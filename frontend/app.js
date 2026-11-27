// Το backend "ακολουθεί" αυτόματα τη διεύθυνση από την οποία ανοίχτηκε το
// frontend: στον υπολογιστή δείχνει σε localhost, ενώ αν το ανοίξεις από
// κινητό/άλλη συσκευή στο ίδιο δίκτυο (μέσω της τοπικής IP του υπολογιστή),
// δείχνει αυτόματα στην ίδια IP — δεν χρειάζεται καμία χειροκίνητη αλλαγή.
// Όταν κάνεις πραγματικό online hosting (backend σε ξεχωριστό domain),
// άλλαξε απλά τη activate σταθερά PRODUCTION_API_BASE παρακάτω.
const PRODUCTION_API_BASE = null; // π.χ. "https://το-backend-σου.onrender.com/api"
const API_BASE = PRODUCTION_API_BASE || `${window.location.protocol}//${window.location.hostname}:3001/api`;
const PROFILE_AVATARS = ["🙂","😀","🦊","🐼","🐸","🦉","🐨","🐢","🌱","🌸","⭐","🔥"];

const state = {
  mode: "action", screen: "profile-select", goals: [], currentGoalId: null, onboardingSlide: 0,
  selectedBreathingTechnique: "478", selectedForumBoard: "a", selectedMusicCategory: "heartbeat",
  currentProfile: null, selectedAvatar: PROFILE_AVATARS[0], selectedRole: null,
  viewingProfile: null, profileViewReturnScreen: "home", chatPartner: null,
};

// Σύνδεση με Google μέσω Supabase. Το URL και το publishable key είναι δημόσια
// (φτιαγμένα για να μπαίνουν στην εφαρμογή). Οι κωδικοί μένουν στην Google.
const SUPABASE_URL = "https://mxdnlamhzglzdtkdwdum.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8qtezYZ3RRsKj3_1-Tv5RQ_iueN3eS9";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Κάθε κλήση στο backend στέλνει το token της σύνδεσης, ώστε ο server να ξέρει ποιος είναι ο χρήστης.
async function apiFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  const res = await fetch(url, Object.assign({}, options, { headers }));
  if (res.status === 401 && !data.session) handleSignedOut();
  return res;
}

const SCREEN_IDS = ["profile-select","profile-create","profile-edit","profile-view","favorites","onboarding","home","dashboard","goal-create","goal-detail","breathing-select","breathing","music-select","music","muscle-select","pmr","self-massage","burnout-info","mentors","forum-select","forum","stats","messages","chat","coach","weekly","consent","legal"];
const NO_TOPBAR_SCREENS = ["onboarding","home","profile-select","consent","legal","profile-create","profile-edit","profile-view","favorites","chat","coach"];
const SCREEN_BG_COLORS = { home:"#fbf0e2", favorites:"#fbf0e2", stats:"#f0dfae", "burnout-info":"#dce6ef", forum:"#e3e6d4", "forum-select":"#e3e6d4", mentors:"#e3e6d4", messages:"#fbf0e2", chat:"#fbf0e2", coach:"#fbf0e2", weekly:"#fbf0e2", "profile-view":"#fbf0e2", "profile-edit":"#faf6f0" };

function showScreen(name) {
  if (healthRevoked() && (HEALTH_GATED_SCREENS.includes(name) || (name === "dashboard" && state.mode === "action"))) {
    showHealthGate();
    // Μόλις συνδέθηκε (π.χ. επιστροφή στη Δράση): πηγαίνει στην αρχική αντί να μείνει στη σύνδεση.
    if (!["profile-select", "consent", "profile-create", "onboarding"].includes(state.screen)) return;
    name = "home";
  }
  if (state.screen === "chat" && name !== "chat") stopChatPolling();
  state.screen = name; document.body.dataset.screen = name;
  SCREEN_IDS.forEach((id) => { const el = document.getElementById(`screen-${id}`); if (el) el.hidden = id !== name; });
  document.getElementById("top-bar").style.display = NO_TOPBAR_SCREENS.includes(name) ? "none" : "flex";
  document.body.style.backgroundColor = SCREEN_BG_COLORS[name] || "";
  updateTabBar(name);
  if (name === "dashboard") renderDashboard();
  if (name === "burnout-info") loadBurnoutInfo();
  if (name === "mentors") loadMentors();
  if (name === "forum-select") renderForumSelect();
  if (name === "forum") loadForumPosts();
  if (name === "stats") loadStats();
  if (name === "profile-edit") { renderProfileEdit(); renderDataSection(); renderNotifSection(); }
  if (name === "favorites") loadFavorites();
  if (name === "messages") loadConversations();
  if (name === "onboarding") document.getElementById("contextual-prompt").hidden = true;
  window.scrollTo(0, 0);
  if (name === "home") { maybeShowInstallPrompt(); if (COACH_NUDGES_ENABLED) loadCoachNudge(); renderHomeBalance(); }
  if (name === "coach") openCoach();
  if (name === "weekly") loadWeekly();
}
// Κάτω μπάρα: παντού μέσα στην εφαρμογή, εκτός από σύνδεση / εισαγωγή / νομικά.
const NO_TABBAR_SCREENS = ["profile-select", "consent", "profile-create", "onboarding", "legal"];
const TAB_FOR_SCREEN = { stats: "stats", "burnout-info": "burnout-info", mentors: "mentors", "forum-select": "community", forum: "community", messages: "messages", chat: "messages" };
function updateTabBar(name) {
  const bar = document.getElementById("tab-bar"); if (!bar) return;
  const show = !NO_TABBAR_SCREENS.includes(name);
  bar.hidden = !show; document.body.classList.toggle("has-tabbar", show);
  const active = TAB_FOR_SCREEN[name] || "";
  bar.querySelectorAll(".tab-item").forEach((b) => { const on = b.dataset.tab === active; b.classList.toggle("active", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
}
function goToRestHub() { setMode("rest"); showScreen("dashboard"); }
document.querySelectorAll("[data-nav]").forEach((el) => {
  el.addEventListener("click", () => { const t = el.dataset.nav; if (t === "rest-hub") return goToRestHub(); showScreen(t); });
});

function setMode(mode) {
  if (mode === "action" && healthRevoked()) { showHealthGate(); return; } // χωρίς συγκατάθεση υγείας: μόνο Ανάπαυση
  state.mode = mode;
  document.body.classList.toggle("mode-action", mode === "action");
  document.body.classList.toggle("mode-rest", mode === "rest");
  document.getElementById("btn-mode-action").classList.toggle("active", mode === "action");
  document.getElementById("btn-mode-rest").classList.toggle("active", mode === "rest");
  if (state.screen === "dashboard") renderDashboard();
}
document.getElementById("btn-mode-action").addEventListener("click", () => { setMode("action"); showScreen("dashboard"); });
document.getElementById("btn-mode-rest").addEventListener("click", () => { setMode("rest"); showScreen("dashboard"); });

function renderOnboardingSlide() {
  document.querySelectorAll(".onb-slide").forEach((el, i) => { el.hidden = i !== state.onboardingSlide; });
  document.querySelectorAll(".dot").forEach((el, i) => { el.classList.toggle("active", i === state.onboardingSlide); });
  document.getElementById("onb-prev").style.visibility = state.onboardingSlide === 0 ? "hidden" : "visible";
  document.getElementById("onb-next").style.visibility = state.onboardingSlide === 2 ? "hidden" : "visible";
}
document.getElementById("onb-next").addEventListener("click", () => { if (state.onboardingSlide < 2) { state.onboardingSlide++; renderOnboardingSlide(); } });
document.getElementById("onb-prev").addEventListener("click", () => { if (state.onboardingSlide > 0) { state.onboardingSlide--; renderOnboardingSlide(); } });
// Μόλις ο επισκέπτης δει τις κάρτες καθοδήγησης, δεν τις ξαναβλέπει σε αυτή τη συσκευή.
function markOnboardingSeen() { lsSet(ONBOARDING_SEEN_KEY, "1"); }
document.getElementById("onb-skip").addEventListener("click", () => { markOnboardingSeen(); showScreen("goal-create"); });
document.getElementById("onb-cta-goal").addEventListener("click", () => { markOnboardingSeen(); showScreen("goal-create"); });
document.getElementById("onb-cta-action").addEventListener("click", () => { markOnboardingSeen(); setMode("action"); showScreen("dashboard"); });
document.getElementById("onb-cta-rest").addEventListener("click", () => { markOnboardingSeen(); setMode("rest"); showScreen("dashboard"); });
document.getElementById("onb-cta-home").addEventListener("click", () => { markOnboardingSeen(); showScreen("home"); });
// Αρχική: πόση Δράση (βήματα που ολοκληρώθηκαν) και πόση Ανάπαυση (ασκήσεις) έγινε τις τελευταίες 7 μέρες,
// και πρόταση για ό,τι λείπει.
async function renderHomeBalance() {
  if (state.guest || healthRevoked()) {  // επισκέπτης ή χωρίς συγκατάθεση υγείας: χωρίς δεδομένα, μόνο η άδεια μπάρα
    document.getElementById("balance-bar").classList.add("empty");
    document.getElementById("balance-action-label").textContent = "Δράση"; document.getElementById("balance-rest-label").textContent = "Ανάπαυση";
    document.getElementById("balance-tip").textContent = "Ξεκίνα την εβδομάδα σου με ένα μικρό βήμα ή μια ανάσα.";
    ["home-action-badge", "home-rest-badge"].forEach((id) => { document.getElementById(id).hidden = true; });
    document.getElementById("home-cta-action").classList.remove("recommended"); document.getElementById("home-cta-rest").classList.remove("recommended");
    document.getElementById("home-action-sub").textContent = "Δούλεψε στους στόχους σου";
    return;
  }
  const weekAgo = Date.now() - 7 * 864e5;
  let goals = [], sessions = [];
  try {
    const [g, r] = await Promise.all([apiFetch(`${API_BASE}/goals`), apiFetch(`${API_BASE}/relaxation-sessions`)]);
    if (g.ok) goals = await g.json();
    if (r.ok) sessions = await r.json();
  } catch (e) {}
  if (!Array.isArray(goals)) goals = [];
  if (!Array.isArray(sessions)) sessions = [];
  const allSteps = goals.flatMap((g) => (g.milestones || []).flatMap((m) => m.subgoals || []));
  const steps = allSteps.filter((s) => s.completed && s.completedAt && new Date(s.completedAt) >= weekAgo).length;
  const rests = sessions.filter((s) => s.timestamp && new Date(s.timestamp) >= weekAgo).length;
  const total = steps + rests;
  const actionPct = total ? Math.round((steps / total) * 100) : 50;
  document.getElementById("balance-bar").classList.toggle("empty", !total);
  document.getElementById("balance-action-bar").style.width = actionPct + "%";
  document.getElementById("balance-rest-bar").style.width = (100 - actionPct) + "%";
  document.getElementById("balance-action-label").textContent = total ? `Δράση ${actionPct}% · ${steps} ${steps === 1 ? "βήμα" : "βήματα"}` : "Δράση";
  document.getElementById("balance-rest-label").textContent = total ? `Ανάπαυση ${100 - actionPct}% · ${rests} ${rests === 1 ? "άσκηση" : "ασκήσεις"}` : "Ανάπαυση";
  let recommend = null, tip;
  if (!total) tip = "Ξεκίνα την εβδομάδα σου με ένα μικρό βήμα ή μια ανάσα.";
  else if (100 - actionPct < 35) { recommend = "rest"; tip = "Λίγη περισσότερη ξεκούραση θα σου έκανε καλό."; }
  else if (actionPct < 35) { recommend = "action"; tip = "Έχεις ξεκουραστεί. Ώρα για ένα μικρό βήμα."; }
  else tip = "Ωραία ισορροπία. Συνέχισε έτσι.";
  document.getElementById("balance-tip").textContent = tip;
  document.getElementById("home-cta-action").classList.toggle("recommended", recommend === "action");
  document.getElementById("home-cta-rest").classList.toggle("recommended", recommend === "rest");
  document.getElementById("home-action-badge").hidden = recommend !== "action";
  document.getElementById("home-rest-badge").hidden = recommend !== "rest";
  // Στην κάρτα Δράσης: η πρόοδος του ενεργού στόχου, αν υπάρχει.
  const active = goals.find((g) => g.status === "active");
  const activeSteps = active ? (active.milestones || []).flatMap((m) => m.subgoals || []) : [];
  document.getElementById("home-action-sub").textContent = activeSteps.length
    ? `${activeSteps.filter((s) => s.completed).length}/${activeSteps.length} βήματα`
    : "Δούλεψε στους στόχους σου";
}
document.getElementById("home-cta-action").addEventListener("click", () => { setMode("action"); showScreen("dashboard"); });
document.getElementById("home-cta-rest").addEventListener("click", () => { setMode("rest"); showScreen("dashboard"); });

async function fetchGoals() { try { const r = await apiFetch(`${API_BASE}/goals`); state.goals = await r.json(); } catch (e) { state.goals = []; } }
function computeGoalProgress(g) { const all = g.milestones.flatMap((m) => m.subgoals); const done = all.filter((s) => s.completed).length; const total = all.length || 1; return { done, total, pct: Math.round((done/total)*100) }; }
function findNextSubgoal(g) { for (const m of g.milestones) { const n = m.subgoals.find((s) => !s.completed); if (n) return { subgoal: n }; } return null; }

async function renderDashboard() {
  document.getElementById("dash-greeting-eyebrow").textContent = state.mode === "action" ? "Λειτουργία Δράσης" : "Λειτουργία Ανάπαυσης";
  document.getElementById("dash-title").textContent = state.mode === "action" ? "Ο στόχος σου" : "Χρόνος για ανάπαυση";
  document.getElementById("dashboard-action-view").hidden = state.mode !== "action";
  document.getElementById("dashboard-rest-view").hidden = state.mode !== "rest";
  if (state.mode === "rest") return;
  if (state.guest) {  // επισκέπτης: δεν φορτώνουμε στόχους
    document.getElementById("active-goal-card").innerHTML = `<p class="empty-state">Δεν έχεις ακόμα ενεργό στόχο.</p>`;
    document.getElementById("all-goals-list").innerHTML = "";
    return;
  }
  await fetchGoals();
  const activeGoalCard = document.getElementById("active-goal-card");
  const allGoalsList = document.getElementById("all-goals-list");
  const activeGoal = state.goals.find((g) => g.status === "active");
  if (!activeGoal) {
    activeGoalCard.innerHTML = `<p class="empty-state">Δεν έχεις ακόμα ενεργό στόχο.</p>`;
  } else {
    const { done, total, pct } = computeGoalProgress(activeGoal);
    const next = findNextSubgoal(activeGoal);
    activeGoalCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div style="flex:1; min-width:0;"><p class="goal-card-label">Ο στόχος μου</p><p class="goal-card-title">${escapeHtml(activeGoal.title)}</p></div>
        <button class="icon-btn goal-delete-btn" data-delete-goal-id="${activeGoal.id}"><i class="ti ti-trash"></i><span class="delete-btn-label">Διαγραφή</span></button>
      </div>
      <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
      <div class="goal-meta-row"><span>${done} / ${total} βήματα</span><span>${pct}%</span></div>
      ${next ? `<div class="goal-next-step"><i class="ti ti-circle-dashed"></i> Επόμενο: ${escapeHtml(next.subgoal.title)}</div>` : ""}`;
    activeGoalCard.onclick = (e) => { if (e.target.closest("[data-delete-goal-id]")) return; openGoal(activeGoal.id); };
    activeGoalCard.style.cursor = "pointer";
  }
  const others = state.goals.filter((g) => g.id !== (activeGoal && activeGoal.id));
  allGoalsList.innerHTML = others.map((g) => { const { pct } = computeGoalProgress(g); return `<div class="card" data-goal-id="${g.id}" style="display:flex; justify-content:space-between; align-items:center; gap:10px;"><div style="flex:1; min-width:0;"><p style="font-weight:600; font-size:14px; margin:0 0 4px;">${escapeHtml(g.title)}</p><p class="muted" style="margin:0;">${g.status === "completed" ? "✅ Ολοκληρώθηκε" : `${pct}% ολοκληρωμένο`}</p></div><button class="icon-btn goal-delete-btn" data-delete-goal-id="${g.id}"><i class="ti ti-trash"></i><span class="delete-btn-label">Διαγραφή</span></button></div>`; }).join("");
  allGoalsList.querySelectorAll("[data-goal-id]").forEach((el) => { el.addEventListener("click", (e) => { if (e.target.closest("[data-delete-goal-id]")) return; openGoal(el.dataset.goalId); }); });
  document.querySelectorAll("[data-delete-goal-id]").forEach((btn) => { btn.addEventListener("click", (e) => { e.stopPropagation(); deleteGoal(btn.dataset.deleteGoalId); }); });
}

async function deleteGoal(goalId) {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!window.confirm(`Να διαγραφεί ο στόχος "${goal ? goal.title : ""}";`)) return;
  try { await apiFetch(`${API_BASE}/goals/${goalId}`, { method: "DELETE" }); if (state.currentGoalId === goalId) state.currentGoalId = null; if (state.screen === "goal-detail") showScreen("dashboard"); else renderDashboard(); } catch (e) {}
}
document.getElementById("dash-new-goal-btn").addEventListener("click", () => showScreen("goal-create"));
document.querySelectorAll(".rest-card").forEach((el) => el.addEventListener("click", () => showScreen(el.dataset.nav)));

state.selectedAttachments = [];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// pdf.js χρειάζεται να δείξουμε πού βρίσκεται το worker script του (ίδια CDN έκδοση)
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

async function extractTextFromPdf(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 20); // λογικό όριο σελίδων για ένα MVP
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return text;
}

async function extractTextFromDocx(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

// Αρχεία των οποίων το περιεχόμενο μπορούμε να "διαβάσουμε" και να το
// περάσουμε στον μέντορα (Claude) κατά τη δημιουργία πλάνου.
const READABLE_TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".log"];
function isPlainTextFile(file) {
  if (file.type && file.type.startsWith("text/")) return true;
  const lower = file.name.toLowerCase();
  return READABLE_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
function isPdfFile(file) { return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"); }
function isDocxFile(file) { return file.name.toLowerCase().endsWith(".docx"); }
function isImageFile(file) { return file.type && file.type.startsWith("image/"); }

// Ένας κοινός Tesseract worker, φορτώνεται μία φορά και ξαναχρησιμοποιείται
// για κάθε επόμενη εικόνα (πολύ πιο γρήγορο από το να φτιάχνεται νέος κάθε φορά).
let ocrWorkerPromise = null;
function getOcrWorker() {
  if (!ocrWorkerPromise) ocrWorkerPromise = window.Tesseract.createWorker("eng+ell");
  return ocrWorkerPromise;
}
async function extractTextFromImage(file) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(file);
  return data.text;
}

async function extractAttachmentText(file) {
  try {
    if (isPlainTextFile(file)) return (await readFileAsText(file)).slice(0, 6000);
    if (isPdfFile(file)) return (await extractTextFromPdf(file)).slice(0, 6000);
    if (isDocxFile(file)) return (await extractTextFromDocx(file)).slice(0, 6000);
    if (isImageFile(file)) return (await extractTextFromImage(file)).slice(0, 6000);
  } catch (err) {
    console.error("Δεν ήταν δυνατή η ανάγνωση του αρχείου:", file.name, err);
    return null;
  }
  return null; // π.χ. παλιό .doc — παραμένει επισυναπτόμενο αλλά χωρίς εξαγωγή κειμένου
}

function renderGoalAttachList() {
  const list = document.getElementById("goal-attach-list");
  list.innerHTML = state.selectedAttachments.map((f, i) => `
    <div class="goal-attach-item">
      <i class="ti ti-file"></i><span>${escapeHtml(f.name)}</span>
      ${f.extracting ? '<i class="ti ti-loader-2 spin" title="Διαβάζεται…"></i>' : f.extractedText ? '<i class="ti ti-eye" title="Θα διαβαστεί από τον μέντορα"></i>' : ""}
      <button type="button" data-remove-attach="${i}"><i class="ti ti-x"></i></button>
    </div>
  `).join("");
  list.querySelectorAll("[data-remove-attach]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedAttachments.splice(Number(btn.dataset.removeAttach), 1);
      renderGoalAttachList();
    });
  });
}

// Σημείωση: το <label> ήδη προωθεί αυτόματα το click στο εσωτερικό, κρυφό
// input[type=file] — δεν χρειάζεται (και δεν πρέπει) να το ξανακάνουμε click
// μέσω JS, αλλιώς σε κινητό (ειδικά Safari) το file picker συχνά "σπάει"
// επειδή ενεργοποιείται δύο φορές για ένα μόνο tap.
document.getElementById("goal-attach-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    const attachment = { name: file.name, type: file.type, dataUrl, extractedText: null, extracting: true };
    state.selectedAttachments.push(attachment);
    renderGoalAttachList();
    attachment.extractedText = await extractAttachmentText(file);
    attachment.extracting = false;
    renderGoalAttachList();
  }
  e.target.value = "";
});

document.getElementById("generate-plan-btn").addEventListener("click", async () => {
  const input = document.getElementById("goal-input"); const errorEl = document.getElementById("goal-error"); const loadingEl = document.getElementById("goal-loading");
  const goal = input.value.trim(); errorEl.hidden = true;
  if (!goal) { errorEl.textContent = "Γράψε πρώτα τον στόχο σου."; errorEl.hidden = false; return; }
  loadingEl.hidden = false; document.getElementById("generate-plan-btn").disabled = true;
  try {
    const res = await apiFetch(`${API_BASE}/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, attachments: state.selectedAttachments }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      errorEl.textContent = (data && data.error) || `Σφάλμα (${res.status}). Δοκίμασε ξανά.`;
      errorEl.hidden = false;
      return;
    }
    input.value = "";
    state.selectedAttachments = []; renderGoalAttachList();
    await openGoal(data.id);
  } catch (e) { errorEl.textContent = "Δεν ήταν δυνατή η σύνδεση με τον server."; errorEl.hidden = false; }
  finally { loadingEl.hidden = true; document.getElementById("generate-plan-btn").disabled = false; }
});

