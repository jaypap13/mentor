const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Αν κάποιο request ξεπεράσει το όριο μεγέθους παραπάνω, επιστρέφουμε καθαρό
// JSON σφάλμα (αντί για το προεπιλεγμένο HTML error page του Express) ώστε
// το frontend να μπορεί να δείξει ένα κατανοητό μήνυμα στον χρήστη.
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Τα αρχεία που επισύναψες είναι πολύ μεγάλα συνολικά. Δοκίμασε λιγότερα ή μικρότερα αρχεία." });
  }
  next(err);
});

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-5";

const db = { profiles: [], goals: [], relaxationSessions: [], forumPosts: [], messages: [], forumMedia: [] };

// Φωτογραφίες/βίντεο του φόρουμ αποθηκεύονται ως αρχεία στο backend/uploads.
// Τα δεδομένα στη μνήμη χάνονται σε κάθε επανεκκίνηση, οπότε καθαρίζουμε και τα αρχεία.
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let idCounter = 1;
function nextId(prefix) { return `${prefix}_${idCounter++}_${Date.now().toString(36)}`; }

async function callClaude(systemPrompt, userMessage, maxTokens = 1500) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
  });
  if (!response.ok) throw new Error(`Anthropic API error (${response.status}): ${await response.text()}`);
  const data = await response.json();
  return data.content.map((b) => b.text || "").join("");
}

function extractJson(rawText) {
  let cleaned = rawText.replace(/```json|```/g, "").trim();
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("Η απάντηση δεν περιείχε έγκυρο JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildYoutubeSearchUrl(subgoalTitle, goalTitle) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${subgoalTitle} ${goalTitle || ""}`.trim())}`;
}

const VALID_ROLES = ["mentor", "user"];
function getProfileFromRequest(req) {
  const profileId = req.header("x-profile-id") || req.query.profileId;
  if (!profileId) return null;
  return db.profiles.find((p) => p.id === profileId) || null;
}

app.get("/api/profiles", (req, res) => res.json(db.profiles));
app.get("/api/profiles/:id", (req, res) => {
  const profile = db.profiles.find((p) => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Δεν βρέθηκε το προφίλ." });
  res.json(profile);
});

app.post("/api/profiles", (req, res) => {
  const { username, avatar, role, bio, photo } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: "Χρειάζεται username." });
  const trimmedUsername = username.trim();
  const taken = db.profiles.some((p) => p.username.toLowerCase() === trimmedUsername.toLowerCase());
  if (taken) return res.status(400).json({ error: "Αυτό το username χρησιμοποιείται ήδη από άλλο προφίλ. Διάλεξε διαφορετικό." });
  const profile = {
    id: nextId("profile"), username: trimmedUsername, avatar: avatar || "🙂", photo: photo || null,
    bio: (bio || "").trim().slice(0, 240), role: VALID_ROLES.includes(role) ? role : "user", createdAt: new Date().toISOString(),
  };
  db.profiles.push(profile);
  res.status(201).json(profile);
});

