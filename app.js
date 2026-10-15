import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, driveApiKey } from "./firebase-config.js";
import { initFx, enterView, reveal, constellation } from "./fx.js";
import { CATEGORIES, AWARD_GROUPS, GENERAL, SUBJECTS, ABSENCE_KINDS, POSITIONS, OFFICES } from "./data.js";

// ---------- Helpers ----------
const $ = (s) => document.querySelector(s);
const main = $("#main");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https:\/\/\S+$/i.test(u || "") ? u : "");
// A real Google Drive / Docs link with a file or folder ID, e.g.
//   https://drive.google.com/file/d/<id>/view   https://drive.google.com/drive/folders/<id>
//   https://drive.google.com/open?id=<id>       https://docs.google.com/document/d/<id>/edit
const DRIVE_ID = "[A-Za-z0-9_-]{20,}";
const DRIVE_PATTERNS = [
  new RegExp(`^https://drive\\.google\\.com/file/d/${DRIVE_ID}(?:[/?#]\\S*)?$`),
  new RegExp(`^https://drive\\.google\\.com/drive/(?:u/\\d+/)?folders/${DRIVE_ID}(?:[/?#]\\S*)?$`),
  new RegExp(`^https://drive\\.google\\.com/(?:open|uc)\\?(?:\\S*&)?id=${DRIVE_ID}(?:&\\S*)?$`),
  new RegExp(`^https://docs\\.google\\.com/(?:document|spreadsheets|presentation|forms|drawings)/d/(?:e/)?${DRIVE_ID}(?:[/?#]\\S*)?$`)
];
const isDriveUrl = (u) => DRIVE_PATTERNS.some((re) => re.test(String(u || "").trim()));
const hasLink = (it) => !!(it && isDriveUrl(it.link));
const icons = () => window.lucide && window.lucide.createIcons();
const fmtDate = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—");

let toastTimer;
function toast(msg, kind = "ok") {
  const t = $("#toast");
  $("#toast-message").textContent = msg;
  $("#toast-dot").className = "w-2 h-2 rounded-full " + ({ ok: "bg-emerald-400", warn: "bg-amber-400", error: "bg-red-400" }[kind]);
  t.classList.remove("translate-y-20", "opacity-0");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("translate-y-20", "opacity-0"), 3000);
}

function errorText(e) {
  const code = e && e.code ? e.code : "";
  return ({
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "Wrong email or password.",
    "auth/email-already-in-use": "That email already has an account. Sign in instead.",
    "auth/weak-password": "Use at least 6 characters for the password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many tries. Wait a minute, then try again.",
    "auth/network-request-failed": "No internet connection. Check it and try again.",
    "permission-denied": "You don't have permission to do that."
  })[code] || (e && e.message) || "Something went wrong. Try again.";
}

function openModal(html) {
  const m = $("#modal");
  m.innerHTML = `<div class="bg-white rounded-[10px] shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto border border-slate-200">${html}</div>`;
  m.classList.remove("hidden");
  m.classList.add("flex");
  icons();
}
function closeModal() {
  const m = $("#modal");
  m.classList.add("hidden");
  m.classList.remove("flex");
  m.innerHTML = "";
}

// ---------- Award + status data ----------
function awardName(key) {
  const m = CATEGORIES[key].title.match(/^(?:\d+\.\s*)?(.*?)\s*(?:\((.*)\))?$/);
  return { name: m[1], local: m[2] || "" };
}
const groupOf = (key) => AWARD_GROUPS.find((g) => g.keys.includes(key));

function checklist(award) {
  const rows = [];
  for (const cat of [GENERAL, award]) {
    CATEGORIES[cat].items.forEach((text, idx) => rows.push({ key: `${cat}_${idx}`, cat, idx, text }));
  }
  return rows;
}
function progress(app, review) {
  const rows = checklist(app.award);
  const items = app.items || {};
  const ver = (review && review.verified) || {};
  return {
    total: rows.length,
    sub: rows.filter((r) => hasLink(items[r.key])).length,
    ver: rows.filter((r) => ver[r.key]).length
  };
}

const STATUS = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  submitted: { label: "Awaiting review", cls: "bg-blue-50 text-blue-800 border-blue-200" },
  complete: { label: "Complete", cls: "bg-emerald-50 text-emerald-800 border-emerald-300" },
  incomplete: { label: "Incomplete", cls: "bg-amber-50 text-amber-800 border-amber-300" },
  compliance: { label: "For compliance", cls: "bg-sky-50 text-sky-800 border-sky-300" },
  qualified: { label: "Qualified", cls: "bg-emerald-600 text-white border-emerald-700" },
  disqualified: { label: "Disqualified", cls: "bg-red-50 text-red-800 border-red-300" }
};
const DECISIONS = [
  ["complete", "Complete", "All MOVs authenticated", "bg-emerald-500"],
  ["incomplete", "Incomplete", "Key MOVs missing", "bg-amber-500"],
  ["compliance", "For compliance", "Grace period for minor gaps", "bg-sky-500"],
  ["qualified", "Qualified", "Endorsed for deliberation", "bg-emerald-700"],
  ["disqualified", "Disqualified", "Fails eligibility or integrity", "bg-red-500"]
];
const LOCKED = ["complete", "qualified", "disqualified"];
const statusOf = (app, review) => (review && review.status) || (app && app.submittedAt ? "submitted" : "draft");
const pill = (s) => `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${STATUS[s].cls}">${STATUS[s].label}</span>`;

function bar(label, n, total, color) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<div>
    <div class="flex justify-between text-xs mb-1"><span class="font-semibold text-slate-600">${label}</span><span class="tabular font-bold ${color.text}">${n}/${total}</span></div>
    <div class="h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full ${color.bar}" style="width:${pct}%"></div></div>
  </div>`;
}
// Stat cards (after CKSS): label, then a big number in the tone taken from cls.
const TILE_NUM = { emerald: "text-[#006300]", green: "text-[#006300]", red: "text-[#b42323]", rose: "text-[#b42323]", amber: "text-amber-700", yellow: "text-amber-700", orange: "text-orange-700", blue: "text-depedGold-500", sky: "text-depedGold-500", indigo: "text-indigo-700", violet: "text-violet-700", purple: "text-purple-700", slate: "text-brand-950", brand: "text-depedGold-500" };
const statTile = (label, n, cls = "") => {
  const tone = (cls.match(/(?:bg|text|border)-([a-z]+)-\d/) || [])[1];
  return `<div class="bg-brand-50 rounded-[10px] border border-black/10 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_16px_rgba(0,0,0,0.04)] px-5 py-4">
    <div class="text-sm text-brand-600">${label}</div>
    <div class="tabular mt-1 text-[1.9rem] font-bold leading-tight ${TILE_NUM[tone] || "text-depedGold-500"}">${n}</div></div>`;
};
const BLUE = { text: "text-blue-700", bar: "bg-blue-600" };
const GREEN = { text: "text-emerald-700", bar: "bg-emerald-500" };

// ---------- State ----------
const state = {
  user: null, role: null, profile: null,
  app: null, review: null, loaded: false, myApps: {}, myReviews: {}, cur: null,
  apps: {}, reviews: {}, selected: null, drafts: {},
  filter: { q: "", award: "", status: "" },
  tab: "main", authMode: "login", unsubs: [],
  linkDrafts: {}, folderDraft: null, folderCheck: null, checking: false,
  // Monitoring (see the Monitoring section below)
  perms: null, mon: null, rep: null, request: null, me: null, meLoaded: false,
  personnel: {}, attendance: {}, aor: {}, dll: {}, monitors: {}, requests: {}, dllDrafts: {}, watches: {}
};
let auth, db;

// ---------- Boot ----------
initFx();
const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
if (!configured) {
  renderSetup();
} else {
  const fb = initializeApp(firebaseConfig);
  auth = getAuth(fb);
  db = getFirestore(fb);
  onAuthStateChanged(auth, onUser);
}

async function onUser(u) {
  state.unsubs.forEach((f) => f());
  Object.values(state.watches).forEach((f) => f());
  Object.assign(state, {
    user: u, role: null, profile: null, app: null, review: null, loaded: false, myApps: {}, myReviews: {}, cur: null,
    apps: {}, reviews: {}, selected: null, drafts: {}, tab: "main", unsubs: [], linkDrafts: {}, folderDraft: null, folderCheck: null, checking: false,
    perms: null, mon: freshMon(), rep: freshRep(), request: null, me: null, meLoaded: false,
    personnel: {}, attendance: {}, aor: {}, dll: {}, monitors: {}, requests: {}, dllDrafts: {}, watches: {}
  });
  if (!u) { state.authMode = "login"; return render(); }
  if (!u.emailVerified) return render();

  let isAdmin = false;
  try { isAdmin = (await getDoc(doc(db, "admins", u.email))).exists(); } catch (e) { isAdmin = false; }
  const perms = isAdmin ? { admin: true, hr: true, clinic: true, dll: true, subjects: SUBJECTS.slice() } : await loadPerms(u.email);
  if (state.user !== u) return; // signed out meanwhile
  state.role = isAdmin ? "admin" : "awardee";
  state.perms = perms;
  // HR, Clinic and Head / Master Teachers land on Monitoring.
  state.tab = isAdmin ? "main" : perms ? "monitor" : "home";
  startMonitoring();
  if (!isAdmin) {
    // Live: access granted or removed by an admin applies without signing in again.
    state.unsubs.push(onSnapshot(doc(db, "monitors", u.email), (d) => {
      const p = permsFrom(d);
      if (JSON.stringify(p) === JSON.stringify(state.perms)) return;
      if (p && !state.perms) toast("Monitoring access granted. See the Monitoring tab.");
      state.perms = p;
      if (!p && (state.tab === "monitor" || state.tab === "reports")) state.tab = "home";
      restartMonitoring();
      render();
    }, () => {}));
    // Own personnel entry; older accounts are asked once to choose their position.
    state.unsubs.push(onSnapshot(doc(db, "personnel", u.uid), (d) => {
      const first = !state.meLoaded;
      state.me = d.exists() ? d.data() : null;
      state.meLoaded = true;
      if (first && !state.me) openProfile(true);
      render();
    }, () => { state.meLoaded = true; }));
    state.unsubs.push(onSnapshot(doc(db, "accessRequests", u.email), (d) => {
      state.request = d.exists() ? d.data() : null;
      render();
    }, () => {}));
  }

  if (isAdmin) {
    const demoQ = (col) => (isDemoEmail(u.email) ? query(collection(db, col), where("demo", "==", true)) : collection(db, col));
    state.unsubs.push(onSnapshot(demoQ("applications"), (snap) => {
      state.apps = {};
      snap.forEach((d) => { state.apps[d.id] = { ...d.data(), uid: d.data().uid || d.id, id: d.id }; });
      state.loaded = true;
      render();
    }, (e) => toast(errorText(e), "error")));
    state.unsubs.push(onSnapshot(demoQ("reviews"), (snap) => {
      state.reviews = {};
      snap.forEach((d) => { state.reviews[d.id] = d.data(); });
      render();
    }, (e) => toast(errorText(e), "error")));
  } else {
    try {
      const p = await getDoc(doc(db, "users", u.uid));
      state.profile = p.exists() ? p.data() : null;
    } catch (e) { state.profile = null; }
    // A person can apply for several awards: one application per award (ID uid_award; older ones use the uid).
    const reviewSubs = {};
    state.unsubs.push(onSnapshot(query(collection(db, "applications"), where("uid", "==", u.uid)), (snap) => {
      state.myApps = {};
      snap.forEach((d) => { state.myApps[d.id] = { ...d.data(), id: d.id }; });
      for (const id of Object.keys(state.myApps)) {
        if (reviewSubs[id]) continue;
        reviewSubs[id] = onSnapshot(doc(db, "reviews", id), (r) => {
          if (r.exists()) state.myReviews[id] = r.data(); else delete state.myReviews[id];
          render();
        }, () => {});
        state.unsubs.push(reviewSubs[id]);
      }
      state.loaded = true;
      render();
    }, (e) => toast(errorText(e), "error")));
  }
  render();
}

// The application shown on "My Awards": the one picked, else the first one.
const myAppList = () => Object.values(state.myApps).sort((a, b) => ((a.createdAt && a.createdAt.seconds) || 0) - ((b.createdAt && b.createdAt.seconds) || 0) || a.award.localeCompare(b.award));
function syncCurrent() {
  if (state.role === "admin") return;
  const list = myAppList();
  if (!state.myApps[state.cur]) state.cur = list.length ? list[0].id : null;
  state.app = state.cur ? state.myApps[state.cur] : null;
  state.review = state.cur ? state.myReviews[state.cur] || null : null;
}
const appIdFor = (key) => `${state.user.uid}_${key}`;
const myAppFor = (key) => myAppList().find((a) => a.award === key);

const isDemoEmail = (e) => /@svnhs-demo\.ph$/i.test(e || "");

const myName = () => (state.profile && state.profile.name) || (state.user && state.user.displayName) || (state.user && state.user.email) || "";

// ---------- Rendering ----------
function render() {
  // Keep focus and caret on re-render (live updates can arrive while typing).
  const ae = document.activeElement;
  const keep = ae && ae.id && "value" in ae ? { id: ae.id, s: ae.selectionStart } : null;

  syncCurrent();
  renderHeader();
  if (!state.user) renderAuth();
  else if (!state.user.emailVerified) renderVerify();
  else if (!state.role || !state.loaded) main.innerHTML = `<div class="py-24 text-center text-slate-400 text-sm">Loading your account…</div>`;
  else if (state.tab === "guide") renderGuide();
  else if (state.tab === "monitor" && state.perms) renderMonitor();
  else if (state.tab === "reports" && state.perms) renderReports();
  else if (state.role === "admin") (state.selected ? renderReview() : renderAdmin());
  else (state.tab === "home" || !state.app ? renderPicker() : renderAwardee());
  icons();
  enterView(main, [state.user ? state.user.uid : "", state.user && state.user.emailVerified, state.role, state.loaded, state.tab, state.selected,
    state.mon && state.mon.view, state.mon && state.mon.attMode].join("|"));
  reveal(main);
  const sky = document.getElementById("ld-canvas");
  if (sky && !sky.dataset.on) { sky.dataset.on = "1"; constellation(sky); }

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) { /* not a text input */ } }
  }
}

// Shell (after the CKSS Client Portal): dark sidebar with grouped links, white top bar with who is signed in.
let navShown = "";
function renderHeader() {
  const side = $("#sidebar");
  const box = $("#userbox");
  document.body.classList.toggle("signed-out", !state.user);
  if (!state.user) { side.innerHTML = ""; box.innerHTML = ""; navShown = ""; return; }

  const roleName = state.role === "admin" ? "Admin" : state.perms ? PERM_LABELS.filter(([k]) => state.perms[k]).map(([, t]) => t).join(" · ") || "Awardee" : "Awardee";
  const dept = (state.me && state.me.position) || (state.profile && state.profile.position) || "";
  box.innerHTML = `<button data-act="profile" title="My profile" class="text-right leading-tight hover:opacity-80 max-w-[60vw] sm:max-w-xs">
      <div class="font-semibold text-sm truncate">${esc(myName())}</div>
      <div class="text-xs text-brand-500 truncate">${esc(roleName)}${dept ? " · " + esc(dept) : ""} · San Vicente NHS</div></button>
    ${state.role === "admin" ? `<span class="hidden sm:inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-depedGold-500 border border-blue-200">PRAISE Committee</span>` : ""}
    <button data-act="tab" data-tab="guide" class="${btnLight} hidden sm:inline-flex">Guidelines</button>
    <button data-act="signout" class="${btnLight}">Sign out</button>`;

  const groups = [];
  if (state.role) {
    groups.push(["", state.role === "admin"
      ? [["main", "Applicants", "users"]]
      : [["home", "Choose awards", "layout-list"], ["main", `My Awards${myAppList().length ? ` (${myAppList().length})` : ""}`, "award"]]]);
    if (state.perms) groups.push(["Monitoring", [["monitor", "Monitoring", "clipboard-check"], ["reports", "Reports", "printer"]]]);
    groups.push(["Help", [["guide", "Guidelines", "book-open"]]]);
  }
  let i = 0;
  side.innerHTML = `<a href="./" data-act="home" title="Go to home page" class="flex items-center gap-2.5 lg:px-1.5 mr-auto lg:mr-0 min-w-0">
      <img src="logo.png" alt="BLESS seal" class="w-9 h-9 rounded-full bg-white p-0.5 flex-shrink-0">
      <span class="min-w-0 leading-tight"><span class="block text-white font-semibold text-[0.95rem] truncate">San Vicente NHS</span>
        <span class="ld-kicker !text-[0.66rem] text-[#7d8590]">BLESS PRAISE Portal</span></span></a>
    <nav class="flex flex-wrap lg:flex-col gap-0.5 w-full lg:w-auto">${groups.map(([label, items]) => `
      ${label ? `<div class="hidden lg:block ld-kicker text-[#7d8590] px-2.5 pt-3 pb-1">${label}</div>` : ""}
      ${items.map(([id, text, icon]) => `<button data-act="tab" data-tab="${id}" style="--i:${i++}" class="nav-btn ${state.tab === id || (id === "main" && state.role === "admin" && state.tab === "home") ? "active" : ""} flex items-center gap-2.5 px-2.5 py-2 rounded-[7px] text-[0.92rem] text-left transition-colors">
        <i data-lucide="${icon}" class="w-[17px] h-[17px] opacity-85 flex-shrink-0"></i>${text}</button>`).join("")}`).join("")}
    </nav>`;
  // Nav slides in once per sign-in.
  const key = state.user.uid + "|" + state.role;
  if (state.role && key !== navShown) {
    navShown = key;
    side.classList.remove("nav-enter"); void side.offsetWidth; side.classList.add("nav-enter");
  }
}

function renderSetup() {
  main.innerHTML = `<div class="max-w-xl mx-auto bg-white rounded-[10px] border border-amber-300 shadow-sm p-6">
    <div class="text-xs font-bold uppercase tracking-wider text-amber-700">Setup needed</div>
    <h2 class="text-xl font-bold text-slate-900 mt-1">Connect Firebase</h2>
    <p class="text-sm text-slate-600 mt-2">Paste your Firebase config into <code class="px-1.5 py-0.5 rounded bg-slate-100 text-brand-900 font-semibold">firebase-config.js</code>.
    Steps are in <code class="px-1.5 py-0.5 rounded bg-slate-100 text-brand-900 font-semibold">README.md</code>.</p>
  </div>`;
}

// ----- Sign in / Create account -----
function field(id, label, type = "text", extra = "") {
  return `<div><label for="${id}" class="block text-xs font-semibold text-slate-700 mb-1">${label}</label>
    <input id="${id}" name="${id}" type="${type}" ${extra} class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"></div>`;
}

// Public demo logins shown on the sign-in page. Demo accounts only see and change demo records (firestore.rules).
const DEMO_LOGINS = [
  { role: "Admin", text: "PRAISE Committee: applicants and reviews, staff access, and reports from all monitoring (attendance, AOR, ILAW)", email: "demo.admin@svnhs-demo.ph", password: "Demo-Admin-2026" },
  { role: "Head / Master Teacher", text: "Rose Aquino: weekly ILAW lesson plan check per subject area and teacher, and the ILAW report", email: "demo.headteacher@svnhs-demo.ph", password: "Demo-HeadTeacher-2026" },
  { role: "School Clinic", text: "Carmen Lopez: weekly AOR cleanest classroom ratings and the AOR report", email: "demo.clinic@svnhs-demo.ph", password: "Demo-Clinic-2026" },
  { role: "HR", text: "Maria Santos: attendance sheet, month view, personnel and the monthly attendance report", email: "demo.hr@svnhs-demo.ph", password: "Demo-HR-2026" },
  { role: "Teacher", text: "Jhon Reyes: choose an award, list of MOV file names, Drive folder check", email: "demo.teacher@svnhs-demo.ph", password: "Demo-Teacher-2026" },
  { role: "Non-teaching staff", text: "Ana Lim: a submitted application under committee review", email: "demo.staff@svnhs-demo.ph", password: "Demo-Staff-2026" }
];
async function demoLogin(i) {
  const d = DEMO_LOGINS[Number(i)];
  if (!d) return;
  $("#li-email").value = d.email;
  $("#li-pass").value = d.password;
  $("#auth-form").requestSubmit();
}