async function openGoal(goalId) { state.currentGoalId = goalId; await fetchGoals(); renderGoalDetail(); showScreen("goal-detail"); }
// Δείχνουμε το λινκ μόνο αν είναι πραγματική αναζήτηση YouTube (όχι π.χ. "javascript:").
const isYoutubeSearchUrl = (u) => typeof u === "string" && u.startsWith("https://www.youtube.com/results?");
function difficultyDotsHtml(d) { const n = { easy:1, medium:2, hard:3 }[d] || 1; let h = '<span class="difficulty-dots">'; for (let i=0;i<3;i++) h += `<span class="${i<n?"filled":""}"></span>`; return h+"</span>"; }

function renderGoalDetail() {
  const goal = state.goals.find((g) => g.id === state.currentGoalId);
  const container = document.getElementById("goal-detail-content");
  if (!goal) { container.innerHTML = `<p class="empty-state">Δεν βρέθηκε.</p>`; return; }
  const { done, total, pct } = computeGoalProgress(goal);
  let html = `<p class="eyebrow">${goal.status === "completed" ? "Ολοκληρωμένος στόχος" : "Ενεργός στόχος"}</p><h1>${escapeHtml(goal.title)}</h1><p class="muted">${escapeHtml(goal.estimated_total_duration||"")} · ${done}/${total} βήματα (${pct}%)</p><p class="ai-label"><i class="ti ti-sparkles"></i> Το πλάνο δημιουργήθηκε με AI (Claude). Έλεγξέ το και προσάρμοσέ το στα μέτρα σου.</p><div style="margin-top:24px;">`;
  goal.milestones.forEach((m, i) => {
    html += `<div class="milestone-block"><div class="milestone-rail"></div><div class="milestone-dot ${m.status==="pending"?"pending":""}">${m.status==="completed"?'<i class="ti ti-check"></i>':i+1}</div><div class="milestone-card"><div class="milestone-title-row"><p>${escapeHtml(m.title)}</p><span class="milestone-duration">${escapeHtml(m.estimated_duration||"")}</span></div><div>${m.subgoals.map((s) => `<div class="subgoal-row-wrap"><div class="subgoal-row"><div class="subgoal-check ${s.completed?"checked":""}" data-subgoal-id="${s.id}">${s.completed?'<i class="ti ti-check" style="font-size:11px;"></i>':""}</div><span class="subgoal-title ${s.completed?"done":""}">${escapeHtml(s.title)}</span>${difficultyDotsHtml(s.difficulty)}</div>${isYoutubeSearchUrl(s.youtubeSearchUrl)?`<a class="subgoal-video-link" href="${escapeHtml(s.youtubeSearchUrl)}" target="_blank" rel="noopener"><i class="ti ti-brand-youtube"></i> Σχετικά βίντεο στο YouTube</a>`:""}</div>`).join("")}</div></div></div>`;
  });
  html += "</div>";
  if (goal.attachments && goal.attachments.length) {
    html += `<div class="goal-detail-attachments"><p class="eyebrow">Επισυναπτόμενα αρχεία</p>`;
    goal.attachments.forEach((f) => {
      html += `<a class="attach-link" href="${escapeHtml(f.url || "#")}" download="${escapeHtml(f.name)}" target="_blank" rel="noopener"><i class="ti ti-paperclip"></i> ${escapeHtml(f.name)}</a>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll("[data-subgoal-id]").forEach((el) => el.addEventListener("click", () => toggleSubgoal(el.dataset.subgoalId)));
}

async function toggleSubgoal(subgoalId) {
  const goal = state.goals.find((g) => g.id === state.currentGoalId); if (!goal) return;
  let target = null; for (const m of goal.milestones) { const s = m.subgoals.find((s) => s.id === subgoalId); if (s) { target = s; break; } }
  if (!target) return;
  const was = target.completed; target.completed = !target.completed; target.completedAt = target.completed ? new Date().toISOString() : null;
  renderGoalDetail();
  try {
    const res = await apiFetch(`${API_BASE}/subgoals/${subgoalId}/toggle`, { method: "PATCH" });
    const result = await res.json();
    await fetchGoals(); renderGoalDetail();
    if (result.subgoal && result.subgoal.completed && result.celebrationMessage) showInlineCelebration(result.celebrationMessage, result.goalStatus === "completed");
  } catch (e) { target.completed = was; renderGoalDetail(); }
}
function showInlineCelebration(msg, done) {
  const p = document.getElementById("contextual-prompt");
  document.getElementById("cp-title").textContent = "🎉 " + msg;
  document.getElementById("cp-subtitle").textContent = (done ? "Ολοκλήρωσες όλο τον στόχο!" : "Θες ένα σύντομο διάλειμμα;") + " · Μήνυμα από AI";
  p.hidden = false;
}
document.getElementById("cp-action-btn").addEventListener("click", () => { document.getElementById("contextual-prompt").hidden = true; setMode("rest"); showScreen("breathing-select"); });
document.getElementById("cp-dismiss-btn").addEventListener("click", () => { document.getElementById("contextual-prompt").hidden = true; });
document.getElementById("delete-goal-btn").addEventListener("click", () => { if (state.currentGoalId) deleteGoal(state.currentGoalId); });

const BREATHING_TECHNIQUES = {
  "478": { title: "Αναπνοή 4-7-8", subtitle: "Εισπνοή 4\" — Κράτημα 7\" — Εκπνοή 8\".", phases: [{name:"Εισπνοή",dur:4,r:90},{name:"Κράτημα",dur:7,r:90},{name:"Εκπνοή",dur:8,r:42}] },
  "box": { title: "Box Breathing", subtitle: "4-4-4-4.", phases: [{name:"Εισπνοή",dur:4,r:90},{name:"Κράτημα",dur:4,r:90},{name:"Εκπνοή",dur:4,r:42},{name:"Κράτημα",dur:4,r:42}] },
  "sigh": { title: "Physiological Sigh", subtitle: "Διπλή εισπνοή, αργή εκπνοή.", phases: [{name:"Εισπνοή",dur:2,r:75},{name:"Δεύτερη εισπνοή",dur:1,r:90},{name:"Αργή εκπνοή",dur:6,r:42}] },
};
document.querySelectorAll("#screen-breathing-select .technique-card[data-technique]").forEach((c) => c.addEventListener("click", () => { state.selectedBreathingTechnique = c.dataset.technique; stopBreathing(); applyBreathingTechnique(); showScreen("breathing"); }));
function applyBreathingTechnique() { const t = BREATHING_TECHNIQUES[state.selectedBreathingTechnique]; document.getElementById("breath-title").textContent = t.title; document.getElementById("breath-subtitle").textContent = t.subtitle; }
let breathState = { running:false, phaseIndex:0, timer:null, cycles:0 };
function currentBreathPattern() { return BREATHING_TECHNIQUES[state.selectedBreathingTechnique].phases; }
function runBreathPhase() {
  const pattern = currentBreathPattern(); const phase = pattern[breathState.phaseIndex]; const circle = document.getElementById("breath-circle");
  document.getElementById("breath-phase").textContent = phase.name; circle.style.transition = `r ${phase.dur}s linear`; circle.setAttribute("r", phase.r);
  let cd = phase.dur; document.getElementById("breath-count").textContent = cd;
  clearInterval(breathState.timer);
  breathState.timer = setInterval(() => {
    cd--;
    if (cd > 0) { document.getElementById("breath-count").textContent = cd; }
    else { clearInterval(breathState.timer); breathState.phaseIndex = (breathState.phaseIndex+1)%pattern.length; if (breathState.phaseIndex===0) { breathState.cycles++; document.getElementById("breath-cycles").textContent = `Κύκλοι: ${breathState.cycles}`; } if (breathState.running) runBreathPhase(); }
  }, 1000);
}
function startBreathing() { breathState.running=true; breathState.phaseIndex=0; document.getElementById("breath-toggle-icon").className="ti ti-player-pause"; document.getElementById("breath-toggle-text").textContent="Παύση"; runBreathPhase(); logRelaxationSession("breathing", state.selectedBreathingTechnique); }
function stopBreathing() { breathState.running=false; clearInterval(breathState.timer); document.getElementById("breath-toggle-icon").className="ti ti-player-play"; document.getElementById("breath-toggle-text").textContent="Έναρξη"; document.getElementById("breath-phase").textContent="Πάτα Έναρξη"; document.getElementById("breath-count").textContent=""; breathState.cycles=0; document.getElementById("breath-cycles").textContent="Κύκλοι: 0"; const c=document.getElementById("breath-circle"); if(c){c.style.transition="r 0.5s ease"; c.setAttribute("r",42);} }
document.getElementById("breath-toggle").addEventListener("click", () => { if (breathState.running) stopBreathing(); else startBreathing(); });

const PMR_STEPS = [
  {region:"pmr-region-face",name:"Πρόσωπο",tense:"Σύσφιξε μάτια & σαγόνι",relax:"Χαλάρωσε το πρόσωπο"},
  {region:"pmr-region-shoulders",name:"Ώμοι",tense:"Ανέβασε τους ώμους",relax:"Άφησε τους ώμους"},
  {region:"pmr-region-armL",name:"Αριστερό χέρι",tense:"Σφίξε τη γροθιά",relax:"Άνοιξε το χέρι"},
  {region:"pmr-region-armR",name:"Δεξί χέρι",tense:"Σφίξε τη γροθιά",relax:"Άνοιξε το χέρι"},
  {region:"pmr-region-torso",name:"Κορμός",tense:"Σφίξε κοιλιά",relax:"Άφησε την αναπνοή"},
  {region:"pmr-region-legL",name:"Αριστερό πόδι",tense:"Τέντωσε το πόδι",relax:"Χαλάρωσε το πόδι"},
  {region:"pmr-region-legR",name:"Δεξί πόδι",tense:"Τέντωσε το πόδι",relax:"Χαλάρωσε το πόδι"},
];
const PMR_TENSE_SEC=5, PMR_RELAX_SEC=8;
let pmrState = { running:false, stepIndex:0, phase:"tense", timer:null };
function clearPmrHighlights() { document.querySelectorAll(".pmr-region").forEach((el) => el.classList.remove("tense","relax")); }
function runPmrPhase() {
  const step = PMR_STEPS[pmrState.stepIndex]; document.getElementById("pmr-group-counter").textContent = `Ομάδα ${pmrState.stepIndex+1}/${PMR_STEPS.length} — ${step.name}`; clearPmrHighlights();
  let cd;
  if (pmrState.phase==="tense") { document.getElementById("pmr-step-title").textContent="Σύσφιξη"; document.getElementById("pmr-step-instruction").textContent=step.tense; document.getElementById(step.region).classList.add("tense"); cd=PMR_TENSE_SEC; }
  else { document.getElementById("pmr-step-title").textContent="Χαλάρωση"; document.getElementById("pmr-step-instruction").textContent=step.relax; document.getElementById(step.region).classList.add("relax"); cd=PMR_RELAX_SEC; }
  document.getElementById("pmr-step-count").textContent=cd;
  const totalPh=PMR_STEPS.length*2; const done=pmrState.stepIndex*2+(pmrState.phase==="relax"?1:0);
  document.getElementById("pmr-progress-fill").style.width = `${(done/totalPh)*100}%`;
  clearInterval(pmrState.timer);
  pmrState.timer = setInterval(() => {
    cd--;
    if (cd>0) document.getElementById("pmr-step-count").textContent=cd;
    else { clearInterval(pmrState.timer); if (pmrState.phase==="tense") pmrState.phase="relax"; else { pmrState.phase="tense"; pmrState.stepIndex++; } if (pmrState.stepIndex>=PMR_STEPS.length) finishPmr(); else if (pmrState.running) runPmrPhase(); }
  }, 1000);
}
function finishPmr() { pmrState.running=false; clearInterval(pmrState.timer); clearPmrHighlights(); document.getElementById("pmr-step-title").textContent="Ολοκληρώθηκε"; document.getElementById("pmr-step-instruction").textContent="Πάρε μια βαθιά αναπνοή."; document.getElementById("pmr-step-count").textContent=""; document.getElementById("pmr-progress-fill").style.width="100%"; document.getElementById("pmr-toggle-icon").className="ti ti-player-play"; document.getElementById("pmr-toggle-text").textContent="Ξανά"; document.getElementById("pmr-group-counter").textContent=""; logRelaxationSession("muscle-relaxation","pmr"); }
function startPmr() { pmrState.running=true; pmrState.stepIndex=0; pmrState.phase="tense"; document.getElementById("pmr-toggle-icon").className="ti ti-player-pause"; document.getElementById("pmr-toggle-text").textContent="Παύση"; runPmrPhase(); }
function stopPmr() { pmrState.running=false; clearInterval(pmrState.timer); clearPmrHighlights(); document.getElementById("pmr-toggle-icon").className="ti ti-player-play"; document.getElementById("pmr-toggle-text").textContent="Έναρξη"; document.getElementById("pmr-step-title").textContent="Πάτα Έναρξη"; document.getElementById("pmr-step-instruction").textContent=""; document.getElementById("pmr-step-count").textContent=""; document.getElementById("pmr-progress-fill").style.width="0%"; document.getElementById("pmr-group-counter").textContent=""; pmrState.stepIndex=0; pmrState.phase="tense"; }
document.getElementById("pmr-toggle").addEventListener("click", () => { if (pmrState.running) stopPmr(); else startPmr(); });

// Κλικ πάνω σε μια συγκεκριμένη μυϊκή ομάδα στο σχήμα του σώματος: πάει
// κατευθείαν εκεί, παραλείποντας τις προηγούμενες ομάδες.
PMR_STEPS.forEach((step, i) => {
  const el = document.querySelector(`[data-region="${step.region}"]`);
  if (!el) return;
  el.style.cursor = "pointer";
  el.addEventListener("click", () => {
    clearInterval(pmrState.timer);
    pmrState.running = true; pmrState.stepIndex = i; pmrState.phase = "tense";
    document.getElementById("pmr-toggle-icon").className = "ti ti-player-pause";
    document.getElementById("pmr-toggle-text").textContent = "Παύση";
    runPmrPhase();
  });
});

const SELF_MASSAGE_STEPS = [
  {name:"Λαιμός",instruction:"Απαλοί κυκλικοί μασάζ στον λαιμό.",dur:30},
  {name:"Ώμοι",instruction:"Πίεσε τον μυ ανάμεσα σε ώμο-λαιμό.",dur:30},
  {name:"Κρόταφοι",instruction:"Κυκλικές πιέσεις στους κροτάφους.",dur:20},
  {name:"Παλάμες",instruction:"Πίεσε το κέντρο της παλάμης.",dur:20},
];
let smState = { running:false, stepIndex:0, timer:null };
function runSmStep() {
  const step = SELF_MASSAGE_STEPS[smState.stepIndex]; document.getElementById("sm-step-counter").textContent = `Βήμα ${smState.stepIndex+1}/${SELF_MASSAGE_STEPS.length}`; document.getElementById("sm-step-title").textContent = step.name; document.getElementById("sm-step-instruction").textContent = step.instruction;
  let cd = step.dur; document.getElementById("sm-step-count").textContent = cd; document.getElementById("sm-progress-fill").style.width = `${(smState.stepIndex/SELF_MASSAGE_STEPS.length)*100}%`;
  clearInterval(smState.timer);
  smState.timer = setInterval(() => { cd--; if (cd>0) document.getElementById("sm-step-count").textContent=cd; else { clearInterval(smState.timer); smState.stepIndex++; if (smState.stepIndex>=SELF_MASSAGE_STEPS.length) finishSm(); else if (smState.running) runSmStep(); } }, 1000);
}
function finishSm() { smState.running=false; clearInterval(smState.timer); document.getElementById("sm-step-title").textContent="Ολοκληρώθηκε"; document.getElementById("sm-step-instruction").textContent="Πάρε μια βαθιά αναπνοή."; document.getElementById("sm-step-count").textContent=""; document.getElementById("sm-progress-fill").style.width="100%"; document.getElementById("sm-toggle-icon").className="ti ti-player-play"; document.getElementById("sm-toggle-text").textContent="Ξανά"; document.getElementById("sm-step-counter").textContent=""; document.getElementById("sm-next").hidden=true; logRelaxationSession("muscle-relaxation","self-massage"); }
function startSm() { smState.running=true; smState.stepIndex=0; document.getElementById("sm-toggle-icon").className="ti ti-player-pause"; document.getElementById("sm-toggle-text").textContent="Παύση"; document.getElementById("sm-next").hidden=false; runSmStep(); }
function stopSm() { smState.running=false; clearInterval(smState.timer); document.getElementById("sm-toggle-icon").className="ti ti-player-play"; document.getElementById("sm-toggle-text").textContent="Έναρξη"; document.getElementById("sm-step-title").textContent="Πάτα Έναρξη"; document.getElementById("sm-step-instruction").textContent=""; document.getElementById("sm-step-count").textContent=""; document.getElementById("sm-progress-fill").style.width="0%"; document.getElementById("sm-step-counter").textContent=""; document.getElementById("sm-next").hidden=true; smState.stepIndex=0; }
document.getElementById("sm-toggle").addEventListener("click", () => { if (smState.running) stopSm(); else startSm(); });
document.getElementById("sm-next").addEventListener("click", () => {
  if (!smState.running) return;
  clearInterval(smState.timer);
  smState.stepIndex++;
  if (smState.stepIndex >= SELF_MASSAGE_STEPS.length) finishSm(); else runSmStep();
});

const MUSIC_CATEGORIES = {
  heartbeat: { title:"Heart Beat", subtitle:"Ρυθμικός παλμός — σε καθησυχάζει.", needsHeadphones:false, youtubeId:"i4ZwYINg9_A", youtubeLabel:"Healing 60 BPM Meditation Music", spotifyId:"5uGvGVwBNIiYgrqsE53hH0", spotifyLabel:"Womb Heartbeat Sound (10 Hours)" },
  alpha: { title:"Alpha Waves", subtitle:"Binaural beat 8-12Hz — σε ενεργοποιεί.", needsHeadphones:true, youtubeId:"WPni755-Krg", youtubeLabel:"Study Music Alpha Waves", spotifyId:"37i9dQZF1DWSrtCzTmPimJ", spotifyLabel:"Binaural Beats: Stress Relief" },
  theta: { title:"Theta Waves", subtitle:"Binaural beat 4-8Hz.", needsHeadphones:true, youtubeId:"KcU6w1Pr5gc", youtubeLabel:"8 Hours Theta Waves Healing", spotifyId:"09WR21875BqtXHEJFaqWYG", spotifyLabel:"theta waves binaural beats" },
  binaural: { title:"Binaural Beats", subtitle:"Μια σταθερή διαφορά συχνότητας που σε εξισορροπεί.", needsHeadphones:true, youtubeId:"g1LNTAdIi8k", youtubeLabel:"Deep Focus Music", spotifyId:"37i9dQZF1DX7EF8wVxBVhG", spotifyLabel:"Binaural Beats: Focus" },
};
document.querySelectorAll("#screen-music-select .technique-card[data-music-category]").forEach((c) => c.addEventListener("click", () => { state.selectedMusicCategory = c.dataset.musicCategory; applyMusicCategory(); showScreen("music"); }));
function applyMusicCategory() {
  const cat = MUSIC_CATEGORIES[state.selectedMusicCategory];
  document.getElementById("music-category-title").textContent = cat.title; document.getElementById("music-category-subtitle").textContent = cat.subtitle;
  document.getElementById("music-youtube-label").textContent = cat.youtubeLabel;
  document.getElementById("music-spotify-label").textContent = cat.spotifyLabel;
  ["youtube", "spotify"].forEach((p) => (state.embedsAllowed[p] ? loadMusicEmbed(p) : resetMusicEmbed(p)));
  logRelaxationSession("music", state.selectedMusicCategory);
}
// YouTube και Spotify φορτώνουν μόνο αφού ο χρήστης πατήσει «Αναπαραγωγή» (πριν από αυτό δεν
// στέλνεται τίποτα σε αυτούς). Το YouTube μέσω youtube-nocookie.com. «Αναπαραγωγή» ισχύει μέχρι
// να κλείσει η εφαρμογή· «Να φορτώνει πάντα» αποθηκεύεται στη συσκευή και αλλάζει από το προφίλ (Cookies).
const EMBEDS_ALWAYS_KEY = "mentor_embeds_always";
function embedsAlways() { try { return JSON.parse(lsGet(EMBEDS_ALWAYS_KEY) || "{}"); } catch (e) { return {}; } }
function setEmbedAlways(provider, on) { const a = embedsAlways(); a[provider] = on; lsSet(EMBEDS_ALWAYS_KEY, JSON.stringify(a)); }
state.embedsAllowed = { youtube: Boolean(embedsAlways().youtube), spotify: Boolean(embedsAlways().spotify) };
function musicEmbedUrl(provider) {
  const cat = MUSIC_CATEGORIES[state.selectedMusicCategory];
  return provider === "youtube" ? `https://www.youtube-nocookie.com/embed/${cat.youtubeId}?rel=0` : `https://open.spotify.com/embed/playlist/${cat.spotifyId}?utm_source=generator`;
}
function resetMusicEmbed(provider) {
  const frame = document.getElementById(`${provider}-iframe`);
  frame.src = ""; frame.hidden = true;
  document.querySelector(`.embed-placeholder[data-embed="${provider}"]`).hidden = false;
}
function loadMusicEmbed(provider) {
  const frame = document.getElementById(`${provider}-iframe`);
  frame.src = musicEmbedUrl(provider); frame.hidden = false;
  document.querySelector(`.embed-placeholder[data-embed="${provider}"]`).hidden = true;
}
document.querySelectorAll(".embed-placeholder").forEach((box) => {
  const provider = box.dataset.embed;
  box.querySelector(".embed-play-btn").addEventListener("click", () => { state.embedsAllowed[provider] = true; loadMusicEmbed(provider); });
  box.querySelector(".embed-always-btn").addEventListener("click", () => { setEmbedAlways(provider, true); state.embedsAllowed[provider] = true; loadMusicEmbed(provider); });
});
document.querySelectorAll(".music-tab-btn").forEach((btn) => btn.addEventListener("click", () => { const t=btn.dataset.musicTab; document.querySelectorAll(".music-tab-btn").forEach((b)=>b.classList.toggle("active",b===btn)); document.getElementById("music-tab-youtube").hidden=t!=="youtube"; document.getElementById("music-tab-spotify").hidden=t!=="spotify"; }));

function logRelaxationSession(type, technique) { apiFetch(`${API_BASE}/relaxation-sessions`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({type, technique, context:"manual"}) }).catch(()=>{}); }

function formatDuration(ms) { const min=Math.floor(ms/60000); if(min<60) return `${Math.max(min,1)} λεπτά`; const h=Math.floor(min/60); if(h<24) return `${h} ώρες`; const d=Math.floor(h/24); if(d<30) return `${d} ημέρες`; return `${Math.floor(d/30)} μήνες`; }
async function loadStats() {
  const summaryEl=document.getElementById("stats-summary"); const listEl=document.getElementById("stats-goals-list"); listEl.innerHTML=`<p class="empty-state">Φόρτωση…</p>`;
  try { const res=await apiFetch(`${API_BASE}/stats`); const data=await res.json();
    summaryEl.innerHTML = `<div class="stats-summary-card"><span class="num">${data.totalCompletedGoals}</span><span class="label">Ολοκληρωμένοι</span></div><div class="stats-summary-card"><span class="num">${data.totalActiveGoals}</span><span class="label">Ενεργοί</span></div>`;
    if (!data.goals.length) { listEl.innerHTML = `<p class="empty-state">Δεν έχεις ολοκληρώσει στόχο ακόμα.</p>`; return; }
    listEl.innerHTML = data.goals.map((g) => `<div class="stats-goal-item"><p class="title">${escapeHtml(g.title)}</p><div class="stats-goal-row"><span>${new Date(g.completedAt).toLocaleDateString("el-GR")}</span><span class="duration">${formatDuration(g.durationMs)}</span></div></div>`).join("");
  } catch (e) { listEl.innerHTML = `<p class="empty-state">Σφάλμα.</p>`; }
}

// Δομή καρτών Συνεντεύξεων. Το κείμενο ΔΕΝ αλλάζει — μόνο χωρίζεται σε κομμάτια.
// Κλειδί = ο τίτλος της ενότητας. breaks: φράσεις όπου ξεκινά νέα παράγραφος·
// lead: η 1η παράγραφος τονίζεται· flow: αλυσίδα «α → β → γ» ως διάγραμμα·
// highlight / note / alert: από τη φράση ως το τέλος γίνεται ξεχωριστό πλαίσιο.
const INTERVIEW_LAYOUT = {
  "Τι είναι το burnout": { icon: "ti-flame", lead: true, breaks: ["Στην εργασία,", "Η χρόνια εξάντληση"], note: "Ο Παγκόσμιος Οργανισμός Υγείας" },
  "Τα τρία βασικά χαρακτηριστικά": { icon: "ti-battery-1", highlight: "Δεν είναι απλώς" },
  "Γιατί η προοδευτική δυσκολία βοηθάει": { icon: "ti-stairs-up", breaks: ["Η προοδευτική δυσκολία κάνει", "Με αυτό το μοντέλο"], flow: { start: "μη ρεαλιστικός στόχος", end: " (κλασικός φαύλος κύκλος)." } },
  "Ο ρόλος της ανάπαυσης": { icon: "ti-battery-charging", lead: true, breaks: ["Υπάρχουν μελετημένα", "Στο site"] },
  "Πότε να ζητήσεις βοήθεια": { icon: "ti-heart-handshake", breaks: ["Στην κοινότητα"], alert: "Αν όμως" },
};
function ivParagraphHtml(p, cfg, isLead) {
  // Λίστα συμβουλών «- Τίτλος: κείμενο»
  if (/^- /m.test(p)) {
    const lines = p.split("\n").filter((l) => l.trim());
    let html = ""; let tips = [];
    const flush = () => { if (tips.length) { html += `<ul class="iv-tips">${tips.join("")}</ul>`; tips = []; } };
    lines.forEach((l) => {
      if (l.startsWith("- ")) {
        const t = l.slice(2); const k = t.indexOf(": ");
        tips.push(k > 0 && k < 40 ? `<li><strong>${escapeHtml(t.slice(0, k))}</strong><span>${escapeHtml(t.slice(k + 2))}</span></li>` : `<li><span>${escapeHtml(t)}</span></li>`);
      } else { flush(); html += `<p>${escapeHtml(l)}</p>`; }
    });
    flush(); return html;
  }
  // Αριθμημένα σημεία μέσα στην ίδια παράγραφο: «1. … 2. … 3. …»
  if (/^1\.\s/.test(p) && /\s2\.\s/.test(p)) {
    const pts = p.split(/\s(?=\d\.\s)/);
    return `<ol class="iv-points">${pts.map((pt) => { const m = pt.match(/^(\d)\.\s+(.*?\.)(\s+[\s\S]*)?$/); return m ? `<li><span class="iv-num">${m[1]}</span><div><strong>${escapeHtml(m[2])}</strong>${m[3] ? `<span>${escapeHtml(m[3].trim())}</span>` : ""}</div></li>` : `<li><div>${escapeHtml(pt)}</div></li>`; }).join("")}</ol>`;
  }
  // Αλυσίδα «α → β → γ» ως διάγραμμα
  if (cfg.flow && p.includes(cfg.flow.start) && p.includes("→")) {
    const s = p.indexOf(cfg.flow.start); const e = p.indexOf(cfg.flow.end, s);
    const chain = p.slice(s, e > s ? e : undefined).split(" → ");
    const before = p.slice(0, s).trim(); const after = e > s ? p.slice(e).trim() : "";
    return `${before ? `<p>${escapeHtml(before)}</p>` : ""}<div class="iv-flow">${chain.map((c, i) => `<span class="iv-flow-step">${escapeHtml(c)}</span>${i < chain.length - 1 ? `<i class="ti ti-arrow-right iv-flow-arrow" aria-hidden="true"></i>` : `<i class="ti ti-repeat iv-flow-arrow" aria-hidden="true"></i>`}`).join("")}</div>${after ? `<p class="iv-flow-caption">${escapeHtml(after)}</p>` : ""}`;
  }
  return `<p${isLead ? ` class="iv-lead"` : ""}>${escapeHtml(p)}</p>`;
}
function renderInterviewCards(items) {
  const titled = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.title && !/:\s*$/.test(it.title));
  const toc = titled.length >= 3 ? `<nav class="iv-toc" aria-label="Ενότητες"><p class="iv-toc-label">Σε αυτή τη συνέντευξη</p><ol>${titled.map(({ it, idx }) => `<li><button type="button" data-iv-jump="iv-${idx}">${escapeHtml(it.title.replace(/^\d+\.\s*/, ""))}</button></li>`).join("")}</ol></nav>` : "";
  return toc + items.map((it, idx) => {
    const cfg = INTERVIEW_LAYOUT[it.title] || {};
    let body = it.body || ""; let tail = "";
    [["alert", "iv-alert", "ti-alert-circle"], ["highlight", "iv-highlight", "ti-quote"], ["note", "iv-note", "ti-info-circle"]].forEach(([key, cls, ic]) => {
      const k = cfg[key] ? body.indexOf(cfg[key]) : -1;
      if (k > 0) { tail = `<div class="${cls}"><i class="ti ${ic}" aria-hidden="true"></i><p>${escapeHtml(body.slice(k).trim())}</p></div>` + tail; body = body.slice(0, k).trim(); }
    });
    (cfg.breaks || []).forEach((b) => { body = body.replace(" " + b, "\n\n" + b); });
    const paras = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const content = paras.map((p, i) => ivParagraphHtml(p, cfg, cfg.lead && i === 0)).join("") + tail;
    if (!it.title) return `<div class="info-item iv-intro" id="iv-${idx}"><i class="ti ti-message-circle-question" aria-hidden="true"></i>${content}</div>`;
    if (/:\s*$/.test(it.title)) return `<div class="info-item iv-closing" id="iv-${idx}"><h3><i class="ti ti-sparkles" aria-hidden="true"></i>${escapeHtml(it.title.replace(/:\s*$/, ""))}</h3>${content}</div>`;
    const num = it.title.match(/^(\d+)\.\s*/);
    const badge = num ? `<span class="iv-badge">${num[1]}</span>` : `<span class="iv-badge"><i class="ti ${cfg.icon || "ti-point"}" aria-hidden="true"></i></span>`;
    return `<div class="info-item iv-card" id="iv-${idx}"><div class="iv-head">${badge}<h3>${escapeHtml(num ? it.title.slice(num[0].length) : it.title)}</h3></div><div class="iv-body">${content}</div></div>`;
  }).join("");
}

// Συνεντεύξεις: θεματικές (κουμπιά πάνω) και οι ερωτοαπαντήσεις της επιλεγμένης.
state.selectedInterviewTheme = "burnout";
state.interviewThemes = null;
function renderInterviews() {
  const c=document.getElementById("burnout-info-list"); const tabs=document.getElementById("interview-themes");
  const themes=state.interviewThemes||[];
  if (!themes.some((t)=>t.id===state.selectedInterviewTheme)) state.selectedInterviewTheme = themes[0] ? themes[0].id : "burnout";
  tabs.innerHTML=themes.map((t)=>`<button type="button" class="interview-theme ${t.id===state.selectedInterviewTheme?"active":""}" data-interview-theme="${escapeHtml(t.id)}">${escapeHtml(t.title)}</button>`).join("");
  tabs.querySelectorAll("[data-interview-theme]").forEach((b)=>b.addEventListener("click",()=>{ state.selectedInterviewTheme=b.dataset.interviewTheme; renderInterviews(); }));
  const theme=themes.find((t)=>t.id===state.selectedInterviewTheme);
  c.innerHTML = theme ? renderInterviewCards(theme.items) : `<p class="empty-state">Σφάλμα.</p>`;
  c.querySelectorAll("[data-iv-jump]").forEach((b)=>b.addEventListener("click",()=>{ const t=document.getElementById(b.dataset.ivJump); if (t) t.scrollIntoView({behavior:"smooth", block:"start"}); }));
  // Ο/η ψυχολόγος της συνέντευξης: φωτογραφία και βιογραφικό δεξιά (στο κινητό από πάνω).
  const author=document.getElementById("interview-author"); const a=theme&&theme.author;
  document.getElementById("screen-burnout-info").classList.toggle("has-author", Boolean(a));
  author.hidden=!a;
  author.innerHTML = a ? `${a.photo?`<img class="interview-author-photo" src="${escapeHtml(a.photo)}" alt="${escapeHtml(a.name)}" />`:""}<p class="interview-author-label">Η συνέντευξη δόθηκε από</p><p class="interview-author-name">${escapeHtml(a.name)}</p><p class="interview-author-bio">${escapeHtml(a.bio)}</p>` : "";
}
async function loadBurnoutInfo() {
  const c=document.getElementById("burnout-info-list"); if (!state.interviewThemes) c.innerHTML=`<p class="empty-state">Φόρτωση…</p>`;
  try { const res=await apiFetch(`${API_BASE}/interviews`); if (!res.ok) throw new Error(); state.interviewThemes=await res.json(); renderInterviews(); window.scrollTo(0,0); } catch(e) { c.innerHTML=`<p class="empty-state">Σφάλμα.</p>`; }
}

// Φωτογραφία και emoji είναι δεδομένα χρηστών: πάντα escapeHtml, για να μη μπορεί κανείς να «κρύψει» κώδικα μέσα τους.
function avatarHtml(e, cls) { if (e && e.photo) return `<img class="${cls}" src="${escapeHtml(e.photo)}" alt="" />`; return `<span>${escapeHtml((e&&e.avatar)||"🙂")}</span>`; }
// Σήμα πάνω στο avatar των μεντόρων: πράσινο ✓ αν τους έχει εγκρίνει ο διαχειριστής, αλλιώς κόκκινο Χ.
function mentorBadgeHtml(p, small) {
  if (!p || p.role !== "mentor") return "";
  const ok = Boolean(p.mentorVerified);
  const label = ok ? "Εγκεκριμένος μέντορας" : "Μέντορας χωρίς έγκριση ακόμα";
  return `<span class="mentor-badge ${ok ? "verified" : "pending"}${small ? " small" : ""}" title="${label}" aria-label="${label}"><i class="ti ${ok ? "ti-check" : "ti-x"}"></i></span>`;
}
function updateProfileChip() { if (!state.currentProfile) return; document.getElementById("profile-chip").classList.remove("guest-chip"); document.getElementById("profile-chip-home").classList.remove("guest-chip"); document.getElementById("profile-chip-avatar").innerHTML=avatarHtml(state.currentProfile,"chip-photo"); document.getElementById("profile-chip-name").textContent=state.currentProfile.username; document.getElementById("profile-chip-home-avatar").innerHTML=avatarHtml(state.currentProfile,"chip-photo"); document.getElementById("profile-chip-home-name").textContent=state.currentProfile.username; }
function renderAvatarGrid(containerId, selected, onSelect) { const c=document.getElementById(containerId); c.innerHTML=PROFILE_AVATARS.map((a)=>`<button type="button" class="avatar-option ${a===selected?"selected":""}" data-avatar="${a}">${a}</button>`).join(""); c.querySelectorAll(".avatar-option").forEach((btn)=>btn.addEventListener("click",()=>{c.querySelectorAll(".avatar-option").forEach((b)=>b.classList.remove("selected")); btn.classList.add("selected"); onSelect(btn.dataset.avatar);})); }

// ── Σύνδεση / αποσύνδεση ──
// Επισκέπτης (χωρίς σύνδεση): βλέπει την αρχική, τη Δράση ή την Ανάπαυση. Στη θέση του προφίλ γράφει
// «Sign in with Google» και κάθε άλλο κλικ ανοίγει το παράθυρο σύνδεσης. Μετά τη σύνδεση (και, για νέους
// χρήστες, προφίλ + συγκαταθέσεις) επιστρέφει στην οθόνη όπου ήταν.
const ONBOARDING_SEEN_KEY = "mentor_onboarding_seen";
const RETURN_TO_KEY = "mentor_return_to";
const RETURN_SCREENS = ["home", "dashboard", "goal-create"];
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }

async function startGoogleSignIn(errorEl) {
  if (errorEl) errorEl.hidden = true;
  // Θυμόμαστε πού ήταν, για να επιστρέψει εκεί μετά τη Google.
  const screen = RETURN_SCREENS.includes(state.screen) ? state.screen : "home";
  lsSet(RETURN_TO_KEY, JSON.stringify({ screen, mode: state.mode }));
  // prompt=select_account: η Google δείχνει πάντα τη λίστα λογαριασμών, ώστε κανείς να μη μπαίνει αυτόματα.
  const { error } = await supabaseClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { prompt: "select_account" } } });
  if (error && errorEl) { errorEl.textContent = "Η σύνδεση με Google δεν ξεκίνησε. Δοκίμασε ξανά."; errorEl.hidden = false; }
}
document.getElementById("google-signin-btn").addEventListener("click", () => startGoogleSignIn(document.getElementById("signin-error")));
document.getElementById("signin-sheet-google").addEventListener("click", () => startGoogleSignIn(document.getElementById("signin-sheet-error")));
document.getElementById("signin-sheet-close").addEventListener("click", closeSigninSheet);
document.getElementById("signin-sheet").addEventListener("click", (e) => { if (e.target.id === "signin-sheet") closeSigninSheet(); });
function openSigninSheet() { document.getElementById("signin-sheet-error").hidden = true; document.getElementById("signin-sheet").hidden = false; }
function closeSigninSheet() { document.getElementById("signin-sheet").hidden = true; }

