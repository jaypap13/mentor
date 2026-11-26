const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
// CORS: στο κοινό internet δέχεται κλήσεις μόνο από τα δικά μας domains (ALLOWED_ORIGINS, χωρισμένα
// με κόμμα, π.χ. "https://mentor.gr,https://app.mentor.gr"). Χωρίς ALLOWED_ORIGINS (τοπική ανάπτυξη)
// δέχεται μόνο τον ίδιο υπολογιστή και το τοπικό δίκτυο (κινητό στο ίδιο WiFi).
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // όχι από browser (π.χ. έλεγχος υγείας του Render)
    if (ALLOWED_ORIGINS.length) return cb(null, ALLOWED_ORIGINS.includes(origin));
    cb(null, LOCAL_ORIGIN.test(origin) || origin === "null"); // "null" = αρχείο ανοιγμένο απευθείας
  },
}));
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
const MODEL = "claude-sonnet-5-5";

// Supabase: βάση δεδομένων, σύνδεση με Google και αρχεία. Το URL και το publishable key
// είναι δημόσια (φτιαγμένα για να μπαίνουν και στην εφαρμογή). Το backend ΔΕΝ χρειάζεται
// μυστικό κλειδί: κάθε εντολή προς τη βάση τρέχει ως ο συνδεδεμένος χρήστης, άρα ισχύουν
// οι κανόνες ασφαλείας του supabase/schema.sql.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://mxdnlamhzglzdtkdwdum.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_8qtezYZ3RRsKj3_1-Tv5RQ_iueN3eS9";
const SUPABASE_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_OPTIONS);

async function callClaude(systemPrompt, userMessage, maxTokens = 1500) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
    // between_tools: χωρίς εκτεταμένη «σκέψη», ώστε όλο το όριο tokens να πηγαίνει στο πλάνο (ίδιο κόστος, χωρίς κομμένες απαντήσεις).
    // fallbacks: αν το Sonnet 5.5 αρνηθεί λανθασμένα, η Anthropic ξαναδοκιμάζει αυτόματα σε άλλο μοντέλο.
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, thinking: { type: "between_tools" }, fallbacks: "default", system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
  });
  if (!response.ok) throw new Error(`Anthropic API error (${response.status}): ${await response.text()}`);
  const data = await response.json();
  if (data.stop_reason === "refusal") throw new Error(`Anthropic refusal (${(data.stop_details && data.stop_details.category) || "unknown"})`);
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