let heroPlayed = false;
function renderAuth() {
  const mode = state.authMode;
  const tab = (m, label) => `<button type="button" data-act="auth-mode" data-mode="${m}" class="flex-1 py-1.5 text-sm font-semibold rounded-md transition ${mode === m ? "bg-white/10 text-white" : "text-[#8b94a4] hover:text-white"}">${label}</button>`;
  let body;
  if (mode === "signup") {
    body = `${field("su-name", "Full name", "text", 'required maxlength="120" placeholder="Juan Dela Cruz" autocomplete="name"')}
      ${positionFields("su", "", "")}
      <div>${lbl("su-role", "Sign up as")}${selectBox("su-role", "su-role", SIGNUP_ROLES.map(([k, t]) => [k, t]), "", "w-full")}
        <p id="su-role-note" class="hidden text-[11px] text-slate-500 mt-1">An admin approves this before the Monitoring tab opens. You can still apply for an award.</p></div>
      <div id="su-subjects" class="hidden"><div class="text-xs font-semibold text-slate-700 mb-1.5">Subject areas you monitor</div>
        <div class="grid grid-cols-2 gap-1.5">${subjectChecks("su-subject", [])}</div></div>
      ${field("su-email", "Email", "email", 'required autocomplete="email" placeholder="name@deped.gov.ph"')}
      ${field("su-pass", "Password", "password", 'required minlength="6" autocomplete="new-password"')}
      <button class="w-full py-2.5 mt-1 rounded-lg bg-[#5598e7] hover:brightness-110 text-[#07090d] text-sm font-semibold transition">Create account</button>`;
  } else if (mode === "reset") {
    body = `<p class="text-sm text-slate-600">We'll email you a link to set a new password.</p>
      ${field("rs-email", "Email", "email", 'required autocomplete="email"')}
      <button class="w-full py-2.5 mt-1 rounded-lg bg-[#5598e7] hover:brightness-110 text-[#07090d] text-sm font-semibold transition">Send reset link</button>
      <button type="button" data-act="auth-mode" data-mode="login" class="w-full text-xs font-semibold text-depedGold-500 hover:underline">Back to sign in</button>`;
  } else {
    body = `${field("li-email", "Email", "email", 'required autocomplete="email"')}
      ${field("li-pass", "Password", "password", 'required autocomplete="current-password"')}
      <button class="w-full py-2.5 mt-1 rounded-lg bg-[#5598e7] hover:brightness-110 text-[#07090d] text-sm font-semibold transition">Sign in</button>
      <button type="button" data-act="auth-mode" data-mode="reset" class="w-full text-xs font-semibold text-depedGold-500 hover:underline">Forgot password?</button>`;
  }
  // Sign-in (after the CKSS Client Portal): dark stage with the network animation, headline on the left,
  // a glassy sign-in card on the right. The headline animation plays on the first visit only.
  const played = heroPlayed;
  heroPlayed = true;
  main.innerHTML = `
    <section class="ld-hero ${played ? "ld-played" : ""} relative min-h-screen overflow-hidden text-[#e9eef6]">
      <canvas id="ld-canvas" class="absolute inset-0 w-full h-full" aria-hidden="true"></canvas>
      <div class="relative z-10 min-h-screen max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,420px)] gap-7 lg:gap-24 items-center content-center px-4 sm:px-[6vw] py-14 lg:py-16">
        <div>
          <div class="ld-fade inline-flex items-center gap-3 bg-white rounded-xl px-3 py-2 shadow-lg" style="--d:.05s">
            <img src="logo.png" alt="BLESS seal" class="w-11 h-11 rounded-full">
            <span class="leading-tight text-brand-950"><span class="block font-bold text-[0.95rem]">San Vicente NHS</span><span class="block text-[11px] text-brand-500">DepEd Region XI · SDO Panabo City</span></span>
          </div>
          <div class="ld-fade ld-kicker mt-3 text-[#b3bccb]" style="--d:.15s">BLESS PRAISE Portal</div>
          <h2 class="mt-5 font-bold leading-[1.02] tracking-[-0.035em] text-white text-[clamp(2.6rem,6.4vw,5.6rem)]">
            <span class="ld-word" style="--i:0"><span>Excellence</span></span><br><span class="ld-word" style="--i:1"><span class="ld-grad">isn’t luck.</span></span>
          </h2>
          <p class="ld-fade mt-5 max-w-[30rem] text-[#b3bccb] text-[clamp(0.98rem,1.4vw,1.12rem)] leading-relaxed" style="--d:.8s">Every MOV linked. Every award verified. Attendance, AOR and ILAW lesson plans monitored in one place.</p>
        </div>
        <div class="ld-fade ld-auth lg:justify-self-end w-full max-w-none lg:max-w-[420px]" style="--d:.45s">
          <div class="rounded-[10px] border border-white/10 bg-[rgba(17,21,29,0.78)] backdrop-blur-xl shadow-[0_30px_80px_rgba(0,0,0,0.45)] p-6 sm:p-8 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <h1 class="text-2xl font-bold text-white">${mode === "signup" ? "Create account" : mode === "reset" ? "Reset password" : "Sign in"}</h1>
            <p class="text-sm text-[#b3bccb] mt-1 mb-5">BLESS PRAISE Portal</p>
            ${mode === "reset" ? "" : `<div class="flex p-1 bg-black/30 border border-white/10 rounded-lg mb-5">${tab("login", "Sign in")}${tab("signup", "Create account")}</div>`}
            <form id="auth-form" data-mode="${mode}" class="space-y-3" novalidate>
              <div id="auth-error" class="hidden text-xs font-semibold text-[#ff7b7b] bg-red-500/10 border border-red-400/30 rounded-lg px-3 py-2"></div>
              ${body}
            </form>
            ${mode === "login" ? `<div class="mt-5 pt-4 border-t border-white/10">
              <div class="flex items-baseline gap-2 mb-2"><span class="ld-kicker text-[#e9eef6]">Try a demo account</span><span class="text-xs text-[#8b94a4]">one click signs you in</span></div>
              <div class="space-y-2">${DEMO_LOGINS.map((d, i) => `<button type="button" data-act="demo-login" data-i="${i}" class="w-full text-left rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-white/20 px-3 py-2.5 transition-colors">
                <div class="text-sm"><span class="font-bold text-white">${d.role}</span> <span class="text-[#b3bccb]">${d.text}</span></div>
                <div class="mt-0.5 font-mono text-[11px] text-[#8b94a4]">${d.email} · ${d.password}</div></button>`).join("")}</div>
            </div>` : ""}
          </div>
        </div>
      </div>
    </section>`;
}

async function handleAuthSubmit(form) {
  const err = $("#auth-error");
  const showErr = (m) => { err.textContent = m; err.classList.remove("hidden"); };
  const v = (id) => (form.querySelector("#" + id) ? form.querySelector("#" + id).value.trim() : "");
  const btn = form.querySelector("button:not([type=button])");
  btn.disabled = true;
  try {
    if (form.dataset.mode === "signup") {
      const name = v("su-name");
      if (!name) return showErr("Enter your full name.");
      const position = v("su-position"), dept = v("su-dept");
      const posErr = positionError(position, dept);
      if (posErr) return showErr(posErr);
      const role = v("su-role");
      const subjects = [...form.querySelectorAll("input[name=su-subject]:checked")].map((i) => i.value);
      if (role === "dll" && !subjects.length) return showErr("Pick the subject areas you monitor.");
      const cred = await createUserWithEmailAndPassword(auth, v("su-email"), form.querySelector("#su-pass").value);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name, position, dept, email: cred.user.email, createdAt: serverTimestamp()
      });
      // Every account is on the personnel list (attendance, ILAW).
      await savePersonnelEntry(cred.user, name, position, dept);
      // HR / Clinic / Head-Master Teacher: ask an admin for Monitoring access.
      if (role) await sendAccessRequest(cred.user.email, name, position, { hr: role === "hr", clinic: role === "clinic", dll: role === "dll", subjects: role === "dll" ? subjects : [] });
      await sendEmailVerification(cred.user);
      render();
    } else if (form.dataset.mode === "reset") {
      await sendPasswordResetEmail(auth, v("rs-email"));
      toast("Reset link sent. Check your inbox.");
      state.authMode = "login";
      render();
    } else {
      await signInWithEmailAndPassword(auth, v("li-email"), form.querySelector("#li-pass").value);
    }
  } catch (e) {
    showErr(errorText(e));
  } finally {
    btn.disabled = false;
  }
}

function renderVerify() {
  main.innerHTML = `<div class="max-w-md mx-auto py-4">
    <div class="bg-white rounded-[10px] border border-slate-200 shadow-sm p-6 text-center">
      <div class="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-3"><i data-lucide="mail-check" class="w-6 h-6"></i></div>
      <h2 class="text-lg font-bold text-slate-900">Verify your email</h2>
      <p class="text-sm text-slate-600 mt-1">We sent a link to <strong class="text-brand-900">${esc(state.user.email)}</strong>.<br>Open it, then tap <strong>Continue</strong>.</p>
      <p class="text-xs text-amber-700 mt-2">Not there? Check <strong>Spam</strong>.</p>
      <div class="mt-5 flex flex-col gap-2">
        <button data-act="verify-continue" class="py-3 rounded-lg bg-depedGold-500 hover:bg-depedGold-600 text-white text-sm font-bold shadow-sm transition-colors">Continue</button>
        <button data-act="verify-resend" class="py-2 text-xs font-semibold text-depedGold-500 hover:underline">Resend link</button>
      </div>
    </div>
  </div>`;
}

// ----- Awardee: choose award -----

// Each award has an award-style Material icon (trophy, medal, badge…).
const AWARD_STYLE = {
  "cat-teach-1": { icon: "emoji_events" },
  "cat-teach-2": { icon: "military_tech" },
  "cat-teach-3": { icon: "workspace_premium" },
  "cat-teach-4": { icon: "stars" },
  "cat-teach-5": { icon: "verified" },
  "cat-teach-6": { icon: "star" },
  "cat-teach-7": { icon: "local_police" },
  "cat-nonteach-1": { icon: "auto_awesome" },
  "cat-nonteach-2": { icon: "diamond" },
  "cat-nonteach-3": { icon: "verified_user" },
  "cat-nonteach-4": { icon: "stars" },
  "cat-special-1": { icon: "local_activity" },
  "cat-special-2": { icon: "military_tech" }
};

// Teaching personnel may only pick Teaching awards, non-teaching only Non-Teaching awards;
// Special Recognitions are open to both. The type comes from the position (firestore.rules checks it too).
const awardType = (k) => (k.startsWith("cat-teach-") ? "teaching" : k.startsWith("cat-nonteach-") ? "nonteaching" : "");
const myPType = () => (state.me && state.me.type) || (state.profile && state.profile.position ? positionType(state.profile.position) : "");
const canPick = (k) => !awardType(k) || awardType(k) === myPType();
const PTYPE_NAME = { teaching: "Teaching Personnel", nonteaching: "Non-Teaching Personnel" };

// Awards are a list inside a card per group (after CKSS's action-item lists), not tiles.
function renderPicker() {
  const mine = myPType();
  const position = (state.me && state.me.position) || (state.profile && state.profile.position) || "";
  const apps = myAppList();
  // Groups this person can choose from come first.
  const isClosed = (g) => (canPick(g.keys[0]) ? 0 : 1);
  main.innerHTML = `${profileBar()}${staffBar()}
    <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
      <div class="min-w-0">
        <h2 class="text-[1.6rem] font-bold tracking-tight leading-tight text-brand-950">Choose your awards</h2>
        <p class="mt-1 text-[0.92rem] text-brand-600">Apply for as many awards as you qualify for. Each award is reviewed separately. The ${CATEGORIES[GENERAL].items.length} General MOVs are shared by all your awards.</p>
      </div>
      ${apps.length ? `<button data-act="go-award" class="${btnDark}">My Awards (${apps.length})<i data-lucide="arrow-right" class="w-4 h-4"></i></button>` : ""}
    </div>
    <div class="space-y-4">
      ${[...AWARD_GROUPS].sort((x, y) => isClosed(x) - isClosed(y)).map((g) => {
        const gType = awardType(g.keys[0]);
        const closed = gType && gType !== mine;
        const note = !closed ? "" : mine
          ? `<div class="mx-5 mb-2 flex items-center gap-2 text-sm text-brand-600"><i data-lucide="lock" class="w-4 h-4 flex-shrink-0"></i>Only for ${PTYPE_NAME[gType]}. Your position${position ? ` (${esc(position)})` : ""} is ${PTYPE_NAME[mine]}.</div>`
          : `<div class="mx-5 mb-2 flex items-center gap-2 text-sm text-brand-600"><i data-lucide="lock" class="w-4 h-4 flex-shrink-0"></i>Choose your position in <button data-act="profile" class="text-depedGold-500 hover:underline">My profile</button> first.</div>`;
        return panel(`${panelHead(g.name, `<span class="text-sm text-brand-500">${closed ? "Not available" : `${g.keys.length} awards`}</span>`)}${note}
        <ul class="px-3 pb-2 divide-y divide-black/10 ${closed ? "opacity-50" : ""}">
          ${g.keys.map((k) => {
            const a = awardName(k);
            const applied = myAppFor(k);
            const n = CATEGORIES[k].items.length;
            const tag = applied ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-depedGold-500 border border-blue-200">Applied · ${STATUS[statusOf(applied, state.myReviews[applied.id])].label}</span>` : "";
            return `<li><button data-act="pick" data-key="${k}" title="${closed && !applied ? `Only for ${PTYPE_NAME[gType]}` : `${esc(a.local || a.name)} · ${n} MOVs`}" ${closed && !applied ? 'aria-disabled="true"' : ""}
              class="group w-full flex items-center gap-3.5 px-2 py-3 text-left rounded-lg ${closed && !applied ? "cursor-not-allowed" : "hover:bg-brand-100"} transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-depedGold-500">
              <span class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${applied ? "bg-depedGold-500 text-white" : "bg-blue-50 text-depedGold-500"}"><span class="material-icons !text-[20px]">${AWARD_STYLE[k].icon}</span></span>
              <span class="flex-1 min-w-0">
                <span class="flex flex-wrap items-center gap-2"><span class="font-semibold text-brand-950">${esc(a.name)}</span>${tag}</span>
                ${a.local ? `<span class="block text-sm text-brand-500 truncate">${esc(a.local)}</span>` : ""}
              </span>
              <span class="flex-shrink-0 text-sm text-brand-600 tabular whitespace-nowrap">${applied ? "Open" : `${n} MOVs`}</span>
              <i data-lucide="${closed && !applied ? "lock" : applied ? "arrow-right" : "plus"}" class="w-4 h-4 text-brand-500 flex-shrink-0"></i>
            </button></li>`;
          }).join("")}
        </ul>`);
      }).join("")}
    </div>`;
}

function confirmPick(key) {
  const a = awardName(key);
  const total = CATEGORIES[GENERAL].items.length + CATEGORIES[key].items.length;
  openModal(`<div class="p-6 space-y-3">
    <h3 class="text-lg font-bold text-slate-900">Add this award?</h3>
    <div class="rounded-xl bg-slate-50 border border-slate-200 p-4">
      <div class="font-bold text-brand-900">${esc(a.name)}</div>
      ${a.local ? `<div class="font-serif italic text-sm text-depedGold-600">${esc(a.local)}</div>` : ""}
      <div class="mt-2 text-xs"><span class="font-bold text-blue-700">${total} MOVs</span> to accomplish</div>
    </div>
    <p class="text-xs text-slate-500">Your General MOVs are shared, so only the award's own MOVs are new. You can remove an award <strong class="text-slate-700">until you submit it</strong>.</p>
  </div>
  <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
    <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
    <button data-act="confirm-pick" data-key="${key}" class="px-5 py-2.5 bg-depedGold-500 hover:bg-depedGold-600 text-white rounded-lg text-sm font-semibold transition-colors">Add award</button>
  </div>`);
}