function renderGuestChip() {
  for (const [av, nm] of [["profile-chip-avatar", "profile-chip-name"], ["profile-chip-home-avatar", "profile-chip-home-name"]]) {
    document.getElementById(av).innerHTML = `<i class="ti ti-brand-google"></i>`;
    document.getElementById(nm).textContent = "Sign in with Google";
  }
  document.getElementById("profile-chip").classList.add("guest-chip");
  document.getElementById("profile-chip-home").classList.add("guest-chip");
}
function enterGuest(screen = "home") {
  state.guest = true; state.currentProfile = null;
  renderGuestChip();
  showScreen(screen);
}
// Επισκέπτης: κάθε κλικ (εκτός από τις κάρτες καθοδήγησης, το κουμπί σύνδεσης, το παράθυρο σύνδεσης,
// το κουμπί κρίσης και τα νομικά κείμενα) ζητά σύνδεση.
document.addEventListener("click", (e) => {
  if (!state.guest || state.screen === "onboarding" || state.screen === "legal") return;
  if (e.target.closest("#signin-sheet, #profile-chip, #profile-chip-home, #help-now-btn, #help-now-overlay, [data-legal]")) return;
  e.preventDefault(); e.stopPropagation();
  openSigninSheet();
}, true);

// Οι ειδοποιήσεις συνεχίζουν να έρχονται σε αυτή τη συσκευή και μετά την αποσύνδεση
// (σταματούν μόνο από τον διακόπτη στο προφίλ). Αν συνδεθεί άλλος λογαριασμός, η συσκευή περνά σε αυτόν.
async function signOut() { await supabaseClient.auth.signOut(); handleSignedOut(); }
function handleSignedOut() { stopChatPolling(); state.goals = []; state.consents = null; state.pendingProfile = null; state.coachMessages = []; enterGuest("home"); }
supabaseClient.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") handleSignedOut(); });
async function loadMyProfileAndContinue() {
  state.guest = false;
  // Πού να επιστρέψει μετά τη σύνδεση (αποθηκεύτηκε πριν πάει στη Google).
  try { state.returnTo = JSON.parse(lsGet(RETURN_TO_KEY) || "null"); } catch (e) { state.returnTo = null; }
  lsRemove(RETURN_TO_KEY);
  try {
    const res = await apiFetch(`${API_BASE}/me`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { profile, consents } = await res.json();
    state.consents = consents || null;
    state.pendingProfile = profile || null; state.pendingIsNew = false;
    // Νέος χρήστης: πρώτα το προφίλ, τα κουτάκια συγκατάθεσης (16+, όροι κ.λπ.) έρχονται τελευταία.
    if (!profile) { openProfileCreate(); return; }
    if (!consents || !consents.ok) { openConsent(); return; }
    continueAfterConsent();
  } catch (e) {
    showScreen("profile-select");
    const errorEl = document.getElementById("signin-error"); errorEl.textContent = "Δεν ήταν δυνατή η σύνδεση με τον server. Δοκίμασε ξανά σε λίγο."; errorEl.hidden = false;
  }
}
function continueAfterConsent() {
  const profile = state.pendingProfile, isNew = state.pendingIsNew; state.pendingProfile = null; state.pendingIsNew = false;
  if (profile) selectProfile(profile, isNew); else openProfileCreate();
}
// Μόλις φτιαχτεί το προφίλ: αν δεν έχουν δοθεί οι συγκαταθέσεις, ακολουθούν τώρα (τελευταίο βήμα).
function afterProfileCreated(profile) {
  if (!state.consents || !state.consents.ok) { state.pendingProfile = profile; state.pendingIsNew = true; openConsent(); return; }
  selectProfile(profile, true);
}
// Μετά τη σύνδεση πάει εκεί όπου ήταν πριν (αρχική, Δράση, Ανάπαυση ή νέος στόχος)· αλλιώς στην αρχική.
// Οι κάρτες καθοδήγησης δεν εμφανίζονται εδώ: τις βλέπει ο νέος επισκέπτης πριν συνδεθεί.
function selectProfile(profile, isNew) {
  state.guest = false; state.currentProfile = profile; updateProfileChip();
  const r = state.returnTo; state.returnTo = null;
  if (r && RETURN_SCREENS.includes(r.screen)) { if (r.mode === "action" || r.mode === "rest") setMode(r.mode); showScreen(r.screen); }
  else showScreen("home");
  if (state.pendingOpen) { const t = state.pendingOpen; state.pendingOpen = null; openFromNotification(t); }
  refreshPushSubscription();
}

function wirePhotoUpload({ inputId, previewWrapId, previewImgId, removeId, onChange }) {
  const input = document.getElementById(inputId);
  const previewWrap = document.getElementById(previewWrapId);
  const previewImg = document.getElementById(previewImgId);
  const removeBtn = document.getElementById(removeId);
  input.addEventListener("change", async () => {
    const file = input.files[0]; if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    previewImg.src = dataUrl; previewWrap.hidden = false; onChange(dataUrl);
  });
  removeBtn.addEventListener("click", () => { input.value = ""; previewWrap.hidden = true; previewImg.src = ""; onChange(null); });
}

state.selectedPhoto = null;
state.editSelectedPhoto = null;

document.getElementById("profile-create-back").addEventListener("click", signOut);
function openProfileCreate() {
  document.getElementById("profile-create-username").value=""; document.getElementById("profile-create-bio").value="";
  document.getElementById("profile-create-error").hidden=true;
  document.getElementById("profile-create-photo-preview").hidden=true; document.getElementById("profile-create-photo").value="";
  state.selectedAvatar=PROFILE_AVATARS[0]; state.selectedRole=null; state.selectedPhoto=null;
  renderAvatarGrid("profile-create-avatar-grid", state.selectedAvatar, (a)=>{state.selectedAvatar=a; updateProfileCreatePreview();});
  document.querySelectorAll(".role-choice-btn").forEach((b)=>b.classList.remove("active"));
  setProfileCreateStep(1);
  showScreen("profile-create");
}
// Δημιουργία προφίλ σε 3 βήματα: 1 username, 2 avatar ή φωτογραφία, 3 ρόλος και bio.
function setProfileCreateStep(n) {
  document.querySelectorAll("#screen-profile-create .pc-step").forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  document.querySelectorAll("#screen-profile-create .pc-dot").forEach((d) => { const k = Number(d.dataset.dot); d.classList.toggle("done", k < n); d.classList.toggle("current", k === n); });
  document.getElementById("pc-step-label").textContent = `Βήμα ${n} από 3`;
  ["profile-create-error-1", "profile-create-error"].forEach((id) => { document.getElementById(id).hidden = true; });
  updateProfileCreatePreview();
  window.scrollTo(0, 0);
  if (n === 1) setTimeout(() => document.getElementById("profile-create-username").focus(), 50);
}
function updateProfileCreatePreview() {
  const who = { avatar: state.selectedAvatar, photo: state.selectedPhoto };
  document.getElementById("pc-avatar-preview").innerHTML = avatarHtml(who, "pc-avatar-img");
  const name = document.getElementById("profile-create-username").value.trim();
  document.getElementById("pc-summary").innerHTML = `<span class="pc-summary-avatar">${avatarHtml(who, "pc-summary-img")}</span><strong>${escapeHtml(name)}</strong>`;
}
function profileCreateNext(to) {
  if (to === 2 && !document.getElementById("profile-create-username").value.trim()) {
    const e = document.getElementById("profile-create-error-1"); e.textContent = "Γράψε ένα username."; e.hidden = false; return;
  }
  setProfileCreateStep(to);
}
document.querySelectorAll("#screen-profile-create .pc-next").forEach((b) => b.addEventListener("click", () => profileCreateNext(Number(b.dataset.next))));
document.querySelectorAll("#screen-profile-create .pc-back").forEach((b) => b.addEventListener("click", () => setProfileCreateStep(Number(b.dataset.back))));
document.getElementById("profile-create-username").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); profileCreateNext(2); } });
document.getElementById("profile-create-username").addEventListener("input", () => { document.getElementById("profile-create-error-1").hidden = true; });
document.querySelectorAll("#screen-profile-create .role-choice-btn").forEach((btn)=>btn.addEventListener("click",()=>{ state.selectedRole=btn.dataset.role; document.querySelectorAll("#screen-profile-create .role-choice-btn").forEach((b)=>b.classList.toggle("active",b===btn)); document.getElementById("profile-create-error").hidden=true; }));

wirePhotoUpload({ inputId:"profile-create-photo", previewWrapId:"profile-create-photo-preview", previewImgId:"profile-create-photo-img", removeId:"profile-create-photo-remove", onChange:(url)=>{state.selectedPhoto=url; updateProfileCreatePreview();} });

document.getElementById("profile-create-submit").addEventListener("click", async () => {
  const username=document.getElementById("profile-create-username").value.trim();
  const bio=document.getElementById("profile-create-bio").value.trim();
  const errorEl=document.getElementById("profile-create-error"); errorEl.hidden=true;
  if (!username) { setProfileCreateStep(1); const e1=document.getElementById("profile-create-error-1"); e1.textContent="Γράψε ένα username."; e1.hidden=false; return; }
  if (!state.selectedRole) { errorEl.textContent="Διάλεξε ρόλο: Χρήστης ή Μέντορας."; errorEl.hidden=false; return; }
  try {
    const res=await apiFetch(`${API_BASE}/profiles`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username, bio, role:state.selectedRole, avatar:state.selectedAvatar, photo:state.selectedPhoto})});
    const data=await res.json();
    // Αν το username υπάρχει ήδη, γυρνάμε στο βήμα 1 για να το αλλάξει.
    if (!res.ok && /username/i.test(data.error||"")) { setProfileCreateStep(1); const e1=document.getElementById("profile-create-error-1"); e1.textContent=data.error; e1.hidden=false; return; }
    if (!res.ok) { errorEl.textContent=data.error||"Σφάλμα."; errorEl.hidden=false; return; }
    afterProfileCreated(data);
  } catch(e) { errorEl.textContent="Σφάλμα."; errorEl.hidden=false; }
});

// ── Τα στοιχεία μου ──
// Πρώτα η κάρτα «πώς σε βλέπουν οι άλλοι»· τα πεδία ανοίγουν με «Επεξεργασία».
// Η μπάρα αποθήκευσης εμφανίζεται μόνο όταν κάτι άλλαξε στο προφίλ.
state.editSelectedAvatar = null;
function pfDraft() {
  return {
    username: document.getElementById("profile-edit-username").value.trim(),
    bio: document.getElementById("profile-edit-bio").value.trim(),
    avatar: state.editSelectedAvatar,
    photo: state.editSelectedPhoto || null,
  };
}
function pfIsDirty() {
  const p = state.currentProfile; if (!p) return false; const d = pfDraft();
  return d.username !== p.username || d.bio !== (p.bio || "") || d.avatar !== p.avatar || d.photo !== (p.photo || null);
}
function pfRefreshPreview() {
  const p = state.currentProfile; if (!p) return; const d = pfDraft();
  document.getElementById("pf-avatar").innerHTML = avatarHtml({ photo: d.photo, avatar: d.avatar }, "pf-photo");
  document.getElementById("pf-name").innerHTML = escapeHtml(d.username || p.username) + mentorBadgeHtml(p);
  const bioEl = document.getElementById("pf-bio");
  bioEl.textContent = d.bio || "Δεν έχεις γράψει ακόμα λίγα λόγια για σένα.";
  bioEl.classList.toggle("empty", !d.bio);
  document.getElementById("pf-bio-count").textContent = document.getElementById("profile-edit-bio").value.length;
  document.getElementById("pf-savebar").hidden = !pfIsDirty();
  document.getElementById("pf-save-msg").textContent = "Έχεις αλλαγές που δεν αποθηκεύτηκαν";
  document.getElementById("pf-save-msg").classList.remove("error");
}
function pfSetEditing(on) {
  document.getElementById("pf-form").hidden = !on;
  document.getElementById("pf-edit-btn-label").textContent = on ? "Κλείσιμο" : "Επεξεργασία";
  if (on) document.getElementById("profile-edit-username").focus();
}
let pfToastTimer = null;
function pfToast(text) {
  const el = document.getElementById("pf-toast"); if (!el) return;
  el.innerHTML = `<i class="ti ti-check" aria-hidden="true"></i> ${escapeHtml(text || "Αποθηκεύτηκε")}`; el.hidden = false;
  clearTimeout(pfToastTimer); pfToastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}
