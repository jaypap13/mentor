// Ειδοποιήσεις στο κινητό/υπολογιστή (Web Push), όπως στο Instagram — όχι email.
// Πίνακες και κανόνες ασφαλείας: supabase/push-notifications.sql.
//
// Το κείμενο της ειδοποίησης είναι πάντα ουδέτερο (π.χ. «Έχεις νέο μήνυμα»): δεν δείχνει
// ποτέ περιεχόμενο ή όνομα, γιατί φαίνεται στην κλειδωμένη οθόνη και η εφαρμογή αφορά
// την ψυχική υγεία.
const webpush = require("web-push");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "https://vermillion-custard-dc5bcb.netlify.app";
const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (enabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
else console.warn("⚠️  Λείπουν τα VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY από το .env: οι ειδοποιήσεις push είναι ανενεργές.");

const PAYLOADS = {
  message: { title: "Mentor", body: "Έχεις νέο μήνυμα", tag: "messages", open: "messages" },
  reply: { title: "Mentor", body: "Υπάρχει νέα απάντηση στη δημοσίευσή σου", tag: "forum", open: "forum" },
  test: { title: "Mentor", body: "Οι ειδοποιήσεις λειτουργούν 🌱", tag: "test", open: "home" },
  inactivity: { title: "Mentor", body: "Ο λογαριασμός σου θα διαγραφεί σε 30 ημέρες λόγω αδράνειας. Άνοιξε το Mentor για να τον κρατήσεις.", tag: "inactivity", open: "home" },
};
const DEFAULT_SETTINGS = { messages: true, forumReplies: true, quietHours: true, quietStart: 22, quietEnd: 8, timezone: "Europe/Athens" };
const toSettings = (r) => (r ? { messages: r.messages, forumReplies: r.forum_replies, quietHours: r.quiet_hours, quietStart: r.quiet_start, quietEnd: r.quiet_end, timezone: r.timezone } : { ...DEFAULT_SETTINGS });
const isHour = (v) => Number.isInteger(v) && v >= 0 && v <= 23;
function isTimezone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch (e) { return false; }
}
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|windows\.com|notify\.windows\.com|push\.apple\.com)(:\d+)?\//i;

async function sendTo(subs, kind, extra = {}) {
  if (!enabled || !subs || !subs.length) return 0;
  const payload = JSON.stringify({ ...PAYLOADS[kind], ...extra });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: "normal" });
      sent++;
    } catch (err) {
      // 404/410: η συσκευή απενεργοποίησε τις ειδοποιήσεις. Σταματά να επιστρέφεται μόνη της μετά από 60 μέρες χωρίς χρήση.
      if (err.statusCode !== 404 && err.statusCode !== 410) console.error("Push απέτυχε:", err.statusCode || "", String(err.body || err.message || err).slice(0, 200));
    }
  }));
  return sent;
}

module.exports = setupPush;
module.exports.sendTo = sendTo; // για τη συντήρηση (backend/maintenance.js)
function setupPush(app, { sendDbError }) {
  app.get("/api/notifications/settings", async (req, res) => {
    const { data, error } = await req.sb.from("notification_settings").select("*").eq("user_id", req.userId).maybeSingle();
    if (error && (error.code === "42P01" || error.code === "PGRST205")) return res.json({ available: false, publicKey: null, settings: { ...DEFAULT_SETTINGS } });
    if (error) return sendDbError(res, error);
    res.json({ available: enabled, publicKey: enabled ? VAPID_PUBLIC_KEY : null, settings: toSettings(data) });
  });

  app.put("/api/notifications/settings", async (req, res) => {
    const b = req.body || {};
    if (!isHour(b.quietStart) || !isHour(b.quietEnd)) return res.status(400).json({ error: "Μη έγκυρες ώρες ησυχίας." });
    const row = {
      user_id: req.userId, messages: Boolean(b.messages), forum_replies: Boolean(b.forumReplies), quiet_hours: Boolean(b.quietHours),
      quiet_start: b.quietStart, quiet_end: b.quietEnd, timezone: isTimezone(b.timezone) ? b.timezone : "Europe/Athens", updated_at: new Date().toISOString(),
    };
    const { data, error } = await req.sb.from("notification_settings").upsert(row).select("*").single();
    if (error) return sendDbError(res, error, "Οι ρυθμίσεις δεν αποθηκεύτηκαν.");
    res.json({ settings: toSettings(data) });
  });

  // Η συσκευή άνοιξε τις ειδοποιήσεις (ή ξανανοίγει την εφαρμογή: ανανεώνεται το last_seen_at).
  app.post("/api/push/subscribe", async (req, res) => {
    const { endpoint, keys } = req.body || {};
    const p256dh = keys && keys.p256dh, auth = keys && keys.auth;
    if (typeof endpoint !== "string" || endpoint.length > 1000 || !PUSH_HOSTS.test(endpoint) || typeof p256dh !== "string" || p256dh.length > 200 || typeof auth !== "string" || auth.length > 100) {
      return res.status(400).json({ error: "Μη έγκυρη συσκευή για ειδοποιήσεις." });
    }
    const { error } = await req.sb.rpc("save_push_subscription", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
    if (error) return sendDbError(res, error, "Οι ειδοποιήσεις δεν ενεργοποιήθηκαν.");
    res.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", async (req, res) => {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint !== "string") return res.json({ ok: true });
    const { error } = await req.sb.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", req.userId);
    if (error) return sendDbError(res, error);
    res.json({ ok: true });
  });

  // Δοκιμαστική ειδοποίηση στις δικές σου συσκευές (έως 1 ανά 10 δευτερόλεπτα).
  const lastTest = new Map();
  app.post("/api/push/test", async (req, res) => {
    if (!enabled) return res.status(503).json({ error: "Οι ειδοποιήσεις δεν είναι ακόμα διαθέσιμες." });
    if (Date.now() - (lastTest.get(req.userId) || 0) < 10000) return res.status(429).json({ error: "Περίμενε λίγα δευτερόλεπτα και δοκίμασε ξανά." });
    lastTest.set(req.userId, Date.now());
    const { data, error } = await req.sb.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", req.userId).limit(10);
    if (error) return sendDbError(res, error);
    const sent = await sendTo(data, "test");
    if (!sent) return res.status(400).json({ error: "Δεν βρέθηκε συσκευή με ενεργές ειδοποιήσεις." });
    res.json({ sent });
  });

  // Καλείται μετά από νέο μήνυμα / απάντηση. Δεν καθυστερεί ποτέ την απάντηση στον χρήστη
  // και δεν «σπάει» τίποτα αν αποτύχει.
  function notifyAfter(req, rpcName, args, kind, extra) {
    if (!enabled) return;
    setImmediate(async () => {
      try {
        const { data, error } = await req.sb.rpc(rpcName, args);
        if (error) { if (error.code !== "PGRST202") console.error("Push: ", error.message || error); return; }
        await sendTo(data, kind, extra);
      } catch (err) { console.error("Push:", err.message || err); }
    });
  }
  return {
    notifyNewMessage: (req, messageId) => notifyAfter(req, "push_targets_for_message", { p_message_id: messageId }, "message"),
    notifyForumReply: (req, replyId, board) => notifyAfter(req, "push_targets_for_reply", { p_post_id: replyId }, "reply", { board: board === "b" ? "b" : "a" }),
  };
}