async function savePick(key) {
  const id = appIdFor(key);
  // Start with the General MOVs and folder already found for another award.
  const other = myAppList().find((a) => a.folder) || myAppList()[0];
  const general = {};
  if (other) Object.entries(other.items || {}).forEach(([k, v]) => { if (k.startsWith(GENERAL + "_")) general[k] = v; });
  try {
    await setDoc(doc(db, "applications", id), {
      uid: state.user.uid, name: myName(), dept: (state.profile && state.profile.dept) || "",
      award: key, items: general, ...(other && other.folder ? { folder: other.folder } : {}), ...demoMark(),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    state.cur = id;
    state.tab = "main";
    closeModal();
    toast("Award added. Its MOVs are listed under My Awards.");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function confirmRemoveAward() {
  const app = state.app;
  if (!app || app.submittedAt) return;
  openModal(`<div class="p-6 space-y-3">
    <h3 class="text-lg font-bold text-slate-900">Remove this award?</h3>
    <p class="text-sm text-slate-600"><strong>${esc(awardName(app.award).name)}</strong> will be removed from your awards. The files in your Drive folder stay.</p>
  </div>
  <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
    <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
    <button data-act="remove-award-yes" class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold">Remove award</button>
  </div>`);
}
async function removeAward() {
  const app = state.app;
  if (!app || app.submittedAt) return;
  try {
    await deleteDoc(doc(db, "applications", app.id));
    state.cur = null;
    closeModal();
    toast("Award removed");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Awardee: MOVs checklist -----
// Each teacher keeps every MOV in ONE Google Drive folder, shared "Anyone with the link", with each file
// named to a set format. The portal lists the exact file names, then reads the folder (Drive API) and
// marks each MOV found, wrongly named, or missing.

// File name: <code>_<SURNAME-Initial>_<Short-Title>.<any extension>, e.g. G01_REYES-J_Nomination-Form.pdf
const NAME_PARTICLES = new Set(["de", "del", "dela", "la", "las", "los", "delos", "san", "santa", "sta", "sto", "van", "von", "da", "di", "dos"]);
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
function nameTag(full) {
  const w = String(full || "").replace(/\([^)]*\)/g, " ").replace(/,/g, " ").split(/\s+/).filter((x) => x && !NAME_SUFFIX.test(x));
  if (!w.length) return "NAME";
  let i = w.length - 1;
  while (i > 1 && NAME_PARTICLES.has(w[i - 1].toLowerCase())) i--;
  const clean = (t) => t.normalize("NFD").replace(/[^A-Za-z]/g, "");
  const surname = w.slice(i).map(clean).join("").toUpperCase() || "NAME";
  return w.length > 1 ? `${surname}-${clean(w[0]).charAt(0).toUpperCase()}` : surname;
}
const TITLE_SKIP = new Set(["of", "the", "and", "or", "a", "an", "to", "in", "on", "for", "by", "as", "all", "containing", "submitted", "latest", "updated", "accomplished", "recent", "if", "applicable"]);
function shortTitle(text) {
  const words = String(text).replace(/\([^)]*\)/g, " ").split("/")[0].split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")).filter((w) => w && !TITLE_SKIP.has(w.toLowerCase()));
  return words.slice(0, 3).map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1))).join("-") || "MOV";
}
// Award code: T1–T7 teaching, N1–N4 non-teaching, S1–S2 special. One folder can hold several awards' files.
const awardCode = (key) => { const m = String(key).match(/^cat-(teach|nonteach|special)-(\d+)$/); return m ? { teach: "T", nonteach: "N", special: "S" }[m[1]] + m[2] : "A"; };
const movCode = (cat, i) => (cat === GENERAL ? `G${pad(i + 1)}` : `${awardCode(cat)}-${pad(i + 1)}`);
function movRows(app) {
  const tag = nameTag(app.name);
  return [GENERAL, app.award].flatMap((cat) => CATEGORIES[cat].items.map((text, i) => {
    const code = movCode(cat, i);
    return { key: `${cat}_${i}`, cat, i, text, code, file: `${code}_${tag}_${shortTitle(text)}` };
  }));
}
const baseName = (n) => String(n).replace(/\.[A-Za-z0-9]{1,5}$/, "").trim().toLowerCase();
const folderId = (u) => {
  const m = String(u || "").trim().match(/^https:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?(?:\S*&)?id=)([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : "";
};

const savedItem = (key) => (state.app.items || {})[key] || {};
// Teachers edit freely before submitting; afterwards only when the committee sends it back.
function canEditLinks(app = state.app, review = state.review) {
  if (!app.submittedAt) return true;
  const st = statusOf(app, review);
  return st === "compliance" || st === "incomplete";
}
function linkReadiness() {
  const rows = checklist(state.app.award);
  const ready = rows.filter((r) => hasLink(savedItem(r.key))).length;
  return { total: rows.length, ready, all: ready === rows.length };
}

// Read the folder and match each required file name.
async function checkFolder() {
  if (!canEditLinks()) return toast("Your files are locked while the committee reviews.", "warn");
  const link = (state.folderDraft ?? state.app.folder ?? "").trim();
  const id = folderId(link);
  if (!id) return toast("Paste the link of your Google Drive folder (it has /folders/ in it).", "warn");
  state.checking = true;
  render();
  try {
    const files = [];
    let page = "";
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,webViewLink,size)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${driveApiKey}${page ? `&pageToken=${page}` : ""}`);
      const j = await r.json();
      if (!r.ok) throw Object.assign(new Error("drive"), { status: r.status });
      files.push(...(j.files || []).filter((f) => f.mimeType !== "application/vnd.google-apps.folder"));
      page = j.nextPageToken || "";
    } while (page);
    // One folder for all awards: match the files for every award that can still be edited.
    const editableApps = myAppList().filter((a) => canEditLinks(a, state.myReviews[a.id]));
    const usedAll = new Set(), wrongAll = {};
    let foundCur = 0, totalCur = 0;
    const batch = writeBatch(db);
    for (const app of editableApps) {
    const rows = movRows(app);
    const used = new Set();
    const items = {}, wrong = {};
    for (const r of rows) {
      const hit = files.find((f) => !used.has(f.id) && baseName(f.name) === r.file.toLowerCase());
      if (hit) {
        used.add(hit.id);
        items[r.key] = { submitted: true, link: hit.webViewLink || `https://drive.google.com/file/d/${hit.id}/view`, name: hit.name };
      } else {
        items[r.key] = { submitted: false, link: "" };
        // Same MOV number but a different name (e.g. "G03 scan.pdf"): tell them to rename it.
        const near = files.find((f) => !used.has(f.id) && new RegExp(`^${r.code}(?![0-9])`, "i").test(f.name.trim()));
        if (near) { used.add(near.id); wrong[r.key] = near.name; }
      }
    }
    used.forEach((f) => usedAll.add(f));
    wrongAll[app.id] = wrong;
    batch.update(doc(db, "applications", app.id), { folder: link, items, checkedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    if (app.id === state.app.id) { foundCur = Object.values(items).filter((x) => x.submitted).length; totalCur = rows.length; }
    }
    await batch.commit();
    const extra = files.filter((f) => !usedAll.has(f.id)).map((f) => f.name);
    state.folderDraft = null;
    state.folderCheck = { wrong: wrongAll, extra, count: files.length };
    toast(`Checked${editableApps.length > 1 ? ` ${editableApps.length} awards` : ""}: ${foundCur} of ${totalCur} files found for ${awardName(state.app.award).name}.`, foundCur === totalCur ? "ok" : "warn");
  } catch (e) {
    toast(e.status === 404 || e.status === 403
      ? "Can't open that folder. In Google Drive, click Share → General access → Anyone with the link, then check again."
      : errorText(e), "error");
  } finally {
    state.checking = false;
    render();
  }
}

function renderAwardee() {
  const { app, review } = state;
  const st = statusOf(app, review);
  const p = progress(app, review);
  const editable = canEditLinks();
  const reopened = !!app.submittedAt && editable;
  const a = awardName(app.award);
  const g = groupOf(app.award);
  const ver = (review && review.verified) || {};
  const rd = linkReadiness();
  const rows = movRows(app);
  const chk0 = state.folderCheck || { wrong: {}, extra: [] };
  const chk = { extra: chk0.extra, wrong: chk0.wrong[app.id] || {} };
  const apps = myAppList();
  const switcher = `<div class="flex flex-wrap items-center gap-2 mb-5">
      ${apps.map((x) => {
        const on = x.id === app.id, s = statusOf(x, state.myReviews[x.id]);
        return `<button data-act="cur-app" data-id="${esc(x.id)}" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors ${on ? "bg-brand-50 text-brand-950 border-black/20 shadow-sm" : "text-brand-600 border-transparent hover:bg-brand-100 hover:text-brand-950"}">
          <span class="material-icons !text-[18px] text-depedGold-500">${AWARD_STYLE[x.award].icon}</span>${esc(awardName(x.award).name)}
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${STATUS[s].cls}">${STATUS[s].label}</span></button>`;
      }).join("")}
      <button data-act="change-award" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-depedGold-500 hover:bg-blue-50"><i data-lucide="plus" class="w-4 h-4"></i>Add another award</button>
    </div>`;
  const folder = state.folderDraft ?? app.folder ?? "";
  const copyBtn = (text) => `<button data-act="copy-name" data-text="${esc(text)}" title="Copy file name" class="flex-shrink-0 p-1 rounded text-slate-400 hover:text-depedGold-500 hover:bg-blue-50"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>`;

  const folderBox = `<div class="bg-white rounded-[10px] border border-slate-200 shadow-sm p-5">
      <div class="flex items-center gap-2"><i data-lucide="folder-open" class="w-5 h-5 text-depedGold-500"></i><h3 class="text-base font-bold text-slate-900">Your Google Drive folder</h3></div>
      <ol class="mt-3 space-y-1 text-sm text-slate-600 list-decimal pl-5">
        <li>Make <strong class="text-slate-800">one folder</strong> in Google Drive for the MOVs of <strong class="text-slate-800">all</strong> your awards.</li>
        <li>Put one file per MOV in it, named <strong class="text-slate-800">exactly</strong> as listed below. Any file type is fine (PDF, JPG, Word…).</li>
        <li>Share the folder: <strong class="text-slate-800">General access → Anyone with the link</strong> (Viewer).</li>
        <li>Paste the folder link here and click <strong class="text-slate-800">Check files</strong>. Check again after adding or renaming files.</li>
      </ol>
      <div class="mt-3 flex flex-wrap gap-2">
        <input id="folder-link" data-act="folder" type="url" value="${esc(folder)}" placeholder="https://drive.google.com/drive/folders/…" ${editable ? "" : "disabled"}
          class="flex-1 min-w-[220px] text-sm px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500">
        ${editable ? `<button data-act="check-folder" ${state.checking ? "disabled" : ""} class="${btnDark}"><i data-lucide="${state.checking ? "loader" : "scan-search"}" class="w-4 h-4 ${state.checking ? "animate-spin" : ""}"></i>${state.checking ? "Checking…" : "Check files"}</button>` : ""}
        ${app.folder ? `<a href="${esc(app.folder)}" target="_blank" rel="noopener noreferrer" class="${btnLight}"><i data-lucide="external-link" class="w-4 h-4"></i>Open folder</a>` : ""}
      </div>
      <p class="mt-2 text-xs text-slate-500">${app.checkedAt ? `Last checked ${fmtDate(app.checkedAt)} · <strong class="text-slate-700">${rd.ready} of ${rd.total}</strong> files found.` : "Not checked yet."}</p>
      ${chk.extra.length ? `<div class="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"><strong>Not matched to any MOV:</strong> ${chk.extra.map((n) => `<code class="px-1 rounded bg-white/70">${esc(n)}</code>`).join(", ")}. Rename them using the names below.</div>` : ""}
    </div>`;

  const part = (cat, heading) => {
    const list = rows.filter((r) => r.cat === cat);
    const done = list.filter((r) => hasLink(savedItem(r.key))).length;
    return `<div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
        <h3 class="text-sm font-bold text-slate-800">${heading}</h3>
        <span class="tabular text-[11px] font-bold px-2 py-0.5 rounded-full border ${done === list.length ? "bg-blue-600 text-white border-blue-700" : "bg-blue-50 text-blue-800 border-blue-200"}">${done}/${list.length} found</span>
      </div>
      <div class="divide-y divide-slate-100">
        ${list.map((r) => {
          const it = savedItem(r.key), ok = ver[r.key], found = hasLink(it), bad = chk.wrong[r.key];
          const status = found
            ? `<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline"><i data-lucide="check" class="w-3.5 h-3.5"></i>Found${it.name ? `: ${esc(it.name)}` : ""}</a>`
            : bad ? `<span class="text-red-700 font-semibold">Wrong name: <code class="px-1 rounded bg-red-50">${esc(bad)}</code>. Rename it to the name above.</span>`
            : app.checkedAt ? `<span class="text-amber-700 font-semibold">Missing from your folder</span>` : `<span class="text-slate-400">Not checked yet</span>`;
          return `<div class="p-3 sm:px-4 ${ok ? "bg-emerald-50/60" : ""}">
            <div class="flex items-start justify-between gap-3">
              <div class="text-sm font-medium text-slate-800 min-w-0"><span class="tabular font-mono text-xs text-slate-400 mr-1">${r.code}</span>${esc(r.text)}</div>
              ${ok
                ? `<span class="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white"><i data-lucide="check-check" class="w-3 h-3"></i>Verified</span>`
                : `<span class="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Pending</span>`}
            </div>
            <div class="mt-1.5 flex items-center gap-1.5 min-w-0">
              <i data-lucide="file" class="w-3.5 h-3.5 text-slate-400 flex-shrink-0"></i>
              <code class="min-w-0 truncate text-xs font-semibold text-brand-950 bg-brand-100 rounded px-1.5 py-0.5">${esc(r.file)}<span class="text-slate-400">.pdf</span></code>${copyBtn(r.file)}
            </div>
            <div class="mt-1 text-xs">${status}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  };

  const submitBox = () => {
    if (app.submittedAt && !reopened) {
      return `<div class="text-xs text-slate-500 border-t border-slate-100 pt-3">Submitted <strong class="text-slate-700">${fmtDate(app.submittedAt)}</strong>${app.endorser ? ` · endorsed by <strong class="text-slate-700">${esc(app.endorser)}</strong>` : ""}
        <br><span class="inline-flex items-center gap-1 mt-1 font-semibold text-slate-600"><i data-lucide="lock" class="w-3 h-3"></i>Files are locked while the committee reviews. Don't rename or delete them.</span></div>`;
    }
    return `<div class="flex flex-col gap-2 pt-1">
      ${reopened ? `<div class="text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">The committee reopened your application. Fix the files in your folder, click Check files, then resubmit.</div>` : ""}
      <button data-act="open-submit" ${rd.all ? "" : "disabled"} class="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold shadow transition ${rd.all ? "bg-depedGold-500 hover:bg-depedGold-600 text-white transition-colors" : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"}">
        <i data-lucide="${rd.all ? "send" : "lock"}" class="w-4 h-4"></i>${reopened ? "Resubmit" : "Submit for review"}</button>
      <p class="text-[11px] text-center ${rd.all ? "text-emerald-700 font-semibold" : "text-slate-500"}">${rd.all
        ? `All ${rd.total} files are in your folder.`
        : `All <strong class="text-slate-700">${rd.total} files</strong> must be in your folder to submit. <span class="tabular">${rd.ready}/${rd.total}</span> found.`}</p>
      ${app.submittedAt ? "" : `<button data-act="remove-award" class="text-xs font-semibold text-slate-500 hover:text-red-700">Remove this award</button>`}
    </div>`;
  };

  main.innerHTML = `${switcher}<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <aside class="lg:col-span-4 space-y-4">
      <div class="bg-white rounded-[10px] border border-slate-200 shadow-sm p-5 space-y-4">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-wider text-brand-600">${esc(g.name)}</div>
          <h2 class="text-lg font-bold text-slate-900 leading-snug">${esc(a.name)}</h2>
          ${a.local ? `<div class="font-serif italic text-depedGold-600">${esc(a.local)}</div>` : ""}
          <div class="mt-2">${pill(st)}</div>
        </div>
        ${bar("Files found", p.sub, p.total, BLUE)}
        ${bar("Verified", p.ver, p.total, GREEN)}
        ${submitBox()}
      </div>
      ${review && review.remarks ? `<div class="rounded-[10px] border border-amber-300 bg-amber-50 p-4">
        <div class="text-[11px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5"><i data-lucide="message-square" class="w-3.5 h-3.5"></i>Committee remarks</div>
        <p class="text-sm text-amber-950 mt-1 whitespace-pre-line">${esc(review.remarks)}</p>
      </div>` : ""}
      <div class="rounded-[10px] bg-brand-900 text-[#c9ced6] p-5 text-xs">
        <div class="font-bold text-white">File name format</div>
        <code class="block mt-1.5 text-[11px] text-blue-200">MOVno_SURNAME-Initial_Short-Title</code>
        <div class="mt-1.5 text-slate-300">e.g. <span class="text-white">${esc(rows[0].file)}.pdf</span>. G = General MOV (shared by all your awards); ${awardCode(app.award)} = this award. Capital letters don't matter; any file type is fine.</div>
      </div>
    </aside>
    <section class="lg:col-span-8 space-y-5 min-w-0">
      ${folderBox}
      ${part(GENERAL, "General MOVs")}
      ${part(app.award, esc(a.name) + " MOVs")}
    </section>
  </div>`;
}

function openSubmit() {
  const rd = linkReadiness();
  if (!rd.all) return toast(`All ${rd.total} files must be in your folder first (${rd.ready}/${rd.total} found). Click Check files after adding them.`, "warn");
  const again = !!state.app.submittedAt;
  openModal(`<div class="px-6 pt-5 pb-3 text-brand-950">
      <h3 class="text-base font-bold">${again ? "Resubmit for review" : "Submit for review"}</h3>
      <p class="text-xs text-slate-500">${esc(awardName(state.app.award).name)}</p>
    </div>
    <div class="p-6 space-y-4">
      <div class="text-xs font-bold px-3 py-2 rounded-lg border bg-blue-50 text-blue-800 border-blue-200">All <span class="tabular">${rd.total}</span> files are in your folder.</div>
      ${field("submit-endorser", 'Endorsed by <span class="text-red-500">*</span>', "text", `value="${esc(state.app.endorser || myName())}" maxlength="120"`)}
      <label class="flex items-start gap-3 bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 cursor-pointer">
        <input id="submit-cert" type="checkbox" class="w-4 h-4 mt-0.5 rounded border-slate-300 text-brand-600">
        <span class="text-xs text-amber-950">I certify all MOVs are <strong class="underline decoration-amber-400 decoration-2 underline-offset-2">authentic</strong> and <strong class="underline decoration-amber-400 decoration-2 underline-offset-2">original</strong>, per CSC &amp; DepEd guidelines.</span>
      </label>
      <p class="text-[11px] text-slate-500"><i data-lucide="lock" class="w-3 h-3 inline -mt-0.5"></i> After submitting, keep your folder shared and don't rename or delete the files while the committee reviews them.</p>
    </div>
    <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
      <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
      <button data-act="do-submit" class="px-5 py-2.5 bg-depedGold-500 hover:bg-depedGold-600 text-white rounded-lg text-sm font-semibold transition-colors">Submit</button>
    </div>`);
}

async function doSubmit() {
  const endorser = $("#submit-endorser").value.trim();
  if (!endorser) return toast("Enter who endorses this application.", "warn");
  if (!$("#submit-cert").checked) return toast("Tick the certification box to submit.", "warn");
  const rd = linkReadiness();
  if (!rd.all) return toast(`All ${rd.total} files must be in your folder first.`, "warn");
  try {
    await updateDoc(doc(db, "applications", state.app.id), { submittedAt: serverTimestamp(), endorser, updatedAt: serverTimestamp() });
    closeModal();
    toast("Submitted to the PRAISE Committee.");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Admin: applicants list -----
function renderAdmin() {
  const all = Object.values(state.apps).map((app) => {
    const review = state.reviews[app.id];
    return { app, review, st: statusOf(app, review), p: progress(app, review) };
  });
  const f = state.filter;
  const rows = all
    .filter((r) => !f.award || r.app.award === f.award)
    .filter((r) => !f.status || r.st === f.status)
    .filter((r) => !f.q || (r.app.name + " " + r.app.dept).toLowerCase().includes(f.q.toLowerCase()))
    .sort((x, y) => (x.st === "submitted" ? 0 : 1) - (y.st === "submitted" ? 0 : 1) || String(x.app.name).localeCompare(String(y.app.name)));

  const count = (s) => all.filter((r) => r.st === s).length;

  main.innerHTML = `${pageHead("Applicants", "users", "Every application, its MOV links and the committee’s verification")}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      ${statTile("Applicants", all.length, "bg-brand-900 text-white border-brand-950")}
      ${statTile("Awaiting review", count("submitted"), "bg-blue-50 text-blue-900 border-blue-200")}
      ${statTile("For compliance", count("compliance") + count("incomplete"), "bg-amber-50 text-amber-900 border-amber-300")}
      ${statTile("Qualified", count("qualified"), "bg-emerald-50 text-emerald-900 border-emerald-300")}
    </div>
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="p-3 sm:p-4 border-b border-slate-200 flex flex-wrap gap-2">
        <input id="f-q" data-act="filter" data-f="q" value="${esc(f.q)}" placeholder="Search name or department" class="flex-1 min-w-[180px] text-sm px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500">
        <select id="f-award" data-act="filter" data-f="award" class="w-full sm:w-auto min-w-0 max-w-full text-sm py-2 rounded-lg border-slate-300">
          <option value="">All awards</option>
          ${AWARD_GROUPS.map((g) => `<optgroup label="${g.name}">${g.keys.map((k) => `<option value="${k}" ${f.award === k ? "selected" : ""}>${esc(awardName(k).name)}</option>`).join("")}</optgroup>`).join("")}
        </select>
        <select id="f-status" data-act="filter" data-f="status" class="w-full sm:w-auto min-w-0 max-w-full text-sm py-2 rounded-lg border-slate-300">
          <option value="">All statuses</option>
          ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${s.label}</option>`).join("")}
        </select>
      </div>
      ${rows.length ? `<div class="overflow-x-auto"><table class="w-full text-sm">
        <thead class="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr>
          <th class="text-left font-bold px-4 py-2.5">Applicant</th>
          <th class="text-left font-bold px-4 py-2.5">Award</th>
          <th class="text-left font-bold px-4 py-2.5">Links</th>
          <th class="text-left font-bold px-4 py-2.5">Verified</th>
          <th class="text-left font-bold px-4 py-2.5">Status</th>
          <th class="text-right font-bold px-4 py-2.5">Actions</th>
        </tr></thead>
        <tbody class="divide-y divide-black/10">
          ${rows.map(({ app, st, p }) => `<tr data-act="open" data-uid="${esc(app.id)}" tabindex="0" class="hover:bg-blue-50/50 cursor-pointer focus:outline-none focus:bg-blue-50">
            <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(app.name)}</div><div class="text-xs text-slate-500">${esc(app.dept) || "—"}</div></td>
            <td class="px-4 py-3 text-xs text-slate-700 max-w-[240px]">${esc(awardName(app.award).name)}</td>
            <td class="px-4 py-3 tabular text-xs font-bold text-blue-700">${p.sub}/${p.total}</td>
            <td class="px-4 py-3 tabular text-xs font-bold text-emerald-700">${p.ver}/${p.total}</td>
            <td class="px-4 py-3 whitespace-nowrap">${pill(st)}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap"><button data-act="report" data-uid="${esc(app.id)}" title="Generate report" class="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-depedGold-500 hover:bg-depedGold-600 text-white transition-colors"><i data-lucide="file-text" class="w-3.5 h-3.5"></i>Report</button><button data-act="delete" data-uid="${esc(app.id)}" title="Delete application" class="ml-1.5 inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-full border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 transition"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>Delete</button></td>
          </tr>`).join("")}
        </tbody></table></div>`
      : `<div class="p-10 text-center text-sm text-slate-400">${all.length ? "No applicants match these filters." : "No applicants yet. Teachers appear here once they choose an award."}</div>`}
    </div>`;
}

// ----- Admin: review one applicant -----
function renderReview() {
  const app = state.apps[state.selected];
  if (!app) { state.selected = null; return renderAdmin(); }
  const review = state.reviews[app.id] || {};
  const draft = state.drafts[app.id] || (state.drafts[app.id] = {});
  const status = draft.status !== undefined ? draft.status : review.status || "";
  const remarks = draft.remarks !== undefined ? draft.remarks : review.remarks || "";
  const items = app.items || {};
  const ver = review.verified || {};
  const p = progress(app, review);
  const a = awardName(app.award);
  const st = statusOf(app, review);

  const part = (cat, heading) => `<div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
    <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-800">${heading}</div>
    <div class="divide-y divide-slate-100">
      ${CATEGORIES[cat].items.map((text, i) => {
        const key = `${cat}_${i}`;
        const it = items[key] || {};
        const url = isDriveUrl(it.link) ? it.link : "";
        return `<div class="p-3 sm:px-4 flex flex-wrap sm:flex-nowrap gap-x-3 gap-y-2 items-center ${ver[key] ? "bg-emerald-50/60" : ""}">
          <div class="flex-1 min-w-[200px] text-sm font-medium text-slate-800"><span class="tabular font-mono text-xs text-slate-400 mr-1">${i + 1}</span>${esc(text)}</div>
          ${hasLink(it)
            ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">Found</span>`
            : `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Missing</span>`}
          ${url
            ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(it.name || "Open")}" class="inline-flex items-center gap-1 max-w-[240px] text-xs font-semibold text-depedGold-500 hover:underline"><i data-lucide="external-link" class="w-3.5 h-3.5 flex-shrink-0"></i><span class="truncate">${esc(it.name || "Open")}</span></a>`
            : `<span class="text-xs text-slate-400">No link</span>`}
          <label class="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${ver[key] ? "text-emerald-700" : "text-slate-600"}">
            <input type="checkbox" data-act="verify" data-key="${key}" ${ver[key] ? "checked" : ""} class="w-5 h-5 rounded border-2 border-slate-300 text-emerald-600 focus:ring-emerald-500">Verified</label>
        </div>`;
      }).join("")}
    </div>
  </div>`;

  main.innerHTML = `
    <button data-act="back" class="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-900"><i data-lucide="arrow-left" class="w-3.5 h-3.5"></i>All applicants</button>
    <div class="bg-white rounded-[10px] border border-slate-200 shadow-sm p-5 mb-5 flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-xl font-bold text-slate-900">${esc(app.name)}</h2>
        <div class="text-sm text-slate-500">${esc(app.dept) || "—"}</div>
        <div class="mt-2 text-sm font-semibold text-brand-900">${esc(a.name)}${a.local ? ` <span class="font-serif italic font-normal text-depedGold-600">· ${esc(a.local)}</span>` : ""}</div>
        ${app.folder ? `<a href="${esc(app.folder)}" target="_blank" rel="noopener noreferrer" class="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-depedGold-500 hover:underline"><i data-lucide="folder-open" class="w-4 h-4"></i>Open MOV folder in Google Drive</a>` : ""}
        <div class="mt-1 text-xs text-slate-500">${app.submittedAt ? `Submitted <strong class="text-slate-700">${fmtDate(app.submittedAt)}</strong>${app.endorser ? ` · endorsed by <strong class="text-slate-700">${esc(app.endorser)}</strong>` : ""}` : `<span class="text-amber-700 font-semibold">Not submitted yet</span>`} · updated ${fmtDate(app.updatedAt)}</div>
      </div>
      <div class="flex flex-col items-end gap-2">
        <button data-act="report" data-uid="${esc(app.id)}" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-depedGold-500 hover:bg-depedGold-600 text-white text-sm font-bold shadow-sm transition-colors"><i data-lucide="file-text" class="w-4 h-4"></i>Generate report</button>
        <button data-act="delete" data-uid="${esc(app.id)}" class="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 transition"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>Delete application</button>
        ${pill(st)}
        <div class="tabular text-xs"><span class="font-bold text-blue-700">${p.sub}/${p.total} links</span> · <span class="font-bold text-emerald-700">${p.ver}/${p.total} verified</span></div>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <section class="lg:col-span-8 space-y-5 min-w-0">
        <div class="flex justify-end">
          <button data-act="verify-ticked" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 transition">Verify all with links</button>
        </div>
        ${part(GENERAL, "General MOVs")}
        ${part(app.award, esc(a.name) + " MOVs")}
      </section>
      <aside class="lg:col-span-4">
        <div class="bg-white rounded-[10px] border border-slate-200 shadow-sm p-5 space-y-3 lg:sticky lg:top-28">
          <h3 class="text-sm font-bold uppercase tracking-wide text-slate-800">Committee decision</h3>
          <div class="space-y-2">
            ${DECISIONS.map(([k, label, hint, dot]) => `<label class="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${status === k ? "border-2 border-brand-800 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}">
              <input type="radio" name="decision" value="${k}" data-act="decision" ${status === k ? "checked" : ""} class="w-4 h-4 text-brand-800 focus:ring-brand-500">
              <span class="flex-1"><span class="block text-sm font-bold text-slate-900">${label}</span><span class="block text-xs text-slate-500">${hint}</span></span>
              <span class="w-2.5 h-2.5 rounded-full ${dot}"></span>
            </label>`).join("")}
          </div>
          <div>
            <label for="remarks" class="block text-xs font-semibold text-slate-700 mb-1">Remarks <span class="font-normal text-slate-400">(the awardee sees this)</span></label>
            <textarea id="remarks" data-act="remarks" rows="4" placeholder="Findings, missing MOVs, deadlines…" class="w-full text-sm p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 resize-y">${esc(remarks)}</textarea>
          </div>
          <button data-act="save-decision" class="w-full py-2.5 rounded-lg bg-depedGold-500 hover:bg-depedGold-600 text-white text-sm font-semibold transition-colors">Save decision</button>
          ${review.reviewer ? `<p class="text-[11px] text-slate-400">Last saved by ${esc(review.reviewer)} · ${fmtDate(review.reviewedAt)}</p>` : ""}
        </div>
      </aside>
    </div>`;
}

async function setVerified(map) {
  try {
    await setDoc(doc(db, "reviews", state.selected), { verified: map, updatedAt: serverTimestamp(), ...demoMark() }, { merge: true });
  } catch (e) {
    toast(errorText(e), "error");
  }
}