function renderProfileEdit() {
  if(!state.currentProfile) return;
  const p = state.currentProfile;
  document.getElementById("profile-edit-username").value=p.username;
  document.getElementById("profile-edit-bio").value=p.bio||"";
  document.getElementById("profile-edit-role-label").textContent=p.role==="mentor"?"Μέντορας":"Χρήστης";
  state.editSelectedAvatar = p.avatar;
  renderAvatarGrid("profile-edit-avatar-grid", p.photo ? null : p.avatar, (a)=>{
    // Διάλεξε avatar: αντικαθιστά τη φωτογραφία.
    state.editSelectedAvatar = a; state.editSelectedPhoto = null;
    document.getElementById("profile-edit-photo-preview").hidden = true; document.getElementById("profile-edit-photo").value = "";
    pfRefreshPreview();
  });
  state.editSelectedPhoto = p.photo || null;
  const previewWrap = document.getElementById("profile-edit-photo-preview");
  const previewImg = document.getElementById("profile-edit-photo-img");
  document.getElementById("profile-edit-photo").value = "";
  if (p.photo) { previewImg.src = p.photo; previewWrap.hidden = false; } else { previewWrap.hidden = true; }
  pfSetEditing(false);
  ["pf-group-notif", "pf-group-data"].forEach((id) => { document.getElementById(id).open = false; });
  document.getElementById("pf-avatar-sheet").hidden = true;
  pfRefreshPreview();
  renderProfileJourney();
}
async function renderProfileJourney() {
  const box = document.getElementById("pf-journey");
  if (state.guest || healthRevoked()) { box.hidden = true; return; }
  try {
    const [g, r] = await Promise.all([apiFetch(`${API_BASE}/goals`), apiFetch(`${API_BASE}/relaxation-sessions`)]);
    const goals = g.ok ? await g.json() : []; const sessions = r.ok ? await r.json() : [];
    document.getElementById("pf-j-goals").textContent = Array.isArray(goals) ? goals.filter((x) => x.status === "completed").length : 0;
    document.getElementById("pf-j-rest").textContent = Array.isArray(sessions) ? sessions.length : 0;
    box.hidden = false;
  } catch (e) { box.hidden = true; }
}
wirePhotoUpload({ inputId:"profile-edit-photo", previewWrapId:"profile-edit-photo-preview", previewImgId:"profile-edit-photo-img", removeId:"profile-edit-photo-remove", onChange:(url)=>{
  state.editSelectedPhoto=url;
  if (url) document.querySelectorAll("#profile-edit-avatar-grid .avatar-option").forEach((b)=>b.classList.remove("selected"));
  pfRefreshPreview();
} });
["profile-edit-username", "profile-edit-bio"].forEach((id) => document.getElementById(id).addEventListener("input", pfRefreshPreview));
document.getElementById("pf-edit-btn").addEventListener("click", () => pfSetEditing(document.getElementById("pf-form").hidden));
document.getElementById("pf-avatar-btn").addEventListener("click", () => { document.getElementById("pf-avatar-sheet").hidden = false; });
document.getElementById("pf-sheet-done").addEventListener("click", () => { document.getElementById("pf-avatar-sheet").hidden = true; });
document.getElementById("pf-avatar-sheet").addEventListener("click", (e) => { if (e.target.id === "pf-avatar-sheet") e.currentTarget.hidden = true; });
document.getElementById("pf-cancel").addEventListener("click", renderProfileEdit);

document.getElementById("profile-edit-save").addEventListener("click", async () => {
  const { username, bio, avatar, photo } = pfDraft();
  const msg = document.getElementById("pf-save-msg");
  if (!username) { pfSetEditing(true); msg.textContent = "Γράψε ένα όνομα χρήστη."; msg.classList.add("error"); return; }
  const btn = document.getElementById("profile-edit-save"); btn.disabled = true;
  try {
    const res=await apiFetch(`${API_BASE}/profiles/${state.currentProfile.id}`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username,avatar,bio,photo})});
    const data=await res.json().catch(()=>null);
    if(res.ok){ state.currentProfile=data; updateProfileChip(); renderProfileEdit(); pfToast("Το προφίλ σου αποθηκεύτηκε"); }
    else { pfSetEditing(true); msg.textContent=(data&&data.error)||"Δεν αποθηκεύτηκε. Δοκίμασε ξανά."; msg.classList.add("error"); }
  } catch(e) { msg.textContent="Δεν ήταν δυνατή η σύνδεση. Δοκίμασε ξανά."; msg.classList.add("error"); }
  finally { btn.disabled = false; }
});
document.getElementById("profile-edit-switch").addEventListener("click", signOut);
// Διαγραφή προφίλ: σβήνει οριστικά τον λογαριασμό (το email φεύγει από την εφαρμογή) και όλα τα δεδομένα του.
// ── Παράθυρο επιβεβαίωσης ──
// showDialog({ title, text, input?, buttons: [{ label, kind: "danger"|"primary"|"", onClick(dialog) }] })
// Ένα κουμπί κλείνει το παράθυρο, εκτός αν το onClick του επιστρέψει false.
function showDialog({ title, text, input, buttons }) {
  const box = document.getElementById("app-dialog"), actions = document.getElementById("app-dialog-actions");
  const field = document.getElementById("app-dialog-input"), errorEl = document.getElementById("app-dialog-error");
  document.getElementById("app-dialog-title").textContent = title;
  document.getElementById("app-dialog-text").textContent = text;
  field.hidden = !input; field.value = ""; field.placeholder = (input && input.placeholder) || "";
  errorEl.hidden = true;
  const dialog = {
    value: () => field.value.trim(),
    error: (msg) => { errorEl.textContent = msg || ""; errorEl.hidden = !msg; },
    close: () => { box.hidden = true; },
  };
  actions.innerHTML = "";
  buttons.forEach((b) => {
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = b.label; if (b.kind) btn.className = b.kind;
    btn.addEventListener("click", async () => {
      if (!b.onClick) return dialog.close();
      const own = [...actions.querySelectorAll("button")];
      own.forEach((x) => { x.disabled = true; });
      try { const keepOpen = (await b.onClick(dialog)) === false; if (!keepOpen) dialog.close(); }
      finally { own.forEach((x) => { x.disabled = false; }); }
    });
    actions.appendChild(btn);
  });
  box.hidden = false;
  (input ? field : actions.querySelector("button")).focus();
}
document.getElementById("app-dialog").addEventListener("click", (e) => { if (e.target.id === "app-dialog") e.currentTarget.hidden = true; });

// Κείμενα από τον «Νομικό φάκελο», καρτέλα 3.
async function downloadMyData() {
  const res = await apiFetch(`${API_BASE}/me/export`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mentor-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
document.getElementById("profile-delete-btn").addEventListener("click", () => {
  showDialog({
    title: "Διαγραφή λογαριασμού",
    text: "Θα διαγραφούν οριστικά τα προφίλ, οι στόχοι, τα στατιστικά και τα μηνύματά σου εντός 30 ημερών. Οι αναρτήσεις σου στο Forum θα εμφανίζονται ως «Διαγραμμένος χρήστης». Η ενέργεια δεν αναιρείται. Αν έχεις συνδρομή, ακυρώνεται αυτόματα.",
    buttons: [
      { label: "Κατέβασε τα δεδομένα μου πρώτα", onClick: async (d) => { try { await downloadMyData(); d.error(""); } catch (e) { d.error("Δεν ήταν δυνατή η λήψη. Δοκίμασε ξανά."); } return false; } },
      { label: "Διαγραφή οριστικά", kind: "danger", onClick: async (d) => {
        try {
          const res = await apiFetch(`${API_BASE}/me`, { method: "DELETE" });
          if (!res.ok) { const data = await res.json().catch(() => null); d.error((data && data.error) || "Η διαγραφή απέτυχε."); return false; }
          await supabaseClient.auth.signOut({ scope: "local" });
          handleSignedOut();
          const msg = document.getElementById("signin-error"); msg.textContent = "Ο λογαριασμός σου διαγράφηκε."; msg.hidden = false;
        } catch (e) { d.error("Δεν ήταν δυνατή η σύνδεση με τον server."); return false; }
      } },
      { label: "Άκυρο" },
    ],
  });
});

// ── Συγκατάθεση για δεδομένα υγείας ──
// Χωρίς αυτήν, το Mentor λειτουργεί μόνο με τις ασκήσεις χαλάρωσης και τη μουσική.
function healthRevoked() { return Boolean(state.consents && state.consents.health === false); }
const HEALTH_GATED_SCREENS = ["goal-create", "goal-detail", "stats", "coach", "weekly", "forum-select", "forum", "messages", "chat", "mentors", "favorites", "profile-view"];
async function setHealthConsent(granted) {
  const res = await apiFetch(`${API_BASE}/consents/health`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ granted }) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || "Η αλλαγή δεν αποθηκεύτηκε.");
  state.consents = data.consents; state.goals = [];
  renderHealthButton();
}
function renderHealthButton() {
  const revoked = healthRevoked();
  document.getElementById("profile-health-title").textContent = revoked ? "Δώσε ξανά συγκατάθεση για δεδομένα υγείας" : "Ανάκληση συγκατάθεσης δεδομένων υγείας";
  document.getElementById("profile-health-sub").textContent = revoked
    ? "Για να λειτουργούν ξανά οι στόχοι, ο coach, η κοινότητα και τα μηνύματα"
    : "Οι στόχοι και η ενέργειά σου θα διαγραφούν και η εφαρμογή θα λειτουργεί μόνο με τις ασκήσεις χαλάρωσης και τη μουσική";
}
const HEALTH_CONSENT_TEXT = "Συναινώ στην επεξεργασία των στόχων, της ενέργειάς μου και όσων γράφω στο Mentor, ακόμα κι αν αφορούν την ψυχική μου υγεία, ώστε να λειτουργεί η εφαρμογή. Μπορώ να το ανακαλέσω από το προφίλ μου.";
function askHealthConsent(title) {
  showDialog({
    title,
    text: HEALTH_CONSENT_TEXT,
    buttons: [
      { label: "Συναινώ", kind: "primary", onClick: async (d) => { try { await setHealthConsent(true); } catch (e) { d.error(e.message); return false; } } },
      { label: "Άκυρο" },
    ],
  });
}
function showHealthGate() {
  showDialog({
    title: "Μόνο χαλάρωση και μουσική",
    text: "Χωρίς τη συγκατάθεση για δεδομένα υγείας, το Mentor λειτουργεί μόνο με τις ασκήσεις χαλάρωσης και τη μουσική.",
    buttons: [
      { label: "Δώσε ξανά συγκατάθεση", kind: "primary", onClick: () => { askHealthConsent("Συγκατάθεση για δεδομένα υγείας"); return false; } },
      { label: "Άκυρο" },
    ],
  });
}
document.getElementById("profile-revoke-health-btn").addEventListener("click", () => {
  if (healthRevoked()) { askHealthConsent("Συγκατάθεση για δεδομένα υγείας"); return; }
  showDialog({
    title: "Ανάκληση συγκατάθεσης δεδομένων υγείας",
    text: "Χωρίς αυτή τη συγκατάθεση δεν μπορούμε να αποθηκεύουμε στόχους και ενέργεια, άρα θα διαγραφούν και η εφαρμογή θα λειτουργεί μόνο με τις ασκήσεις χαλάρωσης και τη μουσική.",
    buttons: [
      { label: "Ανάκληση και διαγραφή", kind: "danger", onClick: async (d) => { try { await setHealthConsent(false); } catch (e) { d.error(e.message); return false; } } },
      { label: "Άκυρο" },
    ],
  });
});
document.getElementById("profile-chip").addEventListener("click", () => { if (state.guest) startGoogleSignIn(document.getElementById("signin-sheet-error")); else showScreen("profile-edit"); });
document.getElementById("profile-chip-home").addEventListener("click", () => { if (state.guest) startGoogleSignIn(document.getElementById("signin-sheet-error")); else showScreen("profile-edit"); });

let allMentorsCache = [];
async function loadMentors() {
  const c=document.getElementById("mentors-list"); document.getElementById("mentors-search").value=""; c.innerHTML=`<p class="empty-state">Φόρτωση…</p>`;
  try { const res=await apiFetch(`${API_BASE}/profiles`); const profiles=await res.json(); allMentorsCache=profiles.filter((p)=>p.role==="mentor"); renderMentorsList(allMentorsCache); } catch(e) { c.innerHTML=`<p class="empty-state">Σφάλμα.</p>`; }
}
function renderMentorsList(list) {
  const c=document.getElementById("mentors-list");
  if (!list.length) { c.innerHTML=`<p class="empty-state">Δεν βρέθηκαν μέντορες.</p>`; return; }
  c.innerHTML = list.map((p)=>`<button class="profile-card" data-view-profile-id="${p.id}"><span class="avatar-wrap"><span class="profile-card-avatar">${avatarHtml(p,"card-photo")}</span>${mentorBadgeHtml(p)}</span><span class="profile-card-info"><strong>${escapeHtml(p.username)}</strong><span class="profile-role-badge">Μέντορας</span></span></button>`).join("");
  c.querySelectorAll("[data-view-profile-id]").forEach((btn)=>btn.addEventListener("click",()=>openProfileView(btn.dataset.viewProfileId,"mentors")));
}
document.getElementById("mentors-search").addEventListener("input", (e)=>{ const q=e.target.value.trim().toLowerCase(); renderMentorsList(q?allMentorsCache.filter((p)=>p.username.toLowerCase().includes(q)):allMentorsCache); });

async function openProfileView(profileId, ret) {
  try { const res=await apiFetch(`${API_BASE}/profiles/${profileId}`); const profile=await res.json(); state.viewingProfile=profile; state.profileViewReturnScreen=ret||"home"; renderProfileView(); showScreen("profile-view"); } catch(e){}
}
function renderProfileView() {
  const p=state.viewingProfile; if(!p) return;
  document.getElementById("profile-view-avatar").innerHTML=avatarHtml(p,""); document.getElementById("profile-view-mentor-badge").innerHTML=mentorBadgeHtml(p); document.getElementById("profile-view-username").textContent=p.username;
  document.getElementById("profile-view-role-badge").textContent=p.role==="mentor"?"Μέντορας":"Χρήστης"; document.getElementById("profile-view-bio").textContent=p.bio||"—";
  document.getElementById("profile-view-message-btn").style.display = (state.currentProfile && state.currentProfile.id===p.id) ? "none" : "flex";
  renderProfileMedia(p);
}
// Οι φωτογραφίες/βίντεο που έχει δημοσιεύσει ο μέντορας στο Learn, κάτω από το bio του.
async function renderProfileMedia(p) {
  const wrap=document.getElementById("profile-view-media-wrap"); const grid=document.getElementById("profile-view-media");
  wrap.hidden=true; grid.innerHTML="";
  if (p.role!=="mentor") return;
  try {
    const items=await (await apiFetch(`${API_BASE}/profiles/${p.id}/media`)).json();
    if (!state.viewingProfile || state.viewingProfile.id!==p.id || !items.length) return;
    grid.innerHTML=items.map((m)=>`<div class="profile-media-item">${forumMediaHtml(m.type,m.url,"")}${m.message?`<p>${escapeHtml(m.message)}</p>`:""}</div>`).join("");
    wireVideoFallbacks(grid); wrap.hidden=false;
  } catch(e) {}
}
document.getElementById("profile-view-back").addEventListener("click", () => showScreen(state.profileViewReturnScreen));
document.getElementById("profile-view-message-btn").addEventListener("click", () => { if(state.viewingProfile) openChat(state.viewingProfile); });

document.getElementById("dm-entry-btn").addEventListener("click", () => showScreen("messages"));
async function loadConversations() {
  document.getElementById("messages-search").value=""; document.getElementById("messages-search-results").innerHTML="";
  const c=document.getElementById("conversations-list"); c.innerHTML=`<p class="empty-state">Φόρτωση…</p>`;
  try { const res=await apiFetch(`${API_BASE}/messages/conversations`); const conv=await res.json();
    if (!conv.length) { c.innerHTML=`<p class="empty-state">Καμία συνομιλία ακόμα.</p>`; return; }
    c.innerHTML = conv.map((x)=>`<button class="conversation-card" data-open-chat-id="${x.partner.id}"><span class="avatar-wrap"><span class="conversation-avatar">${avatarHtml(x.partner,"")}</span>${mentorBadgeHtml(x.partner)}</span><span class="conversation-info"><strong>${escapeHtml(x.partner.username)}</strong><span class="conversation-preview">${escapeHtml(x.lastMessage)}</span></span></button>`).join("");
    c.querySelectorAll("[data-open-chat-id]").forEach((btn)=>{ const x=conv.find((x)=>x.partner.id===btn.dataset.openChatId); btn.addEventListener("click",()=>openChat(x.partner)); });
  } catch(e) { c.innerHTML=`<p class="empty-state">Σφάλμα.</p>`; }
}
document.getElementById("messages-search").addEventListener("input", async (e) => {
  const q=e.target.value.trim().toLowerCase(); const r=document.getElementById("messages-search-results"); if(!q){r.innerHTML="";return;}
  try { const res=await apiFetch(`${API_BASE}/profiles`); const profiles=await res.json(); const matches=profiles.filter((p)=>p.username.toLowerCase().includes(q)&&(!state.currentProfile||p.id!==state.currentProfile.id));
    if(!matches.length){r.innerHTML=`<p class="empty-state">Δεν βρέθηκε.</p>`;return;}
    r.innerHTML = matches.map((p)=>`<button class="conversation-card" data-start-chat-id="${p.id}"><span class="avatar-wrap"><span class="conversation-avatar">${avatarHtml(p,"")}</span>${mentorBadgeHtml(p)}</span><span class="conversation-info"><strong>${escapeHtml(p.username)}</strong></span></button>`).join("");
    r.querySelectorAll("[data-start-chat-id]").forEach((btn)=>{ const p=matches.find((p)=>p.id===btn.dataset.startChatId); btn.addEventListener("click",()=>openChat(p)); });
  } catch(e) { r.innerHTML=`<p class="empty-state">Σφάλμα.</p>`; }
});
state.chatPollTimer = null;
function stopChatPolling() { if (state.chatPollTimer) { clearInterval(state.chatPollTimer); state.chatPollTimer = null; } }