function extractJson(rawText) {
  let cleaned = rawText.replace(/```json|```/g, "").trim();
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("Η απάντηση δεν περιείχε έγκυρο JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Η απόστροφος (π.χ. «Γι' αυτό») κωδικοποιείται κι αυτή (%27): ο κανόνας ασφαλείας της βάσης δεν δέχεται ' στα λινκ.
function youtubeSearchUrlFor(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(String(query).trim()).replace(/'/g, "%27")}`;
}
// Εφεδρικό λινκ (όταν δεν υπάρχουν λέξεις αναζήτησης από το AI, π.χ. στα βήματα του coach).
function buildYoutubeSearchUrl(subgoalTitle, goalTitle) {
  return youtubeSearchUrlFor(`${subgoalTitle} ${goalTitle || ""}`);
}

const VALID_ROLES = ["mentor", "user"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_PATTERN.test(v);

// ─────────────────────────── Ταυτότητα χρήστη ───────────────────────────
// Κάθε κλήση στο /api (εκτός από health και burnout-info) χρειάζεται το token της
// σύνδεσης Google (από το Supabase) στο header Authorization. Το req.sb είναι ένας
// Supabase client που μιλά στη βάση ΩΣ αυτός ο χρήστης.
const PUBLIC_API_PATHS = new Set(["/health", "/burnout-info"]);
app.use("/api", async (req, res, next) => {
  if (req.method === "OPTIONS" || PUBLIC_API_PATHS.has(req.path)) return next();
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Χρειάζεται σύνδεση." });
  try {
    const { data, error } = await authClient.auth.getClaims(token);
    const claims = data && data.claims;
    if (error || !claims || !claims.sub || claims.role !== "authenticated" || claims.is_anonymous) {
      return res.status(401).json({ error: "Η σύνδεσή σου έληξε. Συνδέσου ξανά." });
    }
    req.userId = claims.sub;
    req.claims = claims;
    req.sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { ...SUPABASE_OPTIONS, global: { headers: { Authorization: `Bearer ${token}` } } });
    next();
  } catch (err) {
    // Χαλασμένο token → 401. Μόνο πραγματικό πρόβλημα δικτύου με το Supabase → 503.
    const networkProblem = /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network/i.test(String(err && (err.message || err.cause) || ""));
    if (!networkProblem) return res.status(401).json({ error: "Η σύνδεσή σου έληξε. Συνδέσου ξανά." });
    console.error("Έλεγχος σύνδεσης απέτυχε:", err.message || err);
    res.status(503).json({ error: "Δεν ήταν δυνατή η σύνδεση με τη βάση δεδομένων. Δοκίμασε ξανά." });
  }
});

// Μετατρέπει σφάλματα της βάσης σε κατανοητά μηνύματα.
function sendDbError(res, error, fallback = "Κάτι πήγε στραβά.") {
  const msg = String((error && (error.message || error.details)) || "");
  if (error && error.code === "23505" && msg.includes("profiles_username_lower_idx")) {
    return res.status(400).json({ error: "Αυτό το username χρησιμοποιείται ήδη από άλλο προφίλ. Διάλεξε διαφορετικό." });
  }
  if (error && error.code === "23505" && msg.includes("profiles_pkey")) return res.status(400).json({ error: "Έχεις ήδη δημιουργήσει προφίλ." });
  if (error && error.code === "42501") return res.status(403).json({ error: "Δεν έχεις δικαίωμα για αυτή την ενέργεια." });
  if (error && error.code === "23514") return res.status(400).json({ error: "Κάποιο πεδίο δεν είναι έγκυρο (π.χ. πολύ μεγάλο κείμενο)." });
  if (error && error.status && error.userMessage) return res.status(error.status).json({ error: error.userMessage });
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}
function userError(status, userMessage) { return Object.assign(new Error(userMessage), { status, userMessage }); }

const publicStorageUrl = (bucket, filePath) => `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath.split("/").map(encodeURIComponent).join("/")}`;

// ─────────────────────────────── Προφίλ ───────────────────────────────
// mentor_verified: ο μέντορας έχει εγκριθεί από τον διαχειριστή (βλ. supabase/mentor-verification.sql).
const PROFILE_COLUMNS = "id, username, avatar, photo_url, bio, role, mentor_verified, created_at";
function toProfile(r) {
  return r ? { id: r.id, username: r.username, avatar: r.avatar, photo: r.photo_url, bio: r.bio, role: r.role, mentorVerified: Boolean(r.mentor_verified), createdAt: r.created_at } : null;
}
async function getMyProfile(req) {
  const { data, error } = await req.sb.from("profiles").select(PROFILE_COLUMNS).eq("id", req.userId).maybeSingle();
  if (error) throw error;
  return toProfile(data);
}

// Η φωτογραφία προφίλ έρχεται από την εφαρμογή ως data URL και αποθηκεύεται στο bucket
// "avatars". Επιστρέφει το δημόσιο URL, null για αφαίρεση, ή undefined για "καμία αλλαγή".
const PHOTO_PATTERN = /^data:(image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif));base64,([A-Za-z0-9+/=]+)$/i;
const AVATAR_PREFIX = (userId) => `${SUPABASE_URL}/storage/v1/object/public/avatars/${userId}/`;
async function savePhoto(req, photo) {
  if (photo === undefined) return undefined;
  if (!photo) return null;
  if (typeof photo === "string" && photo.startsWith(AVATAR_PREFIX(req.userId))) return photo;
  const m = typeof photo === "string" && photo.match(PHOTO_PATTERN);
  if (!m) throw userError(400, "Μη έγκυρη φωτογραφία.");
  const buffer = Buffer.from(m[3], "base64");
  if (buffer.length > 5 * 1024 * 1024) throw userError(413, "Η φωτογραφία είναι πολύ μεγάλη (έως 5 MB).");
  const filePath = `${req.userId}/avatar-${Date.now()}.${m[2].toLowerCase().replace("jpeg", "jpg")}`;
  const { error } = await req.sb.storage.from("avatars").upload(filePath, buffer, { contentType: m[1].toLowerCase() });
  if (error) throw error;
  return publicStorageUrl("avatars", filePath);
}
async function removeOldPhoto(req, oldUrl, newUrl) {
  if (!oldUrl || oldUrl === newUrl || !oldUrl.startsWith(AVATAR_PREFIX(req.userId))) return;
  const filePath = decodeURIComponent(oldUrl.slice(`${SUPABASE_URL}/storage/v1/object/public/avatars/`.length));
  await req.sb.storage.from("avatars").remove([filePath]).catch(() => {});
}

// Το προφίλ του συνδεδεμένου χρήστη (null αν δεν έχει φτιάξει ακόμα).
// ─────────────────────────── Συγκαταθέσεις (GDPR) ───────────────────────────
// Όταν έρθουν τα τελικά κείμενα από τον δικηγόρο, άλλαξε την έκδοση: όλοι οι χρήστες
// θα ξαναδούν την οθόνη συγκαταθέσεων στην επόμενη σύνδεση.
const CONSENT_VERSION = "2026-11-draft";
const REQUIRED_CONSENTS = ["age_16", "terms_privacy"];
const AI_CONSENT_ERROR = { error: "Οι λειτουργίες AI είναι απενεργοποιημένες. Μπορείς να τις ενεργοποιήσεις από το προφίλ σου, στο «Τα δεδομένα μου».", code: "ai_consent" };

async function getConsentState(req) {
  const { data, error } = await req.sb.from("consents").select("kind, version, granted, created_at").eq("user_id", req.userId).order("created_at", { ascending: false });
  if (error) throw error;
  const latest = {};
  for (const row of data) if (!latest[row.kind]) latest[row.kind] = row;
  // Η συγκατάθεση υγείας δίνεται στην εγγραφή. Αν ανακληθεί αργότερα, ο χρήστης δεν ξαναβλέπει την
  // οθόνη συγκαταθέσεων: η εφαρμογή λειτουργεί μόνο με ασκήσεις χαλάρωσης και μουσική (health = false).
  const ok = REQUIRED_CONSENTS.every((k) => latest[k] && latest[k].granted && latest[k].version === CONSENT_VERSION)
    && Boolean(latest.health_data && latest.health_data.version === CONSENT_VERSION);
  const health = Boolean(latest.health_data && latest.health_data.granted);
  const ai = Boolean(latest.ai_processing && latest.ai_processing.granted);
  // minor: δήλωσε 16–17 → μια πληρωμένη συνδρομή θα χρειαστεί συναίνεση γονέα.
  const minor = latest.age_18 ? !latest.age_18.granted : null;
  return { ok, health, ai, minor, version: CONSENT_VERSION, aiChangedAt: latest.ai_processing ? latest.ai_processing.created_at : null };
}
// Χωρίς συγκατάθεση για δεδομένα υγείας: μόνο ασκήσεις χαλάρωσης και μουσική. Στόχοι, coach,
// στατιστικά, κοινότητα και μηνύματα δεν είναι διαθέσιμα, και οι ασκήσεις δεν καταγράφονται.
const HEALTH_GATED = /^\/(plan|goals|subgoals|stats|coach|forum|favorites|messages|relaxation-sessions)(\/|$)/;
const HEALTH_CONSENT_ERROR = { error: "Χωρίς τη συγκατάθεση για δεδομένα υγείας, το Mentor λειτουργεί μόνο με τις ασκήσεις χαλάρωσης και τη μουσική. Μπορείς να τη δώσεις ξανά από Προφίλ → Τα δεδομένα μου.", code: "health_consent" };
app.use("/api", async (req, res, next) => {
  if (!req.userId || !HEALTH_GATED.test(req.path)) return next();
  let state;
  try { state = await getConsentState(req); } catch (err) { return next(); } // π.χ. λείπει ο πίνακας: όπως πριν
  if (state.health) return next();
  if (req.method === "POST" && req.path === "/relaxation-sessions") return res.status(204).end(); // δεν καταγράφεται
  res.status(403).json(HEALTH_CONSENT_ERROR);
});
async function hasAiConsent(req) {
  try { return (await getConsentState(req)).ai; } catch (e) { return false; }
}
function sendConsentDbError(res, error) {
  if (error && (error.code === "42P01" || error.code === "PGRST205")) {
    console.error("Λείπει ο πίνακας consents: τρέξε το supabase/consents.sql στο Supabase.");
    return res.status(503).json({ error: "Η εφαρμογή ενημερώνεται. Δοκίμασε ξανά σε λίγο." });
  }
  return sendDbError(res, error);
}

app.get("/api/me", async (req, res) => {
  let profile;
  try { profile = await getMyProfile(req); } catch (err) { return sendDbError(res, err); }
  // Τελευταία χρήση, για τη διαγραφή μετά από 24 μήνες αδράνειας (backend/maintenance.js).
  // Μόλις ξαναμπεί, ακυρώνεται και η προειδοποίηση. Αν λείπουν οι στήλες, απλώς δεν καταγράφεται.
  if (profile) req.sb.from("profiles").update({ last_active_at: new Date().toISOString(), inactivity_warned_at: null }).eq("id", req.userId).then(() => {}, () => {});
  try { res.json({ profile, consents: await getConsentState(req) }); } catch (err) { sendConsentDbError(res, err); }
});

// Πρώτη αποδοχή (ή αποδοχή νέας έκδοσης): ηλικία 16+, όροι/πολιτική και δεδομένα υγείας
// είναι υποχρεωτικά· η χρήση AI είναι προαιρετική.
app.post("/api/consents", async (req, res) => {
  const { age16, adult, termsPrivacy, healthData, ai } = req.body || {};
  if (age16 !== true) return res.status(400).json({ error: "Η εφαρμογή απευθύνεται σε άτομα 16 ετών και άνω." });
  if (typeof adult !== "boolean") return res.status(400).json({ error: "Πες μας αν είσαι 18 ετών ή μεγαλύτερος/η." });
  if (termsPrivacy !== true || healthData !== true) return res.status(400).json({ error: "Για να συνεχίσεις, χρειάζεται να αποδεχτείς τα υποχρεωτικά σημεία." });
  const rows = [
    { kind: "age_16", granted: true }, { kind: "terms_privacy", granted: true }, { kind: "health_data", granted: true },
    { kind: "ai_processing", granted: ai === true },
  ].map((r) => ({ ...r, version: CONSENT_VERSION }));
  const { error } = await req.sb.from("consents").insert(rows);
  if (error) return sendConsentDbError(res, error);
  // Η δήλωση 18+/16–17 γράφεται χωριστά, ώστε να μη μπλοκάρει την είσοδο αν η βάση δεν έχει
  // ενημερωθεί ακόμα με το supabase/consents-age.sql.
  const { error: ageError } = await req.sb.from("consents").insert({ kind: "age_18", granted: adult, version: CONSENT_VERSION });
  if (ageError) console.error("Η δήλωση ηλικίας δεν αποθηκεύτηκε (τρέξε το supabase/consents-age.sql):", ageError.message);
  try { res.json({ consents: await getConsentState(req) }); } catch (err) { sendConsentDbError(res, err); }
});

// Ανάκληση / νέα συγκατάθεση για δεδομένα υγείας από το προφίλ. Η ανάκληση σβήνει τους στόχους
// (με τα συνημμένα τους) και την καταγραφή των ασκήσεων· ο λογαριασμός μένει.
app.post("/api/consents/health", async (req, res) => {
  const granted = Boolean(req.body && req.body.granted === true);
  try {
    if (!granted) {
      const files = await listAllFiles(req.sb, "goal-attachments", req.userId);
      for (let i = 0; i < files.length; i += 100) {
        const { error } = await req.sb.storage.from("goal-attachments").remove(files.slice(i, i + 100));
        if (error) throw error;
      }
      for (const table of ["goals", "relaxation_sessions"]) {
        const { error } = await req.sb.from(table).delete().eq("user_id", req.userId);
        if (error) throw error;
      }
    }
    const { error } = await req.sb.from("consents").insert({ kind: "health_data", granted, version: CONSENT_VERSION });
    if (error) return sendConsentDbError(res, error);
    res.json({ consents: await getConsentState(req) });
  } catch (err) { sendDbError(res, err, "Η αλλαγή δεν αποθηκεύτηκε."); }
});

// Ενεργοποίηση/ανάκληση της χρήσης AI από το προφίλ.
app.post("/api/consents/ai", async (req, res) => {
  const granted = Boolean(req.body && req.body.granted === true);
  const { error } = await req.sb.from("consents").insert({ kind: "ai_processing", granted, version: CONSENT_VERSION });
  if (error) return sendConsentDbError(res, error);
  try { res.json({ consents: await getConsentState(req) }); } catch (err) { sendConsentDbError(res, err); }
});

// «Κατέβασε τα δεδομένα μου» (GDPR: δικαίωμα πρόσβασης και φορητότητας).
app.get("/api/me/export", async (req, res) => {
  try {
    const uid = req.userId;
    const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
    const [profile, consents, goals, relaxation, posts, favorites, messages] = await Promise.all([
      q(req.sb.from("profiles").select("*").eq("id", uid).maybeSingle()),
      q(req.sb.from("consents").select("kind, version, granted, created_at").eq("user_id", uid).order("created_at")).catch(() => []),
      q(req.sb.from("goals").select(GOAL_SELECT).eq("user_id", uid).order("created_at")),
      q(req.sb.from("relaxation_sessions").select("type, technique, context, created_at").eq("user_id", uid).order("created_at")),
      q(req.sb.from("forum_posts").select("id, board, parent_id, message, category, media_type, media_path, created_at").eq("author_id", uid).order("created_at")),
      q(req.sb.from("favorites").select("post_id, created_at").eq("user_id", uid).order("created_at")),
      q(req.sb.from("messages").select("sender_id, recipient_id, text, created_at").or(`sender_id.eq.${uid},recipient_id.eq.${uid}`).order("created_at")),
    ]);
    const notificationSettings = await q(req.sb.from("notification_settings").select("messages, forum_replies, quiet_hours, quiet_start, quiet_end, timezone, updated_at").eq("user_id", uid).maybeSingle()).catch(() => null);
    const notificationDevices = await q(req.sb.from("push_subscriptions").select("created_at, last_seen_at").eq("user_id", uid).order("created_at")).catch(() => []);
    const names = {};
    const otherIds = [...new Set(messages.map((m) => (m.sender_id === uid ? m.recipient_id : m.sender_id)))];
    if (otherIds.length) (await q(req.sb.from("profiles").select("id, username").in("id", otherIds))).forEach((p) => { names[p.id] = p.username; });
    const exportData = {
      exported_at: new Date().toISOString(),
      app: "Mentor",
      note: "Όλα τα δεδομένα που είναι αποθηκευμένα για τον λογαριασμό σου. Οι συνομιλίες με τον coach δεν αποθηκεύονται. Τα αρχεία (φωτογραφίες, βίντεο, συνημμένα) αναφέρονται με το όνομά τους.",
      account: { email: (req.claims && req.claims.email) || null },
      profile, consents,
      goals: goals.map((g) => ({
        title: g.title, status: g.status, estimated_total_duration: g.estimated_total_duration, created_at: g.created_at, completed_at: g.completed_at,
        attachments: (g.attachments || []).map((a) => a.name),
        stages: (g.milestones || []).sort((a, b) => a.position - b.position).map((m) => ({
          title: m.title, status: m.status, estimated_duration: m.estimated_duration,
          steps: (m.subgoals || []).sort((a, b) => a.position - b.position).map((s) => ({ title: s.title, difficulty: s.difficulty, completed: s.completed, completed_at: s.completed_at })),
        })),
      })),
      relaxation_sessions: relaxation,
      forum_posts: posts.map((p) => ({ ...p, board: p.board === "a" ? "Learn" : "Get involved" })),
      favorites,
      notification_settings: notificationSettings,
      notification_devices: notificationDevices,
      messages: messages.map((m) => ({ direction: m.sender_id === uid ? "sent" : "received", with: names[m.sender_id === uid ? m.recipient_id : m.sender_id] || null, text: m.text, created_at: m.created_at })),
    };
    res.setHeader("Content-Disposition", `attachment; filename="mentor-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportData);
  } catch (err) { sendDbError(res, err); }
});

// Διαγραφή λογαριασμού: πρώτα τα αρχεία του χρήστη (φωτογραφίες, βίντεο, συνημμένα),
// μετά ο λογαριασμός. Η βάση σβήνει αυτόματα προφίλ, στόχους, δημοσιεύσεις και μηνύματα.
async function listAllFiles(sb, bucket, prefix) {
  const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  const files = [];
  for (const item of data || []) {
    const full = `${prefix}/${item.name}`;
    if (item.id) files.push(full); else files.push(...(await listAllFiles(sb, bucket, full))); // χωρίς id = υποφάκελος
  }
  return files;
}
app.delete("/api/me", async (req, res) => {
  try {
    for (const bucket of ["avatars", "forum-media", "goal-attachments"]) {
      const files = await listAllFiles(req.sb, bucket, req.userId);
      for (let i = 0; i < files.length; i += 100) {
        const { error } = await req.sb.storage.from(bucket).remove(files.slice(i, i + 100));
        if (error) throw error;
      }
    }
    const { error } = await req.sb.rpc("delete_my_account");
    if (error && error.code === "PGRST202") return res.status(500).json({ error: "Η βάση δεδομένων χρειάζεται ενημέρωση για τη διαγραφή λογαριασμού." });
    if (error) return sendDbError(res, error, "Η διαγραφή του λογαριασμού απέτυχε.");
    res.json({ deleted: true });
  } catch (err) { sendDbError(res, err, "Η διαγραφή του λογαριασμού απέτυχε."); }
});
app.get("/api/profiles", async (req, res) => {
  const { data, error } = await req.sb.from("profiles").select(PROFILE_COLUMNS).order("created_at");
  if (error) return sendDbError(res, error);
  res.json(data.map(toProfile));
});
app.get("/api/profiles/:id", async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Δεν βρέθηκε το προφίλ." });
  const { data, error } = await req.sb.from("profiles").select(PROFILE_COLUMNS).eq("id", req.params.id).maybeSingle();
  if (error) return sendDbError(res, error);
  if (!data) return res.status(404).json({ error: "Δεν βρέθηκε το προφίλ." });
  res.json(toProfile(data));
});

app.post("/api/profiles", async (req, res) => {
  try {
    const { username, avatar, role, bio, photo } = req.body;
    if (!username || !username.trim()) return res.status(400).json({ error: "Χρειάζεται username." });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: "Διάλεξε ρόλο: Χρήστης ή Μέντορας." });
    const photoUrl = await savePhoto(req, photo);
    const { data, error } = await req.sb.from("profiles").insert({
      id: req.userId, username: username.trim(), avatar: avatar || "🙂", photo_url: photoUrl || null,
      bio: (bio || "").trim().slice(0, 240), role,
    }).select(PROFILE_COLUMNS).single();
    if (error) return sendDbError(res, error);
    res.status(201).json(toProfile(data));
  } catch (err) { sendDbError(res, err); }
});

app.patch("/api/profiles/:id", async (req, res) => {
  if (req.params.id !== req.userId) return res.status(403).json({ error: "Μπορείς να αλλάξεις μόνο το δικό σου προφίλ." });
  try {
    const current = await getMyProfile(req);
    if (!current) return res.status(404).json({ error: "Δεν βρέθηκε το προφίλ." });
    const { username, avatar, role, bio, photo } = req.body;
    const changes = {};
    if (username && username.trim()) changes.username = username.trim();
    if (avatar) changes.avatar = avatar;
    if (role && VALID_ROLES.includes(role)) changes.role = role;
    if (typeof bio === "string") changes.bio = bio.trim().slice(0, 240);
    const photoUrl = await savePhoto(req, photo);
    if (photoUrl !== undefined) changes.photo_url = photoUrl;
    const { data, error } = await req.sb.from("profiles").update(changes).eq("id", req.userId).select(PROFILE_COLUMNS).single();
    if (error) return sendDbError(res, error);
    if (photoUrl !== undefined) await removeOldPhoto(req, current.photo, photoUrl);
    res.json(toProfile(data));
  } catch (err) { sendDbError(res, err); }
});

const PLANNER_SYSTEM_PROMPT = `Είσαι ένας έμπειρος, υποστηρικτικός μέντορας goal-setting, εξειδικευμένος στο να βοηθάς ανθρώπους να πετυχαίνουν στόχους ΧΩΡΙΣ να καίγονται.
Σκέψου εσωτερικά (χωρίς να το τυπώσεις): 1) λογικά, διαδοχικά milestones (WBS-style), 2) SMART subgoals ανά milestone, 3) αυξανόμενη δυσκολία μέσα σε κάθε milestone (easy/medium/hard), 4) ρεαλιστικές εκτιμήσεις χρόνου με χώρο για ανάπαυση.
Απάντησε ΑΠΟΚΛΕΙΣΤΙΚΑ με έγκυρο JSON, χωρίς markdown fences, ξεκινώντας με "{" και τελειώνοντας με "}":
{"goal":"...", "estimated_total_duration":"...", "milestones":[{"title":"...", "estimated_duration":"...", "subgoals":[{"title":"...", "difficulty":"easy", "youtube_query":"..."}]}]}
Κανόνες: 3-5 milestones, 2-4 subgoals ανά milestone, πάντα easy→hard μέσα σε κάθε milestone.
youtube_query: 2-5 λέξεις αναζήτησης στο YouTube για βίντεο που βοηθούν σε αυτό το βήμα, όπως θα τις έγραφε κάποιος στην αναζήτηση (π.χ. "τρέξιμο για αρχάριους", "αναπνοές για άγχος"). Χωρίς αριθμούς, διάρκειες ή προσωπικές λεπτομέρειες. Στα ελληνικά, εκτός αν το θέμα ψάχνεται συνήθως στα αγγλικά.`;

const CELEBRATION_SYSTEM_PROMPT = `Είσαι θερμός μέντορας. Ο χρήστης μόλις ολοκλήρωσε ένα subgoal. Γράψε ΕΝΑ σύντομο μήνυμα επιβράβευσης (1-2 προτάσεις, έως ~30 λέξεις). Μόνο το μήνυμα, χωρίς εισαγωγικά.`;

// ─────────────────────────────── Στόχοι ───────────────────────────────
const GOAL_SELECT = "id, user_id, title, estimated_total_duration, status, attachments, created_at, completed_at, "
  + "milestones(id, title, estimated_duration, position, status, subgoals(id, title, difficulty, position, completed, completed_at, youtube_search_url))";
const toSubgoal = (s) => ({ id: s.id, title: s.title, difficulty: s.difficulty, order: s.position, completed: s.completed, completedAt: s.completed_at, youtubeSearchUrl: s.youtube_search_url });
// Τα συνημμένα είναι σε ιδιωτικό bucket: δίνουμε προσωρινά λινκ λήψης (1 ώρα).
async function toGoals(req, rows) {
  const paths = rows.flatMap((g) => (g.attachments || []).map((a) => a.path)).filter(Boolean);
  const signed = {};
  if (paths.length) {
    const { data } = await req.sb.storage.from("goal-attachments").createSignedUrls(paths, 3600);
    (data || []).forEach((s) => { if (s.signedUrl) signed[s.path] = s.signedUrl; });
  }
  return rows.map((g) => ({
    id: g.id, profileId: g.user_id, title: g.title, estimated_total_duration: g.estimated_total_duration,
    createdAt: g.created_at, completedAt: g.completed_at, status: g.status,
    attachments: (g.attachments || []).map((a) => ({ name: a.name, type: a.type, url: signed[a.path] || null })),
    milestones: (g.milestones || []).sort((a, b) => a.position - b.position).map((m) => ({
      id: m.id, title: m.title, estimated_duration: m.estimated_duration, order: m.position, status: m.status,
      subgoals: (m.subgoals || []).sort((a, b) => a.position - b.position).map(toSubgoal),
    })),
  }));
}
async function loadGoal(req, goalId) {
  const { data, error } = await req.sb.from("goals").select(GOAL_SELECT).eq("id", goalId).maybeSingle();
  if (error) throw error;
  return data ? (await toGoals(req, [data]))[0] : null;
}

const ATTACHMENT_PATTERN = /^data:([^;,]*)(;[^,]*)?;base64,([A-Za-z0-9+/=]*)$/;
async function saveAttachments(req, goalId, attachments) {
  const saved = [];
  for (const [i, a] of (Array.isArray(attachments) ? attachments : []).entries()) {
    const m = typeof a.dataUrl === "string" && a.dataUrl.match(ATTACHMENT_PATTERN);
    if (!m) continue;
    const safeName = String(a.name || "file").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80);
    const filePath = `${req.userId}/${goalId}/${i}-${safeName}`;
    const { error } = await req.sb.storage.from("goal-attachments").upload(filePath, Buffer.from(m[3], "base64"), { contentType: m[1] || "application/octet-stream" });
    if (error) { console.error("Συνημμένο δεν αποθηκεύτηκε:", error.message); continue; }
    saved.push({ name: a.name, type: a.type || "", path: filePath });
  }
  return saved;
}

// Όριο χρήσης του AI πλάνου ανά χρήστη (κάθε πλάνο κοστίζει κλήση στην Anthropic).
const PLAN_LIMIT_PER_HOUR = 10;
const PLAN_LIMIT_PER_DAY = 30;
const PLAN_MAX_GOAL_CHARS = 2000;
const PLAN_MAX_ATTACHMENTS = 5;
const PLAN_MAX_ATTACHMENT_CHARS = 6000;
const planTimes = new Map();
function checkPlanLimit(userId) {
  const now = Date.now();
  const recent = (planTimes.get(userId) || []).filter((t) => now - t < 24 * 3600e3);
  const lastHour = recent.filter((t) => now - t < 3600e3).length;
  if (recent.length >= PLAN_LIMIT_PER_DAY || lastHour >= PLAN_LIMIT_PER_HOUR) { planTimes.set(userId, recent); return false; }
  recent.push(now); planTimes.set(userId, recent);
  return true;
}
app.post("/api/plan", async (req, res) => {
  try {
    const { goal, attachments } = req.body;
    if (!goal || !goal.trim()) return res.status(400).json({ error: "Λείπει το πεδίο 'goal'." });
    if (goal.length > PLAN_MAX_GOAL_CHARS) return res.status(400).json({ error: `Ο στόχος είναι πολύ μεγάλος (έως ${PLAN_MAX_GOAL_CHARS} χαρακτήρες).` });
    if (Array.isArray(attachments) && attachments.length > PLAN_MAX_ATTACHMENTS) return res.status(400).json({ error: `Μπορείς να επισυνάψεις έως ${PLAN_MAX_ATTACHMENTS} αρχεία.` });
    if (!(await getMyProfile(req))) return res.status(401).json({ error: "Χρειάζεται προφίλ." });
    if (!(await hasAiConsent(req))) return res.status(403).json(AI_CONSENT_ERROR);
    if (!checkPlanLimit(req.userId)) return res.status(429).json({ error: "Έφτιαξες πολλά πλάνα σε λίγη ώρα. Δοκίμασε ξανά αργότερα." });

    // Αν ο χρήστης επισύναψε αναγνώσιμα αρχεία (το frontend τα διαβάζει ήδη σε
    // καθαρό κείμενο), τα προσθέτουμε στο μήνυμα προς τον μέντορα ώστε να τα
    // λάβει πραγματικά υπόψη στο πλάνο.
    let userMessage = `Ο στόχος μου είναι: ${goal}`;
    const readableAttachments = Array.isArray(attachments)
      ? attachments.filter((a) => a && typeof a.extractedText === "string" && a.extractedText).map((a) => ({ name: String(a.name || "αρχείο").slice(0, 120), extractedText: a.extractedText.slice(0, PLAN_MAX_ATTACHMENT_CHARS) }))
      : [];
    if (readableAttachments.length) {
      userMessage += `\n\nΟ χρήστης επισύναψε επίσης τα παρακάτω αρχεία — λάβε υπόψη το περιεχόμενό τους όπου είναι σχετικό με τον στόχο:\n`;
      readableAttachments.forEach((a) => {
        userMessage += `\n--- Αρχείο: ${a.name} ---\n${a.extractedText}\n`;
      });
    }

    const parsed = extractJson(await callClaude(PLANNER_SYSTEM_PROMPT, userMessage, 4000));
    const title = parsed.goal || goal;
    const { data: goalRow, error: goalError } = await req.sb.from("goals")
      .insert({ title, estimated_total_duration: parsed.estimated_total_duration || "" }).select("id").single();
    if (goalError) throw goalError;

    const milestones = parsed.milestones || [];
    if (milestones.length) {
      const { data: milestoneRows, error: mError } = await req.sb.from("milestones").insert(milestones.map((m, mi) => ({
        goal_id: goalRow.id, title: m.title, estimated_duration: m.estimated_duration || "", position: mi, status: mi === 0 ? "active" : "pending",
      }))).select("id, position");
      if (mError) throw mError;
      const subgoalRows = milestoneRows.flatMap((row) => (milestones[row.position].subgoals || []).map((s, si) => ({
        milestone_id: row.id, goal_id: goalRow.id, title: s.title, position: si,
        difficulty: ["easy", "medium", "hard"].includes(s.difficulty) ? s.difficulty : "easy",
        // Σύντομες λέξεις αναζήτησης από το AI (βρίσκουν βίντεο)· αλλιώς ο τίτλος του βήματος.
        youtube_search_url: typeof s.youtube_query === "string" && s.youtube_query.trim()
          ? youtubeSearchUrlFor(s.youtube_query.trim().slice(0, 80))
          : buildYoutubeSearchUrl(s.title, title),
      })));
      if (subgoalRows.length) {
        const { error: sError } = await req.sb.from("subgoals").insert(subgoalRows);
        if (sError) throw sError;
      }
    }

    const savedAttachments = await saveAttachments(req, goalRow.id, attachments);
    if (savedAttachments.length) await req.sb.from("goals").update({ attachments: savedAttachments }).eq("id", goalRow.id);
    res.json(await loadGoal(req, goalRow.id));
  } catch (err) {
    console.error("Δημιουργία πλάνου απέτυχε:", err);
    res.status(500).json({ error: "Κάτι πήγε στραβά κατά τη δημιουργία του πλάνου.", details: String(err.message || err) });
  }
});

app.get("/api/goals", async (req, res) => {
  const { data, error } = await req.sb.from("goals").select(GOAL_SELECT).order("created_at");
  if (error) return sendDbError(res, error);
  try { res.json(await toGoals(req, data)); } catch (err) { sendDbError(res, err); }
});
app.get("/api/goals/:id", async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Δεν βρέθηκε." });
  try {
    const goal = await loadGoal(req, req.params.id);
    if (!goal) return res.status(404).json({ error: "Δεν βρέθηκε." });
    res.json(goal);
  } catch (err) { sendDbError(res, err); }
});
app.delete("/api/goals/:id", async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Δεν βρέθηκε." });
  const { data, error } = await req.sb.from("goals").delete().eq("id", req.params.id).select("id, attachments");
  if (error) return sendDbError(res, error);
  if (!data.length) return res.status(404).json({ error: "Δεν βρέθηκε." });
  const paths = (data[0].attachments || []).map((a) => a.path).filter(Boolean);
  if (paths.length) await req.sb.storage.from("goal-attachments").remove(paths).catch(() => {});
  res.json({ deleted: true, id: req.params.id });
});

app.patch("/api/subgoals/:id/toggle", async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: "Δεν βρέθηκε το subgoal." });
    const { data: target, error: findError } = await req.sb.from("subgoals").select("id, goal_id, milestone_id, completed, title, difficulty").eq("id", req.params.id).maybeSingle();
    if (findError) throw findError;
    if (!target) return res.status(404).json({ error: "Δεν βρέθηκε το subgoal." });
    const completed = !target.completed;
    const { data: updated, error: updError } = await req.sb.from("subgoals")
      .update({ completed, completed_at: completed ? new Date().toISOString() : null }).eq("id", target.id)
      .select("id, title, difficulty, position, completed, completed_at, youtube_search_url").single();
    if (updError) throw updError;

    const { data: goal, error: goalError } = await req.sb.from("goals").select(GOAL_SELECT).eq("id", target.goal_id).single();
    if (goalError) throw goalError;
    const milestones = (goal.milestones || []).sort((a, b) => a.position - b.position);
    const mi = milestones.findIndex((m) => m.id === target.milestone_id);
    const parentMilestone = milestones[mi];
    const allDone = parentMilestone.subgoals.every((s) => s.completed);
    parentMilestone.status = allDone ? "completed" : "active";
    await req.sb.from("milestones").update({ status: parentMilestone.status }).eq("id", parentMilestone.id);
    if (allDone && milestones[mi + 1] && milestones[mi + 1].status !== "completed") {
      milestones[mi + 1].status = "active";
      await req.sb.from("milestones").update({ status: "active" }).eq("id", milestones[mi + 1].id);
    }
    const allMilestonesDone = milestones.every((m) => m.status === "completed");
    const wasCompleted = goal.status === "completed";
    const goalStatus = allMilestonesDone ? "completed" : "active";
    const goalChanges = { status: goalStatus };
    if (allMilestonesDone && !wasCompleted) goalChanges.completed_at = new Date().toISOString();
    else if (!allMilestonesDone) goalChanges.completed_at = null;
    await req.sb.from("goals").update(goalChanges).eq("id", goal.id);

    let celebrationMessage = null;
    if (completed && ANTHROPIC_API_KEY) {
      if (await hasAiConsent(req)) try { celebrationMessage = (await callClaude(CELEBRATION_SYSTEM_PROMPT, `Subgoal: "${target.title}" (${target.difficulty})`, 100)).trim(); } catch (e) {}
    }
    res.json({ subgoal: toSubgoal(updated), celebrationMessage, goalStatus, milestoneStatus: parentMilestone.status });
  } catch (err) { console.error(err); res.status(500).json({ error: "Κάτι πήγε στραβά." }); }
});

// ─────────────────────────── Χαλάρωση & στατιστικά ───────────────────────────
const toSession = (s) => ({ id: s.id, profileId: s.user_id, type: s.type, technique: s.technique, context: s.context, timestamp: s.created_at });
app.post("/api/relaxation-sessions", async (req, res) => {
  const { type, technique, context } = req.body;
  const { data, error } = await req.sb.from("relaxation_sessions")
    .insert({ type: type || "breathing", technique: technique || null, context: context || "manual" }).select("*").single();
  if (error) return sendDbError(res, error);
  res.json(toSession(data));
});
app.get("/api/relaxation-sessions", async (req, res) => {
  const { data, error } = await req.sb.from("relaxation_sessions").select("*").order("created_at");
  if (error) return sendDbError(res, error);
  res.json(data.map(toSession));
});

app.get("/api/stats", async (req, res) => {
  const { data: myGoals, error } = await req.sb.from("goals").select("id, title, status, created_at, completed_at");
  if (error) return sendDbError(res, error);
  const goalsWithDuration = myGoals.filter((g) => g.status === "completed" && g.completed_at).map((g) => ({
    id: g.id, title: g.title, createdAt: g.created_at, completedAt: g.completed_at,
    durationMs: Math.max(0, new Date(g.completed_at) - new Date(g.created_at)),
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

// Θεματικές των Συνεντεύξεων που μπορεί να προτείνει ο coach. Για νέα θεματική,
// πρόσθεσε μια γραμμή εδώ (id με λατινικά, χωρίς κενά).
// Θεματική «Γνωσιακή Συμπεριφορική Θεραπεία (CBT)» — κείμενο ψυχολόγου, όπως δόθηκε.
const CBT_INFO = [
  { title: "1. Τι είναι η Γνωσιακή Συμπεριφορική Θεραπεία (CBT) και πώς μπορεί να μας βοηθήσει στην καθημερινότητά μας;", body: "Η CBT βασίζεται στο πώς οι σκέψεις, τα συναισθήματα και οι συμπεριφορές μας αλληλεπιδρούν. Δε μας επηρεάζουν, δηλαδή, μόνο τα γεγονότα καθαυτά, αλλά και ο τρόπος που τα ερμηνεύουμε. Στη θεραπεία μαθαίνουμε να εντοπίζουμε δύσκολους (λιγότερο λειτουργικούς) τρόπους σκέψης και συμπεριφοράς και να βρίσκουμε πιο πρακτικούς τρόπους να διαχειριζόμαστε τις δυσκολίες μας." },
  { title: "2. Μπορεί ένα τραγούδι να αλλάξει τη διάθεσή μας; Τι συμβαίνει στον εγκέφαλο όταν ακούμε μουσική;", body: "Η μουσική επηρεάζει μέρη του εγκεφάλου που έχουν σχέση με το συναίσθημα, τη μνήμη, την προσοχή και την ανταμοιβή. Ένα τραγούδι μπορεί να μας χαλαρώσει, να μας συγκινήσει ή να μας φέρει στο μυαλό μια συγκεκριμένη στιγμή της ζωής μας. Η επίδραση της μουσικής διαφέρει από άτομο σε άτομο, γιατί εξαρτάται από τις δικές μας εμπειρίες και συνδέσεις." },
  { title: "3. Γιατί κάποιες φορές ακούμε λυπητερά τραγούδια όταν είμαστε ήδη στενοχωρημένοι;", body: "Αυτό δεν σημαίνει ότι θέλουμε να νιώσουμε πιο λυπημένοι. Συχνά, ένα λυπητερό τραγούδι μας βοηθά να καταλάβουμε και να εκφράσουμε συναισθήματα που δεν μπορούμε να περιγράψουμε εύκολα. Από την οπτική της CBT, έχει ενδιαφέρον να παρατηρούμε πώς επηρεάζουν τη διάθεσή μας οι επιλογές μας: μας βοηθούν να επεξεργαστούμε αυτό που αισθανόμαστε ή μας κάνουν να αισθανόμαστε «εγκλωβισμένοι» σε αυτό;" },
  { title: "4. Χρειάζεται να έχει κανείς μουσικές γνώσεις ή ταλέντο για να επωφεληθεί από τη μουσικοθεραπεία;", body: "Όχι, δεν απαιτείται να έχει κάποιος μουσικές γνώσεις ή ταλέντο για να ωφεληθεί από τη μουσικοθεραπεία. Δεν μαθαίνουμε μουσική και δεν χρειάζεται να παίζουμε άψογα. Στη μουσικοθεραπεία, χρησιμοποιούμε τη μουσική για να εκφραστούμε, να επικοινωνήσουμε και να ψάξουμε μέσα μας, πάντα σε κατάλληλο θεραπευτικό περιβάλλον." },
  { title: "5. Πώς συνδέονται η ψυχολογία, η μουσική και η λειτουργία του εγκεφάλου;", body: "Η ψυχολογία, η μουσική και η νευροεπιστήμη συνδέονται με πολλούς τρόπους. Η μουσική λειτουργεί ως ερέθισμα που ενεργοποιεί διάφορα εγκεφαλικά δίκτυα, όπως αυτά της μνήμης, την προσοχής, του συναισθήματος και της κίνησης. Μπορεί να αλλάξει τη συναισθηματική μας κατάσταση, να επηρεάσει τη διέγερση και τον τρόπο που βιώνουμε και επεξεργαζόμαστε τις εμπειρίες μας. Η ψυχολογία μελετά πώς λειτουργεί ο άνθρωπος, τους λόγους που επιλέγει συγκεκριμένες συμπεριφορές και πώς βιώνει τον κόσμο γύρω του. Η νευροψυχολογία και η γνωσιακή νευροεπιστήμη μελετούν τους εγκεφαλικούς μηχανισμούς αυτών των διαδικασιών. Η μουσικοθεραπεία χρησιμοποιεί τη μουσική με θεραπευτικό σκοπό για να βοηθήσει στη συναισθηματική έκφραση, την επικοινωνία και την ψυχική υγεία. Σε συνδυασμό, αυτές οι επιστημονικές προσεγγίσεις μας βοηθούν να κατανοήσουμε καλύτερα τον άνθρωπο, συνδέοντας τις σκέψεις, τα συναισθήματα και τις πράξεις μας με τις λειτουργίες του εγκεφάλου και τη δύναμη της μουσικής ως θεραπευτικό μέσο." },
];

// Θεματική «Υπερανάλυση» — κείμενο συμβούλου ψυχικής υγείας, όπως δόθηκε.
const OVERTHINKING_INFO = [
  { title: "", body: "Γιατί επιστρέφουμε συνεχώς στις ίδιες σκέψεις, τι κρύβεται πίσω από την ανάγκη μας να αναλύουμε τα πάντα και πώς μπορούμε να αποκτήσουμε μια διαφορετική σχέση με τον εσωτερικό μας διάλογο;" },
  { title: "1. Τι εννοούμε όταν λέμε ότι κάποιος υπεραναλύει; Είναι πάντα αρνητικό να σκεφτόμαστε πολύ;", body: "Το να σκεφτόμαστε και να επεξεργαζόμαστε όσα συμβαίνουν στη ζωή μας είναι μια φυσιολογική και χρήσιμη διαδικασία. Μας βοηθά να κατανοούμε τις εμπειρίες μας, να παίρνουμε αποφάσεις και να προετοιμαζόμαστε για μελλοντικές καταστάσεις.\n\nΗ υπερανάλυση, όμως, είναι κάτι διαφορετικό. Συμβαίνει όταν επιστρέφουμε επανειλημμένα στις ίδιες σκέψεις, προσπαθώντας να βρούμε απαντήσεις ή βεβαιότητα, χωρίς τελικά να καταλήγουμε κάπου. Μπορεί να αναπαράγουμε μια συζήτηση στο μυαλό μας, να αναρωτιόμαστε αν είπαμε κάτι λάθος ή να φανταζόμαστε διαρκώς πιθανά αρνητικά σενάρια.\n\nΤο πρόβλημα δεν είναι ότι σκεφτόμαστε πολύ, αλλά ότι η σκέψη παύει να μας βοηθά να προχωρήσουμε και αρχίζει να μας εγκλωβίζει σε έναν επαναλαμβανόμενο κύκλο." },
  { title: "2. Γιατί δυσκολευόμαστε τόσο πολύ να σταματήσουμε να σκεφτόμαστε; Τι μπορεί να βρίσκεται πίσω από την υπερανάλυση;", body: "Πολλές φορές, η υπερανάλυση συνδέεται με την ανάγκη μας να νιώθουμε ασφαλείς και να έχουμε τον έλεγχο. Όταν αντιμετωπίζουμε αβεβαιότητα, ο νους προσπαθεί να προβλέψει τι μπορεί να συμβεί, να εξετάσει όλες τις πιθανότητες και να μας προστατεύσει από μια ενδεχόμενη δυσάρεστη εμπειρία.\n\nΜπορεί επίσης να σχετίζεται με τον φόβο της απόρριψης, την τελειοθηρία, την αυστηρή αυτοκριτική ή προηγούμενες εμπειρίες που μας έχουν κάνει περισσότερο επιφυλακτικούς.\n\nΕίναι σημαντικό, ωστόσο, να μην αντιμετωπίζουμε κάθε περίπτωση υπερανάλυσης με τον ίδιο τρόπο. Για κάποιους ανθρώπους συνδέεται περισσότερο με το άγχος για το μέλλον, ενώ για άλλους με την ανάγκη να κατανοήσουν τι συνέβη στο παρελθόν ή πώς τους αντιλαμβάνονται οι άλλοι.\n\nΠίσω από τις επαναλαμβανόμενες σκέψεις μπορεί να υπάρχει μια προσπάθεια διαχείρισης κάποιου συναισθήματος ή μιας εσωτερικής δυσκολίας που δεν έχουμε ακόμη καταφέρει να αναγνωρίσουμε." },
  { title: "3. Πώς επηρεάζει η υπερανάλυση την καθημερινότητα και τις σχέσεις μας;", body: "Όταν βρισκόμαστε διαρκώς μέσα στις σκέψεις μας, μπορεί να δυσκολευόμαστε να συγκεντρωθούμε, να πάρουμε αποφάσεις ή να απολαύσουμε στιγμές της καθημερινότητάς μας.\n\nΣτις διαπροσωπικές μας σχέσεις, για παράδειγμα, μπορεί να αναλύουμε υπερβολικά ένα μήνυμα, μια συμπεριφορά ή μια αλλαγή στη στάση κάποιου άλλου. Ενδέχεται να αποδίδουμε αρνητικές προθέσεις εκεί όπου δεν έχουμε αρκετές πληροφορίες ή να αναζητούμε συνεχώς επιβεβαίωση ότι όλα είναι καλά.\n\nΈτσι, αντί να ερχόμαστε σε ουσιαστική επαφή με τον άλλον, μπορεί να εγκλωβιζόμαστε στις δικές μας ερμηνείες για το τι σκέφτεται ή αισθάνεται.\n\nΑυτό μπορεί να ενισχύσει το άγχος και να δημιουργήσει αποστάσεις στις σχέσεις μας. Γι' αυτό είναι σημαντικό να αναγνωρίζουμε πότε βασιζόμαστε σε πραγματικά δεδομένα και πότε σε υποθέσεις που δημιουργεί ο νους μας." },
  { title: "4. Μπορούμε να σταματήσουμε τις σκέψεις μας ή χρειάζεται να αλλάξουμε τη σχέση μας μαζί τους;", body: "Ένα συνηθισμένο λάθος είναι να προσπαθούμε να διώξουμε με τη βία τις σκέψεις που μας δυσκολεύουν. Όσο περισσότερο προσπαθούμε να μην σκεφτόμαστε κάτι, τόσο περισσότερο μπορεί να επιστρέφει στην προσοχή μας.\n\nΑντί να προσπαθούμε να ελέγξουμε κάθε σκέψη, μπορούμε να μάθουμε να την παρατηρούμε με μεγαλύτερη απόσταση. Να αναγνωρίζουμε ότι μια σκέψη είναι μια νοητική ερμηνεία ή πιθανότητα και όχι απαραίτητα μια αντικειμενική πραγματικότητα.\n\nΑυτό δεν σημαίνει ότι αγνοούμε τις σκέψεις μας. Μπορούμε να εξετάσουμε κατά πόσο είναι ρεαλιστικές, να αναζητήσουμε διαφορετικές οπτικές, αλλά και να αναρωτηθούμε τι συναίσθημα βρίσκεται πίσω από αυτές.\n\nΜερικές φορές, αντί να προσπαθούμε να βρούμε ακόμη μία απάντηση, χρειάζεται να αναγνωρίσουμε ότι αισθανόμαστε φόβο, ανασφάλεια ή στενοχώρια και να δώσουμε χώρο σε αυτό που βιώνουμε." },
  { title: "5. Υπάρχουν πρακτικοί τρόποι για να διαχειριστούμε την υπερανάλυση στην καθημερινότητά μας;", body: "Υπάρχουν ορισμένες απλές πρακτικές που μπορούν να μας βοηθήσουν να αποκτήσουμε μεγαλύτερη επίγνωση του τρόπου με τον οποίο σκεφτόμαστε.\n\n- Αναγνώριση των σκέψεων: Όταν παρατηρούμε ότι επιστρέφουμε στην ίδια σκέψη, μπορούμε να σταματήσουμε για λίγο και να αναρωτηθούμε: «Αυτή η σκέψη με βοηθά να βρω μια λύση ή απλώς με κρατά στον ίδιο κύκλο;».\n- Καταγραφή: Γράφοντας τις σκέψεις μας, μπορούμε να τις οργανώσουμε καλύτερα, να ξεχωρίσουμε τα γεγονότα από τις υποθέσεις και να εξετάσουμε εναλλακτικές ερμηνείες.\n- Επαφή με το παρόν: Ασκήσεις αναπνοής, χαλάρωσης ή ενσυνειδητότητας μπορούν να μας βοηθήσουν να επιστρέψουμε στην παρούσα στιγμή, αντί να παρασυρόμαστε από όσα συμβαίνουν στο μυαλό μας.\n- Μετάβαση στη δράση: Αν υπάρχει κάτι που μπορούμε πραγματικά να κάνουμε για μια κατάσταση, ίσως είναι πιο χρήσιμο να εστιάσουμε σε ένα μικρό πρακτικό βήμα αντί να συνεχίσουμε να την αναλύουμε.\n\nΔεν υπάρχει μία τεχνική που να λειτουργεί για όλους. Είναι σημαντικό να ανακαλύψουμε τι βρίσκεται πίσω από τη δική μας υπερανάλυση και ποιες στρατηγικές ανταποκρίνονται καλύτερα στις προσωπικές μας ανάγκες." },
  { title: "Μια τελευταία σκέψη:", body: "Δεν χρειάζεται να έχουμε μια απάντηση για κάθε σκέψη που περνά από το μυαλό μας. Μερικές φορές, η μεγαλύτερη αλλαγή δεν έρχεται όταν καταφέρνουμε να σκεφτόμαστε διαφορετικά, αλλά όταν μαθαίνουμε να μην αφήνουμε κάθε σκέψη να καθορίζει το πώς αισθανόμαστε και το πώς ζούμε." },
];

const INTERVIEW_THEMES = [
  { id: "burnout", title: "Burnout", description: "Τι είναι το burnout, πώς το αναγνωρίζεις, γιατί βοηθά η προοδευτική δυσκολία, ο ρόλος της ανάπαυσης και πότε να ζητήσεις βοήθεια.", sections: BURNOUT_INFO.map((i) => i.title), items: BURNOUT_INFO },
  { id: "cbt", title: "Γνωσιακή Συμπεριφορική Θεραπεία (CBT)", description: "Πώς σκέψεις, συναισθήματα και συμπεριφορές αλληλεπιδρούν· πώς η μουσική επηρεάζει τη διάθεση και τον εγκέφαλο· γιατί ακούμε λυπητερά τραγούδια όταν είμαστε στενοχωρημένοι· μουσικοθεραπεία.", sections: CBT_INFO.map((i) => i.title), items: CBT_INFO,
    author: {
      name: "Στυλιανή Μαρία (Μαριλιάνα) Ζάκκα",
      photo: "assets/interviews/zakka.jpg",
      bio: "Η Στυλιανή Μαρία (Μαριλιάνα) Ζάκκα είναι απόφοιτος του Τμήματος Ψυχολογίας του Εθνικού και Καποδιστριακού Πανεπιστημίου Αθηνών (ΕΚΠΑ), ενώ κατέχει μεταπτυχιακό τίτλο (MSci) στην Κλινική Ψυχολογία από το Hellenic American University (HAU), με ειδίκευση στη Γνωσιακή Συμπεριφορική Θεραπεία (ΓΣΘ/CBT). Διαθέτει επιπλέον κατάρτιση στη Συμβουλευτική, τον Επαγγελματικό Προσανατολισμό και το Mentoring. Στις συνεδρίες, χρησιμοποιεί συχνά το Minfulness (Ενσυνειδητότητα) και την Ολιστική προσέγγιση, καθώς ολοκληρώνει μετεκπαίδευση στην Παιδοψυχολογία με Ολιστική Προσέγγιση. Έχει πιστοποίηση στη Μουσικοθεραπεία. Αυτή τη στιγμή σπουδάζει σε ένα 2ο μεταπτυχιακό πρόγραμμα στη Νευροψυχολογία και τη Γνωσιακή Νευροεπιστήμη.",
    } },
  { id: "overthinking", title: "Υπερανάλυση: Όταν το μυαλό δεν σταματά να σκέφτεται", description: "Γιατί επιστρέφουμε στις ίδιες σκέψεις· τι κρύβεται πίσω από την υπερανάλυση· πώς επηρεάζει την καθημερινότητα και τις σχέσεις· πώς αλλάζουμε τη σχέση μας με τις σκέψεις· πρακτικοί τρόποι διαχείρισης.", sections: OVERTHINKING_INFO.filter((i) => i.title).map((i) => i.title), items: OVERTHINKING_INFO,
    author: {
      name: "Βασίλης Κολυμένος",
      photo: "assets/interviews/kolymenos.jpg",
      bio: "Είμαι Σύμβουλος Ψυχικής Υγείας, με μεταπτυχιακές σπουδές στην Κλινική Ψυχολογία και εκπαίδευση στη Συνθετική Συμβουλευτική Ψυχικής Υγείας και τη Συνθετική Ψυχοθεραπεία.\n\nΣτην επαγγελματική μου πορεία με ενδιαφέρει ιδιαίτερα ο τρόπος με τον οποίο οι σκέψεις, τα συναισθήματα, οι προσωπικές εμπειρίες και οι σχέσεις μας διαμορφώνουν τον τρόπο που αντιλαμβανόμαστε τον εαυτό μας και τον κόσμο γύρω μας.\n\nΗ προσέγγισή μου είναι συνθετική, αξιοποιώντας στοιχεία από τη Γνωσιακή-Συμπεριφορική Θεραπεία (CBT), την υπαρξιακή ψυχολογία, τη θεραπεία σχημάτων και πρακτικές ενσυνειδητότητας (mindfulness). Πιστεύω ότι κάθε άνθρωπος έχει τη δική του διαδρομή και ότι η κατανόηση των δυσκολιών του χρειάζεται να λαμβάνει υπόψη τόσο την προσωπική του ιστορία όσο και τις συνθήκες της ζωής του.\n\nΣτη συμβουλευτική σχέση δίνω ιδιαίτερη σημασία στη δημιουργία ενός ασφαλούς και αποδεκτικού πλαισίου, όπου υπάρχει χώρος για ειλικρινή έκφραση, διερεύνηση και ουσιαστική επικοινωνία. Με ενδιαφέρει όχι μόνο να κατανοήσουμε τι μας δυσκολεύει, αλλά και να ανακαλύψουμε νέους τρόπους να σχετιζόμαστε με τον εαυτό μας και τους άλλους.\n\nΕίμαι μέλος του ΕΚ.Ι.ΣΥ.Π. (Ελληνικό Κέντρο Ινστιτούτου Συνθετικής Συμβουλευτικής και Ψυχοθεραπείας), όπου συμμετέχω στο εκπαιδευτικό και πρακτικό πλαίσιο του κέντρου, με ενδιαφέρον για τη συνεχή εξέλιξη και την εμβάθυνση στις θεραπευτικές διεργασίες.\n\nΠιστεύω ότι η προσωπική αλλαγή δεν χρειάζεται να ξεκινά από την προσπάθεια να γίνουμε κάποιος άλλος, αλλά από την ευκαιρία να κατανοήσουμε καλύτερα τον εαυτό μας και να ανακαλύψουμε τι πραγματικά έχουμε ανάγκη.",
    } },
];
// Όλες οι θεματικές με τα κείμενά τους, για την οθόνη Συνεντεύξεις.
app.get("/api/interviews", (req, res) => res.json(INTERVIEW_THEMES.map(({ id, title, items, author }) => ({ id, title, items, author: author || null }))));

// ─────────────────────────────── Φόρουμ ───────────────────────────────
const FORUM_SELECT = "id, author_id, board, parent_id, message, category, media_type, media_path, created_at, author:profiles!forum_posts_author_id_fkey(username, avatar, photo_url, role, mentor_verified)";
function toForumPost(p) {
  return {
    id: p.id, profileId: p.author_id, author: !p.author_id ? "Διαγραμμένος χρήστης" : (p.author && p.author.username) || "Ανώνυμος",
    avatar: (p.author && p.author.avatar) || null, photo: (p.author && p.author.photo_url) || null,
    role: (p.author && p.author.role) || null, mentorVerified: Boolean(p.author && p.author.mentor_verified),
    category: p.category, message: p.message, createdAt: p.created_at, parentId: p.parent_id, board: p.parent_id ? null : p.board,
    media: p.media_path ? { type: p.media_type, file: p.media_path, url: publicStorageUrl("forum-media", p.media_path) } : null,
  };
}
app.get("/api/forum/posts", async (req, res) => {
  const board = req.query.board === "b" ? "b" : "a";
  const { data, error } = await req.sb.from("forum_posts").select(FORUM_SELECT).eq("board", board).order("created_at");
  if (error) return sendDbError(res, error);
  // Ποιες δημοσιεύσεις έχει ο χρήστης στα Αγαπημένα (για το γεμάτο αστεράκι).
  const { data: favs } = await req.sb.from("favorites").select("post_id");
  const favorited = new Set((favs || []).map((f) => f.post_id));
  const posts = data.map((p) => ({ ...toForumPost(p), favorited: favorited.has(p.id) }));
  const byParent = {};
  posts.forEach((p) => { (byParent[p.parentId || "root"] = byParent[p.parentId || "root"] || []).push(p); });
  const withReplies = (p) => ({ ...p, replies: (byParent[p.id] || []).map(withReplies) });
  res.json((byParent.root || []).slice().reverse().map(withReplies));
});

// Φωτογραφία/βίντεο επιτρέπονται μόνο σε νέες δημοσιεύσεις του Learn (board "a"),
// άρα μόνο από μέντορες. Το αρχείο ανεβαίνει πρώτα εδώ (σκέτα bytes, όχι JSON),
// τα βίντεο μετατρέπονται σε MP4, αποθηκεύεται στο bucket forum-media, και η
// δημοσίευση μετά το αναφέρει με το id του (= η διαδρομή του στο bucket).
const FORUM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FORUM_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const rawUpload = express.raw({ type: () => true, limit: FORUM_VIDEO_MAX_BYTES + 1024 * 1024 });
app.post("/api/forum/media", (req, res, next) => rawUpload(req, res, (err) => {
  if (err) return res.status(err.type === "entity.too.large" ? 413 : 400).json({ error: err.type === "entity.too.large" ? "Το αρχείο είναι πολύ μεγάλο." : "Το αρχείο δεν ανέβηκε." });
  next();
}), async (req, res) => {
  let workDir = null;
  try {
    const profile = await getMyProfile(req);
    if (!profile || profile.role !== "mentor" || !profile.mentorVerified) return res.status(403).json({ error: "Μόνο εγκεκριμένοι μέντορες μπορούν να ανεβάσουν αρχεία." });
    const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const type = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : null;
    if (!type || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Μη έγκυρο αρχείο. Ανέβασε φωτογραφία ή βίντεο." });
    if (req.body.length > (type === "video" ? FORUM_VIDEO_MAX_BYTES : FORUM_IMAGE_MAX_BYTES)) {
      return res.status(413).json({ error: type === "video" ? "Το βίντεο είναι πολύ μεγάλο (έως 50 MB)." : "Η φωτογραφία είναι πολύ μεγάλη (έως 5 MB)." });
    }
    const originalName = decodeURIComponent(String(req.headers["x-file-name"] || ""));
    let ext = (path.extname(originalName).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [""])[0];
    let body = req.body;
    let contentType = mime;
    if (type === "video") {
      if (!checkVideoDailyLimit(req.userId)) return res.status(429).json({ error: `Έχεις ανεβάσει ${VIDEO_DAILY_LIMIT} βίντεο τις τελευταίες 24 ώρες. Δοκίμασε ξανά αργότερα.` });
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "monopati-"));
      const input = path.join(workDir, `input${ext}`);
      const output = path.join(workDir, "output.mp4");
      fs.writeFileSync(input, req.body);
      try {
        // Ουρά: μία μετατροπή τη φορά, ώστε ο server να μένει γρήγορος για όλους.
        await enqueueVideoJob(() => convertVideoToMp4(input, output));
        body = fs.readFileSync(output); ext = ".mp4"; contentType = "video/mp4";
      } catch (e) {
        if (e.userMessage) throw e; // π.χ. πάνω από 3 λεπτά ή γεμάτη ουρά: το λέμε στον χρήστη
        // Αν το ffmpeg δεν μπορέσει να το διαβάσει, κρατάμε το αρχικό αρχείο όπως ήταν.
        console.error("Μετατροπή βίντεο απέτυχε:", String(e.message || e).slice(0, 300));
      }
    }
    const filePath = `${req.userId}/${type}-${crypto.randomUUID()}${ext}`;
    const { error } = await req.sb.storage.from("forum-media").upload(filePath, body, { contentType });
    if (error) return sendDbError(res, error, "Το αρχείο δεν αποθηκεύτηκε.");
    res.status(201).json({ id: filePath, type });
  } catch (err) {
    sendDbError(res, err, "Το αρχείο δεν ανέβηκε.");
  } finally {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
});
// Κάθε βίντεο γίνεται MP4 (H.264 + AAC), που παίζει σε όλους τους browsers. Αν είναι
// ήδη H.264/AAC, αλλάζει μόνο η "συσκευασία" (γρήγορα, χωρίς απώλεια ποιότητας).
// Αλλιώς (π.χ. HEVC από κινητό, AVI, WMV) ξανακωδικοποιείται, με μέγιστο πλάτος 1920px.
// Όρια για τα βίντεο, ώστε ο server να μη «γονατίζει»: έως 3 λεπτά διάρκεια, έως 10 βίντεο
// ανά μέντορα τη μέρα, μία μετατροπή τη φορά (οι υπόλοιπες περιμένουν σε σειρά, έως 5).
const VIDEO_MAX_SECONDS = 3 * 60;
const VIDEO_DAILY_LIMIT = 10;
const VIDEO_QUEUE_MAX = 5;
const VIDEO_CONVERT_TIMEOUT_MS = 3 * 60 * 1000;
const videoUploadTimes = new Map();
function checkVideoDailyLimit(userId) {
  const now = Date.now();
  const recent = (videoUploadTimes.get(userId) || []).filter((t) => now - t < 24 * 3600e3);
  if (recent.length >= VIDEO_DAILY_LIMIT) { videoUploadTimes.set(userId, recent); return false; }
  recent.push(now); videoUploadTimes.set(userId, recent);
  return true;
}
let videoQueueTail = Promise.resolve();
let videoQueueSize = 0; // όσα περιμένουν + αυτό που μετατρέπεται τώρα
function enqueueVideoJob(job) {
  if (videoQueueSize >= VIDEO_QUEUE_MAX) return Promise.reject(userError(503, "Ανεβαίνουν πολλά βίντεο αυτή τη στιγμή. Δοκίμασε ξανά σε λίγα λεπτά."));
  videoQueueSize++;
  const result = videoQueueTail.then(() => job());
  videoQueueTail = result.catch(() => {}).finally(() => { videoQueueSize--; });
  return result;
}

function runFfmpeg(args, timeout = VIDEO_CONVERT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024, timeout },
    (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stderr))));
}
async function convertVideoToMp4(input, output) {
  const info = await runFfmpeg(["-hide_banner", "-i", input], 30 * 1000).catch((e) => e.stderr || ""); // χωρίς έξοδο, το ffmpeg απλώς περιγράφει το αρχείο
  const d = info.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (d && Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) > VIDEO_MAX_SECONDS) {
    throw userError(400, "Το βίντεο είναι μεγαλύτερο από 3 λεπτά. Ανέβασε ένα μικρότερο κομμάτι.");
  }
  const videoCodec = (info.match(/Stream #.*Video: (\w+)/) || [])[1];
  const audioCodec = (info.match(/Stream #.*Audio: (\w+)/) || [])[1];
  if (!videoCodec) throw new Error("Δεν βρέθηκε εικόνα στο αρχείο.");
  const canCopy = videoCodec === "h264" && (!audioCodec || audioCodec === "aac") && /yuv420p[,(\s]/.test(info);
  const codecArgs = canCopy
    ? ["-c", "copy"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale='min(1920,iw)':-2", "-c:a", "aac", "-b:a", "128k"];
  await runFfmpeg(["-hide_banner", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", ...codecArgs, "-movflags", "+faststart", output]);
}

app.post("/api/forum/posts", async (req, res) => {
  const { message, category, parentId, board, media } = req.body;
  if ((!message || !message.trim()) && !media) return res.status(400).json({ error: "Το μήνυμα δεν μπορεί να είναι κενό." });
  if (parentId && !isUuid(parentId)) return res.status(400).json({ error: "Η αρχική δημοσίευση δεν βρέθηκε." });
  const row = { message: (message || "").trim(), category: category || "Γενικά" };
  if (parentId) row.parent_id = parentId; else row.board = board === "b" ? "b" : "a";
  if (media) {
    if (parentId || row.board !== "a") return res.status(400).json({ error: "Φωτογραφίες και βίντεο επιτρέπονται μόνο σε νέες δημοσιεύσεις του Learn." });
    const mediaPath = String(media.id || "");
    const kind = path.basename(mediaPath).split("-")[0];
    if (!mediaPath.startsWith(`${req.userId}/`) || !["image", "video"].includes(kind)) return res.status(400).json({ error: "Το αρχείο δεν βρέθηκε. Ανέβασέ το ξανά." });
    row.media_path = mediaPath; row.media_type = kind;
  }
  const { data, error } = await req.sb.from("forum_posts").insert(row).select(FORUM_SELECT).single();
  if (error && error.code === "42501") return res.status(403).json({ error: "Στο Learn γράφουν μόνο εγκεκριμένοι μέντορες. Οι υπόλοιποι μπορούν να το διαβάζουν." });
  if (error && error.code === "P0001") return res.status(400).json({ error: "Η αρχική δημοσίευση δεν βρέθηκε." });
  if (error) return sendDbError(res, error);
  if (data.parent_id) push.notifyForumReply(req, data.id, data.board);
  res.status(201).json(toForumPost(data));
});
// «Αναφορά» ανάρμοστου περιεχομένου. Οι αναφορές φαίνονται μόνο στον διαχειριστή (πίνακας reports).
app.post("/api/forum/posts/:id/report", async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Η δημοσίευση δεν βρέθηκε." });
  const reason = String((req.body && req.body.reason) || "").trim().slice(0, 500);
  const { error } = await req.sb.from("reports").insert({ post_id: req.params.id, reason });
  if (error && error.code === "23505") return res.json({ ok: true }); // την είχε ήδη αναφέρει
  if (error && error.code === "23503") return res.status(404).json({ error: "Η δημοσίευση δεν βρέθηκε." });
  if (error && (error.code === "42P01" || error.code === "PGRST205")) { console.error("Λείπει ο πίνακας reports: τρέξε το supabase/legal-matching.sql."); return res.status(503).json({ error: "Η αναφορά δεν είναι ακόμα διαθέσιμη." }); }
  if (error) return sendDbError(res, error);
  res.status(201).json({ ok: true });
});
// Ο καθένας διαγράφει μόνο τις δικές του δημοσιεύσεις. Μαζί φεύγουν και οι απαντήσεις
// κάτω από αυτήν (η βάση το κάνει αυτόματα), όπως και το αρχείο της, αν έχει.
app.delete("/api/forum/posts/:id", async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: "Η δημοσίευση δεν βρέθηκε." });
  const { data: post, error: findError } = await req.sb.from("forum_posts").select("id, author_id, media_path").eq("id", req.params.id).maybeSingle();
  if (findError) return sendDbError(res, findError);
  if (!post) return res.status(404).json({ error: "Η δημοσίευση δεν βρέθηκε." });
  if (post.author_id !== req.userId) return res.status(403).json({ error: "Μπορείς να διαγράψεις μόνο τις δικές σου δημοσιεύσεις." });
  const { error } = await req.sb.from("forum_posts").delete().eq("id", post.id);
  if (error) return sendDbError(res, error);
  if (post.media_path) await req.sb.storage.from("forum-media").remove([post.media_path]).catch(() => {});
  res.json({ ok: true });
});
// Οι φωτογραφίες/βίντεο που έχει δημοσιεύσει κάποιος, για το προφίλ του.
app.get("/api/profiles/:id/media", async (req, res) => {
  if (!isUuid(req.params.id)) return res.json([]);
  const { data, error } = await req.sb.from("forum_posts").select("id, media_type, media_path, message, created_at")
    .eq("author_id", req.params.id).not("media_path", "is", null).order("created_at", { ascending: false });
  if (error) return sendDbError(res, error);
  res.json(data.map((p) => ({ postId: p.id, type: p.media_type, file: p.media_path, url: publicStorageUrl("forum-media", p.media_path), message: p.message, createdAt: p.created_at })));
});

// ─────────────────────────────── Αγαπημένα ───────────────────────────────
// Φωτογραφίες/βίντεο της κοινότητας που ο χρήστης αποθήκευσε με το αστεράκι (μόνο για τον ίδιο).
app.get("/api/favorites", async (req, res) => {
  const { data, error } = await req.sb.from("favorites")
    .select("post_id, created_at, post:forum_posts(id, message, media_type, media_path, created_at, author_id, author:profiles!forum_posts_author_id_fkey(username, avatar, photo_url))")
    .order("created_at", { ascending: false });
  if (error) return sendDbError(res, error);
  res.json(data.filter((f) => f.post && f.post.media_path).map((f) => ({
    postId: f.post_id, savedAt: f.created_at, type: f.post.media_type, url: publicStorageUrl("forum-media", f.post.media_path),
    message: f.post.message, createdAt: f.post.created_at, profileId: f.post.author_id, author: (f.post.author && f.post.author.username) || "Ανώνυμος",
  })));
});
app.post("/api/favorites", async (req, res) => {
  const { postId } = req.body;
  if (!isUuid(postId)) return res.status(400).json({ error: "Η δημοσίευση δεν βρέθηκε." });
  const { error } = await req.sb.from("favorites").insert({ post_id: postId });
  if (error && error.code === "23505") return res.json({ favorited: true }); // ήταν ήδη στα αγαπημένα
  if (error && (error.code === "42501" || error.code === "23503")) return res.status(400).json({ error: "Μόνο δημοσιεύσεις με φωτογραφία ή βίντεο μπαίνουν στα Αγαπημένα." });
  if (error) return sendDbError(res, error);
  res.status(201).json({ favorited: true });
});
app.delete("/api/favorites/:postId", async (req, res) => {
  if (!isUuid(req.params.postId)) return res.json({ favorited: false });
  const { error } = await req.sb.from("favorites").delete().eq("post_id", req.params.postId).eq("user_id", req.userId);
  if (error) return sendDbError(res, error);
  res.json({ favorited: false });
});

// Ειδοποιήσεις push (νέο μήνυμα, απάντηση στο φόρουμ) — βλ. push.js
const push = require("./push")(app, { sendDbError });

// ─────────────────────────── Προσωπικά μηνύματα ───────────────────────────
const toMessage = (m) => ({ id: m.id, fromProfileId: m.sender_id, toProfileId: m.recipient_id, text: m.text, createdAt: m.created_at });
app.get("/api/messages/conversations", async (req, res) => {
  // Οι κανόνες της βάσης επιστρέφουν μόνο μηνύματα όπου ο χρήστης είναι αποστολέας ή παραλήπτης.
  const { data: msgs, error } = await req.sb.from("messages").select("sender_id, recipient_id, text, created_at").order("created_at", { ascending: false }).limit(1000);
  if (error) return sendDbError(res, error);
  const lastByPartner = new Map();
  msgs.forEach((m) => {
    const partnerId = m.sender_id === req.userId ? m.recipient_id : m.sender_id;
    if (!lastByPartner.has(partnerId)) lastByPartner.set(partnerId, m);
  });
  if (!lastByPartner.size) return res.json([]);
  const { data: partners, error: pError } = await req.sb.from("profiles").select(PROFILE_COLUMNS).in("id", [...lastByPartner.keys()]);
  if (pError) return sendDbError(res, pError);
  res.json(partners.map((p) => {
    const last = lastByPartner.get(p.id);
    return { partner: { id: p.id, username: p.username, avatar: p.avatar, photo: p.photo_url, role: p.role, mentorVerified: Boolean(p.mentor_verified) }, lastMessage: last.text, lastAt: last.created_at };
  }).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)));
});
app.get("/api/messages/:otherProfileId", async (req, res) => {
  const otherId = req.params.otherProfileId;
  if (!isUuid(otherId)) return res.json([]);
  const { data, error } = await req.sb.from("messages").select("*")
    .or(`and(sender_id.eq.${req.userId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${req.userId})`)
    .order("created_at");
  if (error) return sendDbError(res, error);
  res.json(data.map(toMessage));
});
app.post("/api/messages", async (req, res) => {
  const { toProfileId, text } = req.body;
  if (!toProfileId || !text || !text.trim()) return res.status(400).json({ error: "Λείπει ο παραλήπτης ή το μήνυμα." });
  if (!isUuid(toProfileId)) return res.status(404).json({ error: "Δεν βρέθηκε ο παραλήπτης." });
  const { data, error } = await req.sb.from("messages").insert({ recipient_id: toProfileId, text: text.trim() }).select("*").single();
  if (error && error.code === "23503") return res.status(404).json({ error: "Δεν βρέθηκε ο παραλήπτης." });
  if (error) return sendDbError(res, error);
  push.notifyNewMessage(req, data.id);
  res.status(201).json(toMessage(data));
});

// AI coach (συνομιλία, πρόταση για σπάσιμο βημάτων, ειδοποίηση στην αρχική) — βλ. coach.js
require("./coach")(app, { apiKey: ANTHROPIC_API_KEY, goalSelect: GOAL_SELECT, buildYoutubeSearchUrl, isUuid, sendDbError, interviewThemes: INTERVIEW_THEMES, hasAiConsent, aiConsentError: AI_CONSENT_ERROR });

// Αυτόματη διαγραφή λογαριασμών μετά από 24 μήνες αδράνειας — βλ. maintenance.js
require("./maintenance")({ supabaseUrl: SUPABASE_URL, sendPush: require("./push").sendTo });

app.get("/api/health", (req, res) => res.json({ ok: true, hasApiKey: Boolean(ANTHROPIC_API_KEY), supabaseUrl: SUPABASE_URL }));

app.listen(PORT, () => {
  console.log(`✅ Backend τρέχει στο http://localhost:${PORT}`);
  console.log(`   Για πρόσβαση από κινητό στο ίδιο WiFi: βρες την τοπική IP του υπολογιστή σου`);
  console.log(`   (Windows: ipconfig -> IPv4 Address · Mac/Linux: ifconfig ή ip addr) και άνοιξε`);
  console.log(`   το frontend μέσω αυτής, π.χ. http://192.168.1.X:5500`);
});