async function saveDecision() {
  const uid = state.selected;
  const review = state.reviews[uid] || {};
  const draft = state.drafts[uid] || {};
  const status = draft.status !== undefined ? draft.status : review.status;
  if (!status) return toast("Pick a decision first.", "warn");
  const remarks = draft.remarks !== undefined ? draft.remarks : review.remarks || "";
  try {
    await setDoc(doc(db, "reviews", uid), {
      status, remarks, reviewer: state.user.email, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...demoMark()
    }, { merge: true });
    delete state.drafts[uid];
    toast(`Saved: ${STATUS[status].label}`);
    render();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Admin: per-awardee report (opens in a new tab, print or save as PDF) -----
const DECISION_TEXT = Object.fromEntries(DECISIONS.map(([k, label, hint]) => [k, { label, hint }]));

// Shared by every printable report.
const REPORT_CSS = `
  :root { --navy:#0d2342; --navy2:#1e3a8a; --gold:#d97706; --gold2:#f59e0b; --ink:#1e293b; --muted:#64748b; --line:#cbd5e1; --soft:#f1f5f9; --green:#047857; }
  * { box-sizing: border-box; }
  body { margin:0; background:#e2e8f0; color:var(--ink); font:13px/1.5 "Public Sans", system-ui, sans-serif; }
  .toolbar { position:sticky; top:0; z-index:5; background:var(--navy); color:#fff; padding:10px 16px; display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  .toolbar button { font:700 13px "Public Sans", sans-serif; border:0; border-radius:8px; padding:9px 16px; cursor:pointer; background:var(--gold2); color:var(--navy); }
  .page { width:210mm; max-width:100%; margin:18px auto; background:#fff; padding:16mm 16mm 18mm; box-shadow:0 4px 24px rgba(15,23,42,.15); }
  header.doc { display:flex; gap:14px; align-items:center; border-bottom:3px solid var(--gold2); padding-bottom:12px; }
  header.doc img { width:64px; height:64px; border-radius:50%; border:2px solid var(--gold2); }
  .kicker { font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:700; }
  .school { font-size:17px; font-weight:800; color:var(--navy); }
  .title { margin:18px 0 2px; font:700 24px/1.2 "Playfair Display", Georgia, serif; color:var(--navy); }
  .award { font-size:15px; font-weight:700; color:var(--navy2); }
  .local { font:italic 600 14px "Playfair Display", Georgia, serif; color:var(--gold); }
  .meta { display:flex; flex-wrap:wrap; gap:6px 18px; margin-top:8px; font-size:11.5px; color:var(--muted); }
  .meta b { color:var(--ink); }
  .toc { margin:20px 0 6px; border:1px solid var(--line); border-radius:10px; padding:14px 18px; background:var(--soft); }
  .toc h3 { margin:0 0 8px; font-size:12px; letter-spacing:.1em; text-transform:uppercase; color:var(--navy); }
  .toc ol { margin:0; padding:0; list-style:none; counter-reset:t; }
  .toc li { display:flex; align-items:baseline; gap:8px; padding:3px 0; }
  .toc li a { color:var(--ink); text-decoration:none; font-weight:600; }
  .toc .n { display:inline-block; width:22px; height:22px; line-height:22px; text-align:center; border-radius:50%; background:var(--navy); color:#fff; font-size:11px; font-weight:700; flex-shrink:0; }
  .toc .dots { flex:1; border-bottom:1px dotted #94a3b8; transform:translateY(-4px); }
  .toc .what { color:var(--muted); font-size:11.5px; }
  section { margin-top:22px; break-inside:avoid-page; }
  section h2 { display:flex; align-items:center; gap:10px; margin:0 0 10px; font-size:15px; color:var(--navy); border-bottom:1px solid var(--line); padding-bottom:6px; }
  .sn { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:6px; background:var(--gold2); color:var(--navy); font-size:13px; font-weight:800; }
  table { width:100%; border-collapse:collapse; }
  table.kv td { padding:6px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  table.kv td:first-child { width:34%; color:var(--muted); font-weight:600; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:12px; }
  .stat { border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .stat .v { font-size:22px; font-weight:800; color:var(--navy); font-variant-numeric:tabular-nums; }
  .stat .l { font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:700; }
  .barrow { display:flex; align-items:center; gap:10px; margin:4px 0; font-size:12px; }
  .barrow .lab { width:110px; color:var(--muted); font-weight:600; }
  .bar { flex:1; height:9px; background:#e2e8f0; border-radius:9px; overflow:hidden; }
  .bar i { display:block; height:100%; border-radius:9px; }
  .pill { display:inline-block; padding:2px 10px; border-radius:99px; font-weight:700; font-size:11.5px; border:1px solid var(--line); background:var(--soft); }
  table.movs th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:#fff; background:var(--navy); padding:7px 8px; }
  table.movs td { padding:7px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  table.movs tbody tr:nth-child(even) td { background:#f8fafc; }
  table.movs tr { break-inside:avoid; }
  table.movs tfoot td { font-weight:700; background:var(--soft); border-top:2px solid var(--navy); }
  .num { width:28px; text-align:center; color:var(--muted); font-variant-numeric:tabular-nums; }
  .link { width:36%; word-break:break-all; font-size:11px; }
  .link a { color:var(--navy2); }
  .mark { width:96px; text-align:center; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .mark.yes { color:var(--green); font-weight:700; }
  .muted { color:#94a3b8; font-style:italic; }
  .remarks { white-space:pre-line; border-left:4px solid var(--gold2); background:#fffbeb; padding:10px 12px; border-radius:6px; }
  .sigs { display:grid; grid-template-columns:repeat(3,1fr); gap:22px; margin-top:34px; }
  .sig { text-align:center; font-size:11.5px; }
  .sig .line { border-top:1.5px solid var(--ink); padding-top:5px; font-weight:700; min-height:20px; }
  .sig .role { color:var(--muted); }
  .cert { font-size:12px; }
  footer.doc { margin-top:26px; padding-top:8px; border-top:1px solid var(--line); font-size:10.5px; color:var(--muted); display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  @media (max-width: 640px) { .page { padding:16px; } .stats { grid-template-columns:repeat(2,1fr); } .sigs { grid-template-columns:1fr; } .link { width:auto; } }
  @page { size:A4; margin:14mm; }
  @media print {
    body { background:#fff; }
    .toolbar { display:none; }
    .page { width:auto; margin:0; padding:0; box-shadow:none; }
    a { color:inherit; text-decoration:none; }
    section#general { break-before:page; }
    th, .sn, .toc .n, tfoot td, .stat, .remarks, tbody tr:nth-child(even) td { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
  .empty { padding:14px; text-align:center; color:#94a3b8; font-style:italic; border:1px dashed var(--line); border-radius:8px; }
  .names { margin:0; padding-left:20px; columns:2; column-gap:28px; font-size:12px; }
  .names li { break-inside:avoid; padding:1px 0; }
  .lead { margin:0 0 8px; color:var(--muted); }
  .best { border-left:4px solid var(--gold2); background:#fffbeb; padding:10px 12px; border-radius:6px; margin-top:10px; }
`;

function buildReport(app, review, profile) {
  const a = awardName(app.award);
  const g = groupOf(app.award);
  const st = statusOf(app, review);
  const p = progress(app, review);
  const items = app.items || {};
  const ver = (review && review.verified) || {};
  const pct = (n) => (p.total ? Math.round((n / p.total) * 100) : 0);
  const now = new Date();
  const ref = `BP-${now.getFullYear()}-${String(app.uid).slice(0, 6).toUpperCase()}-${awardCode(app.award)}`;
  const dt = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" }) : "—");
  const logo = new URL("logo.png", location.href).href;
  const awardTitle = esc(a.name) + (a.local ? ` <span class="local">(${esc(a.local)})</span>` : "");

  const movTable = (cat) => {
    const rows = CATEGORIES[cat].items.map((text, i) => {
      const key = `${cat}_${i}`;
      const it = items[key] || {};
      const url = isDriveUrl(it.link) ? it.link : "";
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(text)}</td>
        <td class="link">${url ? `<a href="${esc(url)}">${esc(it.name || url)}</a>` : `<span class="muted">${it.link ? "Invalid link (not Google Drive)" : "No link submitted"}</span>`}</td>
        <td class="mark ${ver[key] ? "yes" : "no"}">${ver[key] ? "✔ Verified" : "—"}</td>
      </tr>`;
    }).join("");
    const done = CATEGORIES[cat].items.filter((_, i) => ver[`${cat}_${i}`]).length;
    return `<table class="movs">
      <thead><tr><th class="num">#</th><th>Means of Verification</th><th>File in Google Drive</th><th class="mark">Committee check</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td></td><td colspan="2">Verified in this section</td><td class="mark">${done} / ${CATEGORIES[cat].items.length}</td></tr></tfoot>
    </table>`;
  };

  const sections = [
    ["applicant", "Applicant Information"],
    ["summary", "Summary of Requirements"],
    ["general", "Part A · General MOVs"],
    ["award", `Part B · ${esc(a.name)} MOVs`],
    ["decision", "Committee Decision and Remarks"],
    ["signatures", "Certification and Signatures"]
  ];
  const sec = (i, id, body) => `<section id="${id}"><h2><span class="sn">${i + 1}</span>${sections[i][1]}</h2>${body}</section>`;
  const decision = review && review.status ? DECISION_TEXT[review.status] : null;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BLESS PRAISE Report · ${esc(app.name)} · ${esc(a.name)}</title>
<link rel="icon" href="${logo}">
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700;800&family=Playfair+Display:ital,wght@0,700;1,600&display=swap" rel="stylesheet">
<style>${REPORT_CSS}</style></head><body>
<div class="toolbar"><span><b>BLESS PRAISE Report</b> · ${esc(app.name)}</span><button onclick="window.print()">Print / Save as PDF</button></div>
<main class="page">
  <header class="doc">
    <img src="${logo}" alt="BLESS seal">
    <div>
      <div class="kicker">Republic of the Philippines · DepEd Region XI · SDO Panabo City</div>
      <div class="school">San Vicente National High School</div>
      <div class="kicker" style="letter-spacing:.06em">BLESS Program on Awards and Incentives for Service Excellence (PRAISE)</div>
    </div>
  </header>

  <div class="title">Nominee Evaluation Report</div>
  <div class="award">${awardTitle}</div>
  <div class="meta">
    <span>Nominee: <b>${esc(app.name)}</b></span>
    <span>Reference no.: <b>${ref}</b></span>
    <span>Generated: <b>${now.toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" })}</b></span>
  </div>

  <nav class="toc">
    <h3>Table of Contents</h3>
    <ol>
      ${sections.map(([id, label], i) => `<li><span class="n">${i + 1}</span><a href="#${id}">${label}</a><span class="dots"></span><span class="what">${[
        "Name, position, award",
        `${p.ver}/${p.total} verified`,
        `${CATEGORIES[GENERAL].items.length} requirements`,
        `${CATEGORIES[app.award].items.length} requirements`,
        decision ? decision.label : "Pending",
        "Validator and School Head"
      ][i]}</span></li>`).join("")}
    </ol>
  </nav>

  ${sec(0, "applicant", `<table class="kv">
    <tr><td>Name of nominee</td><td><b>${esc(app.name)}</b></td></tr>
    <tr><td>Position</td><td>${esc(profile && profile.position) || "—"}</td></tr>
    <tr><td>Department / Grade level</td><td>${esc(app.dept || (profile && profile.dept)) || "—"}</td></tr>
    <tr><td>Email</td><td>${esc(profile && profile.email) || "—"}</td></tr>
    <tr><td>Award category</td><td>${esc(g.name)}</td></tr>
    <tr><td>Award applied for</td><td><b>${awardTitle}</b></td></tr>
    <tr><td>Endorsed by</td><td>${esc(app.endorser) || "—"}</td></tr>
  </table>`)}

  ${sec(1, "summary", `<div class="stats">
      <div class="stat"><div class="v">${p.total}</div><div class="l">Total MOVs</div></div>
      <div class="stat"><div class="v">${p.sub}</div><div class="l">Links submitted</div></div>
      <div class="stat"><div class="v">${p.ver}</div><div class="l">Verified</div></div>
      <div class="stat"><div class="v">${pct(p.ver)}%</div><div class="l">Completion</div></div>
    </div>
    <div class="barrow"><span class="lab">Links submitted</span><span class="bar"><i style="width:${pct(p.sub)}%;background:#2563eb"></i></span><b>${pct(p.sub)}%</b></div>
    <div class="barrow"><span class="lab">Verified</span><span class="bar"><i style="width:${pct(p.ver)}%;background:#10b981"></i></span><b>${pct(p.ver)}%</b></div>
    <table class="kv" style="margin-top:10px">
      <tr><td>Status</td><td><span class="pill">${STATUS[st].label}</span></td></tr>
      <tr><td>Date submitted</td><td>${dt(app.submittedAt)}</td></tr>
      <tr><td>Last updated by nominee</td><td>${dt(app.updatedAt)}</td></tr>
    </table>`)}

  ${sec(2, "general", `<p class="what" style="margin:0 0 8px;color:var(--muted)">Required of every nominee regardless of category.</p>${movTable(GENERAL)}`)}

  ${sec(3, "award", `<p style="margin:0 0 8px;color:var(--muted)">${esc(CATEGORIES[app.award].description)}</p>${movTable(app.award)}`)}

  ${sec(4, "decision", `<table class="kv">
      <tr><td>Decision</td><td>${decision ? `<b>${decision.label}</b> · ${decision.hint}` : `<span class="muted">No decision recorded yet</span>`}</td></tr>
      <tr><td>Recorded by</td><td>${esc(review && review.reviewer) || "—"}</td></tr>
      <tr><td>Date recorded</td><td>${dt(review && review.reviewedAt)}</td></tr>
    </table>
    <div style="margin-top:10px"><div class="kicker" style="margin-bottom:4px">Remarks</div>
      <div class="remarks">${review && review.remarks ? esc(review.remarks) : "None."}</div></div>`)}

  ${sec(5, "signatures", `<p class="cert">We certify that the Means of Verification listed in this report were reviewed against the BLESS PRAISE
      standardized MOVs checklist, in accordance with Civil Service Commission and DepEd guidelines.</p>
    <div class="sigs">
      <div class="sig"><div class="line">${esc(app.name)}</div><div class="role">Nominee</div></div>
      <div class="sig"><div class="line">&nbsp;</div><div class="role">PRAISE Committee Validator</div></div>
      <div class="sig"><div class="line">&nbsp;</div><div class="role">School Head / PRAISE Chair</div></div>
    </div>`)}

  <footer class="doc"><span>BLESS PRAISE Portal · San Vicente National High School</span><span>${ref}</span></footer>
</main>
</body></html>`;
}

function confirmDelete(uid) {
  const app = state.apps[uid];
  if (!app) return;
  openModal(`<div class="p-6 space-y-3">
    <div class="w-11 h-11 rounded-full bg-red-100 text-red-600 flex items-center justify-center"><i data-lucide="trash-2" class="w-5 h-5"></i></div>
    <h3 class="text-lg font-bold text-slate-900">Delete this application?</h3>
    <div class="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm">
      <div class="font-bold text-slate-900">${esc(app.name)}</div>
      <div class="text-slate-600">${esc(awardName(app.award).name)}</div>
    </div>
    <p class="text-sm text-slate-600">This removes the <strong class="text-red-700">saved links, verified checks, decision and remarks</strong>. It can't be undone.
      The teacher's account stays, so they can apply again.</p>
    <label for="delete-confirm" class="block text-xs font-semibold text-slate-700">Type <span class="font-bold text-red-700">DELETE</span> to confirm</label>
    <input id="delete-confirm" autocomplete="off" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500">
  </div>
  <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
    <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
    <button data-act="do-delete" data-uid="${esc(uid)}" class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow">Delete application</button>
  </div>`);
  setTimeout(() => { const i = $("#delete-confirm"); if (i) i.focus(); }, 50);
}

async function doDelete(uid) {
  if (($("#delete-confirm").value || "").trim().toUpperCase() !== "DELETE") return toast("Type DELETE to confirm.", "warn");
  const name = state.apps[uid] ? state.apps[uid].name : "Application";
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "applications", uid));
    batch.delete(doc(db, "reviews", uid));
    await batch.commit();
    closeModal();
    delete state.drafts[uid];
    if (state.selected === uid) state.selected = null;
    render();
    toast(`Deleted: ${name}`);
  } catch (e) {
    toast(errorText(e), "error");
  }
}

async function generateReport(uid) {
  const app = state.apps[uid];
  if (!app) return;
  // Open the tab right away so pop-up blockers allow it, then fill it.
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups for this site to open the report.", "warn");
  w.document.write('<p style="font:14px system-ui,sans-serif;padding:24px;color:#475569">Preparing report…</p>');
  let profile = null;
  try {
    const snap = await getDoc(doc(db, "users", app.uid));
    profile = snap.exists() ? snap.data() : null;
  } catch (e) { profile = null; }
  w.document.open();
  w.document.write(buildReport(app, state.reviews[uid], profile));
  w.document.close();
}

// ---------- Monitoring: Attendance · AOR · ILAW (lesson plan) ----------
// Access comes from monitors/{email}, set by admins under Monitoring → Staff access.
//   hr      Human Resource: attendance of teaching and non-teaching personnel, personnel list
//   clinic  School Clinic: AOR, cleanest classroom per week (1st, 2nd, 3rd)
//   dll     Head / Master Teachers: weekly ILAW (lesson plan) check, only for their own subject areas (stored in "dll")
// Admins have all of it, plus Staff access.
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !isNaN(parseDay(s));
const todayIso = () => isoDay(new Date());
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); };
const mondayOf = (s) => addDays(s, -((parseDay(s).getDay() + 6) % 7));
const fmtDay = (s, opt = { month: "short", day: "numeric", year: "numeric" }) => (isDay(s) ? parseDay(s).toLocaleDateString("en-PH", opt) : "—");
const fmtWeek = (w) => `${fmtDay(w, { month: "short", day: "numeric" })} – ${fmtDay(addDays(w, 4))}`;
const fmtMonth = (ym) => parseDay(ym + "-01").toLocaleDateString("en-PH", { month: "long", year: "numeric" });
const periodText = (from, to) => (from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`);
const fmtTime = (t) => {
  if (!/^\d{2}:\d{2}$/.test(t || "")) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
};
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

const PTYPE = { teaching: "Teaching", nonteaching: "Non-teaching" };
const DURATION = { whole: ["Whole day", 1], am: ["Half day (AM)", 0.5], pm: ["Half day (PM)", 0.5] };
const DLL_STATUS = {
  ontime: { label: "On time", cls: "bg-emerald-600 text-white border-emerald-700" },
  late: { label: "Late", cls: "bg-amber-400 text-amber-950 border-amber-500" },
  missing: { label: "Not submitted", cls: "bg-red-600 text-white border-red-700" }
};
// key, label, medal, points
const PLACES = [["first", "1st", "🥇", 3], ["second", "2nd", "🥈", 2], ["third", "3rd", "🥉", 1]];
const PERM_LABELS = [["hr", "HR"], ["clinic", "Clinic"], ["dll", "Head / Master Teacher"]];

function schoolYearStart() {
  const d = new Date();
  return `${d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1}-06-01`;
}
const PRESETS = {
  week: () => [mondayOf(todayIso()), todayIso()],
  month: () => [todayIso().slice(0, 8) + "01", todayIso()],
  lastmonth: () => { const d = new Date(); d.setDate(0); const e = isoDay(d); return [e.slice(0, 8) + "01", e]; },
  sy: () => [schoolYearStart(), todayIso()]
};
function freshMon() {
  return { view: "", attMode: "daily", day: todayIso(), month: todayIso().slice(0, 7), week: mondayOf(todayIso()), subject: "", q: "", ptype: "" };
}
// Attendance reports are monthly: from the 1st to the last day of the month.
const monthRange = (m) => { const [y, mo] = m.split("-").map(Number); return [`${m}-01`, `${m}-${pad(new Date(y, mo, 0).getDate())}`]; };
function freshRep() {
  return { att: monthRange(todayIso().slice(0, 7)), aor: PRESETS.month(), dll: PRESETS.month(), attType: "", dllSubject: "" };
}

function permsFrom(snap) {
  if (!snap.exists()) return null;
  const m = snap.data();
  const p = { hr: m.hr === true, clinic: m.clinic === true, dll: m.dll === true, subjects: (m.subjects || []).filter((s) => SUBJECTS.includes(s)) };
  return p.hr || p.clinic || p.dll ? p : null;
}
async function loadPerms(email) {
  try { return permsFrom(await getDoc(doc(db, "monitors", email))); } catch (e) { return null; }
}

// ----- Asking for Monitoring access (at sign-up, or later from Home) -----
// The request waits in accessRequests/{email} until an admin approves it under Staff access.
const SIGNUP_ROLES = [
  ["", "Teacher / Personnel (apply for an award)"],
  ["hr", "Human Resource (HR)"],
  ["clinic", "School Clinic"],
  ["dll", "Head Teacher / Master Teacher"]
];
const subjectChecks = (name, on) => SUBJECTS.map((s) => `<label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
  <input type="checkbox" name="${name}" value="${esc(s)}" ${on.includes(s) ? "checked" : ""} class="w-4 h-4 rounded border-slate-300 text-brand-800">${esc(s)}</label>`).join("");
// Role checkboxes + subject areas, used by Staff access and by the request form.
function roleFields(prefix, m) {
  const check = (value, text, hint) => `<label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
    <input type="checkbox" name="${prefix}-role" value="${value}" ${m && m[value] ? "checked" : ""} class="w-4 h-4 mt-0.5 rounded border-slate-300 text-brand-800">
    <span><span class="block text-sm font-bold text-slate-900">${text}</span><span class="block text-xs text-slate-500">${hint}</span></span></label>`;
  return `<div class="space-y-2">
      ${check("hr", "Human Resource", "Attendance of teaching and non-teaching personnel")}
      ${check("clinic", "School Clinic", "AOR · cleanest classroom per week")}
      ${check("dll", "Head Teacher / Master Teacher", "Weekly ILAW (lesson plan) check for the subject areas below")}
    </div>
    <div><div class="text-xs font-semibold text-slate-700 mb-1.5">Subject areas <span class="font-normal text-slate-400">(Head / Master Teacher only)</span></div>
      <div class="grid grid-cols-2 gap-1.5">${subjectChecks(`${prefix}-subject`, (m && m.subjects) || [])}</div></div>`;
}
function readRoles(prefix) {
  const on = (v) => !!document.querySelector(`input[name=${prefix}-role][value=${v}]:checked`);
  const r = { hr: on("hr"), clinic: on("clinic"), dll: on("dll"), subjects: [] };
  if (!r.hr && !r.clinic && !r.dll) return "Tick at least one kind of access.";
  if (r.dll) {
    r.subjects = [...document.querySelectorAll(`input[name=${prefix}-subject]:checked`)].map((i) => i.value);
    if (!r.subjects.length) return "Pick the subject areas for Head / Master Teacher.";
  }
  return r;
}
const rolesText = (m) => PERM_LABELS.filter(([k]) => m[k]).map(([, t]) => t).join(", ");

// ----- Position (chosen from a list) and the personnel entry every account gets -----
const positionType = (p) => (POSITIONS.nonteaching.includes(p) ? "nonteaching" : "teaching");
const needsSubject = (p) => /^(Teacher|Master Teacher|Head Teacher) /.test(p || "");
const deptLabel = (p) => (!p ? "Subject area / Office" : positionType(p) === "nonteaching" ? "Office" : needsSubject(p) ? "Subject area" : 'Subject area <span class="font-normal text-slate-400">(optional)</span>');
function deptOptions(p, cur) {
  if (!p) return `<option value="">Choose your position first</option>`;
  const list = positionType(p) === "nonteaching" ? OFFICES : SUBJECTS;
  const first = positionType(p) === "nonteaching" ? "Choose office…" : needsSubject(p) ? "Choose subject area…" : "None";
  return `<option value="">${first}</option>${list.map((x) => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("")}`;
}
function positionFields(prefix, position, dept) {
  const group = (k, label) => `<optgroup label="${label}">${POSITIONS[k].map((p) => `<option ${p === position ? "selected" : ""}>${esc(p)}</option>`).join("")}</optgroup>`;
  return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div>${lbl(`${prefix}-position`, "Position")}
      <select id="${prefix}-position" data-act="pick-position" data-prefix="${prefix}" class="w-full ${inputCls}">
        <option value="">Choose your position…</option>${group("teaching", "Teaching")}${group("nonteaching", "Non-teaching")}
      </select></div>
    <div><label id="${prefix}-dept-label" for="${prefix}-dept" class="block text-xs font-semibold text-slate-700 mb-1">${deptLabel(position)}</label>
      <select id="${prefix}-dept" class="w-full ${inputCls}" ${position ? "" : "disabled"}>${deptOptions(position, dept)}</select></div>
  </div>`;
}
function positionPicked(prefix, p) {
  const sel = $(`#${prefix}-dept`);
  sel.innerHTML = deptOptions(p, "");
  sel.disabled = !p;
  $(`#${prefix}-dept-label`).innerHTML = deptLabel(p);
}
function positionError(position, dept) {
  if (!position) return "Choose your position.";
  if (positionType(position) === "nonteaching" && !dept) return "Choose your office.";
  if (needsSubject(position) && !dept) return "Choose your subject area.";
  return "";
}
function savePersonnelEntry(user, name, position, dept) {
  const type = positionType(position);
  return setDoc(doc(db, "personnel", user.uid), {
    name: String(name).slice(0, 120), type, position,
    subject: type === "teaching" && SUBJECTS.includes(dept) ? dept : "",
    office: type === "nonteaching" ? dept : "",
    email: user.email || "", by: user.email || "", updatedAt: serverTimestamp(), ...demoMark()
  }, { merge: true });
}

// "My profile": opened from the name in the header, and once for older accounts with no position yet.
function openProfile(first) {
  const me = state.me || {};
  const all = [...POSITIONS.teaching, ...POSITIONS.nonteaching];
  const position = all.includes(me.position) ? me.position : "";
  openModal(`${modalHead(first ? "Complete your profile" : "My profile", first ? "Choose your current position so you're included in attendance monitoring." : esc(state.user.email))}
    <div class="p-6 space-y-3">
      ${field("pf-name", "Full name", "text", `value="${esc(me.name || myName())}" maxlength="120"`)}
      ${positionFields("pf", position, position ? me.subject || me.office || "" : "")}
    </div>
    ${modalFoot("profile-save", "Save")}`);
}
async function saveProfile() {
  const name = val("pf-name").replace(/\s+/g, " ");
  const position = val("pf-position"), dept = val("pf-dept");
  if (!name) return toast("Enter your full name.", "warn");
  const err = positionError(position, dept);
  if (err) return toast(err, "warn");
  try {
    await setDoc(doc(db, "users", state.user.uid), { name, position, dept, email: state.user.email }, { merge: true });
    await savePersonnelEntry(state.user, name, position, dept);
    await updateProfile(state.user, { displayName: name });
    state.profile = { ...(state.profile || {}), name, position, dept };
    closeModal();
    toast("Profile saved");
    render();
  } catch (e) {
    toast(errorText(e), "error");
  }
}
function profileBar() {
  if (!state.meLoaded || state.me) return "";
  return `<div class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
    <span class="inline-flex items-center gap-2"><i data-lucide="user-round-pen" class="w-4 h-4 text-blue-700"></i>Choose your current position to complete your profile.</span>
    <button data-act="profile" class="${btnDark}">Complete profile</button></div>`;
}

function sendAccessRequest(email, name, position, roles) {
  return setDoc(doc(db, "accessRequests", email), {
    name: String(name || "").slice(0, 120), email, position: String(position || "").slice(0, 120),
    hr: roles.hr, clinic: roles.clinic, dll: roles.dll, subjects: roles.subjects, createdAt: serverTimestamp()
  });
}

// Shown on Home for people without Monitoring access.
function staffBar() {
  if (state.perms) return "";
  const r = state.request;
  if (r) {
    return `<div class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <span class="inline-flex items-center gap-2"><i data-lucide="hourglass" class="w-4 h-4 text-amber-700"></i>Your request for <strong>${esc(rolesText(r))}</strong> access is waiting for an admin to approve it.</span>
      <button data-act="req-cancel" class="text-xs font-semibold text-amber-800 hover:underline">Cancel request</button></div>`;
  }
  return `<div class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
    <span class="inline-flex items-center gap-2"><i data-lucide="clipboard-check" class="w-4 h-4 text-brand-600"></i>Are you HR, the School Clinic, or a Head / Master Teacher?</span>
    <button data-act="req-open" class="${btnLight}">Request Monitoring access</button></div>`;
}

function openRequest() {
  openModal(`${modalHead("Request Monitoring access", "An admin approves this. You keep your award application.")}
    <div class="p-6 space-y-3">${roleFields("req", null)}</div>
    ${modalFoot("req-save", "Send request")}`);
}
async function saveRequest() {
  const roles = readRoles("req");
  if (typeof roles === "string") return toast(roles, "warn");
  try {
    await sendAccessRequest(state.user.email, myName(), state.profile && state.profile.position, roles);
    closeModal();
    toast("Request sent. You'll get the Monitoring tab once an admin approves it.");
  } catch (e) {
    toast(errorText(e), "error");
  }
}
async function cancelRequest() {
  try { await deleteDoc(doc(db, "accessRequests", state.user.email)); toast("Request cancelled"); } catch (e) { toast(errorText(e), "error"); }
}

// Live listeners, replaced when the month / week changes and dropped on sign-out.
// Public demo accounts (…@svnhs-demo.ph) work only on records marked demo: true; firestore.rules enforces it.
const isDemoUser = () => isDemoEmail(state.user && state.user.email);
const demoOnly = (...w) => (isDemoUser() ? [where("demo", "==", true), ...w] : w);
const demoMark = () => (isDemoUser() ? { demo: true } : {});
const aorDocId = (week) => (isDemoUser() ? `demo-${week}` : week);

function watch(key, ref, set) {
  if (state.watches[key]) state.watches[key]();
  state.watches[key] = onSnapshot(ref, (snap) => {
    const out = {};
    snap.forEach((d) => { out[d.id] = { id: d.id, ...d.data() }; });
    set(out);
    render();
  }, (e) => toast(errorText(e), "error"));
}
function startMonitoring() {
  const p = state.perms;
  if (!p) return;
  if (p.hr || p.dll) watch("personnel", query(collection(db, "personnel"), ...demoOnly()), (d) => { state.personnel = d; });
  if (p.clinic) watch("aor", query(collection(db, "aor"), ...demoOnly()), (d) => {
    state.aor = Object.fromEntries(Object.values(d).filter((x) => isDay(x.week) && !!x.demo === isDemoUser()).map((x) => [x.week, x]));
  });
  if (p.admin) watch("monitors", query(collection(db, "monitors"), ...demoOnly()), (d) => { state.monitors = d; });
  if (p.admin) watch("requests", query(collection(db, "accessRequests"), ...demoOnly()), (d) => { state.requests = d; });
  if (p.hr) watchAttendance();
  if (p.dll) watchDll();
}
function restartMonitoring() {
  Object.values(state.watches).forEach((f) => f());
  state.watches = {};
  startMonitoring();
}
function watchAttendance() {
  const m = state.mon.month;
  watch("attendance", query(collection(db, "attendance"), ...demoOnly(where("date", ">=", `${m}-01`), where("date", "<=", `${m}-31`))),
    (d) => { state.attendance = d; });
}
function watchDll() {
  state.dllDrafts = {};
  watch("dll", query(collection(db, "dll"), ...demoOnly(where("week", "==", state.mon.week))), (d) => { state.dll = d; });
}

// ----- Shared bits -----
const inputCls = "text-sm px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
const btnDark = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-depedGold-500 bg-depedGold-500 hover:bg-depedGold-600 text-white text-sm font-semibold whitespace-nowrap transition-colors";
const btnLight = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-black/20 bg-brand-50 hover:bg-brand-100 text-brand-950 text-sm font-semibold whitespace-nowrap transition-colors";
const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const lbl = (forId, text) => `<label for="${forId}" class="block text-xs font-semibold text-slate-700 mb-1">${text}</label>`;
const chip = (text, cls) => `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${cls}">${text}</span>`;
const panel = (inner) => `<div class="bg-brand-50 rounded-[10px] border border-black/10 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_16px_rgba(0,0,0,0.04)] overflow-hidden">${inner}</div>`;
const panelHead = (title, right = "") => `<div class="px-5 pt-4 pb-3 flex flex-wrap items-baseline justify-between gap-2"><h3 class="text-base font-bold text-brand-950">${title}</h3>${right}</div>`;
const empty = (msg) => `<div class="p-10 text-center text-sm text-slate-400">${msg}</div>`;
const table = (heads, rows) => `<div class="overflow-x-auto"><table class="w-full text-sm">
  <thead class="text-xs uppercase tracking-[0.04em] text-brand-500 border-b border-black/10"><tr>${heads.map((h) => `<th class="text-left font-semibold px-4 py-2.5 whitespace-nowrap">${h}</th>`).join("")}</tr></thead>
  <tbody class="divide-y divide-black/10">${rows.join("")}</tbody></table></div>`;
const selectBox = (id, act, options, value, cls = "") => `<select id="${id}" ${act ? `data-act="${act}"` : ""} class="${inputCls} ${cls}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
const iconBtn = (act, id, icon, title) => `<button data-act="${act}" data-id="${esc(id)}" title="${title}" class="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"><i data-lucide="${icon}" class="w-4 h-4"></i></button>`;
const delBtn = (col, id) => `<button data-act="mon-del" data-col="${col}" data-id="${esc(id)}" title="Delete" class="p-1.5 rounded-md text-red-500 hover:text-red-700 hover:bg-red-50 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
const modalHead = (title, sub = "") => `<div class="px-6 pt-5 pb-3"><h3 class="text-lg font-bold text-brand-950">${title}</h3>${sub ? `<p class="mt-0.5 text-sm text-brand-600">${sub}</p>` : ""}</div>`;
const modalFoot = (act, text, id = "") => `<div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
  <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
  <button data-act="${act}" data-id="${esc(id)}" class="px-5 py-2.5 bg-depedGold-500 hover:bg-depedGold-600 text-white rounded-lg text-sm font-semibold transition-colors">${text}</button></div>`;
const pageHead = (title, icon, sub) => `<div class="flex flex-wrap items-start justify-between gap-4 mb-5"><div class="min-w-0"><h2 class="text-[1.6rem] font-bold tracking-tight leading-tight text-brand-950">${title}</h2><p class="mt-1 text-[0.92rem] text-brand-600">${sub}</p></div></div>`;

// ----- Monitoring page -----
function monViews() {
  const p = state.perms || {};
  return [
    ["attendance", "Attendance", "calendar-x", p.hr],
    ["aor", "AOR · Cleanest classroom", "sparkles", p.clinic],
    ["dll", "ILAW · Lesson plan", "book-open-check", p.dll],
    ["personnel", "Personnel", "users", p.hr || p.dll],
    ["access", `Staff access${Object.keys(state.requests).length ? ` (${Object.keys(state.requests).length} new)` : ""}`, "shield-check", p.admin]
  ].filter((v) => v[3]);
}

function renderMonitor() {
  const views = monViews();
  if (!views.some((v) => v[0] === state.mon.view)) state.mon.view = views[0][0];
  const body = { attendance: monAttendance, aor: monAor, dll: monDll, personnel: monPersonnel, access: monAccess }[state.mon.view]();
  main.innerHTML = `${pageHead("Monitoring", "clipboard-check", "Attendance, AOR (Area of Responsibility) and ILAW lesson plans")}
    <div class="flex flex-wrap gap-2 mb-5">
      ${views.map(([id, text, icon]) => `<button data-act="mon-view" data-view="${id}" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors ${state.mon.view === id ? "bg-brand-50 text-brand-950 border-black/20 shadow-sm" : "text-brand-600 border-transparent hover:bg-brand-100 hover:text-brand-950"}">
        <i data-lucide="${icon}" class="w-4 h-4"></i>${text}</button>`).join("")}
    </div>
    ${body}`;
}

// ----- Attendance (HR) -----
function attendanceSummary(recs) {
  const m = {};
  for (const r of recs) {
    const s = (m[r.pid] ||= { pid: r.pid, name: r.name, ptype: r.ptype, days: 0, lates: 0, minutes: 0, uniform: 0 });
    if (r.type === "absent") s.days += (DURATION[r.duration] || DURATION.whole)[1];
    else if (r.type === "uniform") s.uniform++;
    else { s.lates++; s.minutes += Number(r.minutes) || 0; }
  }
  return Object.values(m).sort(byName);
}

// 75 → "1 h 15 min"
const fmtMins = (m) => (!m ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

// Tardiness: HR enters the time in; minutes late are counted from the official start of the school day.
const SCHOOL_START = "07:30";
const toMins = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const minutesLate = (timeIn) => (/^\d{2}:\d{2}$/.test(timeIn || "") ? Math.max(0, toMins(timeIn) - toMins(SCHOOL_START)) : 0);
function lateText(timeIn, savedMinutes = 0) {
  if (!timeIn) return savedMinutes ? `${fmtMins(savedMinutes)} late (no time in recorded)` : `Enter the time in. Minutes late are counted from ${fmtTime(SCHOOL_START)}.`;
  const m = minutesLate(timeIn);
  return m ? `${m} minute${m === 1 ? "" : "s"} late${m >= 60 ? ` (${fmtMins(m)})` : ""} · class starts at ${fmtTime(SCHOOL_START)}`
    : `Not late: ${fmtTime(timeIn)} is on or before ${fmtTime(SCHOOL_START)}.`;
}

function attRecord(r) {
  if (r.type === "uniform") return chip("No proper uniform", "bg-violet-50 text-violet-800 border-violet-200");
  if (r.type === "absent") {
    const half = r.duration && r.duration !== "whole" ? ` · ${(DURATION[r.duration] || DURATION.whole)[0]}` : "";
    return `${chip("Absent", "bg-red-50 text-red-800 border-red-200")}<div class="text-xs text-slate-600 mt-1">${esc(r.kind || "—")}${half}</div>`;
  }
  const bits = [r.minutes ? `${r.minutes} min late` : "", r.timeIn ? `in at ${fmtTime(r.timeIn)}` : ""].filter(Boolean).join(" · ");
  return `${chip("Late", "bg-amber-50 text-amber-800 border-amber-300")}${bits ? `<div class="text-xs text-slate-600 mt-1">${bits}</div>` : ""}`;
}

// Attendance has three modes: a daily sheet to tag people, a month grid, and the list of all records.
function monAttendance() {
  const modes = [["daily", "Daily sheet", "list-checks"], ["month", "Month view", "calendar-days"], ["records", "All records", "list"]];
  return `<div class="inline-flex flex-wrap p-1 mb-4 bg-brand-100 rounded-lg border border-black/10">
      ${modes.map(([k, t, icon]) => `<button data-act="att-mode" data-mode="${k}" class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold rounded-md transition-colors ${state.mon.attMode === k ? "bg-brand-50 text-brand-950 shadow-sm" : "text-brand-600 hover:text-brand-950"}"><i data-lucide="${icon}" class="w-4 h-4"></i>${t}</button>`).join("")}
    </div>
    ${{ daily: attDaily, month: attMonth, records: attRecords }[state.mon.attMode]()}`;
}

// The loaded month always contains the selected day.
function setAttMonth(m) {
  if (!/^\d{4}-\d{2}$/.test(m || "")) return render();
  if (m !== state.mon.month) { state.mon.month = m; watchAttendance(); }
  if (state.mon.day.slice(0, 7) !== m) state.mon.day = todayIso().slice(0, 7) === m ? todayIso() : `${m}-01`;
  render();
}
function setAttDay(d) {
  if (!isDay(d)) return render();
  state.mon.day = d;
  setAttMonth(d.slice(0, 7));
}
const personFilter = (x) => (!state.mon.ptype || x.type === state.mon.ptype)
  && (!state.mon.q || `${x.name} ${x.position || ""}`.toLowerCase().includes(state.mon.q.toLowerCase()));
const recsOn = (pid, d) => Object.values(state.attendance).filter((r) => r.pid === pid && r.date === d);
const attFilters = (placeholder) => `
  <input id="mon-q" data-act="mon-q" value="${esc(state.mon.q)}" placeholder="${placeholder}" class="${inputCls} flex-1 min-w-[160px]">
  ${selectBox("mon-ptype", "mon-ptype", [["", "All personnel"], ["teaching", "Teaching"], ["nonteaching", "Non-teaching"]], state.mon.ptype)}`;
const noPersonnel = () => panel(empty("No personnel yet. Teaching and non-teaching personnel appear here once they create an account and choose their position."));

function attDaily() {
  const d = state.mon.day;
  const all = Object.values(state.personnel);
  if (!all.length) return noPersonnel();
  const people = all.filter(personFilter).sort(byName);
  const recs = (pid) => recsOn(pid, d);
  const absent = people.filter((x) => recs(x.id).some((r) => r.type === "absent")).length;
  const late = people.filter((x) => recs(x.id).some((r) => r.type === "late")).length;
  const noUniform = people.filter((x) => recs(x.id).some((r) => r.type === "uniform")).length;
  const present = people.filter((x) => !recs(x.id).some((r) => r.type === "absent" && r.duration === "whole")).length;
  const wd = parseDay(d).getDay();
  const markBtn = (x, mark, text, on, onCls) => `<button data-act="att-mark" data-pid="${esc(x.id)}" data-mark="${mark}"
    class="px-3 py-1.5 rounded-full text-xs font-bold border transition ${on ? onCls : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}">${text}</button>`;
  const rows = (pt) => people.filter((x) => x.type === pt).map((x) => {
    const rs = recs(x.id);
    const isAbs = rs.some((r) => r.type === "absent"), isLate = rs.some((r) => r.type === "late"), isUni = rs.some((r) => r.type === "uniform");
    return `<tr class="${isAbs ? "bg-red-50/50" : isLate ? "bg-amber-50/50" : ""}">
      <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(x.name)}</div><div class="text-xs text-slate-500">${esc(x.position) || PTYPE[x.type]}${x.subject ? ` · ${esc(x.subject)}` : ""}</div></td>
      <td class="px-4 py-3"><div class="flex flex-wrap gap-1.5">
        ${markBtn(x, "present", "Present", !isAbs && !isLate, "bg-emerald-600 text-white border-emerald-700")}
        ${markBtn(x, "absent", "Absent", isAbs, "bg-red-600 text-white border-red-700")}
        ${markBtn(x, "late", "Late", isLate, "bg-amber-400 text-amber-950 border-amber-500")}
        ${markBtn(x, "uniform", "No uniform", isUni, "bg-violet-600 text-white border-violet-700")}
      </div></td>
      <td class="px-4 py-3 text-xs">${rs.length ? rs.map((r) => `<div class="flex items-start justify-between gap-2">
          <div>${attRecord(r)}${r.remarks ? `<div class="text-slate-500 mt-0.5 whitespace-pre-line">${esc(r.remarks)}</div>` : ""}</div>
          <div class="flex-shrink-0">${iconBtn("att-edit", r.id, "pencil", "Edit")}</div></div>`).join("") : `<span class="text-slate-400">—</span>`}</td>
    </tr>`;
  });
  const section = (pt) => {
    const r = rows(pt);
    return r.length ? panel(panelHead(`${PTYPE[pt]} personnel · ${r.length}`) + table(["Name", "Attendance", "Details"], r)) : "";
  };
  return `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <div class="inline-flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
        <button data-act="att-day" data-step="-1" title="Previous day" class="px-2.5 py-2 hover:bg-slate-50"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
        <span class="px-2 text-xs font-bold text-slate-700 whitespace-nowrap">${fmtDay(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
        <button data-act="att-day" data-step="1" title="Next day" class="px-2.5 py-2 hover:bg-slate-50"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
      </div>
      <input id="att-day-pick" type="date" data-act="att-day-pick" value="${d}" title="Pick a day" class="${inputCls}">
      ${d !== todayIso() ? `<button data-act="att-day-today" class="${btnLight}">Today</button>` : ""}
      ${attFilters("Search name")}
    </div>
    ${wd === 0 || wd === 6 ? `<div class="mb-4 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">This day is a ${wd === 0 ? "Sunday" : "Saturday"}. Only tag people if there was work or an activity.</div>` : ""}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      ${statTile("Present", present, "bg-emerald-50 text-emerald-900 border-emerald-300")}
      ${statTile("Absent", absent, "bg-red-50 text-red-900 border-red-200")}
      ${statTile("Late", late, "bg-amber-50 text-amber-900 border-amber-300")}
      ${statTile("No proper uniform", noUniform, "bg-violet-50 text-violet-900 border-violet-200")}
    </div>
    <p class="text-xs text-slate-500 mb-3">${people.length} personnel. Everyone is <strong class="text-emerald-700">Present</strong> unless tagged. Tap <strong class="text-red-700">Absent</strong>, <strong class="text-amber-700">Late</strong> or <strong class="text-violet-700">No uniform</strong> to add the details.</p>
    <div class="space-y-5">${section("teaching")}${section("nonteaching")}${people.length ? "" : panel(empty("No one matches."))}</div>`;
}

function attMonth() {
  const m = state.mon.month;
  const all = Object.values(state.personnel);
  if (!all.length) return noPersonnel();
  const people = all.filter(personFilter).sort((a, b) => a.type.localeCompare(b.type) * -1 || byName(a, b));
  const [y, mo] = m.split("-").map(Number);
  const days = Array.from({ length: new Date(y, mo, 0).getDate() }, (_, i) => `${m}-${pad(i + 1)}`);
  const today = todayIso();
  const idx = {};
  Object.values(state.attendance).forEach((r) => { ((idx[r.pid] ||= {})[r.date] ||= []).push(r); });
  const weekend = (d) => [0, 6].includes(parseDay(d).getDay());
  const cell = (x, d) => {
    const rs = (idx[x.id] || {})[d] || [];
    const abs = rs.find((r) => r.type === "absent"), late = rs.find((r) => r.type === "late"), uni = rs.find((r) => r.type === "uniform");
    const mark = (abs ? (abs.duration && abs.duration !== "whole" ? "½" : "A") : "") + (late ? "L" : "") + (uni ? "U" : "");
    const cls = abs ? "bg-red-500 text-white" : late ? "bg-amber-400 text-amber-950" : uni ? "bg-violet-500 text-white" : weekend(d) ? "bg-slate-100 text-slate-300 hover:bg-slate-200" : "text-slate-300 hover:bg-blue-50";
    const tip = rs.length ? rs.map((r) => `${r.type === "absent" ? `Absent: ${r.kind}` : r.type === "uniform" ? "No proper uniform" : `Late${r.minutes ? ` ${r.minutes} min` : ""}`}${r.remarks ? ` (${r.remarks})` : ""}`).join("; ") : "Click to tag";
    return `<td class="px-px py-0.5"><button data-act="att-cell" data-pid="${esc(x.id)}" data-date="${d}" title="${esc(x.name)} · ${fmtDay(d)}: ${esc(tip)}"
      class="min-w-[1.5rem] h-7 px-px rounded text-[11px] font-extrabold transition ${cls} ${d === today ? "ring-2 ring-blue-500" : ""}">${mark || "·"}</button></td>`;
  };
  const sumOf = (x) => attendanceSummary(Object.values(idx[x.id] || {}).flat())[0] || { days: 0, lates: 0, uniform: 0 };
  return `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <input id="mon-month" type="month" data-act="mon-month" value="${m}" title="Month" class="${inputCls}">
      ${attFilters("Search name")}
    </div>
    <div class="flex flex-wrap items-center gap-3 mb-3 text-xs text-slate-600">
      <span class="inline-flex items-center gap-1.5"><span class="w-5 h-5 rounded bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center">A</span>Absent</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-5 h-5 rounded bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center">½</span>Half day absent</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-5 h-5 rounded bg-amber-400 text-amber-950 text-[10px] font-extrabold flex items-center justify-center">L</span>Late</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-5 h-5 rounded bg-violet-500 text-white text-[10px] font-extrabold flex items-center justify-center">U</span>No proper uniform</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-5 h-5 rounded bg-slate-100 border border-slate-200"></span>Weekend</span>
      <span class="text-slate-500">Click a day to tag or edit it.</span>
    </div>
    ${panel(panelHead(`${fmtMonth(m)} · ${people.length} personnel`) + (people.length ? `<div class="overflow-x-auto"><table class="text-sm border-collapse">
      <thead class="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>
        <th class="sticky left-0 z-10 bg-slate-50 text-left font-bold px-3 py-2 min-w-[160px]">Name</th>
        ${days.map((d) => `<th class="font-bold px-0 py-1 w-6 text-center ${weekend(d) ? "text-slate-300" : ""}"><div>${"SMTWTFS"[parseDay(d).getDay()]}</div><div class="tabular text-[11px] ${d === today ? "text-blue-700" : "text-slate-700"}">${Number(d.slice(8))}</div></th>`).join("")}
        <th class="font-bold px-2 py-2 text-center text-red-700">Abs</th><th class="font-bold px-2 py-2 text-center text-amber-700">Late</th><th class="font-bold px-2 py-2 text-center text-violet-700" title="Days without proper uniform">Unif</th>
      </tr></thead>
      <tbody class="divide-y divide-black/10">${people.map((x) => {
        const s = sumOf(x);
        return `<tr><td class="sticky left-0 z-10 bg-white px-3 py-1.5"><div class="font-semibold text-slate-900 text-xs whitespace-nowrap">${esc(x.name)}</div><div class="text-[10px] text-slate-500">${PTYPE[x.type]}</div></td>
          ${days.map((d) => cell(x, d)).join("")}
          <td class="px-2 text-center tabular text-xs font-bold text-red-700">${s.days || "—"}</td><td class="px-2 text-center tabular text-xs font-bold text-amber-700">${s.lates || "—"}</td><td class="px-2 text-center tabular text-xs font-bold text-violet-700">${s.uniform || "—"}</td></tr>`;
      }).join("")}</tbody></table></div>` : empty("No one matches.")))}`;
}

// Tag from the daily sheet or the month grid: edit what's there, or start a new record for that person and day.
function tagAttendance(pid, date, type) {
  const existing = recsOn(pid, date).find((r) => !type || r.type === type);
  if (existing) return openAttendance(existing.id);
  openAttendance("", { pid, date, type: type || "absent" });
}
function confirmAttClear(pid) {
  const d = state.mon.day;
  const rs = recsOn(pid, d).filter((r) => r.type !== "uniform");
  if (!rs.length) return;
  const x = state.personnel[pid];
  openModal(`<div class="p-6 space-y-3">
    <h3 class="text-lg font-bold text-slate-900">Mark as present?</h3>
    <p class="text-sm text-slate-600">This removes the ${rs.map((r) => (r.type === "absent" ? "absence" : "late")).join(" and ")} record for <strong>${esc(x ? x.name : rs[0].name)}</strong> on ${fmtDay(d)}.</p>
  </div>
  <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
    <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
    <button data-act="att-clear-yes" data-pid="${esc(pid)}" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow">Mark present</button>
  </div>`);
}
async function clearAttendance(pid) {
  try {
    const b = writeBatch(db);
    recsOn(pid, state.mon.day).filter((r) => r.type !== "uniform").forEach((r) => b.delete(doc(db, "attendance", r.id)));
    await b.commit();
    closeModal();
    toast("Marked present");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function attRecords() {
  const f = state.mon;
  const all = Object.values(state.attendance);
  const recs = all
    .filter((r) => !f.ptype || r.ptype === f.ptype)
    .filter((r) => !f.q || String(r.name).toLowerCase().includes(f.q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || byName(a, b));
  const sum = attendanceSummary(recs);
  const days = sum.reduce((n, s) => n + s.days, 0);
  const lates = sum.reduce((n, s) => n + s.lates, 0);
  const uniform = sum.reduce((n, s) => n + s.uniform, 0);
  return `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <input id="mon-month" type="month" data-act="mon-month" value="${f.month}" title="Month" class="${inputCls}">
      <input id="mon-q" data-act="mon-q" value="${esc(f.q)}" placeholder="Search name" class="${inputCls} flex-1 min-w-[160px]">
      ${selectBox("mon-ptype", "mon-ptype", [["", "All personnel"], ["teaching", "Teaching"], ["nonteaching", "Non-teaching"]], f.ptype)}
      <button data-act="att-new" class="${btnDark}"><i data-lucide="plus" class="w-4 h-4"></i>Record attendance</button>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      ${statTile("Days absent", days, "bg-red-50 text-red-900 border-red-200")}
      ${statTile("Times late", lates, "bg-amber-50 text-amber-900 border-amber-300")}
      ${statTile("Days without proper uniform", uniform, "bg-violet-50 text-violet-900 border-violet-200")}
      ${statTile("Personnel on list", Object.keys(state.personnel).length, "bg-brand-900 text-white border-brand-950")}
    </div>
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <div class="xl:col-span-2 min-w-0">${panel(panelHead(`Absences, tardiness and uniform · ${fmtMonth(f.month)}`) + (recs.length
        ? table(["Date", "Name", "Record", "Remarks", ""], recs.map((r) => `<tr>
            <td class="px-4 py-3 whitespace-nowrap tabular text-xs font-semibold text-slate-700">${fmtDay(r.date, { weekday: "short", month: "short", day: "numeric" })}</td>
            <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(r.name)}</div><div class="text-xs text-slate-500">${PTYPE[r.ptype] || ""}</div></td>
            <td class="px-4 py-3">${attRecord(r)}</td>
            <td class="px-4 py-3 text-xs text-slate-600 max-w-[260px] whitespace-pre-line">${esc(r.remarks) || "—"}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">${iconBtn("att-edit", r.id, "pencil", "Edit")}${delBtn("attendance", r.id)}</td>
          </tr>`))
        : empty(all.length ? "No records match these filters." : `Nothing recorded for ${fmtMonth(f.month)}.`)))}</div>
      <div class="min-w-0">${panel(panelHead("Summary per person") + (sum.length
        ? table(["Name", "Absent", "Late", "Uniform"], sum.map((s) => `<tr>
            <td class="px-4 py-2.5"><div class="font-semibold text-slate-900">${esc(s.name)}</div><div class="text-[11px] text-slate-500">${PTYPE[s.ptype] || ""}</div></td>
            <td class="px-4 py-2.5 tabular text-xs font-bold text-red-700 whitespace-nowrap">${s.days ? `${s.days} day${s.days === 1 ? "" : "s"}` : "—"}</td>
            <td class="px-4 py-2.5 tabular text-xs font-bold text-amber-700 whitespace-nowrap">${s.lates ? `${s.lates}×${s.minutes ? ` · ${fmtMins(s.minutes)}` : ""}` : "—"}</td>
            <td class="px-4 py-2.5 tabular text-xs font-bold text-violet-700 whitespace-nowrap">${s.uniform ? `${s.uniform} day${s.uniform === 1 ? "" : "s"}` : "—"}</td>
          </tr>`))
        : empty("Nothing recorded.")))}</div>
    </div>`;
}

// pre: { pid, date, type } to start a new record for someone (daily sheet, month grid).
function openAttendance(id, pre = {}) {
  const r = id ? state.attendance[id] : null;
  const pick = r ? r.pid : pre.pid;
  const day = r ? r.date : pre.date || todayIso();
  const people = Object.values(state.personnel).sort(byName);
  if (!people.length && !r) return toast("No personnel yet. People appear once they create an account.", "warn");
  const type = r ? r.type : pre.type || "absent";
  const group = (pt) => {
    const list = people.filter((p) => p.type === pt);
    return list.length ? `<optgroup label="${PTYPE[pt]}">${list.map((p) => `<option value="${esc(p.id)}" ${pick === p.id ? "selected" : ""}>${esc(p.name)}${p.position ? ` · ${esc(p.position)}` : ""}</option>`).join("")}</optgroup>` : "";
  };
  const typeBtn = (k, text, icon) => `<label class="cursor-pointer">
    <input type="radio" name="att-type" value="${k}" data-act="att-type" ${type === k ? "checked" : ""} class="sr-only peer">
    <span class="flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-bold transition border-slate-200 text-slate-500 peer-checked:border-brand-800 peer-checked:bg-brand-50 peer-checked:text-brand-900"><i data-lucide="${icon}" class="w-4 h-4"></i>${text}</span></label>`;
  const kinds = ABSENCE_KINDS.slice();
  if (r && r.kind && !kinds.includes(r.kind)) kinds.push(r.kind);
  openModal(`${modalHead(r ? "Edit attendance record" : "Record attendance", "Human Resource · Attendance monitoring")}
    <div class="p-6 space-y-4">
      <div>${lbl("att-pid", "Name")}
        <select id="att-pid" class="w-full ${inputCls}">
          <option value="">Choose teacher or non-teaching personnel…</option>
          ${r && !state.personnel[r.pid] ? `<option value="${esc(r.pid)}" selected>${esc(r.name)} (removed from list)</option>` : ""}
          ${group("teaching")}${group("nonteaching")}
        </select></div>
      <div class="grid grid-cols-3 gap-2">${typeBtn("absent", "Absent", "user-x")}${typeBtn("late", "Late / Tardy", "clock")}${typeBtn("uniform", "No uniform", "shirt")}</div>
      <div id="att-absent" class="space-y-3 ${type === "absent" ? "" : "hidden"}">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${field("att-from", r ? "Date" : "Date (from)", "date", `value="${day}"`)}
          ${r ? "" : field("att-to", 'To <span class="font-normal text-slate-400">(if more than 1 day)</span>', "date")}
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>${lbl("att-kind", "Kind of absence")}<select id="att-kind" class="w-full ${inputCls}"><option value="">Choose…</option>${kinds.map((k) => `<option ${r && r.kind === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></div>
          <div>${lbl("att-duration", "Duration")}${selectBox("att-duration", "", Object.entries(DURATION).map(([k, [t]]) => [k, t]), r && r.duration ? r.duration : "whole", "w-full")}</div>
        </div>
        ${r ? "" : `<p class="text-[11px] text-slate-500">For several days, also set <strong>To</strong>. Saturdays and Sundays in between are skipped.</p>`}
      </div>
      <div id="att-late" class="space-y-2 ${type === "late" ? "" : "hidden"}">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${field("att-date", "Date", "date", `value="${day}"`)}
          ${field("att-time", "Time in", "time", `data-act="att-time" value="${r ? esc(r.timeIn || "") : ""}"`)}
        </div>
        <div id="att-late-calc" class="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">${lateText(r ? r.timeIn : "", r && !r.timeIn ? r.minutes : 0)}</div>
      </div>
      <div id="att-uniform" class="space-y-2 ${type === "uniform" ? "" : "hidden"}">
        ${field("att-udate", "Date", "date", `value="${day}"`)}
        <p class="text-[11px] text-slate-500">Did not wear the proper uniform on this day. Counted per day in the monthly report.</p>
      </div>
      <div>${lbl("att-remarks", 'Remarks <span class="font-normal text-slate-400">(optional)</span>')}
        <textarea id="att-remarks" rows="3" maxlength="500" placeholder="e.g. With approved leave form · fever · heavy traffic" class="w-full ${inputCls} resize-y">${esc(r ? r.remarks : "")}</textarea></div>
    </div>
    ${r ? `<div class="px-6 pb-3"><button data-act="mon-del" data-col="attendance" data-id="${esc(id)}" class="text-xs font-semibold text-red-700 hover:underline">Delete this record</button></div>` : ""}
    ${modalFoot("att-save", r ? "Save changes" : "Save record", id || "")}`);
}

async function saveAttendance(id) {
  const old = id ? state.attendance[id] : null;
  const pid = val("att-pid");
  const person = state.personnel[pid] || (old && old.pid === pid ? { name: old.name, type: old.ptype } : null);
  if (!person) return toast("Choose a name.", "warn");
  const type = (document.querySelector("input[name=att-type]:checked") || {}).value;
  const base = { pid, name: person.name, ptype: person.type, type, remarks: val("att-remarks").slice(0, 500), by: state.user.email, updatedAt: serverTimestamp() };
  let dates;
  if (type === "absent") {
    const from = val("att-from"), to = val("att-to") || from;
    if (!isDay(from)) return toast("Pick the date of absence.", "warn");
    if (!isDay(to) || to < from) return toast("The To date must be on or after the From date.", "warn");
    if (from === to) dates = [from];
    else {
      dates = [];
      for (let d = from; d <= to; d = addDays(d, 1)) { const wd = parseDay(d).getDay(); if (wd !== 0 && wd !== 6) dates.push(d); }
      if (!dates.length) return toast("Those dates are all on a weekend.", "warn");
      if (dates.length > 31) return toast("Record at most 31 school days at a time.", "warn");
    }
    const kind = val("att-kind");
    if (!kind) return toast("Choose the kind of absence.", "warn");
    Object.assign(base, { kind, duration: val("att-duration") || "whole", timeIn: "", minutes: 0 });
  } else if (type === "late") {
    const date = val("att-date");
    if (!isDay(date)) return toast("Pick the date.", "warn");
    const timeIn = val("att-time");
    // Older records saved minutes without a time in; keep those when the time isn't given.
    const minutes = timeIn ? minutesLate(timeIn) : old && old.type === "late" ? old.minutes : 0;
    if (!timeIn && !minutes) return toast("Enter the time in.", "warn");
    if (!(minutes > 0)) return toast(`${fmtTime(timeIn)} is not late. Class starts at ${fmtTime(SCHOOL_START)}.`, "warn");
    dates = [date];
    Object.assign(base, { kind: "", duration: "", timeIn, minutes: Math.min(minutes, 600) });
  } else if (type === "uniform") {
    const date = val("att-udate");
    if (!isDay(date)) return toast("Pick the date.", "warn");
    if (recsOn(pid, date).some((r) => r.type === "uniform" && r.id !== id)) return toast("Already recorded for that day.", "warn");
    dates = [date];
    Object.assign(base, { kind: "", duration: "", timeIn: "", minutes: 0 });
  } else {
    return toast("Choose Absent, Late or No uniform.", "warn");
  }
  try {
    if (id) {
      await updateDoc(doc(db, "attendance", id), { ...base, ...demoMark(), date: dates[0] });
    } else {
      const b = writeBatch(db);
      dates.forEach((d) => b.set(doc(collection(db, "attendance")), { ...base, ...demoMark(), date: d, createdAt: serverTimestamp() }));
      await b.commit();
    }
    closeModal();
    toast(id ? "Record updated" : `Saved: ${person.name} · ${type === "absent" ? `absent ${dates.length > 1 ? `${dates.length} days` : fmtDay(dates[0])}` : type === "uniform" ? "no proper uniform" : "late"}`);
    // Show the month the record went into.
    const m = dates[0].slice(0, 7);
    if (m !== state.mon.month) { state.mon.month = m; watchAttendance(); render(); }
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- AOR: cleanest classroom per week, 1st–3rd per grade level (School Clinic) -----
const GRADES = ["7", "8", "9", "10", "11", "12"];
// A week's results by grade: { "7": { first, second, third }, … }. Older ratings had one top 3 for the
// whole school; those rooms are sorted into grades by the "Grade N" in their name.
function aorGrades(w) {
  if (w && w.grades) return w.grades;
  const out = {};
  PLACES.forEach(([k]) => {
    const room = String((w && w[k]) || "").trim();
    const g = (room.match(/grade\s*(\d{1,2})/i) || [])[1];
    if (room && GRADES.includes(g)) (out[g] ||= {})[k] = room;
  });
  return out;
}
function aorRanking(weeks, grade) {
  const m = {};
  for (const w of weeks) {
    const res = aorGrades(w)[grade] || {};
    PLACES.forEach(([k, , , pts], i) => {
      const room = String(res[k] || "").trim();
      if (!room) return;
      const r = (m[room.toLowerCase()] ||= { room, counts: [0, 0, 0], points: 0 });
      r.counts[i]++;
      r.points += pts;
    });
  }
  return Object.values(m).sort((a, b) => b.points - a.points || b.counts[0] - a.counts[0] || a.room.localeCompare(b.room));
}
const ratedGrades = (w) => GRADES.filter((g) => (aorGrades(w)[g] || {}).first);

function monAor() {
  const now = mondayOf(todayIso());
  const wk = state.mon.aorWeek || now;
  const g0 = state.mon.aorGrade || "7";
  const weeks = Object.values(state.aor).filter((w) => isDay(w.week)).sort((a, b) => b.week.localeCompare(a.week));
  const cur = state.aor[wk];
  const res = aorGrades(cur);
  const done = cur ? ratedGrades(cur).length : 0;
  const rank = aorRanking(weeks, g0).slice(0, 10);
  const card = (g) => {
    const r = res[g] || {};
    return `<div class="bg-brand-50 rounded-[10px] border border-black/10 shadow-sm p-4">
      <div class="flex items-center justify-between"><h4 class="font-bold text-brand-950">Grade ${g}</h4>${r.first ? "" : `<span class="text-[11px] text-slate-400">Not rated</span>`}</div>
      <ol class="mt-2 space-y-1.5 text-sm">${PLACES.map(([k, text, medal]) => `<li class="flex items-center gap-2"><span>${medal}</span>
        ${r[k] ? `<span class="font-semibold text-slate-900 truncate">${esc(r[k])}</span>` : `<span class="text-slate-400">${text} —</span>`}</li>`).join("")}</ol>
    </div>`;
  };
  return `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <div class="inline-flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
        <button data-act="aor-wk" data-step="-7" title="Previous week" class="px-2.5 py-2 hover:bg-slate-50"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
        <span class="px-2 text-xs font-bold text-slate-700 whitespace-nowrap tabular">Week of ${fmtWeek(wk)}</span>
        <button data-act="aor-wk" data-step="7" title="Next week" class="px-2.5 py-2 hover:bg-slate-50"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
      </div>
      ${wk !== now ? `<button data-act="aor-wk-now" class="${btnLight}">This week</button>` : ""}
      <span class="text-sm ${done === GRADES.length ? "text-emerald-700 font-semibold" : "text-slate-500"}">${done} of ${GRADES.length} grade levels rated</span>
      <div class="flex-1"></div>
      <button data-act="aor-edit" data-id="${wk}" class="${btnDark}"><i data-lucide="${cur ? "pencil" : "trophy"}" class="w-4 h-4"></i>${cur ? "Edit this week" : "Rate this week"}</button>
      ${cur ? delBtn("aor", wk) : ""}
    </div>
    ${cur && cur.remarks ? `<p class="text-sm text-slate-600 mb-3"><strong>Remarks:</strong> ${esc(cur.remarks)}</p>` : ""}
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">${GRADES.map(card).join("")}</div>
    ${panel(panelHead("Overall standing", `<span class="text-[11px] text-slate-500">All rated weeks · 1st = 3 pts · 2nd = 2 · 3rd = 1</span>`) + `
      <div class="px-5 pb-3 flex flex-wrap gap-1.5">${GRADES.map((g) => `<button data-act="aor-grade" data-g="${g}" class="px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${g === g0 ? "bg-depedGold-500 text-white border-depedGold-500" : "border-black/10 text-brand-600 hover:bg-brand-100"}">Grade ${g}</button>`).join("")}</div>` + (rank.length
      ? table(["Rank", "Classroom", "🥇", "🥈", "🥉", "Pts"], rank.map((r, i) => `<tr>
          <td class="px-4 py-2.5 tabular text-xs font-bold text-slate-500">${i + 1}</td>
          <td class="px-4 py-2.5 font-semibold text-slate-900">${esc(r.room)}</td>
          ${r.counts.map((c) => `<td class="px-4 py-2.5 tabular text-xs text-slate-600">${c || "—"}</td>`).join("")}
          <td class="px-4 py-2.5 tabular text-sm font-extrabold text-brand-900">${r.points}</td>
        </tr>`))
      : empty(`No Grade ${g0} classroom placed yet.`)))}`;
}

function openAor(week) {
  const w = isDay(week) ? mondayOf(week) : mondayOf(todayIso());
  const res = aorGrades(state.aor[w]);
  const all = Object.values(state.aor);
  const roomsOf = (g) => [...new Set(all.flatMap((x) => PLACES.map(([k]) => (aorGrades(x)[g] || {})[k]).filter(Boolean)))].sort();
  openModal(`${modalHead("AOR · Cleanest classroom", "School Clinic · top 3 classrooms per grade level this week")}
    <div class="p-6 space-y-4">
      <div>${lbl("aor-week", "Any day of the week")}
        <input id="aor-week" type="date" data-act="aor-week" value="${w}" class="w-full ${inputCls}">
        <p id="aor-week-label" class="text-xs font-semibold text-brand-900 mt-1">Week of ${fmtWeek(w)}</p></div>
      <p class="text-xs text-slate-500">Fill in the grade levels you rated. 2nd and 3rd place are optional.</p>
      ${GRADES.map((g) => `<fieldset class="rounded-lg border border-black/10 p-3">
        <legend class="px-1 text-sm font-bold text-brand-950">Grade ${g}</legend>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          ${PLACES.map(([k, text, medal]) => `<div><label for="aor-${g}-${k}" class="block text-[11px] font-semibold text-slate-600 mb-0.5">${medal} ${text}</label>
            <input id="aor-${g}-${k}" list="aor-rooms-${g}" maxlength="80" value="${esc((res[g] || {})[k] || "")}" placeholder="Grade ${g} – section" class="w-full ${inputCls}"></div>`).join("")}
        </div>
        <datalist id="aor-rooms-${g}">${roomsOf(g).map((x) => `<option value="${esc(x)}"></option>`).join("")}</datalist>
      </fieldset>`).join("")}
      <div>${lbl("aor-remarks", 'Remarks <span class="font-normal text-slate-400">(optional)</span>')}
        <textarea id="aor-remarks" rows="2" maxlength="300" class="w-full ${inputCls} resize-y">${esc((state.aor[w] || {}).remarks || "")}</textarea></div>
    </div>
    ${modalFoot("aor-save", "Save ratings")}`);
}

function aorWeekChanged(value) {
  if (!isDay(value)) return;
  const w = mondayOf(value);
  $("#aor-week-label").textContent = `Week of ${fmtWeek(w)}`;
  const r = state.aor[w];
  if (!r) return; // keep whatever was typed
  const res = aorGrades(r);
  GRADES.forEach((g) => PLACES.forEach(([k]) => { $(`#aor-${g}-${k}`).value = (res[g] || {})[k] || ""; }));
  $("#aor-remarks").value = r.remarks || "";
}

async function saveAor() {
  const day = val("aor-week");
  if (!isDay(day)) return toast("Pick the week.", "warn");
  const week = mondayOf(day);
  const grades = {};
  for (const g of GRADES) {
    const [first, second, third] = PLACES.map(([k]) => val(`aor-${g}-${k}`).replace(/\s+/g, " ").slice(0, 80));
    if (!first && !second && !third) continue;
    if (!first) return toast(`Grade ${g}: enter the 1st place classroom.`, "warn");
    if (third && !second) return toast(`Grade ${g}: fill in 2nd place before 3rd.`, "warn");
    const named = [first, second, third].filter(Boolean).map((x) => x.toLowerCase());
    if (new Set(named).size !== named.length) return toast(`Grade ${g}: a classroom can only take one place.`, "warn");
    grades[g] = { first, second, third };
  }
  if (!Object.keys(grades).length) return toast("Enter the 1st place classroom for at least one grade level.", "warn");
  try {
    await setDoc(doc(db, "aor", aorDocId(week)), { week, grades, remarks: val("aor-remarks").slice(0, 300), by: state.user.email, updatedAt: serverTimestamp(), ...demoMark() });
    state.mon.aorWeek = week;
    closeModal();
    toast(`Saved: week of ${fmtWeek(week)} · ${Object.keys(grades).length} grade level${Object.keys(grades).length === 1 ? "" : "s"}`);
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- ILAW lesson plan, weekly (Head / Master Teachers, per subject area, per teacher) -----
const dllTeachers = (s) => Object.values(state.personnel).filter((x) => x.type === "teaching" && x.subject === s).sort(byName);
function dllCurrent(pid) {
  const old = state.dll[`${state.mon.week}_${pid}`] || {};
  const d = state.dllDrafts[pid] || {};
  return { status: d.status !== undefined ? d.status : old.status || "", remarks: d.remarks !== undefined ? d.remarks : old.remarks || "", old };
}
function dllChanges() {
  return Object.keys(state.dllDrafts).filter((pid) => {
    const c = dllCurrent(pid);
    return c.status !== (c.old.status || "") || c.remarks.trim() !== (c.old.remarks || "");
  });
}
function dllDiscardOk() {
  return !dllChanges().length || confirm("You have unsaved ILAW changes. Discard them?");
}
function setDllWeek(w) {
  if (!isDay(w) || w === state.mon.week) return render();
  if (!dllDiscardOk()) return render();
  state.mon.week = w;
  watchDll();
  render();
}

function monDll() {
  const subs = state.perms.subjects;
  if (!subs.length) return panel(empty("No subject areas are assigned to you yet. Ask an admin to add them under Staff access."));
  if (!subs.includes(state.mon.subject)) state.mon.subject = subs[0];
  const s = state.mon.subject, w = state.mon.week;
  const teachers = dllTeachers(s);
  const changed = new Set(dllChanges());
  const count = (k) => teachers.filter((t) => dllCurrent(t.id).status === k).length;
  const seg = (t, c) => Object.entries(DLL_STATUS).map(([k, st]) => `<label class="cursor-pointer">
      <input type="radio" class="sr-only" name="dll-${t.id}" value="${k}" data-act="dll-status" data-pid="${esc(t.id)}" ${c.status === k ? "checked" : ""}>
      <span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${c.status === k ? st.cls : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}">${st.label}</span></label>`).join("");
  return `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      ${selectBox("dll-subject", "dll-subject", subs.map((x) => [x, x]), s)}
      <div class="inline-flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
        <button data-act="dll-week" data-step="-7" title="Previous week" class="px-2.5 py-2 hover:bg-slate-50"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
        <span class="px-2 text-xs font-bold text-slate-700 whitespace-nowrap tabular">Week of ${fmtWeek(w)}</span>
        <button data-act="dll-week" data-step="7" title="Next week" class="px-2.5 py-2 hover:bg-slate-50"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
      </div>
      <input id="dll-week-pick" type="date" data-act="dll-week-pick" value="${w}" title="Jump to a week" class="${inputCls}">
      ${w !== mondayOf(todayIso()) ? `<button data-act="dll-today" class="${btnLight}">This week</button>` : ""}
      <span class="flex-1"></span>
      ${teachers.length ? `<button data-act="dll-all-ontime" class="${btnLight}"><i data-lucide="check-check" class="w-4 h-4"></i>Mark unchecked as on time</button>
      <button data-act="dll-save" ${changed.size ? "" : "disabled"} class="${btnDark} ${changed.size ? "" : "opacity-40 cursor-not-allowed"}"><i data-lucide="save" class="w-4 h-4"></i>Save${changed.size ? ` (${changed.size})` : ""}</button>` : ""}
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      ${statTile("On time", count("ontime"), "bg-emerald-50 text-emerald-900 border-emerald-300")}
      ${statTile("Late", count("late"), "bg-amber-50 text-amber-900 border-amber-300")}
      ${statTile("Not submitted", count("missing"), "bg-red-50 text-red-900 border-red-200")}
      ${statTile("Not checked yet", count(""), "bg-slate-100 text-slate-800 border-slate-300")}
    </div>
    ${panel(panelHead(`${esc(s)} teachers · ${teachers.length}`) + (teachers.length
      ? table(["Teacher", "ILAW this week", "Remarks"], teachers.map((t) => {
          const c = dllCurrent(t.id);
          return `<tr class="${changed.has(t.id) ? "bg-amber-50/70" : ""}">
            <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(t.name)}</div><div class="text-xs text-slate-500">${esc(t.position) || "Teacher"}</div></td>
            <td class="px-4 py-3"><div class="flex flex-wrap gap-1.5">${seg(t, c)}</div></td>
            <td class="px-4 py-3"><input id="dll-r-${esc(t.id)}" data-act="dll-remarks" data-pid="${esc(t.id)}" value="${esc(c.remarks)}" maxlength="300" placeholder="Remarks (optional)" class="w-full min-w-[180px] text-xs px-2.5 py-2 rounded-md border border-slate-300 focus:ring-1 focus:ring-blue-500"></td>
          </tr>`;
        }))
      : empty(`No ${esc(s)} teachers yet. Teachers appear here once they create an account with subject area ${esc(s)}.`)))}`;
}

function markAllOnTime() {
  let n = 0;
  for (const t of dllTeachers(state.mon.subject)) {
    if (!dllCurrent(t.id).status) { (state.dllDrafts[t.id] ||= {}).status = "ontime"; n++; }
  }
  if (!n) return toast("Every teacher already has a status.", "warn");
  render();
  toast(`${n} marked on time. Click Save to keep it.`);
}

async function saveDll() {
  const s = state.mon.subject, w = state.mon.week;
  const pids = dllChanges();
  if (!pids.length) return toast("Nothing to save.", "warn");
  const b = writeBatch(db);
  let n = 0;
  for (const pid of pids) {
    const t = state.personnel[pid];
    if (!t) continue;
    const c = dllCurrent(pid);
    if (!c.status) return toast(`Pick a status for ${t.name} first.`, "warn");
    b.set(doc(db, "dll", `${w}_${pid}`), { week: w, pid, name: t.name, subject: s, status: c.status, remarks: c.remarks.trim().slice(0, 300), by: state.user.email, updatedAt: serverTimestamp(), ...demoMark() });
    n++;
  }
  try {
    await b.commit();
    state.dllDrafts = {};
    render();
    toast(`Saved ${n} ILAW record${n === 1 ? "" : "s"}`);
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Personnel list -----
// Everyone who creates an account is on it, with the position they chose. HR can correct an entry;
// Head / Master Teachers see the teachers in their subject areas.
const canEditPerson = () => state.perms.hr;

function monPersonnel() {
  const p = state.perms, f = state.mon;
  const all = Object.values(state.personnel).filter((x) => p.hr || (x.type === "teaching" && p.subjects.includes(x.subject)));
  const list = all
    .filter((x) => !f.ptype || x.type === f.ptype)
    .filter((x) => !f.q || `${x.name} ${x.position || ""} ${x.subject || ""} ${x.office || ""}`.toLowerCase().includes(f.q.toLowerCase()))
    .sort(byName);
  const n = (t) => all.filter((x) => x.type === t).length;
  return `
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <input id="mon-q" data-act="mon-q" value="${esc(f.q)}" placeholder="Search name, position, subject or office" class="${inputCls} flex-1 min-w-[180px]">
      ${p.hr ? selectBox("mon-ptype", "mon-ptype", [["", "All personnel"], ["teaching", "Teaching"], ["nonteaching", "Non-teaching"]], f.ptype) : ""}
    </div>
    <p class="text-xs text-slate-500 mb-3"><i data-lucide="info" class="w-3.5 h-3.5 inline -mt-0.5"></i>
      People appear here when they <strong class="text-slate-700">create an account</strong> and choose their position.${p.hr ? "" : ` Showing teachers in your subject areas: <strong class="text-slate-700">${esc(p.subjects.join(", "))}</strong>.`}</p>
    ${p.hr ? `<div class="grid grid-cols-2 gap-3 mb-5 max-w-md">
        ${statTile("Teaching", n("teaching"), "bg-blue-50 text-blue-900 border-blue-200")}
        ${statTile("Non-teaching", n("nonteaching"), "bg-emerald-50 text-emerald-900 border-emerald-300")}
      </div>` : ""}
    ${panel(panelHead("Personnel list", `<span class="text-[11px] text-slate-500">Used by Attendance and the ILAW lesson plan check</span>`) + (list.length
      ? table(["Name", "Type", "Position", "Subject area / Office", ""], list.map((x) => `<tr>
          <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(x.name)}</div>${x.email ? `<div class="text-xs text-slate-500">${esc(x.email)}</div>` : ""}</td>
          <td class="px-4 py-3 text-xs">${chip(PTYPE[x.type] || "—", x.type === "teaching" ? "bg-blue-50 text-blue-800 border-blue-200" : "bg-emerald-50 text-emerald-800 border-emerald-200")}</td>
          <td class="px-4 py-3 text-xs text-slate-700">${esc(x.position) || "—"}</td>
          <td class="px-4 py-3 text-xs text-slate-600">${esc(x.subject || x.office) || "—"}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap">${canEditPerson() ? iconBtn("person-edit", x.id, "pencil", "Edit") + delBtn("personnel", x.id) : ""}</td>
        </tr>`))
      : empty(all.length ? "No one matches." : "No one yet. Personnel appear here once they create an account.")))}`;
}

function openPerson(id) {
  const x = state.personnel[id];
  if (!x) return;
  const all = [...POSITIONS.teaching, ...POSITIONS.nonteaching];
  const position = all.includes(x.position) ? x.position : "";
  openModal(`${modalHead("Edit personnel", esc(x.email || ""))}
    <div class="p-6 space-y-3">
      ${field("person-name", "Full name", "text", `value="${esc(x.name)}" maxlength="120"`)}
      ${positionFields("person", position, position ? x.subject || x.office || "" : "")}
      ${x.position && !position ? `<p class="text-[11px] text-amber-700">Was: ${esc(x.position)}. Choose the matching position from the list.</p>` : ""}
    </div>
    ${modalFoot("person-save", "Save changes", id)}`);
}

async function savePerson(id) {
  const name = val("person-name").replace(/\s+/g, " ");
  const position = val("person-position"), dept = val("person-dept");
  if (!name) return toast("Enter the name.", "warn");
  const err = positionError(position, dept);
  if (err) return toast(err, "warn");
  const type = positionType(position);
  try {
    await updateDoc(doc(db, "personnel", id), {
      name: name.slice(0, 120), type, position,
      subject: type === "teaching" && SUBJECTS.includes(dept) ? dept : "",
      office: type === "nonteaching" ? dept : "",
      by: state.user.email, updatedAt: serverTimestamp(), ...demoMark()
    });
    closeModal();
    toast("Saved");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Staff access (admins) -----
function monAccess() {
  const list = Object.values(state.monitors).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  const reqs = Object.values(state.requests).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  const accessChips = (m) => `<div class="flex flex-wrap gap-1">${PERM_LABELS.filter(([k]) => m[k]).map(([, t]) => chip(t, "bg-brand-50 text-brand-900 border-brand-200")).join("")}</div>`;
  const subjectsOf = (m) => (m.dll && (m.subjects || []).length ? esc(m.subjects.join(", ")) : "—");
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <p class="text-sm text-slate-600 max-w-2xl">Choose who can open Monitoring. People who sign up as HR, School Clinic or Head / Master Teacher appear under <strong>Waiting for approval</strong>. Admins already have full access.</p>
      <button data-act="access-new" class="${btnDark}"><i data-lucide="user-plus" class="w-4 h-4"></i>Add staff</button>
    </div>
    ${reqs.length ? `<div class="mb-5 rounded-xl border-2 border-amber-300 overflow-hidden">${panel(panelHead(`<span class="inline-flex items-center gap-2"><i data-lucide="hourglass" class="w-4 h-4 text-amber-600"></i>Waiting for approval · ${reqs.length}</span>`)
      + table(["Name", "Asked for", "Subject areas", ""], reqs.map((r) => `<tr class="bg-amber-50/40">
          <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(r.name) || "—"}</div><div class="text-xs text-slate-500">${esc(r.id)}${r.position ? ` · ${esc(r.position)}` : ""}</div></td>
          <td class="px-4 py-3">${accessChips(r)}</td>
          <td class="px-4 py-3 text-xs text-slate-600">${subjectsOf(r)}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap">
            <button data-act="access-edit" data-id="${esc(r.id)}" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition"><i data-lucide="check" class="w-3.5 h-3.5"></i>Approve</button>
            <button data-act="mon-del" data-col="accessRequests" data-id="${esc(r.id)}" class="ml-1 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition">Decline</button>
          </td>
        </tr>`)))}</div>` : ""}
    ${panel(panelHead("Staff with Monitoring access") + (list.length
      ? table(["Name", "Access", "Subject areas", ""], list.map((m) => `<tr>
          <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(m.name) || "—"}</div><div class="text-xs text-slate-500">${esc(m.id)}</div></td>
          <td class="px-4 py-3">${accessChips(m)}</td>
          <td class="px-4 py-3 text-xs text-slate-600">${subjectsOf(m)}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap">${iconBtn("access-edit", m.id, "pencil", "Edit")}${delBtn("monitors", m.id)}</td>
        </tr>`))
      : empty("No staff yet. Add the HR personnel, the School Clinic and the Head / Master Teachers.")))}`;
}

// Edit someone's access, or approve a request (the form starts with what they asked for).
function openAccess(id) {
  const req = id && !state.monitors[id] ? state.requests[id] : null;
  const m = id ? state.monitors[id] || req : null;
  openModal(`${modalHead(req ? "Approve staff access" : m ? "Edit staff access" : "Add staff access", req ? "Check the access they asked for, then approve" : "Monitoring")}
    <div class="p-6 space-y-3">
      ${field("access-email", "Email", "email", `value="${esc(m ? m.id : "")}" ${m ? "disabled" : ""} placeholder="name@deped.gov.ph"`)}
      ${field("access-name", "Name", "text", `value="${esc(m ? m.name : "")}" maxlength="120"`)}
      ${roleFields("access", m)}
    </div>
    ${modalFoot("access-save", req ? "Approve" : "Save access", id || "")}`);
}

async function saveAccess(id) {
  const email = (id || val("access-email")).toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) return toast("Enter a valid email.", "warn");
  const roles = readRoles("access");
  if (typeof roles === "string") return toast(roles, "warn");
  const data = { name: val("access-name").slice(0, 120), ...roles, by: state.user.email, updatedAt: serverTimestamp() };
  try {
    const b = writeBatch(db);
    if (isDemoUser() && !isDemoEmail(email)) return toast("The demo account can only give access to demo emails (…@svnhs-demo.ph).", "warn");
    b.set(doc(db, "monitors", email), { ...data, ...demoMark() });
    if (state.requests[email]) b.delete(doc(db, "accessRequests", email));
    await b.commit();
    closeModal();
    toast(`Access saved for ${data.name || email}`);
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Delete (any Monitoring record) -----
const DEL_TEXT = {
  attendance: "this attendance record",
  aor: "this week's cleanest classroom ratings",
  personnel: "this person from the list. Their attendance and ILAW records stay. If they still have an account, they're asked for their position again the next time they sign in",
  monitors: "this staff member's Monitoring access",
  accessRequests: "this access request. They stay a regular user and can ask again"
};
function confirmMonDelete(col, id) {
  if (!DEL_TEXT[col]) return;
  openModal(`<div class="p-6 space-y-3">
    <div class="w-11 h-11 rounded-full bg-red-100 text-red-600 flex items-center justify-center"><i data-lucide="trash-2" class="w-5 h-5"></i></div>
    <h3 class="text-lg font-bold text-slate-900">Delete?</h3>
    <p class="text-sm text-slate-600">This removes ${DEL_TEXT[col]}. It can't be undone.</p>
  </div>
  <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
    <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
    <button data-act="mon-del-yes" data-col="${col}" data-id="${esc(id)}" class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow">Delete</button>
  </div>`);
}
async function doMonDelete(col, id) {
  if (!DEL_TEXT[col]) return;
  try {
    await deleteDoc(doc(db, col, col === "aor" ? aorDocId(id) : id));
    closeModal();
    toast("Deleted");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ---------- Reports page ----------
function renderReports() {
  const p = state.perms, r = state.rep;
  const range = (k) => `<div class="grid grid-cols-2 gap-2">
      <div>${lbl(`rep-${k}-0`, "From")}<input id="rep-${k}-0" type="date" data-act="rep-date" data-k="${k}" data-i="0" value="${r[k][0]}" class="w-full ${inputCls}"></div>
      <div>${lbl(`rep-${k}-1`, "To")}<input id="rep-${k}-1" type="date" data-act="rep-date" data-k="${k}" data-i="1" value="${r[k][1]}" class="w-full ${inputCls}"></div>
    </div>
    <div class="flex flex-wrap gap-1.5">${[["week", "This week"], ["month", "This month"], ["lastmonth", "Last month"], ["sy", "School year"]].map(([id, t]) =>
      `<button data-act="rep-preset" data-k="${k}" data-p="${id}" class="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600">${t}</button>`).join("")}</div>`;
  const card = (kind, icon, color, title, text, inner) => `<div class="bg-white rounded-[10px] border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl ${color} flex items-center justify-center flex-shrink-0"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
        <div><h3 class="text-base font-bold text-slate-900">${title}</h3><p class="text-xs text-slate-500">${text}</p></div>
      </div>
      ${inner}
      <button data-act="rep-gen" data-kind="${kind}" class="mt-auto inline-flex items-center justify-center gap-2 py-3 rounded-lg bg-depedGold-500 hover:bg-depedGold-600 text-white text-sm font-bold shadow-sm transition-colors"><i data-lucide="printer" class="w-4 h-4"></i>Generate report</button>
    </div>`;
  const cards = [];
  if (p.hr) cards.push(card("att", "calendar-x", "bg-red-50 text-red-700", "Monthly Attendance Report",
    "Per teacher and non-teaching personnel: absences, tardiness in minutes and hours, and days without the proper uniform.",
    `<div>${lbl("rep-att-month", "Month")}<input id="rep-att-month" type="month" data-act="rep-month" value="${r.att[0].slice(0, 7)}" class="w-full ${inputCls}"></div>
    <div>${lbl("rep-att-type", "Personnel")}${selectBox("rep-att-type", "rep-type", [["", "Teaching and non-teaching"], ["teaching", "Teaching only"], ["nonteaching", "Non-teaching only"]], r.attType, "w-full")}</div>`));
  if (p.clinic) cards.push(card("aor", "sparkles", "bg-emerald-50 text-emerald-700", "AOR · Cleanest Classroom",
    "1st, 2nd and 3rd place per grade level (7–12) each week, plus the standing per grade.", range("aor")));
  if (p.dll) cards.push(card("dll", "book-open-check", "bg-blue-50 text-blue-700", "ILAW · Lesson Plan",
    "Weekly ILAW submissions per subject area and per teacher: on time, late, not submitted.",
    `${range("dll")}<div>${lbl("rep-dll-subject", "Subject area")}${selectBox("rep-dll-subject", "rep-subject",
      p.subjects.length > 1 ? [["", "All my subject areas"], ...p.subjects.map((s) => [s, s])] : p.subjects.map((s) => [s, s]), r.dllSubject, "w-full")}</div>`));
  main.innerHTML = `${pageHead("Reports", "printer", "Each report opens in a new tab. Print it or save it as PDF.")}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">${cards.join("")}</div>`;
}

async function generateMonReport(kind) {
  const [from, to] = state.rep[kind] || [];
  if (!isDay(from) || !isDay(to) || to < from) return toast("Pick a valid From and To date.", "warn");
  // Open the tab right away so pop-up blockers allow it, then fill it.
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups for this site to open the report.", "warn");
  w.document.write('<p style="font:14px system-ui,sans-serif;padding:24px;color:#475569">Preparing report…</p>');
  try {
    const rows = async (col, field, a, b) => {
      const snap = await getDocs(query(collection(db, col), ...(col === "attendance" || col === "dll" ? demoOnly(where(field, ">=", a), where(field, "<=", b)) : [where(field, ">=", a), where(field, "<=", b)])));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    };
    let html;
    if (kind === "att") html = buildAttendanceReport(await rows("attendance", "date", from, to), from, to, state.rep.attType);
    else if (kind === "aor") html = buildAorReport(from, to);
    else {
      const subs = state.rep.dllSubject && state.perms.subjects.includes(state.rep.dllSubject) ? [state.rep.dllSubject] : state.perms.subjects;
      html = buildDllReport(await rows("dll", "week", mondayOf(from), to), from, to, subs);
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch (e) {
    w.close();
    toast(errorText(e), "error");
  }
}

// ----- Printable report pages -----
const stat = (v, l) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
const rptTable = (heads, rows) => (rows.length
  ? `<table class="movs"><thead><tr>${heads.map((h) => `<th${h === "#" ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`
  : `<div class="empty">None in this period.</div>`);

function reportDoc({ title, subtitle, period, ref, sections, sigs }) {
  const logo = new URL("logo.png", location.href).href;
  const now = new Date().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" });
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(period)}</title>
<link rel="icon" href="${logo}">
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700;800&family=Playfair+Display:ital,wght@0,700;1,600&display=swap" rel="stylesheet">
<style>${REPORT_CSS}</style></head><body>
<div class="toolbar"><span><b>${esc(title)}</b> · ${esc(period)}</span><button onclick="window.print()">Print / Save as PDF</button></div>
<main class="page">
  <header class="doc">
    <img src="${logo}" alt="BLESS seal">
    <div>
      <div class="kicker">Republic of the Philippines · DepEd Region XI · SDO Panabo City</div>
      <div class="school">San Vicente National High School</div>
      <div class="kicker" style="letter-spacing:.06em">Monitoring Report</div>
    </div>
  </header>
  <div class="title">${esc(title)}</div>
  <div class="award">${esc(subtitle)}</div>
  <div class="meta">
    <span>Period: <b>${esc(period)}</b></span>
    <span>Prepared by: <b>${esc(myName())}</b></span>
    <span>Generated: <b>${now}</b></span>
  </div>
  ${sections.map(([h, body], i) => `<section><h2><span class="sn">${i + 1}</span>${h}</h2>${body}</section>`).join("\n  ")}
  <div class="sigs" style="grid-template-columns:repeat(${sigs.length},1fr)">
    ${sigs.map(([n, role]) => `<div class="sig"><div class="line">${n ? esc(n) : "&nbsp;"}</div><div class="role">${role}</div></div>`).join("")}
  </div>
  <footer class="doc"><span>BLESS PRAISE Portal · San Vicente National High School</span><span>${ref}</span></footer>
</main>
</body></html>`;
}

// Monthly attendance: every teacher and non-teaching personnel with their absences, tardiness
// (minutes and hours) and days without the proper uniform, then the details.
function buildAttendanceReport(recs, from, to, ptype) {
  recs = recs.filter((r) => !ptype || r.ptype === ptype).sort((a, b) => a.date.localeCompare(b.date) || byName(a, b));
  const sum = Object.fromEntries(attendanceSummary(recs).map((s) => [s.pid, s]));
  // Everyone on the personnel list, plus anyone with records who was removed since.
  const zero = { days: 0, lates: 0, minutes: 0, uniform: 0 };
  const roster = Object.values(state.personnel).filter((x) => !ptype || x.type === ptype)
    .map((x) => ({ pid: x.id, name: x.name, ptype: x.type, position: x.position || "" }));
  Object.values(sum).forEach((s) => { if (!roster.some((x) => x.pid === s.pid)) roster.push({ pid: s.pid, name: s.name, ptype: s.ptype, position: "" }); });
  const all = roster.map((x) => ({ ...x, ...zero, ...(sum[x.pid] || {}), name: x.name, ptype: x.ptype }));
  const total = (list, k) => list.reduce((n, x) => n + x[k], 0);
  const perfect = all.filter((x) => !x.days && !x.lates && !x.uniform).sort(byName);
  const day = (s) => fmtDay(s, { weekday: "short", month: "short", day: "numeric" });
  const perPerson = (pt) => {
    const list = all.filter((x) => x.ptype === pt).sort(byName);
    if (!list.length) return `<div class="empty">No ${PTYPE[pt].toLowerCase()} personnel on the list.</div>`;
    const cell = (v) => `<td class="mark">${v || "—"}</td>`;
    const tot = (k) => `<td class="mark"><b>${total(list, k) || "—"}</b></td>`;
    return `<table class="movs"><thead><tr><th class="num">#</th><th>Name</th><th>Position</th><th>Days absent</th><th>Times late</th>
      <th>Tardiness (minutes)</th><th>Tardiness (hours)</th><th>Days without proper uniform</th></tr></thead><tbody>
      ${list.map((x, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.position) || "—"}</td>
        ${cell(x.days)}${cell(x.lates)}${cell(x.minutes)}<td class="mark" style="white-space:nowrap">${fmtMins(x.minutes)}</td>${cell(x.uniform)}</tr>`).join("")}
      <tr><td></td><td colspan="2"><b>Total</b></td>${tot("days")}${tot("lates")}${tot("minutes")}
        <td class="mark" style="white-space:nowrap"><b>${fmtMins(total(list, "minutes"))}</b></td>${tot("uniform")}</tr>
      </tbody></table>`;
  };
  const types = ptype ? [ptype] : ["teaching", "nonteaching"];
  const month = from.slice(0, 7);
  return reportDoc({
    title: "Monthly Attendance Report",
    subtitle: ptype ? `${PTYPE[ptype]} personnel` : "Teaching and non-teaching personnel",
    period: fmtMonth(month),
    ref: `ATT-${month.replace("-", "")}${ptype ? "-" + ptype.toUpperCase() : ""}`,
    sections: [
      ["Summary", `<div class="stats">${stat(roster.length, "Personnel")}${stat(total(all, "days"), "Days absent")}${stat(fmtMins(total(all, "minutes")), "Total tardiness")}${stat(total(all, "uniform"), "Days without proper uniform")}</div>`],
      ...types.map((pt) => [`${PTYPE[pt]} Personnel`, perPerson(pt)]),
      ["Absences", rptTable(["#", "Date", "Name", "Kind of absence", "Duration", "Remarks"], recs.filter((r) => r.type === "absent").map((r, i) => `<tr>
        <td class="num">${i + 1}</td><td style="white-space:nowrap">${day(r.date)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.kind) || "—"}</td>
        <td style="white-space:nowrap">${(DURATION[r.duration] || DURATION.whole)[0]}</td><td>${esc(r.remarks) || "—"}</td></tr>`))],
      ["Tardiness", rptTable(["#", "Date", "Name", "Time in", "Minutes late", "Remarks"], recs.filter((r) => r.type === "late").map((r, i) => `<tr>
        <td class="num">${i + 1}</td><td style="white-space:nowrap">${day(r.date)}</td><td><b>${esc(r.name)}</b></td>
        <td style="white-space:nowrap">${fmtTime(r.timeIn) || "—"}</td><td class="mark">${r.minutes || "—"}</td><td>${esc(r.remarks) || "—"}</td></tr>`))],
      ["Without Proper Uniform", rptTable(["#", "Date", "Name", "Remarks"], recs.filter((r) => r.type === "uniform").map((r, i) => `<tr>
        <td class="num">${i + 1}</td><td style="white-space:nowrap">${day(r.date)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.remarks) || "—"}</td></tr>`))],
      ["Perfect Attendance", perfect.length
        ? `<p class="lead">No absence, tardiness or uniform record this month.</p><ol class="names">${perfect.map((x) => `<li>${esc(x.name)} <span class="muted">· ${PTYPE[x.ptype] || ""}</span></li>`).join("")}</ol>`
        : `<div class="empty">None this month.</div>`]
    ],
    sigs: [[myName(), "Prepared by · Human Resource"], ["", "Noted by · School Head"]]
  });
}

function buildAorReport(from, to) {
  const weeks = Object.values(state.aor).filter((w) => isDay(w.week) && w.week >= mondayOf(from) && w.week <= to).sort((a, b) => a.week.localeCompare(b.week));
  const tops = GRADES.map((g) => [g, aorRanking(weeks, g)[0]]).filter(([, t]) => t);
  const gradeSection = (g) => {
    const rank = aorRanking(weeks, g);
    const rows = weeks.filter((w) => (aorGrades(w)[g] || {}).first);
    return [`Grade ${g}`, rptTable(["#", "Week", "🥇 1st", "🥈 2nd", "🥉 3rd"], rows.map((w, i) => { const r = aorGrades(w)[g]; return `<tr>
        <td class="num">${i + 1}</td><td style="white-space:nowrap">${fmtWeek(w.week)}</td>${PLACES.map(([k]) => `<td>${r[k] ? `<b>${esc(r[k])}</b>` : "—"}</td>`).join("")}</tr>`; }))
      + (rank.length ? `<p class="lead" style="margin-top:10px">Standing for Grade ${g} (1st = 3, 2nd = 2, 3rd = 1):</p>` + rptTable(["Rank", "Classroom", "1st", "2nd", "3rd", "Points"], rank.map((r, i) => `<tr>
        <td class="num">${i + 1}</td><td><b>${esc(r.room)}</b></td>${r.counts.map((c) => `<td class="mark">${c || "—"}</td>`).join("")}<td class="mark"><b>${r.points}</b></td></tr>`)) : "")];
  };
  return reportDoc({
    title: "AOR · Cleanest Classroom Report",
    subtitle: "Area of Responsibility · top 3 per grade level, rated weekly by the School Clinic",
    period: periodText(from, to),
    ref: `AOR-${from.replace(/-/g, "")}-${to.replace(/-/g, "")}`,
    sections: [
      ["Summary", `<div class="stats">${stat(weeks.length, "Weeks rated")}${stat(tops.length, "Grade levels with results")}${stat(weeks.reduce((n, w) => n + ratedGrades(w).length, 0), "Grade ratings")}</div>
        ${tops.length ? `<div class="best">Cleanest classroom per grade level: ${tops.map(([g, t]) => `<b>Grade ${g}</b>: ${esc(t.room)} (${t.points} pts)`).join(" · ")}</div>` : ""}`],
      ...GRADES.map(gradeSection)
    ],
    sigs: [[myName(), "Prepared by · School Clinic"], ["", "Noted by · School Head"]]
  });
}

function buildDllReport(recs, from, to, subjects) {
  const weekList = [];
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) weekList.push(w);
  recs = recs.filter((r) => subjects.includes(r.subject) && r.week >= mondayOf(from) && r.week <= to && DLL_STATUS[r.status]);
  let teacherTotal = 0;
  const perSubject = subjects.map((s) => {
    const rows = recs.filter((r) => r.subject === s).sort((a, b) => a.week.localeCompare(b.week) || byName(a, b));
    const people = new Map(dllTeachers(s).map((t) => [t.id, { name: t.name, ontime: 0, late: 0, missing: 0 }]));
    for (const r of rows) {
      if (!people.has(r.pid)) people.set(r.pid, { name: r.name, ontime: 0, late: 0, missing: 0 });
      people.get(r.pid)[r.status]++;
    }
    const list = [...people.values()].sort(byName);
    teacherTotal += list.length;
    const issues = rows.filter((r) => r.status !== "ontime" || r.remarks);
    const body = rptTable(["#", "Teacher", "On time", "Late", "Not submitted", "Weeks checked", "Submitted"], list.map((t, i) => {
      const checked = t.ontime + t.late + t.missing;
      return `<tr><td class="num">${i + 1}</td><td><b>${esc(t.name)}</b></td><td class="mark">${t.ontime || "—"}</td><td class="mark">${t.late || "—"}</td>
        <td class="mark">${t.missing || "—"}</td><td class="mark">${checked} / ${weekList.length}</td><td class="mark">${checked ? Math.round(((t.ontime + t.late) / checked) * 100) + "%" : "—"}</td></tr>`;
    })) + (issues.length ? `<p class="lead" style="margin-top:12px"><b>Late, not submitted, or with remarks</b></p>` + rptTable(["#", "Week", "Teacher", "Status", "Remarks"], issues.map((r, i) => `<tr>
        <td class="num">${i + 1}</td><td style="white-space:nowrap">${fmtWeek(r.week)}</td><td><b>${esc(r.name)}</b></td><td>${DLL_STATUS[r.status].label}</td><td>${esc(r.remarks) || "—"}</td></tr>`)) : "");
    return [esc(s), body];
  });
  return reportDoc({
    title: "ILAW (Lesson Plan) Monitoring Report",
    subtitle: subjects.length === 1 ? `Subject area: ${subjects[0]}` : `Subject areas: ${subjects.join(", ")}`,
    period: periodText(from, to),
    ref: `ILAW-${from.replace(/-/g, "")}-${to.replace(/-/g, "")}`,
    sections: [
      ["Summary", `<div class="stats">${stat(subjects.length, "Subject areas")}${stat(teacherTotal, "Teachers")}${stat(weekList.length, "Weeks in period")}${stat(recs.length, "ILAW checks")}</div>
        <p class="lead">Submitted = (on time + late) ÷ weeks checked.</p>`],
      ...perSubject
    ],
    sigs: [[myName(), "Prepared by · Head Teacher / Master Teacher"], ["", "Noted by · School Head"]]
  });
}

// ----- Guidelines (both roles) -----
function renderGuide() {
  const step = (n, title, text, cls) => `<div class="rounded-xl border p-4 ${cls}"><div class="tabular text-xs font-extrabold opacity-70">STEP ${n}</div><div class="text-sm font-bold mt-0.5">${title}</div><div class="text-xs mt-0.5 opacity-80">${text}</div></div>`;
  const L = (c) => `<span class="text-depedGold-600 font-extrabold">${c}</span>`;
  const objectives = ["Define MOVs per category", "Standardize portfolios", "Speed up validation", "Require authentic evidence",
    "Strengthen accountability", "Support objective decisions", "Improve record-keeping", "Comply with CSC &amp; DepEd"];
  main.innerHTML = `<div class="max-w-4xl mx-auto bg-white rounded-[10px] border border-slate-200 shadow-sm p-6 sm:p-8 space-y-7">
    <div>
      <div class="text-xs font-bold text-depedGold-600 uppercase tracking-widest">DepEd Panabo City</div>
      <h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-1">Program on Awards and Incentives for Service Excellence</h2>
      <p class="text-sm text-slate-700 mt-2"><strong class="text-brand-900">BLESS</strong>: ${L("B")}uilding ${L("L")}eadership, ${L("E")}xcellence &amp; ${L("S")}teadfast ${L("S")}ervice.</p>
    </div>
    <section class="space-y-3">
      <h3 class="text-base font-bold text-brand-900 border-l-4 border-brand-800 pl-3">How it works</h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        ${step(1, "Choose your award", "General MOVs are added automatically.", "bg-blue-50 border-blue-200 text-blue-900")}
        ${step(2, "Put your MOVs in one Drive folder", "Name each file as listed, share the folder, paste its link, click Check files.", "bg-amber-50 border-amber-200 text-amber-900")}
        ${step(3, "Committee verifies", "Watch for the green Verified badge.", "bg-emerald-50 border-emerald-200 text-emerald-900")}
      </div>
      <p class="text-xs text-slate-500">Set Drive files to <strong class="text-slate-700">Anyone with the link can view</strong> so the committee can open them.</p>
    </section>
    <section class="space-y-3">
      <h3 class="text-base font-bold text-brand-900 border-l-4 border-depedGold-500 pl-3">Why</h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-xl p-4 bg-blue-50 border border-blue-200"><div class="text-sm font-bold text-blue-900">Fair</div><div class="text-xs text-slate-600 mt-0.5">Same rules for every category</div></div>
        <div class="rounded-xl p-4 bg-emerald-50 border border-emerald-200"><div class="text-sm font-bold text-emerald-900">Verifiable</div><div class="text-xs text-slate-600 mt-0.5">Every award backed by real MOVs</div></div>
        <div class="rounded-xl p-4 bg-amber-50 border border-amber-200"><div class="text-sm font-bold text-amber-900">Consistent</div><div class="text-xs text-slate-600 mt-0.5">One guide for nominees &amp; validators</div></div>
      </div>
    </section>
    <section class="space-y-3">
      <h3 class="text-base font-bold text-brand-900 border-l-4 border-emerald-600 pl-3">Objectives</h3>
      <div class="flex flex-wrap gap-2">
        ${objectives.map((o) => `<span class="text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200">${o}</span>`).join("")}
      </div>
    </section>
  </div>`;
}

// ---------- Events ----------
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-close]")) return closeModal();
  if (e.target.id === "modal") return closeModal();
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case "home":
      // Logo = home: teachers go to "Choose your award", admins to the applicants list.
      e.preventDefault();
      closeModal();
      Object.assign(state, { tab: state.role === "admin" ? "main" : "home", selected: null, authMode: "login" });
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;
    case "signout": await signOut(auth); break;
    case "tab": state.tab = el.dataset.tab; render(); break;
    case "auth-mode": state.authMode = el.dataset.mode; render(); break;
    case "demo-login": demoLogin(el.dataset.i); break;
    case "verify-continue": {
      await state.user.reload();
      await state.user.getIdToken(true);
      if (auth.currentUser.emailVerified) onUser(auth.currentUser);
      else toast("Not verified yet. Open the link in your email first.", "warn");
      break;
    }
    case "verify-resend":
      try { await sendEmailVerification(state.user); toast("Link sent again."); } catch (err) { toast(errorText(err), "error"); }
      break;
    case "pick":
      if (myAppFor(el.dataset.key)) { state.cur = myAppFor(el.dataset.key).id; state.tab = "main"; render(); window.scrollTo({ top: 0 }); }
      else if (!canPick(el.dataset.key)) toast(myPType() ? `This award is only for ${PTYPE_NAME[awardType(el.dataset.key)]}.` : "Choose your position in My profile first.", "warn");
      else confirmPick(el.dataset.key);
      break;
    case "confirm-pick": if (canPick(el.dataset.key) && !myAppFor(el.dataset.key)) savePick(el.dataset.key); break;
    case "cur-app": state.cur = el.dataset.id; state.folderCheck = null; render(); break;
    case "remove-award": confirmRemoveAward(); break;
    case "remove-award-yes": removeAward(); break;
    case "change-award": state.tab = "home"; render(); window.scrollTo({ top: 0 }); break;
    case "go-award": state.tab = "main"; render(); window.scrollTo({ top: 0 }); break;
    case "check-folder": checkFolder(); break;
    case "copy-name": navigator.clipboard.writeText(el.dataset.text).then(() => toast("File name copied"), () => toast(el.dataset.text)); break;
    case "open-submit": openSubmit(); break;
    case "do-submit": doSubmit(); break;
    case "open": state.selected = el.dataset.uid; window.scrollTo({ top: 0 }); render(); break;
    case "back": state.selected = null; render(); break;
    case "report": generateReport(el.dataset.uid); break;
    case "delete": confirmDelete(el.dataset.uid); break;
    case "do-delete": doDelete(el.dataset.uid); break;
    case "verify-ticked": {
      const app = state.apps[state.selected];
      const map = {};
      checklist(app.award).forEach((r) => { if (hasLink(app.items && app.items[r.key])) map[r.key] = true; });
      if (!Object.keys(map).length) return toast("No links saved yet.", "warn");
      await setVerified(map);
      toast(`${Object.keys(map).length} MOVs verified`);
      break;
    }
    case "save-decision": saveDecision(); break;
    // Monitoring
    case "aor-wk": state.mon.aorWeek = addDays(state.mon.aorWeek || mondayOf(todayIso()), Number(el.dataset.step)); render(); break;
    case "aor-wk-now": state.mon.aorWeek = mondayOf(todayIso()); render(); break;
    case "aor-grade": state.mon.aorGrade = el.dataset.g; render(); break;
    case "mon-view":
      if (state.mon.view === "dll" && !dllDiscardOk()) break;
      if (state.mon.view === "dll") state.dllDrafts = {};
      state.mon.view = el.dataset.view; render(); break;
    case "att-new": openAttendance(); break;
    case "att-mode": state.mon.attMode = el.dataset.mode; render(); break;
    case "att-day": setAttDay(addDays(state.mon.day, Number(el.dataset.step))); break;
    case "att-day-today": setAttDay(todayIso()); break;
    case "att-mark":
      if (el.dataset.mark === "present") confirmAttClear(el.dataset.pid);
      else tagAttendance(el.dataset.pid, state.mon.day, el.dataset.mark);
      break;
    case "att-cell": tagAttendance(el.dataset.pid, el.dataset.date); break;
    case "att-clear-yes": clearAttendance(el.dataset.pid); break;
    case "req-open": openRequest(); break;
    case "profile": openProfile(false); break;
    case "profile-save": saveProfile(); break;
    case "req-save": saveRequest(); break;
    case "req-cancel": cancelRequest(); break;
    case "att-edit": openAttendance(el.dataset.id); break;
    case "att-save": saveAttendance(el.dataset.id); break;
    case "aor-edit": openAor(el.dataset.id); break;
    case "aor-save": saveAor(); break;
    case "dll-week": setDllWeek(addDays(state.mon.week, Number(el.dataset.step))); break;
    case "dll-today": setDllWeek(mondayOf(todayIso())); break;
    case "dll-all-ontime": markAllOnTime(); break;
    case "dll-save": saveDll(); break;
    case "person-edit": openPerson(el.dataset.id); break;
    case "person-save": savePerson(el.dataset.id); break;
    case "access-new": openAccess(); break;
    case "access-edit": openAccess(el.dataset.id); break;
    case "access-save": saveAccess(el.dataset.id); break;
    case "mon-del": confirmMonDelete(el.dataset.col, el.dataset.id); break;
    case "mon-del-yes": doMonDelete(el.dataset.col, el.dataset.id); break;
    case "rep-preset": state.rep[el.dataset.k] = PRESETS[el.dataset.p](); render(); break;
    case "rep-gen": generateMonReport(el.dataset.kind); break;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter" && e.target.id === "delete-confirm") { const b = document.querySelector("[data-act=do-delete]"); if (b) doDelete(b.dataset.uid); }
  if (e.key === "Enter" && e.target.matches("tr[data-act=open]")) e.target.click();
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.act === "folder") { e.preventDefault(); checkFolder(); }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  switch (el.dataset.act) {
    case "verify": setVerified({ [el.dataset.key]: el.checked }); break;
    case "decision": (state.drafts[state.selected] ||= {}).status = el.value; render(); break;
    case "filter": state.filter[el.dataset.f] = el.value; render(); break;
    // Monitoring
    case "mon-month": setAttMonth(el.value); break;
    case "att-day-pick": setAttDay(el.value); break;
    case "pick-position": positionPicked(el.dataset.prefix, el.value); break;
    case "su-role":
      $("#su-subjects").classList.toggle("hidden", el.value !== "dll");
      $("#su-role-note").classList.toggle("hidden", !el.value);
      break;
    case "mon-ptype": state.mon.ptype = el.value; render(); break;
    case "att-type":
      $("#att-absent").classList.toggle("hidden", el.value !== "absent");
      $("#att-late").classList.toggle("hidden", el.value !== "late");
      $("#att-uniform").classList.toggle("hidden", el.value !== "uniform");
      break;
    case "aor-week": aorWeekChanged(el.value); break;
    case "dll-subject":
      if (dllDiscardOk()) { state.mon.subject = el.value; state.dllDrafts = {}; }
      render(); break;
    case "dll-week-pick": if (isDay(el.value)) setDllWeek(mondayOf(el.value)); break;
    case "dll-status": (state.dllDrafts[el.dataset.pid] ||= {}).status = el.value; render(); break;
    case "rep-date": state.rep[el.dataset.k][Number(el.dataset.i)] = el.value; break;
    case "rep-type": state.rep.attType = el.value; break;
    case "rep-month": if (/^\d{4}-\d{2}$/.test(el.value)) state.rep.att = monthRange(el.value); break;
    case "rep-subject": state.rep.dllSubject = el.value; break;
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.act === "remarks") (state.drafts[state.selected] ||= {}).remarks = el.value;
  if (el.dataset.act === "folder") state.folderDraft = el.value;
  if (el.dataset.act === "filter" && el.tagName === "INPUT") { state.filter.q = el.value; render(); }
  if (el.dataset.act === "mon-q") { state.mon.q = el.value; render(); }
  if (el.dataset.act === "dll-remarks") { (state.dllDrafts[el.dataset.pid] ||= {}).remarks = el.value; render(); }
  if (el.dataset.act === "att-time") $("#att-late-calc").innerHTML = lateText(el.value);
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "auth-form") { e.preventDefault(); handleAuthSubmit(e.target); }
});