async function openChat(partner) {
  state.chatPartner=partner; document.getElementById("chat-partner-avatar").innerHTML=avatarHtml(partner,""); document.getElementById("chat-partner-mentor-badge").innerHTML=mentorBadgeHtml(partner);
  document.getElementById("chat-partner-name").textContent=partner.username; document.getElementById("chat-input").value="";
  showScreen("chat"); await loadChatMessages();
  stopChatPolling();
  // Κάθε 3" ελέγχουμε για νέα μηνύματα όσο ο χρήστης παραμένει σε αυτή τη
  // συνομιλία — έτσι δεν χρειάζεται να βγει/ξαναμπεί για να τα δει.
  state.chatPollTimer = setInterval(loadChatMessages, 3000);
}
async function loadChatMessages() {
  const c=document.getElementById("chat-messages"); if(!state.chatPartner) return;
  const wasEmpty = c.querySelector(".empty-state");
  if (!c.children.length || wasEmpty) c.innerHTML=`<p class="empty-state">Φόρτωση…</p>`;
  try { const res=await apiFetch(`${API_BASE}/messages/${state.chatPartner.id}`); const msgs=await res.json();
    const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
    if (!msgs.length) c.innerHTML=`<p class="empty-state">Καμία συνομιλία ακόμα.</p>`;
    else c.innerHTML = msgs.map((m)=>{ const mine=state.currentProfile&&m.fromProfileId===state.currentProfile.id; return `<div class="chat-bubble ${mine?"mine":"theirs"}">${escapeHtml(m.text)}</div>`; }).join("");
    if (nearBottom) c.scrollTop=c.scrollHeight;
  } catch(e) { /* σιωπηλή αποτυχία στο polling ώστε να μη διακόπτεται η συνομιλία */ }
}
async function sendChatMessage() { const input=document.getElementById("chat-input"); const text=input.value.trim(); if(!text||!state.chatPartner) return; input.value=""; try { await apiFetch(`${API_BASE}/messages`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({toProfileId:state.chatPartner.id,text})}); await loadChatMessages(); } catch(e) {} }
document.getElementById("chat-send-btn").addEventListener("click", sendChatMessage);
document.getElementById("chat-input").addEventListener("keydown", (e)=>{ if(e.key==="Enter") sendChatMessage(); });

const FORUM_BOARD_LABELS = { a: "Learn", b: "Get involved" };
function isMentor() { return Boolean(state.currentProfile && state.currentProfile.role==="mentor"); }
// Στο Learn γράφουν (κείμενο, φωτογραφίες, βίντεο) μόνο οι εγκεκριμένοι μέντορες.
function canWriteLearn() { return isMentor() && Boolean(state.currentProfile.mentorVerified); }
function renderForumSelect() { document.getElementById("forum-a-badge").textContent = canWriteLearn() ? "Μπορείς να γράψεις" : isMentor() ? "Θα μπορείς να γράψεις μόλις εγκριθείς" : "Μόνο ανάγνωση για σένα"; }
document.querySelectorAll("#screen-forum-select .technique-card[data-forum-board]").forEach((card)=>card.addEventListener("click", () => {
  state.selectedForumBoard=card.dataset.forumBoard; document.getElementById("forum-board-title").textContent=FORUM_BOARD_LABELS[state.selectedForumBoard];
  const canWrite = state.selectedForumBoard!=="a" || canWriteLearn();
  document.getElementById("forum-new-post").hidden=!canWrite; document.getElementById("forum-readonly-note").hidden=canWrite;
  clearForumMedia(); document.getElementById("forum-media-wrap").hidden = !(state.selectedForumBoard==="a" && canWriteLearn());
  showScreen("forum");
}));

// Φωτογραφία/βίντεο στις δημοσιεύσεις του Learn (μόνο μέντορες).
const FORUM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FORUM_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
state.forumMedia = null;
function clearForumMedia() {
  if (state.forumMedia) URL.revokeObjectURL(state.forumMedia.previewUrl);
  state.forumMedia = null;
  document.getElementById("forum-media-input").value = "";
  document.getElementById("forum-media-preview").hidden = true;
  document.getElementById("forum-media-preview-content").innerHTML = "";
  document.getElementById("forum-media-error").hidden = true;
}
function forumMediaHtml(type, src, cls) {
  src = escapeHtml(src);
  return type === "video" ? `<video class="${cls}" src="${src}" controls playsinline preload="metadata"></video>` : `<img class="${cls}" src="${src}" alt="" />`;
}
// Ο browser συχνά δεν δίνει τύπο σε μορφές όπως .mkv/.avi/.wmv, οπότε τον βρίσκουμε από την κατάληξη.
const VIDEO_EXTENSION_TYPES = {
  mp4:"video/mp4", m4v:"video/x-m4v", mov:"video/quicktime", webm:"video/webm", ogv:"video/ogg", mkv:"video/x-matroska",
  avi:"video/x-msvideo", wmv:"video/x-ms-wmv", asf:"video/x-ms-asf", flv:"video/x-flv", f4v:"video/x-f4v", "3gp":"video/3gpp",
  "3g2":"video/3gpp2", mpg:"video/mpeg", mpeg:"video/mpeg", m2v:"video/mpeg", ts:"video/mp2t", mts:"video/mp2t", m2ts:"video/mp2t",
  vob:"video/dvd", divx:"video/divx", rmvb:"video/vnd.rn-realvideo",
};
function videoTypeOf(file) {
  if (file.type.startsWith("video/")) return file.type;
  return VIDEO_EXTENSION_TYPES[(file.name.split(".").pop() || "").toLowerCase()] || null;
}
// Όλες οι μορφές ανεβαίνουν, αλλά ο browser παίζει μόνο κάποιες (π.χ. MP4, WebM).
// Όταν δεν μπορεί, δείχνουμε κουμπί λήψης στη θέση του player. Βίντεο από κινητά
// σε HEVC/H.265 συχνά παίζουν μόνο τον ήχο: τότε κρατάμε τον player και εξηγούμε.
function videoFallbackBox(video, text) {
  const box = document.createElement("div"); box.className = "forum-video-fallback";
  box.innerHTML = `<i class="ti ti-video-off"></i><span>${text}</span>`;
  const link = document.createElement("a"); link.href = video.src; link.download = "video"; link.textContent = "Κατέβασέ το";
  box.appendChild(link); return box;
}
function wireVideoFallbacks(container, onProblem) {
  container.querySelectorAll("video").forEach((video) => {
    video.addEventListener("error", () => {
      video.replaceWith(videoFallbackBox(video, "Αυτή η μορφή βίντεο δεν παίζει στον browser σου."));
      if (onProblem) onProblem("unplayable");
    }, { once: true });
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth > 0) return;
      video.after(videoFallbackBox(video, "Ο browser σου δείχνει μόνο τον ήχο αυτού του βίντεο."));
      if (onProblem) onProblem("audio-only");
    }, { once: true });
  });
}
document.getElementById("forum-media-input").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const errorEl = document.getElementById("forum-media-error");
  const videoType = videoTypeOf(file), isVideo = Boolean(videoType), isImage = !isVideo && file.type.startsWith("image/");
  clearForumMedia();
  if (!isVideo && !isImage) { errorEl.textContent = "Μπορείς να ανεβάσεις μόνο φωτογραφία ή βίντεο."; errorEl.hidden = false; return; }
  const max = isVideo ? FORUM_VIDEO_MAX_BYTES : FORUM_IMAGE_MAX_BYTES;
  if (file.size > max) { errorEl.textContent = isVideo ? "Το βίντεο είναι πολύ μεγάλο (έως 50 MB)." : "Η φωτογραφία είναι πολύ μεγάλη (έως 5 MB)."; errorEl.hidden = false; return; }
  const media = { type: isVideo ? "video" : "image", mime: isVideo ? videoType : file.type, file, previewUrl: URL.createObjectURL(file) };
  state.forumMedia = media;
  const previewContent = document.getElementById("forum-media-preview-content");
  previewContent.innerHTML = forumMediaHtml(media.type, media.previewUrl, "");
  wireVideoFallbacks(previewContent, (problem) => {
    errorEl.textContent = problem === "audio-only"
      ? "Στην προεπισκόπηση φαίνεται μόνο ο ήχος, γιατί το βίντεο είναι πιθανότατα σε μορφή HEVC (H.265). Με τη δημοσίευση μετατρέπεται αυτόματα σε μορφή που παίζει παντού."
      : "Η προεπισκόπηση δεν παίζει σε αυτόν τον browser. Με τη δημοσίευση το βίντεο μετατρέπεται αυτόματα σε μορφή που παίζει παντού.";
    errorEl.hidden = false;
  });
  document.getElementById("forum-media-preview").hidden = false;
});
document.getElementById("forum-media-remove").addEventListener("click", clearForumMedia);
async function loadForumPosts() {
  const board=state.selectedForumBoard; const c=document.getElementById("forum-posts-list"); c.innerHTML=`<p class="empty-state">Φόρτωση…</p>`;
  try { const res=await apiFetch(`${API_BASE}/forum/posts?board=${board}`); const posts=await res.json(); const canWrite=board!=="a"||canWriteLearn();
    if (!posts.length) { c.innerHTML=`<p class="empty-state">Καμία δημοσίευση ακόμα${canWrite?" — γράψε την πρώτη!":"."}</p>`; return; }
    c.innerHTML = posts.map((p)=>renderForumPost(p,0,canWrite)).join(""); wireVideoFallbacks(c);
    c.querySelectorAll("[data-reply-toggle]").forEach((btn)=>btn.addEventListener("click",()=>{ const f=c.querySelector(`[data-reply-form="${btn.dataset.replyToggle}"]`); if(f) f.hidden=!f.hidden; }));
    c.querySelectorAll("[data-reply-submit]").forEach((btn)=>btn.addEventListener("click",()=>submitForumReply(btn.dataset.replySubmit)));
    c.querySelectorAll("[data-view-profile-id]").forEach((el)=>el.addEventListener("click",()=>openProfileView(el.dataset.viewProfileId,"forum")));
    wireFavoriteStars(c);
    c.querySelectorAll("[data-delete-post]").forEach((btn)=>btn.addEventListener("click",()=>deleteForumPost(btn.dataset.deletePost, btn.dataset.hasReplies==="1")));
    c.querySelectorAll("[data-report-post]").forEach((btn)=>btn.addEventListener("click",()=>reportForumPost(btn.dataset.reportPost)));
  } catch(e) { c.innerHTML=`<p class="empty-state">Σφάλμα.</p>`; }
}
// ── Αγαπημένα: αστεράκι σε δημοσιεύσεις με φωτογραφία/βίντεο ──
function favoriteStarHtml(postId, on) {
  return `<button type="button" class="favorite-star ${on?"on":""}" data-favorite-post="${postId}" aria-pressed="${on?"true":"false"}" title="${on?"Αφαίρεση από τα Αγαπημένα":"Αποθήκευση στα Αγαπημένα"}"><i class="ti ${on?"ti-star-filled":"ti-star"}"></i></button>`;
}
function setStarState(btn, on) {
  btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.title = on ? "Αφαίρεση από τα Αγαπημένα" : "Αποθήκευση στα Αγαπημένα";
  btn.querySelector("i").className = `ti ${on ? "ti-star-filled" : "ti-star"}`;
}
async function toggleFavorite(btn) {
  const postId = btn.dataset.favoritePost, on = !btn.classList.contains("on");
  setStarState(btn, on); btn.disabled = true;
  try {
    const res = on
      ? await apiFetch(`${API_BASE}/favorites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId }) })
      : await apiFetch(`${API_BASE}/favorites/${postId}`, { method: "DELETE" });
    if (!res.ok) { setStarState(btn, !on); const data = await res.json().catch(() => null); alert((data && data.error) || "Δεν αποθηκεύτηκε. Δοκίμασε ξανά."); }
  } catch (e) { setStarState(btn, !on); }
  finally { btn.disabled = false; }
}
function wireFavoriteStars(container) { container.querySelectorAll("[data-favorite-post]").forEach((btn) => btn.addEventListener("click", () => toggleFavorite(btn))); }
async function loadFavorites() {
  const c = document.getElementById("favorites-list"); c.innerHTML = `<p class="empty-state">Φόρτωση…</p>`;
  try {
    const items = await (await apiFetch(`${API_BASE}/favorites`)).json();
    if (!items.length) { c.innerHTML = `<p class="empty-state">Δεν έχεις αποθηκεύσει τίποτα ακόμα. Πάτα το <i class="ti ti-star"></i> σε μια φωτογραφία ή ένα βίντεο της κοινότητας.</p>`; return; }
    c.innerHTML = items.map((m) => `<div class="profile-media-item favorite-item" data-favorite-item="${m.postId}">${forumMediaHtml(m.type, m.url, "")}<div class="favorite-item-meta"><span>${escapeHtml(m.author)}</span>${favoriteStarHtml(m.postId, true)}</div>${m.message?`<p>${escapeHtml(m.message)}</p>`:""}</div>`).join("");
    wireVideoFallbacks(c);
    // Στα Αγαπημένα, όταν βγάζεις το αστεράκι, η κάρτα φεύγει από τη λίστα.
    c.querySelectorAll("[data-favorite-post]").forEach((btn) => btn.addEventListener("click", async () => {
      await toggleFavorite(btn);
      if (!btn.classList.contains("on")) { btn.closest("[data-favorite-item]").remove(); if (!c.querySelector("[data-favorite-item]")) loadFavorites(); }
    }));
  } catch (e) { c.innerHTML = `<p class="empty-state">Σφάλμα.</p>`; }
}
async function deleteForumPost(postId, hasReplies) {
  if (!confirm(hasReplies ? "Να διαγραφεί η δημοσίευση; Θα διαγραφούν και οι απαντήσεις της." : "Να διαγραφεί η δημοσίευση;")) return;
  try { const res=await apiFetch(`${API_BASE}/forum/posts/${postId}`, {method:"DELETE"}); if(!res.ok){ const data=await res.json().catch(()=>null); alert((data&&data.error)||"Η διαγραφή απέτυχε."); return; } loadForumPosts(); } catch(e) { alert("Δεν ήταν δυνατή η σύνδεση με τον server."); }
}
function renderForumPost(p, depth, canWrite) {
  const replies=p.replies||[]; const isOwn=Boolean(state.currentProfile && p.profileId===state.currentProfile.id);
  return `<div class="forum-post" style="margin-left:${Math.min(depth,8)*18}px;"><div class="forum-post-head"><span class="forum-post-author-wrap" ${p.profileId?`data-view-profile-id="${p.profileId}"`:""} style="${p.profileId?"cursor:pointer;":""}"><span class="avatar-wrap">${avatarHtml(p,"post-photo")}${mentorBadgeHtml(p,true)}</span><span style="font-weight:600;">${escapeHtml(p.author)}</span></span><span class="forum-post-head-right"><span>${new Date(p.createdAt).toLocaleString("el-GR")}</span>${p.media&&!p.parentId?favoriteStarHtml(p.id,p.favorited):""}</span></div>${p.message?`<div class="forum-post-message">${escapeHtml(p.message)}</div>`:""}${p.media?forumMediaHtml(p.media.type,p.media.url,"forum-post-media"):""}${canWrite||isOwn?`<div class="forum-post-actions">${canWrite?`<button class="reply-toggle-btn" data-reply-toggle="${p.id}"><i class="ti ti-corner-up-left"></i> Απάντηση${replies.length?` (${replies.length})`:""}</button>`:""}${isOwn?`<button class="reply-toggle-btn post-delete-btn" data-delete-post="${p.id}" data-has-replies="${replies.length?1:0}"><i class="ti ti-trash"></i> Διαγραφή</button>`:`<button class="reply-toggle-btn report-btn" data-report-post="${p.id}"><i class="ti ti-flag"></i> Αναφορά</button>`}</div>`:`<div class="forum-post-actions"><button class="reply-toggle-btn report-btn" data-report-post="${p.id}"><i class="ti ti-flag"></i> Αναφορά</button></div>`}${canWrite?`<div class="forum-reply-form" data-reply-form="${p.id}" hidden><textarea rows="2" placeholder="Γράψε…" data-reply-message="${p.id}"></textarea><button class="btn-small" data-reply-submit="${p.id}">Απάντησε</button></div>`:""}${replies.length?`<div class="forum-replies">${replies.map((r)=>renderForumPost(r,depth+1,canWrite)).join("")}</div>`:""}</div>`;
}
// «Αναφορά» ανάρμοστου περιεχομένου (βλ. Όροι Χρήσης, ενότητα 4). Τη βλέπει μόνο ο διαχειριστής.
function reportForumPost(postId) {
  showDialog({
    title: "Αναφορά",
    text: "Τι δεν πάει καλά με αυτή την ανάρτηση; (προαιρετικό)",
    input: { placeholder: "π.χ. προσβολή, spam, επικίνδυνο περιεχόμενο" },
    buttons: [
      { label: "Αποστολή αναφοράς", kind: "danger", onClick: async (d) => {
        try {
          const res = await apiFetch(`${API_BASE}/forum/posts/${postId}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: d.value() }) });
          const data = await res.json().catch(() => null);
          if (!res.ok) { d.error((data && data.error) || "Η αναφορά δεν στάλθηκε. Δοκίμασε ξανά."); return false; }
          showDialog({ title: "Ευχαριστούμε", text: "Η αναφορά σου στάλθηκε. Θα την εξετάσουμε το συντομότερο.", buttons: [{ label: "Εντάξει", kind: "primary" }] });
          return false; // το νέο παράθυρο έχει ήδη πάρει τη θέση αυτού
        } catch (e) { d.error("Δεν ήταν δυνατή η σύνδεση με τον server."); return false; }
      } },
      { label: "Άκυρο" },
    ],
  });
}
async function submitForumReply(parentId) {
  const el=document.querySelector(`[data-reply-message="${parentId}"]`); const message=el.value.trim(); if(!message) return;
  try { const res=await apiFetch(`${API_BASE}/forum/posts`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({message,parentId})}); if(res.status===403){alert("Εδώ γράφουν μόνο εγκεκριμένοι μέντορες.");return;} loadForumPosts(); } catch(e) {}
}
document.getElementById("forum-submit-btn").addEventListener("click", async () => {
  const message=document.getElementById("forum-message").value.trim(); const media=state.forumMedia; if(!message && !media) return;
  const btn=document.getElementById("forum-submit-btn"); const btnHtml=btn.innerHTML; btn.disabled=true;
  const errorEl=document.getElementById("forum-media-error");
  const showError=async(res)=>{ const data=await res.json().catch(()=>null); errorEl.textContent=(data&&data.error)||"Κάτι πήγε στραβά."; errorEl.hidden=false; };
  try {
    let uploaded=null;
    if (media) {
      btn.innerHTML=media.type==="video" ? `<i class="ti ti-loader-2 spin"></i> Ανεβαίνει και ετοιμάζεται το βίντεο…` : `<i class="ti ti-loader-2 spin"></i> Ανεβαίνει…`;
      const up=await apiFetch(`${API_BASE}/forum/media`, {method:"POST", headers:{"Content-Type":media.mime||"application/octet-stream","x-file-name":encodeURIComponent(media.file.name)}, body:media.file});
      if(!up.ok){ await showError(up); return; }
      uploaded={ id:(await up.json()).id };
    }
    const res=await apiFetch(`${API_BASE}/forum/posts`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({message,board:state.selectedForumBoard,media:uploaded})}); if(res.status===403){alert("Εδώ γράφουν μόνο εγκεκριμένοι μέντορες.");return;}
    if(!res.ok){ await showError(res); return; }
    document.getElementById("forum-message").value=""; clearForumMedia(); loadForumPosts(); } catch(e) { errorEl.textContent="Δεν ήταν δυνατή η σύνδεση με τον server."; errorEl.hidden=false; }
  finally { btn.disabled=false; btn.innerHTML=btnHtml; }
});

