// ─────────────────────────────── AI Coach ───────────────────────────────
// Ο coach βλέπει ΜΟΝΟ τα δεδομένα του συνδεδεμένου χρήστη (μέσω req.sb, άρα με RLS)
// και δεν αλλάζει τίποτα μόνος του: οι αλλαγές στο πλάνο γίνονται μόνο όταν ο
// χρήστης πατήσει «Εφάρμοσε» (POST /api/coach/apply-split).
const Anthropic = require("@anthropic-ai/sdk");

const COACH_MODEL = "claude-sonnet-5-5";
const MAX_HISTORY = 20;          // μηνύματα συνομιλίας που στέλνονται κάθε φορά
const MAX_TEXT = 2000;           // χαρακτήρες ανά μήνυμα χρήστη
const MAX_TOOL_ROUNDS = 6;
const RATE_LIMIT = 40;           // μηνύματα ανά ώρα ανά χρήστη
const rateBuckets = new Map();

const EXERCISES = {
  breathing_478: "Αναπνοή 4-7-8",
  breathing_box: "Box Breathing",
  breathing_sigh: "Physiological Sigh",
  pmr: "PMR (μυϊκή χαλάρωση)",
  self_massage: "Self-massage",
  music: "Χαλαρωτική μουσική",
};

const COACH_SYSTEM_PROMPT = `Είσαι ο coach της εφαρμογής Mentor, μιας ελληνικής εφαρμογής που βοηθά τους ανθρώπους να πετυχαίνουν τους στόχους τους χωρίς να φτάνουν στο burnout. Η εφαρμογή έχει Λειτουργία Δράσης (στόχοι με πλάνο σε βήματα) και Λειτουργία Ανάπαυσης (αναπνοές, PMR, self-massage, μουσική).

Ο ρόλος σου:
- Βοηθάς τον χρήστη να προχωρά στους στόχους του με υγιή ρυθμό. Όταν έχει κολλήσει σε ένα βήμα, προτείνεις να το χωρίσετε σε 2-4 μικρότερα, συγκεκριμένα βήματα με το εργαλείο propose_step_split.
- Προσέχεις σημάδια υπερκόπωσης (πολλή δουλειά χωρίς ανάπαυση, δουλειά αργά το βράδυ, κούραση, πίεση) και προτείνεις μια συγκεκριμένη άσκηση με το εργαλείο suggest_rest.
- Όταν ο χρήστης θέλει να καταλάβει καλύτερα κάτι που περνά, προτείνεις μια θεματική από τις Συνεντεύξεις των ψυχολόγων με το εργαλείο suggest_interview.
- Πριν δώσεις συμβουλή για στόχους ή ρυθμό, κοίτα τα πραγματικά δεδομένα με τα get_goals και get_recent_activity. Μην επινοείς στόχους ή βήματα.

Πώς γράφεις:
- Πάντα στα ελληνικά, ζεστά και απλά, σαν έμπειρος φίλος. Σύντομα: συνήθως 2-4 προτάσεις. Χωρίς λίστες με πολλά σημεία και χωρίς markdown (όχι **, #).
- Μία ερώτηση τη φορά. Μην κάνεις κήρυγμα.
- Τα εργαλεία suggest_rest, suggest_interview και propose_step_split εμφανίζουν κουμπιά στον χρήστη. Τα κουμπιά εμφανίζονται ακριβώς κάτω από το μήνυμά σου, οπότε γράψε π.χ. «σου αφήνω παρακάτω…» και όχι «σου πρότεινα». Μην επαναλαμβάνεις στο κείμενο ολόκληρη τη λίστα των νέων βημάτων· πες απλώς τι προτείνεις και ότι μπορεί να το εφαρμόσει με ένα πάτημα.

Όρια:
- Δεν είσαι ψυχολόγος ή θεραπευτής και δεν κάνεις διαγνώσεις. Για βαθύτερα θέματα, πρότεινε να μιλήσει με έναν από τους μέντορες (ψυχολόγους) της εφαρμογής, από την ενότητα «Μέντορες».
- Αν ο χρήστης αναφέρει σκέψεις αυτοτραυματισμού ή αυτοκτονίας, ή ότι κινδυνεύει, σταμάτα την καθοδήγηση για στόχους. Απάντησε με κατανόηση και δώσε αμέσως: Γραμμή Παρέμβασης για την Αυτοκτονία 1018 (24ωρη), Γραμμή Ψυχοκοινωνικής Υποστήριξης 10306 (24ωρη), και 112 για άμεσο κίνδυνο. Ενθάρρυνέ τον να μιλήσει τώρα με κάποιον που εμπιστεύεται.`;

