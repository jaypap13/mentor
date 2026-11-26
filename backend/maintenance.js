// Συντήρηση: αυτόματη διαγραφή λογαριασμών μετά από 24 μήνες αδράνειας, με προειδοποίηση
// 30 ημέρες νωρίτερα (Πολιτική Απορρήτου, ενότητα 6). Στήλες: supabase/inactivity.sql.
//
// Χρειάζεται το SUPABASE_SERVICE_ROLE_KEY στις μεταβλητές περιβάλλοντος (το βάζει ο ιδιοκτήτης
// στο Render, ποτέ στον κώδικα ή στο frontend), γιατί αφορά λογαριασμούς άλλων χρηστών. Το κλειδί
// χρησιμοποιείται ΜΟΝΟ εδώ· όλες οι κανονικές κλήσεις του backend τρέχουν ως ο συνδεδεμένος χρήστης.
// Χωρίς το κλειδί η συντήρηση απλώς δεν τρέχει.
//
// Κανόνας: κανείς δεν διαγράφεται χωρίς να έχει πάρει προειδοποίηση. Η προειδοποίηση πηγαίνει ως
// ειδοποίηση push· όποιος δεν έχει ενεργές ειδοποιήσεις δεν προειδοποιείται και δεν διαγράφεται
// (καταγράφεται στο log ώστε να αποφασιστεί άλλος τρόπος, π.χ. email).
const { createClient } = require("@supabase/supabase-js");

const DAY = 24 * 3600e3;
const DELETE_AFTER_DAYS = 730;          // 24 μήνες
const WARN_BEFORE_DAYS = 30;            // προειδοποίηση 30 ημέρες πριν
const RUN_EVERY_MS = 12 * 3600e3;       // δύο φορές τη μέρα
const BATCH = 200;

module.exports = function startMaintenance({ supabaseUrl, sendPush }) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { console.warn("ℹ️  Χωρίς SUPABASE_SERVICE_ROLE_KEY: η αυτόματη διαγραφή ανενεργών λογαριασμών δεν τρέχει."); return; }
  const admin = createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  async function listAllFiles(bucket, prefix) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw error;
    const files = [];
    for (const item of data || []) {
      const full = `${prefix}/${item.name}`;
      if (item.id) files.push(full); else files.push(...(await listAllFiles(bucket, full)));
    }
    return files;
  }

  // Ίδια σειρά με τη διαγραφή από τον ίδιο τον χρήστη (delete_my_account): αρχεία, μετά οι αναρτήσεις
  // μένουν χωρίς φωτογραφία/βίντεο ως «Διαγραμμένος χρήστης», μετά ο λογαριασμός.
  async function deleteAccount(userId) {
    for (const bucket of ["avatars", "forum-media", "goal-attachments"]) {
      const files = await listAllFiles(bucket, userId);
      for (let i = 0; i < files.length; i += 100) {
        const { error } = await admin.storage.from(bucket).remove(files.slice(i, i + 100));
        if (error) throw error;
      }
    }
    let r = await admin.from("forum_posts").delete().eq("author_id", userId).not("media_path", "is", null).eq("message", "");
    if (r.error) throw r.error;
    r = await admin.from("forum_posts").update({ media_path: null, media_type: null }).eq("author_id", userId).not("media_path", "is", null);
    if (r.error) throw r.error;
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
  }

  async function run() {
    const now = Date.now();
    try {
      // 1. Προειδοποίηση: 23 μήνες (730 − 30 ημέρες) χωρίς χρήση και χωρίς προειδοποίηση ακόμα.
      const warnCutoff = new Date(now - (DELETE_AFTER_DAYS - WARN_BEFORE_DAYS) * DAY).toISOString();
      const { data: toWarn, error: wErr } = await admin.from("profiles").select("id")
        .lt("last_active_at", warnCutoff).is("inactivity_warned_at", null).limit(BATCH);
      if (wErr) throw wErr;
      let warned = 0, noChannel = 0;
      for (const p of toWarn || []) {
        const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", p.id).limit(10);
        const sent = await sendPush(subs || [], "inactivity");
        if (sent > 0) { await admin.from("profiles").update({ inactivity_warned_at: new Date().toISOString() }).eq("id", p.id); warned++; }
        else noChannel++;
      }

      // 2. Διαγραφή: 24 μήνες χωρίς χρήση ΚΑΙ προειδοποίηση πριν από τουλάχιστον 30 ημέρες.
      const deleteCutoff = new Date(now - DELETE_AFTER_DAYS * DAY).toISOString();
      const warnedCutoff = new Date(now - WARN_BEFORE_DAYS * DAY).toISOString();
      const { data: toDelete, error: dErr } = await admin.from("profiles").select("id")
        .lt("last_active_at", deleteCutoff).not("inactivity_warned_at", "is", null).lte("inactivity_warned_at", warnedCutoff).limit(BATCH);
      if (dErr) throw dErr;
      let deleted = 0;
      for (const p of toDelete || []) {
        try { await deleteAccount(p.id); deleted++; } catch (e) { console.error("Αυτόματη διαγραφή απέτυχε:", p.id, e.message || e); }
      }
      if (warned || noChannel || deleted) console.log(`Συντήρηση: ${warned} προειδοποιήσεις, ${deleted} διαγραφές, ${noChannel} χωρίς τρόπο προειδοποίησης (δεν διαγράφονται).`);
    } catch (err) {
      if (err && (err.code === "42703" || /last_active_at|inactivity_warned_at/.test(String(err.message)))) console.error("Λείπουν στήλες: τρέξε το supabase/inactivity.sql.");
      else console.error("Συντήρηση απέτυχε:", err.message || err);
    }
  }

  setTimeout(run, 60 * 1000);
  setInterval(run, RUN_EVERY_MS);
};