// Ασφαλές και μέσα σε κείμενο και μέσα σε attributes (src="…", data-…="…"): «καθαρίζει» και τα εισαγωγικά.
function escapeHtml(str) { return (str==null?"":String(str)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

renderOnboardingSlide();
// "Δίχτυ ασφαλείας" για το θέμα των μπλε, auto-detected links σε κινητό:
// αν κάποιο mobile browser εισάγει tel:/sms:/mailto: ή Apple Data Detector
// elements μέσα στο κείμενό μας, τα αφαιρούμε ενεργά (αντικαθιστώντας τα με
// απλό κείμενο) αντί να βασιζόμαστε μόνο σε CSS override.
function stripAutoDetectedLinks(root) {
  // Οι σύνδεσμοι που βάζουμε επίτηδες (π.χ. οι γραμμές του «Χρειάζομαι βοήθεια τώρα») έχουν data-keep-link και μένουν.
  const selector = 'a[href^="tel:"]:not([data-keep-link]), a[href^="sms:"]:not([data-keep-link]), a[href^="mailto:"]:not([data-keep-link]), a[x-apple-data-detectors], .x-apple-data-detectors, [x-apple-data-detectors]';
  root.querySelectorAll(selector).forEach((el) => {
    const text = document.createTextNode(el.textContent);
    el.replaceWith(text);
  });
}
stripAutoDetectedLinks(document.body);
new MutationObserver((mutations) => {
  mutations.forEach((m) => {
    m.addedNodes.forEach((node) => {
      if (node.nodeType === 1) stripAutoDetectedLinks(node);
    });
  });
}).observe(document.body, { childList: true, subtree: true });

// Εγκατάσταση στην αρχική οθόνη: το Chrome/Edge/Android δίνουν έτοιμο παράθυρο
// (beforeinstallprompt). Το iPhone δεν το επιτρέπει, οπότε εκεί δείχνουμε οδηγίες.
const INSTALL_DISMISSED_KEY = "monopati_install_dismissed_at";
const INSTALL_ASK_AGAIN_MS = 30 * 24 * 60 * 60 * 1000;
let deferredInstallEvent = null;
function isInstalledApp() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function maybeShowInstallPrompt() {
  if (isInstalledApp() || state.screen !== "home") return;
  if (!deferredInstallEvent && !isIos()) return;
  const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISSED_KEY)) || 0;
  if (Date.now() - dismissedAt < INSTALL_ASK_AGAIN_MS) return;
  document.getElementById("install-prompt").hidden = false;
}
function hideInstallPrompt() { document.getElementById("install-prompt").hidden = true; }
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstallEvent = e; maybeShowInstallPrompt(); });
window.addEventListener("appinstalled", () => { deferredInstallEvent = null; hideInstallPrompt(); });
document.getElementById("install-yes-btn").addEventListener("click", async () => {
  if (deferredInstallEvent) {
    hideInstallPrompt();
    deferredInstallEvent.prompt();
    const { outcome } = await deferredInstallEvent.userChoice;
    deferredInstallEvent = null;
    if (outcome !== "accepted") localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
    return;
  }
  document.getElementById("install-subtitle").innerHTML = 'Πάτα <i class="ti ti-share"></i> Κοινή χρήση κάτω στην οθόνη και μετά «Προσθήκη στην οθόνη Αφετηρίας».';
  document.getElementById("install-actions").hidden = true;
  document.getElementById("install-close-btn").hidden = false;
});
document.getElementById("install-no-btn").addEventListener("click", () => { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())); hideInstallPrompt(); });
document.getElementById("install-close-btn").addEventListener("click", () => { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())); hideInstallPrompt(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ── AI coach ──
// Η συνομιλία κρατιέται μόνο όσο είναι ανοιχτή η εφαρμογή. Ο coach δεν αλλάζει
// τίποτα μόνος του: οι προτάσεις του εφαρμόζονται μόνο με το κουμπί «Εφάρμοσε».
state.coachMessages = [];   // [{role:"user"|"assistant", text, actions?, proposals?}]
state.coachBusy = false;
const COACH_QUICK_REPLIES = ["Καλά", "Κουρασμένος/η", "Πιεσμένος/η", "Έχω κολλήσει σε ένα βήμα"];
const COACH_NUDGE_KEY = "mentor_coach_nudge_dismissed";

function openCoachExercise(exercise) {
  const breathing = { breathing_478: "478", breathing_box: "box", breathing_sigh: "sigh" }[exercise];
  setMode("rest");
  if (breathing) { state.selectedBreathingTechnique = breathing; stopBreathing(); applyBreathingTechnique(); showScreen("breathing"); return; }
  showScreen({ pmr: "pmr", self_massage: "self-massage", music: "music-select" }[exercise] || "dashboard");
}

const AI_BADGE_TOOLTIP = "Αυτή η πρόταση δημιουργήθηκε αυτόματα από τεχνητή νοημοσύνη. Μπορείς να την αλλάξεις ή να την αγνοήσεις. Δεν αντικαθιστά συμβουλή ειδικού.";
function renderCoach() {
  const c = document.getElementById("coach-messages");
  const name = state.currentProfile ? state.currentProfile.username : "";
  let html = `<div class="chat-bubble theirs">Γεια σου${name ? " " + escapeHtml(name) : ""}! Είμαι ο coach σου. Πώς νιώθεις σήμερα;</div>`;
  state.coachMessages.forEach((m, mi) => {
    html += `<div class="chat-bubble ${m.role === "user" ? "mine" : "theirs"}">${escapeHtml(m.text)}</div>`;
    if (m.role === "assistant") html += `<p class="coach-ai-note" title="${AI_BADGE_TOOLTIP}">✦ Πρόταση AI</p>`;
    if (m.actions && m.actions.length) html += `<div class="coach-actions">${m.actions.map((a) => a.themeId
      ? `<button type="button" class="coach-chip" data-coach-theme="${escapeHtml(a.themeId)}"><i class="ti ti-microphone"></i> ${escapeHtml(a.label)}</button>`
      : `<button type="button" class="coach-chip primary" data-coach-exercise="${escapeHtml(a.exercise)}"><i class="ti ti-leaf" aria-hidden="true"></i> ${escapeHtml(a.label)}</button>`).join("")}</div>`;
    (m.proposals || []).forEach((p, pi) => {
      let foot;
      if (p.status === "applied") foot = `<p class="coach-card-done"><i class="ti ti-check"></i> Εφαρμόστηκε στο πλάνο σου.</p>`;
      else if (p.status === "declined") foot = `<p class="coach-card-done">Δεν έγινε καμία αλλαγή.</p>`;
      else foot = `<div class="coach-actions"><button type="button" class="coach-chip primary" data-coach-apply="${mi}:${pi}" ${p.status === "applying" ? "disabled" : ""}><i class="ti ti-check"></i> ${p.status === "applying" ? "Εφαρμόζεται…" : "Εφάρμοσε"}</button><button type="button" class="coach-chip" data-coach-decline="${mi}:${pi}">Όχι</button></div>`
        + (p.error ? `<p class="coach-card-done" style="color:var(--danger);">${escapeHtml(p.error)}</p>` : "");
      html += `<div class="coach-card"><p class="coach-card-label">Πρόταση: το «${escapeHtml(p.subgoalTitle)}» σε μικρότερα βήματα</p><ol>${p.steps.map((s) => `<li>${escapeHtml(s.title)}</li>`).join("")}</ol>${foot}</div>`;
    });
  });
  if (state.coachBusy) html += `<div class="chat-bubble theirs coach-typing">Ο coach σκέφτεται…</div>`;
  c.innerHTML = html;
  c.scrollTop = c.scrollHeight;
  c.querySelectorAll("[data-coach-exercise]").forEach((b) => b.addEventListener("click", () => openCoachExercise(b.dataset.coachExercise)));
  c.querySelectorAll("[data-coach-theme]").forEach((b) => b.addEventListener("click", () => openInterviewTheme(b.dataset.coachTheme)));
  c.querySelectorAll("[data-coach-apply]").forEach((b) => b.addEventListener("click", () => applyCoachProposal(b.dataset.coachApply)));
  c.querySelectorAll("[data-coach-decline]").forEach((b) => b.addEventListener("click", () => {
    const [mi, pi] = b.dataset.coachDecline.split(":").map(Number); state.coachMessages[mi].proposals[pi].status = "declined"; renderCoach();
  }));
  const quick = document.getElementById("coach-quick");
  quick.innerHTML = state.coachMessages.length || state.coachBusy ? "" : COACH_QUICK_REPLIES.map((q) => `<button type="button" class="coach-chip" data-coach-quick="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("");
  quick.querySelectorAll("[data-coach-quick]").forEach((b) => b.addEventListener("click", () => sendCoachMessage(b.dataset.coachQuick)));
}

function openCoach() { renderCoach(); }

async function sendCoachMessage(text) {
  text = (text || "").trim();
  if (!text || state.coachBusy) return;
  state.coachMessages.push({ role: "user", text });
  state.coachBusy = true; renderCoach();
  let reply;
  try {
    // Στέλνουμε μόνο τα κανονικά μηνύματα (όχι τα μηνύματα σφάλματος).
    const history = state.coachMessages.filter((m) => !m.failed).map((m) => ({ role: m.role, text: m.text }));
    const res = await apiFetch(`${API_BASE}/coach`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) reply = { role: "assistant", text: (data && data.error) || "Ο coach δεν απάντησε. Δοκίμασε ξανά.", failed: true };
    else reply = { role: "assistant", text: data.reply, actions: data.actions || [], proposals: data.proposals || [] };
  } catch (e) {
    reply = { role: "assistant", text: "Δεν ήταν δυνατή η σύνδεση με τον server.", failed: true };
  }
  // Αν απέτυχε, βγάζουμε το μήνυμα του χρήστη από το ιστορικό ώστε να μη μείνουν δύο συνεχόμενα μηνύματα χρήστη.
  if (reply.failed) state.coachMessages[state.coachMessages.length - 1].failed = true;
  state.coachMessages.push(reply);
  state.coachBusy = false; renderCoach();
}

async function applyCoachProposal(key) {
  const [mi, pi] = key.split(":").map(Number);
  const p = state.coachMessages[mi].proposals[pi];
  p.status = "applying"; p.error = null; renderCoach();
  try {
    const res = await apiFetch(`${API_BASE}/coach/apply-split`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subgoalId: p.subgoalId, steps: p.steps }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) { p.status = null; p.error = (data && data.error) || "Δεν εφαρμόστηκε. Δοκίμασε ξανά."; }
    else p.status = "applied";
  } catch (e) { p.status = null; p.error = "Δεν ήταν δυνατή η σύνδεση με τον server."; }
  renderCoach();
}

document.getElementById("coach-send-btn").addEventListener("click", () => { const i = document.getElementById("coach-input"); const t = i.value; i.value = ""; sendCoachMessage(t); });
document.getElementById("coach-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { const t = e.target.value; e.target.value = ""; sendCoachMessage(t); } });

// Κάρτα του coach στην αρχική: εμφανίζεται μόνο όταν υπάρχει κάτι να πει, και όχι ξανά την ίδια μέρα αν την κλείσεις.
function coachNudgeDismissedToday(id) {
  try { const d = JSON.parse(localStorage.getItem(COACH_NUDGE_KEY) || "{}"); return d.id === id && d.day === new Date().toDateString(); } catch (e) { return false; }
}
function dismissCoachNudge(id) {
  try { localStorage.setItem(COACH_NUDGE_KEY, JSON.stringify({ id, day: new Date().toDateString() })); } catch (e) {}
  document.getElementById("coach-nudge").hidden = true;
}
// Τα pop-ups του coach στην αρχική είναι απενεργοποιημένα. Για να ξαναμπούν: true.
const COACH_NUDGES_ENABLED = false;
async function loadCoachNudge() {
  const box = document.getElementById("coach-nudge");
  if (!state.currentProfile) { box.hidden = true; return; }
  try {
    const { nudge } = await (await apiFetch(`${API_BASE}/coach/nudge`)).json();
    if (!nudge || coachNudgeDismissedToday(nudge.id) || state.screen !== "home") { box.hidden = true; return; }
    document.getElementById("coach-nudge-text").textContent = nudge.text;
    const yes = document.getElementById("coach-nudge-yes");
    yes.textContent = nudge.action ? nudge.action.label : nudge.actionLabel;
    yes.onclick = () => { dismissCoachNudge(nudge.id); if (nudge.action) openCoachExercise(nudge.action.exercise); else if (nudge.screen) showScreen(nudge.screen); else { showScreen("coach"); sendCoachMessage(nudge.coachPrompt); } };
    document.getElementById("coach-nudge-later").onclick = () => dismissCoachNudge(nudge.id);
    document.getElementById("coach-nudge-close").onclick = () => dismissCoachNudge(nudge.id);
    box.hidden = false;
  } catch (e) { box.hidden = true; }
}

// ── Η εβδομάδα σου ──
// Θεματικές Συνεντεύξεων → οθόνη. Προς το παρόν όλες ανοίγουν την οθόνη Συνεντεύξεις.
function openInterviewTheme(themeId) { state.selectedInterviewTheme = themeId; showScreen("burnout-info"); }

async function loadWeekly() {
  const c = document.getElementById("weekly-content");
  c.innerHTML = `<p class="empty-state">Ο coach ετοιμάζει τη σύνοψη…</p>`;
  try {
    const res = await apiFetch(`${API_BASE}/coach/weekly`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) { c.innerHTML = `<p class="empty-state">${escapeHtml((data && data.error) || "Δεν ήταν δυνατή η σύνοψη. Δοκίμασε ξανά.")}</p>`; return; }
    const s = data.stats;
    const total = s.steps + s.rest;
    const actionPct = total ? Math.round((s.steps / total) * 100) : 50;
    const maxDay = Math.max(1, ...data.days.map((d) => d.steps + d.rest));
    let html = `<div class="weekly-metrics">
      <div class="weekly-metric"><span class="num">${s.steps}</span><span class="label">Βήματα</span></div>
      <div class="weekly-metric"><span class="num">${s.rest}</span><span class="label">Ασκήσεις ανάπαυσης</span></div>
      <div class="weekly-metric"><span class="num">${s.activeDays}/7</span><span class="label">Μέρες με δράση</span></div>
    </div>
    <div class="weekly-card">
      <p class="weekly-card-label">Ισορροπία Δράσης / Ανάπαυσης</p>
      <div class="weekly-balance">${total ? `<div class="bar-action" style="width:${actionPct}%"></div><div class="bar-rest" style="width:${100 - actionPct}%"></div>` : `<div class="bar-empty"></div>`}</div>
      <div class="weekly-legend"><span><i class="dot dot-action"></i>Δράση</span><span><i class="dot dot-rest"></i>Ανάπαυση</span>${s.lateNight ? `<span class="weekly-late"><i class="ti ti-moon"></i> ${s.lateNight} ${s.lateNight === 1 ? "φορά" : "φορές"} μετά τις 23:00</span>` : ""}</div>
      <div class="weekly-days">${data.days.map((d) => `<div class="weekly-day"><div class="weekly-day-bars">${d.rest ? `<div class="bar-rest" style="height:${Math.round((d.rest / maxDay) * 100)}%"></div>` : ""}${d.steps ? `<div class="bar-action" style="height:${Math.round((d.steps / maxDay) * 100)}%"></div>` : ""}</div><span>${escapeHtml(d.label)}</span></div>`).join("")}</div>
    </div>`;
    if (data.coach) {
      html += `<div class="weekly-card weekly-coach"><p class="weekly-card-label"><i class="ti ti-sparkles"></i> Ο coach σου <span class="ai-tag">AI</span></p><p>${escapeHtml(data.coach.summary)}</p>`;
      if (data.coach.nextWeek.length) html += `<p class="weekly-card-label weekly-next">Για την επόμενη εβδομάδα</p><ul>${data.coach.nextWeek.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
      html += `</div>`;
      if (data.coach.theme) html += `<button type="button" class="weekly-card weekly-theme" data-weekly-theme="${escapeHtml(data.coach.theme.id)}"><i class="ti ti-microphone"></i><span><strong>Προτεινόμενη συνέντευξη: ${escapeHtml(data.coach.theme.title)}</strong>${data.coach.theme.reason ? `<small>${escapeHtml(data.coach.theme.reason)}</small>` : ""}</span><i class="ti ti-chevron-right"></i></button>`;
    } else {
      html += data.aiDisabled
        ? `<p class="empty-state">Οι λειτουργίες AI είναι απενεργοποιημένες, γι’ αυτό βλέπεις μόνο τους αριθμούς. Μπορείς να τις ενεργοποιήσεις από το προφίλ σου, στο «Τα δεδομένα μου».</p>`
        : `<p class="empty-state">Ο coach δεν μπόρεσε να γράψει σχόλιο αυτή τη φορά. Οι αριθμοί σου είναι παραπάνω.</p>`;
    }
    html += `<button type="button" class="coach-chip primary weekly-talk" data-nav-coach><i class="ti ti-sparkles"></i> Μίλα με τον coach</button>`;
    c.innerHTML = html;
    c.querySelectorAll("[data-weekly-theme]").forEach((b) => b.addEventListener("click", () => openInterviewTheme(b.dataset.weeklyTheme)));
    c.querySelectorAll("[data-nav-coach]").forEach((b) => b.addEventListener("click", () => showScreen("coach")));
  } catch (e) { c.innerHTML = `<p class="empty-state">Δεν ήταν δυνατή η σύνδεση με τον server.</p>`; }
}

// ── Συγκαταθέσεις (GDPR), Όροι/Πολιτική, «Τα δεδομένα μου» ──
state.consents = null;
state.pendingProfile = null;
state.legalReturn = "consent";

// Όροι, Πολιτική απορρήτου και Πολιτική cookies: ένα κείμενο για κάθε σελίδα, στα αρχεία
// terms.html, privacy.html και cookies.html (δημόσιες σελίδες /terms, /privacy, /cookies).
// Μέσα στην εφαρμογή εμφανίζεται το ίδιο κείμενο, ώστε να αλλάζει μόνο σε ένα σημείο.
const LEGAL_FILES = { terms: "terms.html", privacy: "privacy.html", cookies: "cookies.html" };
async function openLegal(page) {
  const file = LEGAL_FILES[page]; if (!file) return;
  if (state.screen !== "legal") state.legalReturn = state.screen;
  const title = document.getElementById("legal-title"), body = document.getElementById("legal-body");
  title.textContent = ""; body.innerHTML = `<p class="muted">Φόρτωση…</p>`;
  showScreen("legal");
  try {
    const res = await fetch(file, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const content = doc.getElementById("legal-content"); if (!content) throw new Error("no content");
    const h1 = content.querySelector("h1");
    title.textContent = h1 ? h1.textContent : "";
    if (h1) h1.remove();
    // Οι σύνδεσμοι προς τις άλλες νομικές σελίδες ανοίγουν μέσα στην εφαρμογή.
    content.querySelectorAll("a[href]").forEach((a) => { const key = a.getAttribute("href").replace(/\.html$/, ""); if (LEGAL_FILES[key]) { a.setAttribute("href", "#"); a.dataset.legal = key; } });
    body.innerHTML = content.innerHTML;
  } catch (e) { body.innerHTML = `<p class="error-text">Δεν ήταν δυνατή η φόρτωση του κειμένου. Δοκίμασε ξανά.</p>`; }
}
document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-legal]"); if (!link) return;
  e.preventDefault(); e.stopPropagation();
  openLegal(link.dataset.legal);
});
document.getElementById("legal-back").addEventListener("click", () => showScreen(state.legalReturn || "consent"));