app.patch("/api/profiles/:id", (req, res) => {
  const profile = db.profiles.find((p) => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Δεν βρέθηκε το προφίλ." });
  const { username, avatar, role, bio, photo } = req.body;
  if (username && username.trim()) {
    const trimmedUsername = username.trim();
    const taken = db.profiles.some((p) => p.id !== profile.id && p.username.toLowerCase() === trimmedUsername.toLowerCase());
    if (taken) return res.status(400).json({ error: "Αυτό το username χρησιμοποιείται ήδη από άλλο προφίλ. Διάλεξε διαφορετικό." });
    profile.username = trimmedUsername;
  }
  if (avatar) profile.avatar = avatar;
  if (role && VALID_ROLES.includes(role)) profile.role = role;
  if (typeof bio === "string") profile.bio = bio.trim().slice(0, 240);
  if (photo !== undefined) profile.photo = photo || null;
  db.forumPosts.forEach((post) => {
    if (post.profileId === profile.id) { post.author = profile.username; post.avatar = profile.avatar; post.photo = profile.photo; }
  });
  res.json(profile);
});

const PLANNER_SYSTEM_PROMPT = `Είσαι ένας έμπειρος, υποστηρικτικός μέντορας goal-setting, εξειδικευμένος στο να βοηθάς ανθρώπους να πετυχαίνουν στόχους ΧΩΡΙΣ να καίγονται.
Σκέψου εσωτερικά (χωρίς να το τυπώσεις): 1) λογικά, διαδοχικά milestones (WBS-style), 2) SMART subgoals ανά milestone, 3) αυξανόμενη δυσκολία μέσα σε κάθε milestone (easy/medium/hard), 4) ρεαλιστικές εκτιμήσεις χρόνου με χώρο για ανάπαυση.
Απάντησε ΑΠΟΚΛΕΙΣΤΙΚΑ με έγκυρο JSON, χωρίς markdown fences, ξεκινώντας με "{" και τελειώνοντας με "}":
{"goal":"...", "estimated_total_duration":"...", "milestones":[{"title":"...", "estimated_duration":"...", "subgoals":[{"title":"...", "difficulty":"easy"}]}]}
Κανόνες: 3-5 milestones, 2-4 subgoals ανά milestone, πάντα easy→hard μέσα σε κάθε milestone.`;

const CELEBRATION_SYSTEM_PROMPT = `Είσαι θερμός μέντορας. Ο χρήστης μόλις ολοκλήρωσε ένα subgoal. Γράψε ΕΝΑ σύντομο μήνυμα επιβράβευσης (1-2 προτάσεις, έως ~30 λέξεις). Μόνο το μήνυμα, χωρίς εισαγωγικά.`;

app.post("/api/plan", async (req, res) => {
  try {
    const profile = getProfileFromRequest(req);
    if (!profile) return res.status(401).json({ error: "Χρειάζεται επιλεγμένο προφίλ." });
    const { goal, attachments } = req.body;
    if (!goal || !goal.trim()) return res.status(400).json({ error: "Λείπει το πεδίο 'goal'." });

    // Αν ο χρήστης επισύναψε αναγνώσιμα αρχεία (.txt/.md/.csv/.json — το
    // frontend τα διαβάζει ήδη σε καθαρό κείμενο), τα προσθέτουμε στο μήνυμα
    // προς τον μέντορα ώστε να τα λάβει πραγματικά υπόψη στο πλάνο.
    let userMessage = `Ο στόχος μου είναι: ${goal}`;
    const readableAttachments = Array.isArray(attachments) ? attachments.filter((a) => a.extractedText) : [];
    if (readableAttachments.length) {
      userMessage += `\n\nΟ χρήστης επισύναψε επίσης τα παρακάτω αρχεία — λάβε υπόψη το περιεχόμενό τους όπου είναι σχετικό με τον στόχο:\n`;
      readableAttachments.forEach((a) => {
        userMessage += `\n--- Αρχείο: ${a.name} ---\n${a.extractedText}\n`;
      });
    }

    const parsed = extractJson(await callClaude(PLANNER_SYSTEM_PROMPT, userMessage, 4000));
    const goalRecord = {
      id: nextId("goal"), profileId: profile.id, title: parsed.goal || goal,
      estimated_total_duration: parsed.estimated_total_duration || "", createdAt: new Date().toISOString(),
      completedAt: null, status: "active",
      // Αρχεία που επισύναψε ο χρήστης κατά τη δημιουργία (base64 data URLs,
      // ίδιο μοτίβο με τις φωτογραφίες προφίλ — απλό για MVP σε μνήμη).
      // Το extractedText (όπου υπάρχει) ήδη χρησιμοποιήθηκε παραπάνω στο prompt.
      attachments: Array.isArray(attachments) ? attachments.map((a) => ({ name: a.name, type: a.type || "", dataUrl: a.dataUrl })) : [],
      milestones: (parsed.milestones || []).map((m, mi) => ({
        id: nextId("mile"), title: m.title, estimated_duration: m.estimated_duration || "", order: mi,
        status: mi === 0 ? "active" : "pending",
        subgoals: (m.subgoals || []).map((s, si) => ({
          id: nextId("sub"), title: s.title, difficulty: ["easy","medium","hard"].includes(s.difficulty) ? s.difficulty : "easy",
          order: si, completed: false, completedAt: null, youtubeSearchUrl: buildYoutubeSearchUrl(s.title, parsed.goal || goal),
        })),
      })),
    };
    db.goals.push(goalRecord);
    res.json(goalRecord);
  } catch (err) {
    res.status(500).json({ error: "Κάτι πήγε στραβά κατά τη δημιουργία του πλάνου.", details: String(err.message || err) });
  }
});

app.get("/api/goals", (req, res) => {
  const profile = getProfileFromRequest(req);
  res.json(profile ? db.goals.filter((g) => g.profileId === profile.id) : []);
});
app.get("/api/goals/:id", (req, res) => {
  const goal = db.goals.find((g) => g.id === req.params.id);
  if (!goal) return res.status(404).json({ error: "Δεν βρέθηκε." });
  res.json(goal);
});
app.delete("/api/goals/:id", (req, res) => {
  const idx = db.goals.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Δεν βρέθηκε." });
  db.goals.splice(idx, 1);
  res.json({ deleted: true, id: req.params.id });
});

app.patch("/api/subgoals/:id/toggle", async (req, res) => {
  try {
    let target = null, parentMilestone = null, parentGoal = null;
    for (const goal of db.goals) {
      for (const m of goal.milestones) {
        const s = m.subgoals.find((s) => s.id === req.params.id);
        if (s) { target = s; parentMilestone = m; parentGoal = goal; break; }
      }
      if (target) break;
    }
    if (!target) return res.status(404).json({ error: "Δεν βρέθηκε το subgoal." });
    target.completed = !target.completed;
    target.completedAt = target.completed ? new Date().toISOString() : null;
    const allDone = parentMilestone.subgoals.every((s) => s.completed);
    parentMilestone.status = allDone ? "completed" : "active";
    const mi = parentGoal.milestones.findIndex((m) => m.id === parentMilestone.id);
    if (allDone && parentGoal.milestones[mi + 1]) parentGoal.milestones[mi + 1].status = "active";
    const allMilestonesDone = parentGoal.milestones.every((m) => m.status === "completed");
    const wasCompleted = parentGoal.status === "completed";
    parentGoal.status = allMilestonesDone ? "completed" : "active";
    if (allMilestonesDone && !wasCompleted) parentGoal.completedAt = new Date().toISOString();
    else if (!allMilestonesDone) parentGoal.completedAt = null;
    let celebrationMessage = null;
    if (target.completed && ANTHROPIC_API_KEY) {
      try { celebrationMessage = (await callClaude(CELEBRATION_SYSTEM_PROMPT, `Subgoal: "${target.title}" (${target.difficulty})`, 100)).trim(); } catch (e) {}
    }
    res.json({ subgoal: target, celebrationMessage, goalStatus: parentGoal.status, milestoneStatus: parentMilestone.status });
  } catch (err) { res.status(500).json({ error: "Κάτι πήγε στραβά." }); }
});

app.post("/api/relaxation-sessions", (req, res) => {
  const profile = getProfileFromRequest(req);
  const { type, technique, context } = req.body;
  const session = { id: nextId("relax"), profileId: profile ? profile.id : null, type: type || "breathing", technique: technique || null, context: context || "manual", timestamp: new Date().toISOString() };
  db.relaxationSessions.push(session);
  res.json(session);
});
app.get("/api/relaxation-sessions", (req, res) => res.json(db.relaxationSessions));

app.get("/api/stats", (req, res) => {
  const profile = getProfileFromRequest(req);
  const myGoals = profile ? db.goals.filter((g) => g.profileId === profile.id) : [];
  const completed = myGoals.filter((g) => g.status === "completed" && g.completedAt);
  const goalsWithDuration = completed.map((g) => ({
    id: g.id, title: g.title, createdAt: g.createdAt, completedAt: g.completedAt,
    durationMs: Math.max(0, new Date(g.completedAt) - new Date(g.createdAt)),
  })).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const total = goalsWithDuration.reduce((s, g) => s + g.durationMs, 0);
  res.json({
    totalCompletedGoals: goalsWithDuration.length, totalActiveGoals: myGoals.filter((g) => g.status === "active").length,
    averageDurationMs: goalsWithDuration.length ? Math.round(total / goalsWithDuration.length) : 0, goals: goalsWithDuration,
  });
});

const BURNOUT_INFO = [
  { title: "Τι είναι το burnout", body: "Το burnout είναι η εξάντληση που έρχεται όταν για πολύ καιρό πιέζεσαι περισσότερο απ’ όσο μπορείς να ανακάμψεις — σωματικά, συναισθηματικά και νοητικά. Στην εργασία, οι μη ρεαλιστικές απαιτήσεις επειδή «σε πληρώνουν», ο/η manager που υποτιμά, πιέζει ή εκφοβίζει, ο ατελείωτος φόρτος ή η αίσθηση ότι αυτό που κάνεις δεν έχει πια νόημα μπορούν σταδιακά να σε αδειάσουν. Η χρόνια εξάντληση όμως δεν γεννιέται μόνο στο γραφείο: φροντίδα άλλων, οικονομική πίεση, δύσκολες σχέσεις ή συνεχείς απαιτήσεις χωρίς χώρο για ανάκαμψη μπορούν να δημιουργήσουν μια πολύ παρόμοια εμπειρία. Ο Παγκόσμιος Οργανισμός Υγείας χρησιμοποιεί τον όρο burnout ειδικά για το εργασιακό πλαίσιο και το αναγνωρίζει ως επαγγελματικό φαινόμενο, όχι ως ιατρική διάγνωση." },
  { title: "Τα τρία βασικά χαρακτηριστικά", body: "1. Έχεις αδειάσει. Κοιμάσαι, τρως, ξεκουράζεσαι — αλλά η ενέργεια δεν επιστρέφει πραγματικά. 2. Έχεις αποστασιοποιηθεί. Δεν θυμάσαι πια γιατί κάνεις αυτή τη δουλειά. Εκεί που κάποτε σε ένοιαζε, τώρα υπάρχει όλο και περισσότερο ένα «δεν με νοιάζει». 3. Δεν αποδίδεις όπως πριν. Η συγκέντρωση δυσκολεύει, η διάθεση να προσπαθήσεις μειώνεται και πράγματα που κάποτε έκανες εύκολα τώρα σου κοστίζουν πολύ περισσότερο. Δεν είναι απλώς «είμαι κουρασμένος/η». Είναι περισσότερο «δεν έχω άλλο να δώσω»." },
  { title: "Γιατί η προοδευτική δυσκολία βοηθάει", body: "Οι περισσότεροι έχουμε την τάση να βάζουμε μη ρεαλιστικούς στόχους — από υπεραπαίτηση, τελειομανία, έλλειψη υπομονής ή πειθαρχίας. Η προοδευτική δυσκολία κάνει κάτι πολύ απλό: σπάει τον στόχο σε εφικτά βήματα, ώστε να μην πας στο κλασικό μοτίβο μη ρεαλιστικός στόχος → απογοήτευση → εγκατάλειψη στόχου → ενοχές → θέσιμο υψηλότερου στόχου (κλασικός φαύλος κύκλος). Με αυτό το μοντέλο, χτίζεις stamina και αυτοπεποίθηση που χρειάζεται για να αντέξεις όλο και μεγαλύτερη δυσκολία και να ολοκληρώσεις τον στόχο σου. Τόσο απλό." },
  { title: "Ο ρόλος της ανάπαυσης", body: "Σκέψου την ανάπαυση σαν το καύσιμο που σου επιτρέπει να συνεχίσεις. Χωρίς επαρκή αποφόρτιση, κάποια στιγμή δεν έχει σημασία πόσο προσπαθείς — απλώς δεν έχεις άλλα αποθέματα. Υπάρχουν μελετημένα εργαλεία όπως η καθοδηγούμενη αναπνοή, η μυϊκή χαλάρωση ή ακόμη και η μουσική που σε βοηθούν να γεμίσεις μπαταρίες, και όχι, δεν είναι «χάσιμο χρόνου». Στο site θα βρεις πολλά εργαλεία που θα σε βοηθήσουν να συνεχίσεις είτε χρειάζεσαι άδειασμα του μυαλό, αποφόρτιση σωματικής έντασης, καθησυχασμό από το άγχος και εξισορρόπηση της σκέψης αν σου λείπει η συγκέντρωση κ.α." },
  { title: "Πότε να ζητήσεις βοήθεια", body: "Δεν χρειάζεται να το σηκώνεις μόνος/η σου. Το burnout δεν συμβαίνει σε κενό. Εξωτερικές πιέσεις, απαιτητικά ή τοξικά περιβάλλοντα, εργασιακές κουλτούρες και δύσκολες συνεργασίες μπορούν να σε φέρουν στα όριά σου. Και δεν χρειάζεται να το διαχειριστείς μόνος/η σου. Στην κοινότητα μπορείς να επικοινωνήσεις τόσο με άλλα μέλη όσο και με ειδικούς–μέντορες, να μοιραστείς την εμπειρία σου και να πάρεις την υποστήριξη που χρειάζεσαι. Αν όμως η εξάντληση επιμένει, δυσκολεύεσαι να λειτουργήσεις στην καθημερινότητά σου ή νιώθεις ότι δεν είσαι πια ο εαυτός σου, είναι σημαντικό να απευθυνθείς σε ψυχολόγο ή ψυχίατρο." },
];
app.get("/api/burnout-info", (req, res) => res.json(BURNOUT_INFO));

function buildReplyTree(parentId) {
  return db.forumPosts.filter((p) => p.parentId === parentId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((post) => ({ ...post, replies: buildReplyTree(post.id) }));
}
function getRootBoard(postId) {
  let cur = db.forumPosts.find((p) => p.id === postId);
  while (cur && cur.parentId) cur = db.forumPosts.find((p) => p.id === cur.parentId);
  return cur ? cur.board || "a" : null;
}
app.get("/api/forum/posts", (req, res) => {
  const board = req.query.board || "a";
  const top = db.forumPosts.filter((p) => !p.parentId && (p.board || "a") === board).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(top.map((post) => ({ ...post, replies: buildReplyTree(post.id) })));
});
// Φωτογραφία/βίντεο επιτρέπονται μόνο σε νέες δημοσιεύσεις του Learn (board "a"),
// άρα μόνο από μέντορες. Το αρχείο ανεβαίνει πρώτα εδώ (σκέτα bytes, όχι JSON)
// και η δημοσίευση μετά το αναφέρει με το id του.
const FORUM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FORUM_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const rawUpload = express.raw({ type: () => true, limit: FORUM_VIDEO_MAX_BYTES + 1024 * 1024 });
app.post("/api/forum/media", (req, res, next) => rawUpload(req, res, (err) => {
  if (err) return res.status(err.type === "entity.too.large" ? 413 : 400).json({ error: err.type === "entity.too.large" ? "Το αρχείο είναι πολύ μεγάλο." : "Το αρχείο δεν ανέβηκε." });
  next();
}), async (req, res) => {
  const profile = getProfileFromRequest(req);
  if (!profile || profile.role !== "mentor") return res.status(403).json({ error: "Μόνο μέντορες μπορούν να ανεβάσουν αρχεία." });
  const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const type = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : null;
  if (!type || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Μη έγκυρο αρχείο. Ανέβασε φωτογραφία ή βίντεο." });
  if (req.body.length > (type === "video" ? FORUM_VIDEO_MAX_BYTES : FORUM_IMAGE_MAX_BYTES)) {
    return res.status(413).json({ error: type === "video" ? "Το βίντεο είναι πολύ μεγάλο (έως 50 MB)." : "Η φωτογραφία είναι πολύ μεγάλη (έως 5 MB)." });
  }
  const originalName = decodeURIComponent(String(req.headers["x-file-name"] || ""));
  const ext = (path.extname(originalName).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [""])[0];
  const id = nextId("media");
  let file = `${id}${ext}`;
  let finalMime = mime;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), req.body);
  if (type === "video") {
    try {
      const converted = `${id}.mp4`;
      await convertVideoToMp4(path.join(UPLOAD_DIR, file), path.join(UPLOAD_DIR, `${id}.tmp.mp4`));
      fs.rmSync(path.join(UPLOAD_DIR, file), { force: true });
      fs.renameSync(path.join(UPLOAD_DIR, `${id}.tmp.mp4`), path.join(UPLOAD_DIR, converted));
      file = converted; finalMime = "video/mp4";
    } catch (e) {
      // Αν το ffmpeg δεν μπορέσει να το διαβάσει, κρατάμε το αρχικό αρχείο όπως ήταν.
      fs.rmSync(path.join(UPLOAD_DIR, `${id}.tmp.mp4`), { force: true });
      console.error("Μετατροπή βίντεο απέτυχε:", String(e.message || e).slice(0, 300));
    }
  }
  db.forumMedia.push({ id, file, type, mime: finalMime, profileId: profile.id, postId: null });
  res.status(201).json({ id, type });
});
// Κάθε βίντεο γίνεται MP4 (H.264 + AAC), που παίζει σε όλους τους browsers. Αν είναι
// ήδη H.264/AAC, αλλάζει μόνο η "συσκευασία" (γρήγορα, χωρίς απώλεια ποιότητας).
// Αλλιώς (π.χ. HEVC από κινητό, AVI, WMV) ξανακωδικοποιείται, με μέγιστο πλάτος 1920px.
function runFfmpeg(args) {
  return new Promise((resolve, reject) => execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: 10 * 60 * 1000 },
    (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stderr))));
}
async function convertVideoToMp4(input, output) {
  const info = await runFfmpeg(["-hide_banner", "-i", input]).catch((e) => e.stderr || ""); // χωρίς έξοδο, το ffmpeg απλώς περιγράφει το αρχείο
  const videoCodec = (info.match(/Stream #.*Video: (\w+)/) || [])[1];
  const audioCodec = (info.match(/Stream #.*Audio: (\w+)/) || [])[1];
  if (!videoCodec) throw new Error("Δεν βρέθηκε εικόνα στο αρχείο.");
  const canCopy = videoCodec === "h264" && (!audioCodec || audioCodec === "aac") && /yuv420p[,(\s]/.test(info);
  const codecArgs = canCopy
    ? ["-c", "copy"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale='min(1920,iw)':-2", "-c:a", "aac", "-b:a", "128k"];
  await runFfmpeg(["-hide_banner", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", ...codecArgs, "-movflags", "+faststart", output]);
}
app.get("/api/forum/media/:file", (req, res) => {
  const media = db.forumMedia.find((m) => m.file === req.params.file);
  if (!media) return res.status(404).end();
  res.type(media.mime);
  res.sendFile(path.join(UPLOAD_DIR, media.file)); // υποστηρίζει Range, άρα και μετακίνηση μέσα στο βίντεο
});
function deleteMediaOf(post) {
  if (!post.media) return;
  db.forumMedia = db.forumMedia.filter((m) => m.id !== post.media.id);
  fs.rmSync(path.join(UPLOAD_DIR, post.media.file), { force: true });
}
app.post("/api/forum/posts", (req, res) => {
  const { author, message, category, parentId, board, media } = req.body;
  if ((!message || !message.trim()) && !media) return res.status(400).json({ error: "Το μήνυμα δεν μπορεί να είναι κενό." });
  let mediaRecord = null;
  if (media) {
    if (parentId || (board || "a") !== "a") return res.status(400).json({ error: "Φωτογραφίες και βίντεο επιτρέπονται μόνο σε νέες δημοσιεύσεις του Learn." });
    const uploader = getProfileFromRequest(req);
    mediaRecord = db.forumMedia.find((m) => m.id === media.id && !m.postId && uploader && m.profileId === uploader.id);
    if (!mediaRecord) return res.status(400).json({ error: "Το αρχείο δεν βρέθηκε. Ανέβασέ το ξανά." });
  }
  if (parentId && !db.forumPosts.find((p) => p.id === parentId)) return res.status(400).json({ error: "Η αρχική δημοσίευση δεν βρέθηκε." });
  const effectiveBoard = parentId ? getRootBoard(parentId) : (board || "a");
  const profile = getProfileFromRequest(req);
  if (effectiveBoard === "a" && (!profile || profile.role !== "mentor")) {
    return res.status(403).json({ error: "Μόνο μέντορες μπορούν να γράψουν στο Φόρουμ 1. Οι χρήστες μπορούν μόνο να το διαβάζουν." });
  }
  const post = {
    id: nextId("post"), profileId: profile ? profile.id : null, author: (profile && profile.username) || (author && author.trim()) || "Ανώνυμος",
    avatar: (profile && profile.avatar) || null, photo: (profile && profile.photo) || null, category: category || "Γενικά",
    message: (message || "").trim(), createdAt: new Date().toISOString(), parentId: parentId || null, board: parentId ? null : (board || "a"),
    media: mediaRecord ? { id: mediaRecord.id, type: mediaRecord.type, file: mediaRecord.file } : null,
  };
  if (mediaRecord) mediaRecord.postId = post.id;
  db.forumPosts.push(post);
  res.status(201).json(post);
});
// Ο καθένας διαγράφει μόνο τις δικές του δημοσιεύσεις. Μαζί φεύγουν και οι απαντήσεις
// κάτω από αυτήν, όπως και το αρχείο της, αν έχει.
app.delete("/api/forum/posts/:id", (req, res) => {
  const profile = getProfileFromRequest(req);
  const post = db.forumPosts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Η δημοσίευση δεν βρέθηκε." });
  if (!profile || post.profileId !== profile.id) return res.status(403).json({ error: "Μπορείς να διαγράψεις μόνο τις δικές σου δημοσιεύσεις." });
  const toDelete = new Set([post.id]);
  let added = true;
  while (added) {
    added = false;
    db.forumPosts.forEach((p) => { if (p.parentId && toDelete.has(p.parentId) && !toDelete.has(p.id)) { toDelete.add(p.id); added = true; } });
  }
  db.forumPosts.filter((p) => toDelete.has(p.id)).forEach(deleteMediaOf);
  db.forumPosts = db.forumPosts.filter((p) => !toDelete.has(p.id));
  res.json({ ok: true, deleted: toDelete.size });
});
// Οι φωτογραφίες/βίντεο που έχει δημοσιεύσει κάποιος, για το προφίλ του.
app.get("/api/profiles/:id/media", (req, res) => {
  const items = db.forumPosts.filter((p) => p.profileId === req.params.id && p.media)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((p) => ({ postId: p.id, type: p.media.type, file: p.media.file, message: p.message, createdAt: p.createdAt }));
  res.json(items);
});

app.get("/api/messages/conversations", (req, res) => {
  const profile = getProfileFromRequest(req);
  if (!profile) return res.json([]);
  const partnerIds = new Set();
  db.messages.forEach((m) => {
    if (m.fromProfileId === profile.id) partnerIds.add(m.toProfileId);
    if (m.toProfileId === profile.id) partnerIds.add(m.fromProfileId);
  });
  const conversations = Array.from(partnerIds).map((pid) => {
    const partner = db.profiles.find((p) => p.id === pid);
    if (!partner) return null;
    const thread = db.messages.filter((m) => (m.fromProfileId === profile.id && m.toProfileId === pid) || (m.fromProfileId === pid && m.toProfileId === profile.id))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const last = thread[0];
    return { partner: { id: partner.id, username: partner.username, avatar: partner.avatar, photo: partner.photo }, lastMessage: last ? last.text : "", lastAt: last ? last.createdAt : null };
  }).filter(Boolean).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  res.json(conversations);
});
app.get("/api/messages/:otherProfileId", (req, res) => {
  const profile = getProfileFromRequest(req);
  if (!profile) return res.status(401).json({ error: "Χρειάζεται επιλεγμένο προφίλ." });
  const otherId = req.params.otherProfileId;
  const thread = db.messages.filter((m) => (m.fromProfileId === profile.id && m.toProfileId === otherId) || (m.fromProfileId === otherId && m.toProfileId === profile.id))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json(thread);
});
app.post("/api/messages", (req, res) => {
  const profile = getProfileFromRequest(req);
  if (!profile) return res.status(401).json({ error: "Χρειάζεται επιλεγμένο προφίλ." });
  const { toProfileId, text } = req.body;
  if (!toProfileId || !text || !text.trim()) return res.status(400).json({ error: "Λείπει ο παραλήπτης ή το μήνυμα." });
  if (!db.profiles.find((p) => p.id === toProfileId)) return res.status(404).json({ error: "Δεν βρέθηκε ο παραλήπτης." });
  const message = { id: nextId("msg"), fromProfileId: profile.id, toProfileId, text: text.trim(), createdAt: new Date().toISOString() };
  db.messages.push(message);
  res.status(201).json(message);
});

app.get("/api/health", (req, res) => res.json({ ok: true, hasApiKey: Boolean(ANTHROPIC_API_KEY) }));

app.listen(PORT, () => {
  console.log(`✅ Backend τρέχει στο http://localhost:${PORT}`);
  console.log(`   Για πρόσβαση από κινητό στο ίδιο WiFi: βρες την τοπική IP του υπολογιστή σου`);
  console.log(`   (Windows: ipconfig -> IPv4 Address · Mac/Linux: ifconfig ή ip addr) και άνοιξε`);
  console.log(`   το frontend μέσω αυτής, π.χ. http://192.168.1.X:5500`);
});