const TOOLS = [
  {
    name: "get_goals",
    description: "Επιστρέφει τους στόχους του χρήστη με τα στάδια και τα βήματά τους (id, τίτλος, δυσκολία, αν ολοκληρώθηκε). Χρησιμοποίησέ το πριν μιλήσεις για συγκεκριμένους στόχους ή πριν προτείνεις να σπάσει ένα βήμα.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_recent_activity",
    description: "Επιστρέφει τη δραστηριότητα των τελευταίων 7 ημερών: πότε ολοκληρώθηκε κάθε βήμα (ώρα Ελλάδας) και πότε έκανε ασκήσεις ανάπαυσης. Χρησιμοποίησέ το για να δεις τον ρυθμό του και αν ξεκουράζεται.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "suggest_rest",
    description: "Δείχνει στον χρήστη ένα κουμπί που ανοίγει απευθείας μια άσκηση της Λειτουργίας Ανάπαυσης. breathing_478: βαθιά χαλάρωση / πριν τον ύπνο. breathing_box: ισορροπία και εστίαση. breathing_sigh: άμεση ανακούφιση από άγχος. pmr: σωματική ένταση. self_massage: πιασμένος αυχένας/ώμοι από πολύωρη δουλειά. music: χαλάρωση με ήχους.",
    input_schema: {
      type: "object",
      properties: {
        exercise: { type: "string", enum: Object.keys(EXERCISES) },
        reason: { type: "string", description: "Μία σύντομη φράση στα ελληνικά για το γιατί." },
      },
      required: ["exercise", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_step_split",
    description: "Προτείνει να αντικατασταθεί ένα βήμα που δεν έχει ολοκληρωθεί από 2-4 μικρότερα, συγκεκριμένα βήματα (από το πιο εύκολο προς το πιο δύσκολο). Ο χρήστης βλέπει την πρόταση και την εφαρμόζει μόνο αν πατήσει «Εφάρμοσε». Το subgoal_id πρέπει να προέρχεται από το get_goals.",
    input_schema: {
      type: "object",
      properties: {
        subgoal_id: { type: "string" },
        new_steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            },
            required: ["title", "difficulty"],
            additionalProperties: false,
          },
        },
      },
      required: ["subgoal_id", "new_steps"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const athensTime = (iso) => new Date(iso).toLocaleString("el-GR", { timeZone: "Europe/Athens", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const athensHour = (iso) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString();

function checkRateLimit(userId) {
  const now = Date.now();
  const recent = (rateBuckets.get(userId) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= RATE_LIMIT) { rateBuckets.set(userId, recent); return false; }
  recent.push(now); rateBuckets.set(userId, recent);
  return true;
}

module.exports = function registerCoachRoutes(app, { apiKey, goalSelect, buildYoutubeSearchUrl, isUuid, sendDbError, interviewThemes = [], hasAiConsent = async () => true, aiConsentError = { error: "Οι λειτουργίες AI είναι απενεργοποιημένες." } }) {
  const client = apiKey ? new Anthropic({ apiKey }) : null;
  const themeIds = interviewThemes.map((t) => t.id);
  const themeList = interviewThemes.map((t) => `${t.id}: «${t.title}»${t.author ? ` (ψυχολόγος: ${t.author.name})` : ""} — ${t.description}`).join("\n");
  const tools = themeIds.length ? [...TOOLS, {
    name: "suggest_interview",
    description: `Δείχνει στον χρήστη κουμπί που ανοίγει μια θεματική από τις Συνεντεύξεις: κείμενα σε μορφή ερωτοαπαντήσεων γραμμένα από τους ψυχολόγους της εφαρμογής. Πρότεινε θεματική όταν ταιριάζει με αυτό που περνά ο χρήστης. Διαθέσιμες θεματικές:
${themeList}`,
    input_schema: {
      type: "object",
      properties: { theme_id: { type: "string", enum: themeIds }, reason: { type: "string", description: "Μία σύντομη φράση στα ελληνικά για το γιατί." } },
      required: ["theme_id", "reason"],
      additionalProperties: false,
    },
    strict: true,
  }] : TOOLS;

  async function loadGoals(req) {
    const { data, error } = await req.sb.from("goals").select(goalSelect).order("created_at");
    if (error) throw error;
    return data;
  }

  async function runTool(req, name, input, collected) {
    if (name === "get_goals") {
      const goals = await loadGoals(req);
      if (!goals.length) return "Ο χρήστης δεν έχει ακόμα κανέναν στόχο.";
      return JSON.stringify(goals.map((g) => ({
        title: g.title, status: g.status, estimated_total_duration: g.estimated_total_duration,
        stages: (g.milestones || []).sort((a, b) => a.position - b.position).map((m) => ({
          title: m.title, status: m.status,
          steps: (m.subgoals || []).sort((a, b) => a.position - b.position).map((s) => ({ subgoal_id: s.id, title: s.title, difficulty: s.difficulty, completed: s.completed })),
        })),
      })));
    }
    if (name === "get_recent_activity") {
      const [steps, rest] = await Promise.all([
        req.sb.from("subgoals").select("title, completed_at").eq("completed", true).gte("completed_at", daysAgo(7)).order("completed_at"),
        req.sb.from("relaxation_sessions").select("type, technique, created_at").gte("created_at", daysAgo(7)).order("created_at"),
      ]);
      if (steps.error) throw steps.error;
      if (rest.error) throw rest.error;
      return JSON.stringify({
        now: athensTime(new Date().toISOString()),
        completed_steps: steps.data.map((s) => ({ title: s.title, when: athensTime(s.completed_at) })),
        rest_sessions: rest.data.map((r) => ({ type: r.type, technique: r.technique, when: athensTime(r.created_at) })),
      });
    }
    if (name === "suggest_rest") {
      if (!EXERCISES[input.exercise]) return { error: "Άγνωστη άσκηση." };
      if (!collected.actions.some((a) => a.exercise === input.exercise)) collected.actions.push({ exercise: input.exercise, label: EXERCISES[input.exercise] });
      return "Το κουμπί για την άσκηση εμφανίστηκε στον χρήστη.";
    }
    if (name === "suggest_interview") {
      const theme = interviewThemes.find((t) => t.id === input.theme_id);
      if (!theme) return { error: "Άγνωστη θεματική." };
      if (!collected.actions.some((a) => a.themeId === theme.id)) collected.actions.push({ themeId: theme.id, label: `Συνεντεύξεις: ${theme.title}` });
      return "Το κουμπί για τη θεματική εμφανίστηκε στον χρήστη.";
    }
    if (name === "propose_step_split") {
      const steps = Array.isArray(input.new_steps) ? input.new_steps.filter((s) => s && typeof s.title === "string" && s.title.trim()) : [];
      if (steps.length < 2 || steps.length > 4) return { error: "Χρειάζονται 2 έως 4 νέα βήματα." };
      if (!isUuid(input.subgoal_id)) return { error: "Μη έγκυρο subgoal_id. Πάρε το id από το get_goals." };
      const { data: sub, error } = await req.sb.from("subgoals").select("id, title, completed").eq("id", input.subgoal_id).maybeSingle();
      if (error) throw error;
      if (!sub) return { error: "Δεν βρέθηκε αυτό το βήμα. Πάρε το id από το get_goals." };
      if (sub.completed) return { error: "Αυτό το βήμα έχει ήδη ολοκληρωθεί." };
      collected.proposals = collected.proposals.filter((p) => p.subgoalId !== sub.id);
      collected.proposals.push({
        subgoalId: sub.id, subgoalTitle: sub.title,
        steps: steps.map((s) => ({ title: s.title.trim().slice(0, 200), difficulty: ["easy", "medium", "hard"].includes(s.difficulty) ? s.difficulty : "easy" })),
      });
      return "Η πρόταση εμφανίστηκε στον χρήστη με κουμπί «Εφάρμοσε». Δεν έχει εφαρμοστεί ακόμα.";
    }
    return { error: `Άγνωστο εργαλείο: ${name}` };
  }

  // Συνομιλία με τον coach. Το frontend κρατά το ιστορικό (μόνο κείμενο) και το στέλνει κάθε φορά.
  app.post("/api/coach", async (req, res) => {
    if (!client) return res.status(503).json({ error: "Ο coach δεν είναι διαθέσιμος αυτή τη στιγμή." });
    const raw = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
    const history = raw.slice(-MAX_HISTORY)
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
      .map((m) => ({ role: m.role, content: m.text.trim().slice(0, MAX_TEXT) }));
    while (history.length && history[0].role !== "user") history.shift();
    if (!history.length || history[history.length - 1].role !== "user") return res.status(400).json({ error: "Γράψε πρώτα ένα μήνυμα." });
    if (!(await hasAiConsent(req))) return res.status(403).json(aiConsentError);
    if (!checkRateLimit(req.userId)) return res.status(429).json({ error: "Στείλατε πολλά μηνύματα σε λίγη ώρα. Δοκίμασε ξανά σε λίγο." });

    const { data: me } = await req.sb.from("profiles").select("username").eq("id", req.userId).maybeSingle();
    const system = [
      { type: "text", text: COACH_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Ο χρήστης λέγεται «${(me && me.username) || "φίλε"}». Τώρα είναι ${athensTime(new Date().toISOString())} (ώρα Ελλάδας).` },
    ];
    const messages = history;
    const collected = { actions: [], proposals: [] };
    try {
      let response;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        response = await client.beta.messages.create({
          model: COACH_MODEL,
          max_tokens: 4000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system, tools, messages,
        });
        if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
        if (response.stop_reason !== "tool_use") break;
        messages.push({ role: "assistant", content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          try {
            const out = await runTool(req, block.name, block.input || {}, collected);
            toolResults.push(typeof out === "string"
              ? { type: "tool_result", tool_use_id: block.id, content: out }
              : { type: "tool_result", tool_use_id: block.id, content: out.error, is_error: true });
          } catch (e) {
            console.error("Coach tool error:", block.name, e.message);
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Σφάλμα κατά την ανάγνωση των δεδομένων.", is_error: true });
          }
        }
        messages.push({ role: "user", content: toolResults });
      }
      let reply = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (response.stop_reason === "refusal") {
        reply = "Δεν μπορώ να βοηθήσω με αυτό εδώ. Αν περνάς κάτι δύσκολο, μίλησε με έναν από τους μέντορες της εφαρμογής ή κάλεσε το 10306 (24ωρη γραμμή υποστήριξης). Για άμεσο κίνδυνο κάλεσε το 112.";
      }
      if (!reply) reply = collected.proposals.length || collected.actions.length ? "Δες την πρότασή μου παρακάτω." : "Συγγνώμη, δεν κατάφερα να απαντήσω. Δοκίμασε ξανά.";
      res.json({ reply, actions: collected.actions, proposals: collected.proposals });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Ο coach έχει πολλή κίνηση. Δοκίμασε ξανά σε λίγο." });
      if (e instanceof Anthropic.APIError) { console.error("Coach API error:", e.status, e.message); return res.status(502).json({ error: "Ο coach δεν απάντησε. Δοκίμασε ξανά." }); }
      console.error("Coach error:", e);
      res.status(500).json({ error: "Κάτι πήγε στραβά με τον coach." });
    }
  });

  // Εφαρμογή της πρότασης: το βήμα γίνεται το πρώτο από τα νέα βήματα και τα υπόλοιπα μπαίνουν αμέσως μετά.
  app.post("/api/coach/apply-split", async (req, res) => {
    try {
      const { subgoalId, steps } = req.body || {};
      const clean = Array.isArray(steps) ? steps.filter((s) => s && typeof s.title === "string" && s.title.trim()).map((s) => ({
        title: s.title.trim().slice(0, 200), difficulty: ["easy", "medium", "hard"].includes(s.difficulty) ? s.difficulty : "easy",
      })) : [];
      if (!isUuid(subgoalId) || clean.length < 2 || clean.length > 4) return res.status(400).json({ error: "Μη έγκυρη πρόταση." });
      const { data: sub, error } = await req.sb.from("subgoals").select("id, milestone_id, goal_id, position, completed").eq("id", subgoalId).maybeSingle();
      if (error) return sendDbError(res, error);
      if (!sub) return res.status(404).json({ error: "Δεν βρέθηκε το βήμα." });
      if (sub.completed) return res.status(409).json({ error: "Αυτό το βήμα έχει ήδη ολοκληρωθεί." });
      const { data: goal } = await req.sb.from("goals").select("title").eq("id", sub.goal_id).single();
      const goalTitle = goal ? goal.title : "";

      const { data: later, error: laterErr } = await req.sb.from("subgoals").select("id, position").eq("milestone_id", sub.milestone_id).gt("position", sub.position).order("position", { ascending: false });
      if (laterErr) return sendDbError(res, laterErr);
      const shift = clean.length - 1;
      for (const s of later) {
        const { error: e } = await req.sb.from("subgoals").update({ position: s.position + shift }).eq("id", s.id);
        if (e) return sendDbError(res, e);
      }
      const [first, ...rest] = clean;
      const { error: updErr } = await req.sb.from("subgoals").update({ title: first.title, difficulty: first.difficulty, youtube_search_url: buildYoutubeSearchUrl(first.title, goalTitle) }).eq("id", sub.id);
      if (updErr) return sendDbError(res, updErr);
      const { error: insErr } = await req.sb.from("subgoals").insert(rest.map((s, i) => ({
        milestone_id: sub.milestone_id, goal_id: sub.goal_id, title: s.title, difficulty: s.difficulty,
        position: sub.position + 1 + i, youtube_search_url: buildYoutubeSearchUrl(s.title, goalTitle),
      })));
      if (insErr) return sendDbError(res, insErr);
      res.json({ ok: true, goalId: sub.goal_id });
    } catch (e) {
      console.error("Apply split error:", e);
      res.status(500).json({ error: "Δεν εφαρμόστηκε η αλλαγή. Δοκίμασε ξανά." });
    }
  });

  // ── Η εβδομάδα σου ── Αριθμοί από τη βάση + σύντομη ανάλυση και πλάνο από τον coach.
  // Η ανάλυση κρατιέται για την ίδια μέρα, ώστε να μην πληρώνεται κλήση στο Claude σε κάθε άνοιγμα.
  const weeklyCache = new Map();
  const athensDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(d);
  const WEEKLY_SCHEMA = {
    type: "object",
    properties: {
      summary: { type: "string", description: "2-3 προτάσεις: πώς πήγε η εβδομάδα, με έμφαση στην ισορροπία δράσης και ανάπαυσης." },
      next_week: { type: "array", items: { type: "string" }, description: "1-3 συγκεκριμένες, μικρές προτάσεις για την επόμενη εβδομάδα." },
      theme_id: { type: "string", description: "Το id της θεματικής Συνεντεύξεων που ταιριάζει περισσότερο, ή none." },
      theme_reason: { type: "string", description: "Μία σύντομη φράση για το γιατί ταιριάζει η θεματική (κενό αν none)." },
    },
    required: ["summary", "next_week", "theme_id", "theme_reason"],
    additionalProperties: false,
  };

  app.get("/api/coach/weekly", async (req, res) => {
    try {
      const [steps, rest, goals, me] = await Promise.all([
        req.sb.from("subgoals").select("title, completed_at, goal_id").eq("completed", true).gte("completed_at", daysAgo(7)).order("completed_at"),
        req.sb.from("relaxation_sessions").select("type, technique, created_at").gte("created_at", daysAgo(7)).order("created_at"),
        loadGoals(req),
        req.sb.from("profiles").select("username").eq("id", req.userId).maybeSingle(),
      ]);
      if (steps.error) return sendDbError(res, steps.error);
      if (rest.error) return sendDbError(res, rest.error);

      // Ανά μέρα (τελευταίες 7, ώρα Ελλάδας), για το μικρό γράφημα.
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400e3);
        days.push({ day: athensDay(d), label: d.toLocaleDateString("el-GR", { timeZone: "Europe/Athens", weekday: "short" }), steps: 0, rest: 0 });
      }
      const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
      steps.data.forEach((s) => { const d = byDay[athensDay(new Date(s.completed_at))]; if (d) d.steps++; });
      rest.data.forEach((r) => { const d = byDay[athensDay(new Date(r.created_at))]; if (d) d.rest++; });
      const lateNight = steps.data.filter((s) => { const h = athensHour(s.completed_at); return h >= 23 || h < 5; }).length;
      const goalTitles = Object.fromEntries(goals.map((g) => [g.id, g.title]));
      const active = goals.filter((g) => g.status === "active").map((g) => {
        const all = (g.milestones || []).sort((a, b) => a.position - b.position).flatMap((m) => (m.subgoals || []).sort((a, b) => a.position - b.position));
        const next = all.find((s) => !s.completed);
        return { title: g.title, done: all.filter((s) => s.completed).length, total: all.length, nextStep: next ? next.title : null };
      });
      const stats = {
        steps: steps.data.length, rest: rest.data.length, lateNight,
        activeDays: days.filter((d) => d.steps > 0).length, restDays: days.filter((d) => d.rest > 0).length,
      };
      const base = { stats, days: days.map(({ label, steps: s, rest: r }) => ({ label, steps: s, rest: r })), activeGoals: active };

      // Χωρίς συγκατάθεση για AI δείχνουμε μόνο τους αριθμούς.
      if (!(await hasAiConsent(req))) return res.json({ ...base, coach: null, aiDisabled: true });
      // Χωρίς καμία δραστηριότητα δεν χρειάζεται κλήση στο Claude.
      if (!stats.steps && !stats.rest) {
        return res.json({ ...base, coach: {
          summary: "Αυτή την εβδομάδα δεν κατέγραψες βήματα ή ανάπαυση. Δεν πειράζει: κάθε εβδομάδα είναι μια νέα αρχή.",
          nextWeek: active.length && active[0].nextStep ? [`Ξεκίνα με ένα μόνο βήμα: «${active[0].nextStep}».`, "Κάνε μία άσκηση αναπνοής στο τέλος μιας κουραστικής μέρας."] : ["Φτιάξε έναν μικρό στόχο στη Λειτουργία Δράσης.", "Κάνε μία άσκηση αναπνοής στο τέλος μιας κουραστικής μέρας."],
          theme: interviewThemes[0] ? { id: interviewThemes[0].id, title: interviewThemes[0].title, reason: "Για να ξεκινήσεις με τα βασικά." } : null,
        } });
      }

      const cacheKey = `${req.userId}:${athensDay(new Date())}:${stats.steps}:${stats.rest}`;
      if (weeklyCache.has(cacheKey)) return res.json({ ...base, coach: weeklyCache.get(cacheKey) });
      if (!client) return res.json({ ...base, coach: null });
      if (!checkRateLimit(req.userId)) return res.json({ ...base, coach: null });

      const facts = {
        user: (me.data && me.data.username) || "",
        today: athensTime(new Date().toISOString()),
        stats, per_day: base.days,
        completed_steps: steps.data.map((s) => ({ step: s.title, goal: goalTitles[s.goal_id] || "", when: athensTime(s.completed_at) })),
        rest_sessions: rest.data.map((r) => ({ type: r.type, technique: r.technique, when: athensTime(r.created_at) })),
        active_goals: active,
        interview_themes: interviewThemes.map((t) => ({ id: t.id, title: t.title, description: t.description })),
      };
      let response;
      try {
        response = await client.beta.messages.create({
        model: COACH_MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: WEEKLY_SCHEMA } },
        system: `${COACH_SYSTEM_PROMPT}\n\nΤώρα γράφεις την εβδομαδιαία σύνοψη του χρήστη, με βάση ΜΟΝΟ τα δεδομένα που σου δίνονται. Μίλα στον χρήστη στο δεύτερο πρόσωπο. Αναγνώρισε ό,τι πήγε καλά, και αν έλειψε η ανάπαυση ή δούλεψε αργά το βράδυ πες το ήπια. Οι προτάσεις για την επόμενη εβδομάδα να είναι μικρές και συγκεκριμένες, π.χ. ένα συγκεκριμένο επόμενο βήμα ή μια άσκηση ανάπαυσης (αναπνοή 4-7-8, Box Breathing, Physiological Sigh, PMR, self-massage, μουσική).`,
        messages: [{ role: "user", content: JSON.stringify(facts) }],
        });
      } catch (e) {
        // Αν ο coach δεν απαντήσει, δείχνουμε τουλάχιστον τους αριθμούς.
        console.error("Weekly AI error:", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
        return res.json({ ...base, coach: null });
      }
      if (response.stop_reason !== "end_turn") return res.json({ ...base, coach: null });
      let out;
      try { out = JSON.parse(response.content.filter((b) => b.type === "text").map((b) => b.text).join("")); }
      catch (e) { return res.json({ ...base, coach: null }); }
      const theme = interviewThemes.find((t) => t.id === out.theme_id);
      const coach = {
        summary: String(out.summary || "").trim(),
        nextWeek: (Array.isArray(out.next_week) ? out.next_week : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
        theme: theme ? { id: theme.id, title: theme.title, reason: String(out.theme_reason || "").trim() } : null,
      };
      weeklyCache.set(cacheKey, coach);
      res.json({ ...base, coach });
    } catch (e) {
      if (e instanceof Anthropic.APIError) console.error("Weekly API error:", e.status, e.message);
      else console.error("Weekly error:", e);
      res.status(500).json({ error: "Δεν ήταν δυνατή η σύνοψη της εβδομάδας. Δοκίμασε ξανά." });
    }
  });

  // Ειδοποίηση στην αρχική. Απλοί κανόνες χωρίς AI, ώστε να μην κοστίζει τίποτα.
  app.get("/api/coach/nudge", async (req, res) => {
    try {
      const [steps, rest, goals] = await Promise.all([
        req.sb.from("subgoals").select("completed_at").eq("completed", true).gte("completed_at", daysAgo(5)),
        req.sb.from("relaxation_sessions").select("created_at").gte("created_at", daysAgo(2)),
        req.sb.from("goals").select("title, status, created_at").eq("status", "active").order("created_at", { ascending: false }),
      ]);
      for (const r of [steps, rest, goals]) if (r.error) return sendDbError(res, r.error);
      const last48 = steps.data.filter((s) => s.completed_at >= daysAgo(2)).length;
      const lateNight = steps.data.filter((s) => s.completed_at >= daysAgo(3)).filter((s) => { const h = athensHour(s.completed_at); return h >= 23 || h < 5; }).length;
      if (last48 >= 4 && rest.data.length === 0) {
        return res.json({ nudge: { id: "busy", text: `Ολοκλήρωσες ${last48} βήματα τις τελευταίες 2 μέρες χωρίς διάλειμμα. Θες 3 λεπτά αναπνοή;`, action: { exercise: "breathing_478", label: "Ναι, τώρα" } } });
      }
      if (lateNight >= 2) {
        return res.json({ nudge: { id: "late", text: `Δούλεψες ${lateNight} φορές μετά τις 23:00 τις τελευταίες μέρες. Μια σύντομη χαλάρωση πριν τον ύπνο;`, action: { exercise: "pmr", label: "Ναι, τώρα" } } });
      }
      const stale = goals.data.find((g) => g.created_at < daysAgo(5));
      if (stale && steps.data.length === 0) {
        return res.json({ nudge: { id: "stuck", text: `Ο στόχος «${stale.title}» περιμένει λίγες μέρες. Θες να σπάσουμε το επόμενο βήμα σε μικρότερα;`, coachPrompt: `Έχω κολλήσει στον στόχο «${stale.title}». Με βοηθάς να σπάσουμε το επόμενο βήμα σε μικρότερα;`, actionLabel: "Μίλα με τον coach" } });
      }
      // Κάθε Κυριακή: η σύνοψη της εβδομάδας είναι έτοιμη.
      if (new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "short" }).format(new Date()) === "Sun") {
        return res.json({ nudge: { id: `weekly-${athensDay(new Date())}`, text: "Η σύνοψη της εβδομάδας σου είναι έτοιμη: τι πέτυχες, πόσο ξεκουράστηκες και ένα μικρό πλάνο για την επόμενη.", screen: "weekly", actionLabel: "Δες τη" } });
      }
      res.json({ nudge: null });
    } catch (e) {
      console.error("Nudge error:", e);
      res.json({ nudge: null });
    }
  });
};