function openConsent() {
  ["consent-age", "consent-health"].forEach((id) => { document.getElementById(id).checked = false; });
  document.querySelectorAll('input[name="consent-adult"]').forEach((r) => { r.checked = false; });
  updateConsentSubmit();
  document.getElementById("consent-ai").checked = Boolean(state.consents && state.consents.ai);
  document.getElementById("consent-error").hidden = true;
  showScreen("consent");
}
document.getElementById("consent-signout").addEventListener("click", signOut);
// «Συνέχεια»: ανενεργό μέχρι να τσεκαριστούν τα υποχρεωτικά (και να απαντηθεί η ερώτηση 18+).
function updateConsentSubmit() {
  const ready = document.getElementById("consent-age").checked && document.getElementById("consent-health").checked && Boolean(document.querySelector('input[name="consent-adult"]:checked'));
  document.getElementById("consent-submit").disabled = !ready;
}
["consent-age", "consent-health"].forEach((id) => document.getElementById(id).addEventListener("change", updateConsentSubmit));
document.querySelectorAll('input[name="consent-adult"]').forEach((r) => r.addEventListener("change", updateConsentSubmit));
document.getElementById("consent-submit").addEventListener("click", async () => {
  const errorEl = document.getElementById("consent-error"); errorEl.hidden = true;
  const body = {
    age16: document.getElementById("consent-age").checked,
    adult: (() => { const r = document.querySelector('input[name="consent-adult"]:checked'); return r ? r.value === "yes" : null; })(),
    termsPrivacy: document.getElementById("consent-age").checked, // ίδιο κουτάκι με το 16+
    healthData: document.getElementById("consent-health").checked,
    ai: document.getElementById("consent-ai").checked,
  };
  if (!body.age16) { errorEl.textContent = "Η εφαρμογή απευθύνεται σε άτομα 16 ετών και άνω."; errorEl.hidden = false; return; }
  if (body.adult === null) { errorEl.textContent = "Πες μας αν είσαι 18 ετών ή μεγαλύτερος/η."; errorEl.hidden = false; return; }
  if (!body.termsPrivacy || !body.healthData) { errorEl.textContent = "Για να συνεχίσεις, τσέκαρε τα υποχρεωτικά σημεία."; errorEl.hidden = false; return; }
  const btn = document.getElementById("consent-submit"); btn.disabled = true;
  try {
    const res = await apiFetch(`${API_BASE}/consents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) { errorEl.textContent = (data && data.error) || "Κάτι πήγε στραβά. Δοκίμασε ξανά."; errorEl.hidden = false; return; }
    state.consents = data.consents;
    continueAfterConsent();
  } catch (e) { errorEl.textContent = "Δεν ήταν δυνατή η σύνδεση με τον server."; errorEl.hidden = false; }
  finally { btn.disabled = false; }
});

function renderDataSection() {
  renderHealthButton();
  const always = embedsAlways(); document.getElementById("profile-embeds-always").checked = Boolean(always.youtube && always.spotify);
  const box = document.getElementById("profile-ai-consent");
  box.checked = Boolean(state.consents && state.consents.ai);
  document.getElementById("profile-ai-status").hidden = true;
  document.getElementById("profile-export-error").hidden = true;
}
document.getElementById("profile-ai-consent").addEventListener("change", async (e) => {
  const box = e.target, granted = box.checked, status = document.getElementById("profile-ai-status");
  box.disabled = true;
  try {
    const res = await apiFetch(`${API_BASE}/consents/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ granted }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || "error");
    state.consents = data.consents; pfToast("Αποθηκεύτηκε");
    status.textContent = granted ? "Οι λειτουργίες AI ενεργοποιήθηκαν." : "Οι λειτουργίες AI απενεργοποιήθηκαν. Δεν στέλνεται πια τίποτα στην Anthropic.";
  } catch (err) {
    box.checked = !granted;
    status.textContent = "Δεν αποθηκεύτηκε η αλλαγή. Δοκίμασε ξανά.";
  } finally { box.disabled = false; status.hidden = false; }
});
document.getElementById("profile-embeds-always").addEventListener("change", (e) => {
  const on = e.target.checked;
  ["youtube", "spotify"].forEach((p) => { setEmbedAlways(p, on); state.embedsAllowed[p] = on; });
  pfToast("Αποθηκεύτηκε");
});
document.getElementById("profile-export-btn").addEventListener("click", async () => {
  const btn = document.getElementById("profile-export-btn"), errorEl = document.getElementById("profile-export-error");
  errorEl.hidden = true; btn.disabled = true;
  try { await downloadMyData(); } catch (e) { errorEl.textContent = "Δεν ήταν δυνατή η λήψη. Δοκίμασε ξανά."; errorEl.hidden = false; }
  finally { btn.disabled = false; }
});

// ── Ειδοποιήσεις push (όπως στο Instagram, όχι email) ──
// Ο χρήστης τις ανοίγει από το προφίλ του, ανά συσκευή. Το κείμενο στην οθόνη είναι πάντα
// ουδέτερο. Οι ρυθμίσεις (τι θέλει να του έρχεται, ώρες ησυχίας) ισχύουν για όλο τον λογαριασμό.
state.notif = null;        // { available, publicKey, settings }
state.pendingOpen = null;  // οθόνη που ζήτησε μια ειδοποίηση, πριν ολοκληρωθεί η σύνδεση
const PUSH_SUPPORTED = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_STANDALONE = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
function sameKey(sub, publicKey) {
  const k = sub && sub.options && sub.options.applicationServerKey; if (!k || !publicKey) return true;
  const a = new Uint8Array(k), b = urlBase64ToUint8Array(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
async function loadNotifSettings() {
  const res = await apiFetch(`${API_BASE}/notifications/settings`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  state.notif = await res.json();
  return state.notif;
}
async function getPushSubscription() {
  if (!PUSH_SUPPORTED) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function savePushSubscription(sub) {
  const res = await apiFetch(`${API_BASE}/push/subscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
async function enablePushOnThisDevice() {
  if (!state.notif || !state.notif.publicKey) throw Object.assign(new Error("unavailable"), { code: "unavailable" });
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, state.notif.publicKey)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.notif.publicKey) });
  await savePushSubscription(sub);
}
async function disablePushOnThisDevice() {
  try {
    const sub = await getPushSubscription(); if (!sub) return;
    await apiFetch(`${API_BASE}/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch (e) {}
}
// Σε κάθε σύνδεση: αν η συσκευή έχει ήδη ειδοποιήσεις, το backend μαθαίνει ποιος λογαριασμός
// είναι συνδεδεμένος και ότι η συσκευή χρησιμοποιείται ακόμα.
async function refreshPushSubscription() {
  try {
    if (!PUSH_SUPPORTED || Notification.permission !== "granted") return;
    const sub = await getPushSubscription(); if (!sub) return;
    const notif = await loadNotifSettings(); if (!notif.available) return;
    if (!sameKey(sub, notif.publicKey)) { await sub.unsubscribe().catch(() => {}); await enablePushOnThisDevice(); return; }
    await savePushSubscription(sub);
  } catch (e) {}
}

function notifStatus(text) { const el = document.getElementById("notif-status"); el.textContent = text || ""; el.hidden = !text; }
function notifHint(text) { const el = document.getElementById("notif-hint"); el.textContent = text || ""; el.hidden = !text; }
function fillNotifOptions() {
  const s = (state.notif && state.notif.settings) || {};
  document.getElementById("notif-messages").checked = s.messages !== false;
  document.getElementById("notif-replies").checked = s.forumReplies !== false;
  document.getElementById("notif-quiet").checked = s.quietHours !== false;
  document.getElementById("notif-quiet-start").value = String(s.quietStart ?? 22);
  document.getElementById("notif-quiet-end").value = String(s.quietEnd ?? 8);
  document.getElementById("notif-quiet-hours").classList.toggle("disabled", s.quietHours === false);
}
(function fillQuietHourSelects() {
  const opts = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`).join("");
  document.getElementById("notif-quiet-start").innerHTML = opts;
  document.getElementById("notif-quiet-end").innerHTML = opts;
})();
async function renderNotifSection() {
  const device = document.getElementById("notif-device"), options = document.getElementById("notif-options");
  device.checked = false; device.disabled = true; options.hidden = true; notifHint(""); notifStatus(""); pfNotifSummary();
  if (!PUSH_SUPPORTED) {
    notifHint(IS_IOS && !IS_STANDALONE
      ? "Στο iPhone οι ειδοποιήσεις λειτουργούν όταν η εφαρμογή είναι στην οθόνη Αφετηρίας: πάτα Κοινή χρήση και μετά «Προσθήκη στην οθόνη Αφετηρίας», και άνοιξέ την από εκεί."
      : "Αυτός ο browser δεν υποστηρίζει ειδοποιήσεις.");
    return;
  }
  try { await loadNotifSettings(); } catch (e) { notifHint("Δεν ήταν δυνατή η φόρτωση των ρυθμίσεων. Δοκίμασε ξανά σε λίγο."); return; }
  if (!state.notif.available) { notifHint("Οι ειδοποιήσεις δεν είναι ακόμα διαθέσιμες."); return; }
  fillNotifOptions();
  if (Notification.permission === "denied") { notifHint("Έχεις μπλοκάρει τις ειδοποιήσεις για την εφαρμογή. Μπορείς να τις επιτρέψεις από τις ρυθμίσεις του browser ή του κινητού σου."); return; }
  const sub = await getPushSubscription().catch(() => null);
  device.checked = Boolean(sub && Notification.permission === "granted");
  device.disabled = false; options.hidden = !device.checked; pfNotifSummary();
}
function pfNotifSummary() {
  const el = document.getElementById("pf-notif-summary"); if (!el) return;
  el.textContent = document.getElementById("notif-device").checked ? "Ενεργές σε αυτή τη συσκευή" : "Ανενεργές σε αυτή τη συσκευή";
}
document.getElementById("notif-device").addEventListener("change", async (e) => {
  const box = e.target, on = box.checked; box.disabled = true; notifStatus(""); notifHint("");
  try {
    if (on) { await enablePushOnThisDevice(); notifStatus("Οι ειδοποιήσεις ενεργοποιήθηκαν σε αυτή τη συσκευή."); }
    else { await disablePushOnThisDevice(); notifStatus("Οι ειδοποιήσεις απενεργοποιήθηκαν σε αυτή τη συσκευή."); }
  } catch (err) {
    box.checked = !on;
    if (err.code === "denied") notifHint("Για να έρχονται ειδοποιήσεις, πάτα «Επιτρέπεται» όταν σε ρωτήσει ο browser. Αν τις έχεις μπλοκάρει, άνοιξέ τες από τις ρυθμίσεις του browser ή του κινητού σου.");
    else notifStatus("Δεν ήταν δυνατή η αλλαγή. Δοκίμασε ξανά.");
  } finally { box.disabled = false; document.getElementById("notif-options").hidden = !box.checked; pfNotifSummary(); }
});
async function saveNotifSettings() {
  const body = {
    messages: document.getElementById("notif-messages").checked,
    forumReplies: document.getElementById("notif-replies").checked,
    quietHours: document.getElementById("notif-quiet").checked,
    quietStart: Number(document.getElementById("notif-quiet-start").value),
    quietEnd: Number(document.getElementById("notif-quiet-end").value),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Athens",
  };
  document.getElementById("notif-quiet-hours").classList.toggle("disabled", !body.quietHours);
  try {
    const res = await apiFetch(`${API_BASE}/notifications/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || "error");
    if (state.notif) state.notif.settings = data.settings;
    notifStatus(""); pfToast("Αποθηκεύτηκε");
  } catch (err) { fillNotifOptions(); notifStatus("Δεν αποθηκεύτηκε η αλλαγή. Δοκίμασε ξανά."); }
}
["notif-messages", "notif-replies", "notif-quiet", "notif-quiet-start", "notif-quiet-end"].forEach((id) => document.getElementById(id).addEventListener("change", saveNotifSettings));
document.getElementById("notif-test-btn").addEventListener("click", async () => {
  const btn = document.getElementById("notif-test-btn"); btn.disabled = true; notifStatus("");
  try {
    const res = await apiFetch(`${API_BASE}/push/test`, { method: "POST" });
    const data = await res.json().catch(() => null);
    notifStatus(res.ok ? "Στάλθηκε. Θα εμφανιστεί σε λίγα δευτερόλεπτα." : (data && data.error) || "Δεν στάλθηκε. Δοκίμασε ξανά.");
  } catch (e) { notifStatus("Δεν ήταν δυνατή η σύνδεση με τον server."); }
  finally { btn.disabled = false; }
});

// Πάτημα σε ειδοποίηση → η αντίστοιχη οθόνη (μηνύματα ή φόρουμ).
function openFromNotification(target) {
  if (!target || !target.open) return;
  if (state.guest || !state.currentProfile) { state.pendingOpen = target; return; }
  if (target.open === "messages") showScreen("messages");
  else if (target.open === "forum") {
    const card = document.querySelector(`#screen-forum-select .technique-card[data-forum-board="${target.board === "b" ? "b" : "a"}"]`);
    if (card) card.click(); else showScreen("forum-select");
  } else showScreen("home");
}
if (PUSH_SUPPORTED) navigator.serviceWorker.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "open") openFromNotification(d);
  // Ήρθε κάτι ενώ η εφαρμογή είναι ανοιχτή: ανανεώνουμε τη λίστα, αν τη βλέπει.
  if (d.type === "push" && d.open === "messages" && state.screen === "messages") loadConversations();
  if (d.type === "push" && d.open === "forum" && state.screen === "forum") loadForumPosts();
});
(function readOpenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const open = params.get("open"); if (!open) return;
  state.pendingOpen = { open, board: params.get("board") };
  params.delete("open"); params.delete("board");
  const rest = params.toString();
  history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
})();

// ── Κουμπί κρίσης «Χρειάζομαι βοήθεια τώρα» ──
function openHelpNow() { document.getElementById("help-now-overlay").hidden = false; document.getElementById("help-now-close").focus(); }
function closeHelpNow() { document.getElementById("help-now-overlay").hidden = true; }
document.getElementById("help-now-btn").addEventListener("click", openHelpNow);
document.getElementById("help-now-close").addEventListener("click", closeHelpNow);
document.getElementById("help-now-overlay").addEventListener("click", (e) => { if (e.target.id === "help-now-overlay") closeHelpNow(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.getElementById("help-now-overlay").hidden) closeHelpNow(); });

(async function initApp() {
  // Μετά την επιστροφή από τη Google, το Supabase διαβάζει τη σύνδεση από το URL.
  const { data } = await supabaseClient.auth.getSession();
  if (window.location.hash.includes("access_token") || window.location.search.includes("code=")) history.replaceState(null, "", window.location.pathname);
  try { localStorage.removeItem("monopati_profile_id"); } catch (e) {} // παλιό, από την εποχή χωρίς σύνδεση
  if (data.session) {
    // Συνδεδεμένος χρήστης: κατευθείαν στην αρχική (ή στην οθόνη όπου ήταν πριν τη σύνδεση).
    markOnboardingSeen();
    await loadMyProfileAndContinue();
  } else if (!lsGet(ONBOARDING_SEEN_KEY)) {
    // Πρώτη φορά σε αυτή τη συσκευή: οι τρεις κάρτες καθοδήγησης, μετά εκεί που θα διαλέξει.
    state.guest = true; renderGuestChip(); state.onboardingSlide = 0; renderOnboardingSlide(); showScreen("onboarding");
  } else enterGuest("home");
})();
