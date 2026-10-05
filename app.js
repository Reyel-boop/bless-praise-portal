import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { CATEGORIES, AWARD_GROUPS, GENERAL } from "./data.js";

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
  m.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto border border-slate-200">${html}</div>`;
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
const BLUE = { text: "text-blue-700", bar: "bg-blue-600" };
const GREEN = { text: "text-emerald-700", bar: "bg-emerald-500" };

// ---------- State ----------
const state = {
  user: null, role: null, profile: null,
  app: null, review: null, loaded: false,
  apps: {}, reviews: {}, selected: null, drafts: {},
  filter: { q: "", award: "", status: "" },
  tab: "main", authMode: "login", unsubs: [],
  linkDrafts: {}
};
let auth, db;

// ---------- Boot ----------
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
  Object.assign(state, {
    user: u, role: null, profile: null, app: null, review: null, loaded: false,
    apps: {}, reviews: {}, selected: null, drafts: {}, tab: "main", unsubs: [], linkDrafts: {}
  });
  if (!u) { state.authMode = "login"; return render(); }
  if (!u.emailVerified) return render();

  let isAdmin = false;
  try { isAdmin = (await getDoc(doc(db, "admins", u.email))).exists(); } catch (e) { isAdmin = false; }
  if (state.user !== u) return; // signed out meanwhile
  state.role = isAdmin ? "admin" : "awardee";
  state.tab = isAdmin ? "main" : "home";

  if (isAdmin) {
    state.unsubs.push(onSnapshot(collection(db, "applications"), (snap) => {
      state.apps = {};
      snap.forEach((d) => { state.apps[d.id] = { uid: d.id, ...d.data() }; });
      state.loaded = true;
      render();
    }, (e) => toast(errorText(e), "error")));
    state.unsubs.push(onSnapshot(collection(db, "reviews"), (snap) => {
      state.reviews = {};
      snap.forEach((d) => { state.reviews[d.id] = d.data(); });
      render();
    }, (e) => toast(errorText(e), "error")));
  } else {
    try {
      const p = await getDoc(doc(db, "users", u.uid));
      state.profile = p.exists() ? p.data() : null;
    } catch (e) { state.profile = null; }
    let gotApp = false, gotReview = false;
    state.unsubs.push(onSnapshot(doc(db, "applications", u.uid), (d) => {
      state.app = d.exists() ? d.data() : null;
      gotApp = true; state.loaded = gotApp && gotReview; render();
    }, (e) => toast(errorText(e), "error")));
    state.unsubs.push(onSnapshot(doc(db, "reviews", u.uid), (d) => {
      state.review = d.exists() ? d.data() : null;
      gotReview = true; state.loaded = gotApp && gotReview; render();
    }, (e) => toast(errorText(e), "error")));
  }
  render();
}

const myName = () => (state.profile && state.profile.name) || (state.user && state.user.displayName) || (state.user && state.user.email) || "";

// ---------- Rendering ----------
function render() {
  // Keep focus and caret on re-render (live updates can arrive while typing).
  const ae = document.activeElement;
  const keep = ae && ae.id && "value" in ae ? { id: ae.id, s: ae.selectionStart } : null;

  renderHeader();
  if (!state.user) renderAuth();
  else if (!state.user.emailVerified) renderVerify();
  else if (!state.role || !state.loaded) main.innerHTML = `<div class="py-24 text-center text-slate-400 text-sm">Loading your account…</div>`;
  else if (state.tab === "guide") renderGuide();
  else if (state.role === "admin") (state.selected ? renderReview() : renderAdmin());
  else (state.tab === "home" || !state.app ? renderPicker() : renderAwardee());
  icons();

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) { /* not a text input */ } }
  }
}

function renderHeader() {
  const box = $("#userbox");
  const tabs = $("#tabs");
  if (!state.user) { box.innerHTML = ""; tabs.classList.add("hidden"); return; }
  const role = state.role === "admin"
    ? `<span class="px-2 py-0.5 rounded-full bg-depedGold-500 text-brand-950 font-bold text-[10px] uppercase tracking-wider">Admin</span>`
    : state.role === "awardee"
      ? `<span class="px-2 py-0.5 rounded-full bg-white/15 border border-white/20 text-white font-bold text-[10px] uppercase tracking-wider">Awardee</span>`
      : "";
  box.innerHTML = `${role}
    <span class="hidden sm:inline text-slate-200 max-w-[200px] truncate">${esc(myName())}</span>
    <button data-act="signout" class="no-print inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white px-3 py-1.5 rounded-lg font-medium transition">
      <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Sign out</button>`;

  if (!state.role) { tabs.classList.add("hidden"); return; }
  const items = state.role === "admin"
    ? [["main", "Applicants", "users"], ["guide", "Guidelines", "book-open"]]
    : [["home", "Home", "house"], ["main", "My Award", "award"], ["guide", "Guidelines", "book-open"]];
  tabs.classList.remove("hidden");
  tabs.firstElementChild.innerHTML = items.map(([id, label, icon]) => {
    const on = state.tab === id;
    return `<button data-act="tab" data-tab="${id}" class="inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition ${on ? "border-depedGold-500 text-brand-900" : "border-transparent text-slate-500 hover:text-slate-800"}">
      <i data-lucide="${icon}" class="w-4 h-4"></i>${label}</button>`;
  }).join("");
}

function renderSetup() {
  main.innerHTML = `<div class="max-w-xl mx-auto bg-white rounded-2xl border border-amber-300 shadow-sm p-6">
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

function renderAuth() {
  const mode = state.authMode;
  const tab = (m, label) => `<button type="button" data-act="auth-mode" data-mode="${m}" class="flex-1 py-2 text-sm font-semibold rounded-lg transition ${mode === m ? "bg-white text-brand-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}">${label}</button>`;
  let body;
  if (mode === "signup") {
    body = `${field("su-name", "Full name", "text", 'required maxlength="120" placeholder="Juan Dela Cruz" autocomplete="name"')}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${field("su-position", "Position", "text", 'maxlength="120" placeholder="Teacher III"')}
        ${field("su-dept", "Department", "text", 'maxlength="120" placeholder="Science Dept"')}
      </div>
      ${field("su-email", "Email", "email", 'required autocomplete="email" placeholder="name@deped.gov.ph"')}
      ${field("su-pass", "Password", "password", 'required minlength="6" autocomplete="new-password"')}
      <button class="w-full py-2.5 rounded-lg bg-brand-900 hover:bg-brand-950 text-white text-sm font-bold shadow transition">Create account</button>`;
  } else if (mode === "reset") {
    body = `<p class="text-sm text-slate-600">We'll email you a link to set a new password.</p>
      ${field("rs-email", "Email", "email", 'required autocomplete="email"')}
      <button class="w-full py-2.5 rounded-lg bg-brand-900 hover:bg-brand-950 text-white text-sm font-bold shadow transition">Send reset link</button>
      <button type="button" data-act="auth-mode" data-mode="login" class="w-full text-xs font-semibold text-blue-700 hover:underline">Back to sign in</button>`;
  } else {
    body = `${field("li-email", "Email", "email", 'required autocomplete="email"')}
      ${field("li-pass", "Password", "password", 'required autocomplete="current-password"')}
      <button class="w-full py-2.5 rounded-lg bg-brand-900 hover:bg-brand-950 text-white text-sm font-bold shadow transition">Sign in</button>
      <button type="button" data-act="auth-mode" data-mode="reset" class="w-full text-xs font-semibold text-blue-700 hover:underline">Forgot password?</button>`;
  }
  main.innerHTML = `<div class="max-w-md mx-auto py-4">
    <div class="text-center mb-6">
      <h2 class="font-serif text-3xl font-bold text-brand-900">BLESS PRAISE Portal</h2>
      <p class="text-sm text-slate-500 mt-1">Choose your award. Track your <span class="font-bold text-blue-700">MOVs</span>. Get <span class="font-bold text-emerald-700">verified</span>.</p>
    </div>
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
      ${mode === "reset" ? "" : `<div class="flex p-1 bg-slate-100 rounded-xl border border-slate-200 mb-5">${tab("login", "Sign in")}${tab("signup", "Create account")}</div>`}
      <form id="auth-form" data-mode="${mode}" class="space-y-3" novalidate>
        <div id="auth-error" class="hidden text-xs font-semibold text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2"></div>
        ${body}
      </form>
    </div>
  </div>`;
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
      const cred = await createUserWithEmailAndPassword(auth, v("su-email"), form.querySelector("#su-pass").value);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name, position: v("su-position"), dept: v("su-dept"), email: cred.user.email, createdAt: serverTimestamp()
      });
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
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
      <div class="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-3"><i data-lucide="mail-check" class="w-6 h-6"></i></div>
      <h2 class="text-lg font-bold text-slate-900">Verify your email</h2>
      <p class="text-sm text-slate-600 mt-1">We sent a link to <strong class="text-brand-900">${esc(state.user.email)}</strong>.<br>Open it, then tap <strong>Continue</strong>.</p>
      <p class="text-xs text-amber-700 mt-2">Not there? Check <strong>Spam</strong>.</p>
      <div class="mt-5 flex flex-col gap-2">
        <button data-act="verify-continue" class="py-2.5 rounded-lg bg-brand-900 hover:bg-brand-950 text-white text-sm font-bold shadow transition">Continue</button>
        <button data-act="verify-resend" class="py-2 text-xs font-semibold text-blue-700 hover:underline">Resend link</button>
      </div>
    </div>
  </div>`;
}

// ----- Awardee: choose award -----

// Each award is a gradient tile with its own colors and an award-style Material icon (trophy, medal, badge…).
// Class strings are written out in full so the Tailwind CDN generates them.
const AWARD_STYLE = {
  "cat-teach-1": { icon: "emoji_events", tile: "bg-gradient-to-br from-red-500 to-orange-400" },
  "cat-teach-2": { icon: "military_tech", tile: "bg-gradient-to-br from-violet-500 to-fuchsia-500" },
  "cat-teach-3": { icon: "workspace_premium", tile: "bg-gradient-to-br from-sky-500 to-blue-700" },
  "cat-teach-4": { icon: "stars", tile: "bg-gradient-to-br from-indigo-500 to-blue-600" },
  "cat-teach-5": { icon: "verified", tile: "bg-gradient-to-br from-pink-400 to-pink-600" },
  "cat-teach-6": { icon: "star", tile: "bg-gradient-to-br from-emerald-500 to-teal-700" },
  "cat-teach-7": { icon: "local_police", tile: "bg-gradient-to-br from-amber-500 to-orange-600" },
  "cat-nonteach-1": { icon: "auto_awesome", tile: "bg-gradient-to-br from-cyan-500 to-teal-600" },
  "cat-nonteach-2": { icon: "diamond", tile: "bg-gradient-to-br from-lime-600 to-green-700" },
  "cat-nonteach-3": { icon: "verified_user", tile: "bg-gradient-to-br from-rose-500 to-pink-600" },
  "cat-nonteach-4": { icon: "stars", tile: "bg-gradient-to-br from-orange-500 to-amber-600" },
  "cat-special-1": { icon: "local_activity", tile: "bg-gradient-to-br from-fuchsia-500 to-purple-700" },
  "cat-special-2": { icon: "military_tech", tile: "bg-gradient-to-br from-red-600 to-rose-500" }
};

function renderPicker() {
  const app = state.app;
  const locked = !!(app && app.submittedAt);
  main.innerHTML = `
    <div class="flex items-center justify-between gap-3 pb-3 mb-6 border-b border-slate-300">
      <div class="flex items-center gap-3">
        <span class="material-icons text-sky-500 !text-[40px]">emoji_events</span>
        <div>
          <h2 class="text-xl sm:text-2xl text-sky-500 leading-tight">Choose your award</h2>
          <p class="text-sm text-slate-700"><span class="font-semibold text-blue-700">General MOVs</span> (${CATEGORIES[GENERAL].items.length}) are included automatically.</p>
        </div>
      </div>
      ${app ? `<button data-act="go-award" class="flex-shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900">My Award<span class="material-icons !text-[18px]">arrow_forward</span></button>` : ""}
    </div>
    ${locked ? `<div class="mb-5 text-sm font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5">Your award is locked because you already submitted.</div>` : ""}
    <div class="space-y-7">
      ${AWARD_GROUPS.map((g) => `<section>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">${g.name}</h3>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            ${g.keys.map((k) => {
              const a = awardName(k);
              const current = app && app.award === k;
              const st = AWARD_STYLE[k];
              return `<button data-act="pick" data-key="${k}" title="${esc(a.local || a.name)} · ${CATEGORIES[k].items.length} MOVs"
                class="group relative flex flex-col overflow-hidden rounded-md ${st.tile} text-white text-center shadow-sm hover:shadow-lg hover:brightness-105 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500 ${current ? "ring-4 ring-depedGold-400 ring-offset-2" : ""} ${locked && !current ? "opacity-60" : ""}">
                ${current ? `<span class="absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded bg-depedGold-400 text-brand-950">Current</span>` : ""}
                <span class="flex-1 flex items-center justify-center py-7 sm:py-9">
                  <span class="material-icons !text-[52px] sm:!text-[60px] transition group-hover:scale-110">${st.icon}</span>
                </span>
                <span class="flex items-center justify-center min-h-[2.75rem] bg-black/15 px-2 py-2 text-sm sm:text-base leading-snug">${esc(a.name)}</span>
              </button>`;
            }).join("")}
          </div>
        </section>`).join("")}
    </div>`;
}

function confirmPick(key) {
  const a = awardName(key);
  const total = CATEGORIES[GENERAL].items.length + CATEGORIES[key].items.length;
  openModal(`<div class="p-6 space-y-3">
    <h3 class="text-lg font-bold text-slate-900">Apply for this award?</h3>
    <div class="rounded-xl bg-slate-50 border border-slate-200 p-4">
      <div class="font-bold text-brand-900">${esc(a.name)}</div>
      ${a.local ? `<div class="font-serif italic text-sm text-depedGold-600">${esc(a.local)}</div>` : ""}
      <div class="mt-2 text-xs"><span class="font-bold text-blue-700">${total} MOVs</span> to accomplish</div>
    </div>
    <p class="text-xs text-slate-500">You can switch awards <strong class="text-slate-700">until you submit</strong>.</p>
  </div>
  <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
    <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
    <button data-act="confirm-pick" data-key="${key}" class="px-5 py-2.5 bg-brand-900 hover:bg-brand-950 text-white rounded-lg text-xs font-bold shadow">Apply</button>
  </div>`);
}

async function savePick(key) {
  const ref = doc(db, "applications", state.user.uid);
  try {
    if (state.app) {
      await updateDoc(ref, { award: key, updatedAt: serverTimestamp() });
    } else {
      await setDoc(ref, {
        uid: state.user.uid, name: myName(), dept: (state.profile && state.profile.dept) || "",
        award: key, items: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    }
    state.tab = "main";
    closeModal();
    toast("Award selected. Your MOVs are ready.");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Awardee: MOVs checklist -----
// Links must point to Google Drive / Docs.
const savedLink = (key) => ((state.app.items || {})[key] || {}).link || "";
const draftLink = (key) => (state.linkDrafts[key] !== undefined ? state.linkDrafts[key] : savedLink(key));
// Teachers edit freely before submitting; afterwards only when the committee sends it back.
function canEditLinks() {
  if (!state.app.submittedAt) return true;
  const st = statusOf(state.app, state.review);
  return st === "compliance" || st === "incomplete";
}
function linkReadiness() {
  const rows = checklist(state.app.award);
  const ready = rows.filter((r) => isDriveUrl(draftLink(r.key).trim())).length;
  const unsaved = rows.filter((r) => draftLink(r.key).trim() !== savedLink(r.key)).length;
  return { total: rows.length, ready, unsaved, all: ready === rows.length };
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

  const rowState = (key) => {
    const d = draftLink(key).trim(), s = savedLink(key);
    if (d && !isDriveUrl(d)) return `<span class="text-red-700 font-semibold">Not a valid Google Drive link. In Drive, click Share → Copy link, then paste it here.</span>`;
    if (d !== s) return `<span class="text-amber-700 font-semibold">Not saved yet. Click Save.</span>`;
    if (s) return `<span class="text-blue-700 font-semibold inline-flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i>Saved</span>`;
    return `<span class="text-slate-400">No link yet</span>`;
  };

  const part = (cat, heading) => {
    const list = CATEGORIES[cat].items;
    const done = list.filter((_, i) => isDriveUrl(savedLink(`${cat}_${i}`))).length;
    return `<div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
        <h3 class="text-sm font-bold text-slate-800">${heading}</h3>
        <span class="tabular text-[11px] font-bold px-2 py-0.5 rounded-full border ${done === list.length ? "bg-blue-600 text-white border-blue-700" : "bg-blue-50 text-blue-800 border-blue-200"}">${done}/${list.length} saved</span>
      </div>
      <div class="divide-y divide-slate-100">
        ${list.map((text, i) => {
          const key = `${cat}_${i}`;
          const ok = ver[key];
          const d = draftLink(key);
          const s = savedLink(key);
          const dirty = d.trim() !== s;
          const bad = d.trim() && !isDriveUrl(d.trim());
          return `<div class="p-3 sm:px-4 ${ok ? "bg-emerald-50/60" : ""}">
            <div class="flex items-start justify-between gap-3">
              <div class="text-sm font-medium text-slate-800 min-w-0"><span class="tabular font-mono text-xs text-slate-400 mr-1">${i + 1}</span>${esc(text)}</div>
              ${ok
                ? `<span class="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white"><i data-lucide="check-check" class="w-3 h-3"></i>Verified</span>`
                : `<span class="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Pending</span>`}
            </div>
            <div class="mt-2 flex items-center gap-2">
              <input id="link-${key}" data-act="link" data-key="${key}" type="url" value="${esc(d)}" placeholder="Paste Google Drive link" ${editable ? "" : "disabled"}
                class="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-md border ${bad ? "border-red-400 bg-red-50/40" : dirty ? "border-amber-400" : "border-slate-300"} focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500">
              ${editable ? `<button data-act="save-link" data-key="${key}" ${dirty && !bad ? "" : "disabled"}
                class="flex-shrink-0 px-3.5 py-2 rounded-md text-xs font-bold transition ${dirty && !bad ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm" : "bg-slate-100 text-slate-400 cursor-not-allowed"}">Save</button>` : ""}
              ${isDriveUrl(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer" class="flex-shrink-0 text-xs font-semibold text-blue-700 hover:underline">Open</a>` : ""}
            </div>
            <div class="mt-1 text-[11px]">${rowState(key)}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  };

  const submitBox = () => {
    if (app.submittedAt && !reopened) {
      return `<div class="text-xs text-slate-500 border-t border-slate-100 pt-3">Submitted <strong class="text-slate-700">${fmtDate(app.submittedAt)}</strong>${app.endorser ? ` · endorsed by <strong class="text-slate-700">${esc(app.endorser)}</strong>` : ""}
        <br><span class="inline-flex items-center gap-1 mt-1 font-semibold text-slate-600"><i data-lucide="lock" class="w-3 h-3"></i>Links are locked while the committee reviews.</span></div>`;
    }
    return `<div class="flex flex-col gap-2 pt-1">
      ${reopened ? `<div class="text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">The committee reopened your application. Fix the links, then resubmit.</div>` : ""}
      <button data-act="open-submit" ${rd.all ? "" : "disabled"} class="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold shadow transition ${rd.all ? "bg-gradient-to-r from-depedGold-500 to-amber-500 hover:from-depedGold-600 hover:to-amber-600 text-brand-950" : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"}">
        <i data-lucide="${rd.all ? "send" : "lock"}" class="w-4 h-4"></i>${reopened ? "Resubmit" : "Submit for review"}</button>
      <p class="text-[11px] text-center ${rd.all ? "text-emerald-700 font-semibold" : "text-slate-500"}">${rd.all
        ? `All ${rd.total} MOVs have a link.${rd.unsaved ? ` ${rd.unsaved} unsaved will be saved when you submit.` : ""}`
        : `Add a Google Drive link to <strong class="text-slate-700">all ${rd.total} MOVs</strong> to submit. <span class="tabular">${rd.ready}/${rd.total}</span> done.`}</p>
      ${app.submittedAt ? "" : `<button data-act="change-award" class="text-xs font-semibold text-slate-500 hover:text-slate-800">Change award</button>`}
    </div>`;
  };

  main.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <aside class="lg:col-span-4 space-y-4">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-wider text-brand-600">${esc(g.name)}</div>
          <h2 class="text-lg font-bold text-slate-900 leading-snug">${esc(a.name)}</h2>
          ${a.local ? `<div class="font-serif italic text-depedGold-600">${esc(a.local)}</div>` : ""}
          <div class="mt-2">${pill(st)}</div>
        </div>
        ${bar("Saved links", p.sub, p.total, BLUE)}
        ${bar("Verified", p.ver, p.total, GREEN)}
        ${submitBox()}
      </div>
      ${review && review.remarks ? `<div class="rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <div class="text-[11px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5"><i data-lucide="message-square" class="w-3.5 h-3.5"></i>Committee remarks</div>
        <p class="text-sm text-amber-950 mt-1 whitespace-pre-line">${esc(review.remarks)}</p>
      </div>` : ""}
      <div class="rounded-2xl bg-gradient-to-br from-brand-900 to-slate-900 text-white p-4 text-xs">
        <span class="text-blue-300 font-bold">Saved</span> + <span class="text-emerald-300 font-bold">Verified</span> = <span class="text-depedGold-400 font-bold">Cleared</span>
        <div class="mt-1.5 text-slate-300">Google Drive links only. Set sharing to <strong class="text-white">Anyone with the link</strong>.</div>
      </div>
    </aside>
    <section class="lg:col-span-8 space-y-5 min-w-0">
      ${part(GENERAL, "General MOVs")}
      ${part(app.award, esc(a.name) + " MOVs")}
    </section>
  </div>`;
}

async function saveLink(key) {
  if (!canEditLinks()) return toast("Links are locked while the committee reviews.", "warn");
  const v = draftLink(key).trim();
  if (v && !isDriveUrl(v)) return toast("Not a valid Google Drive link. In Drive, click Share → Copy link, then paste it here.", "warn");
  try {
    await updateDoc(doc(db, "applications", state.user.uid), {
      [`items.${key}`]: v ? { submitted: true, link: v } : { submitted: false, link: "" },
      updatedAt: serverTimestamp()
    });
    delete state.linkDrafts[key];
    toast(v ? "Link saved" : "Link removed");
    render();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function openSubmit() {
  const rd = linkReadiness();
  if (!rd.all) return toast(`Add a Google Drive link to all ${rd.total} MOVs first (${rd.ready}/${rd.total} done).`, "warn");
  const again = !!state.app.submittedAt;
  openModal(`<div class="bg-gradient-to-r from-brand-950 to-brand-900 text-white px-6 py-4 border-b-2 border-depedGold-500">
      <h3 class="text-base font-bold">${again ? "Resubmit for review" : "Submit for review"}</h3>
      <p class="text-xs text-slate-300">${esc(awardName(state.app.award).name)}</p>
    </div>
    <div class="p-6 space-y-4">
      <div class="text-xs font-bold px-3 py-2 rounded-lg border bg-blue-50 text-blue-800 border-blue-200">
        All <span class="tabular">${rd.total}</span> MOVs have a link.${rd.unsaved ? ` <span class="text-amber-700">${rd.unsaved} unsaved link${rd.unsaved > 1 ? "s" : ""} will be saved now.</span>` : ""}
      </div>
      ${field("submit-endorser", 'Endorsed by <span class="text-red-500">*</span>', "text", `value="${esc(state.app.endorser || myName())}" maxlength="120"`)}
      <label class="flex items-start gap-3 bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 cursor-pointer">
        <input id="submit-cert" type="checkbox" class="w-4 h-4 mt-0.5 rounded border-slate-300 text-brand-600">
        <span class="text-xs text-amber-950">I certify all MOVs are <strong class="underline decoration-amber-400 decoration-2 underline-offset-2">authentic</strong> and <strong class="underline decoration-amber-400 decoration-2 underline-offset-2">original</strong>, per CSC &amp; DepEd guidelines.</span>
      </label>
      <p class="text-[11px] text-slate-500"><i data-lucide="lock" class="w-3 h-3 inline -mt-0.5"></i> After submitting, links are locked until the committee reviews them.</p>
    </div>
    <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
      <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
      <button data-act="do-submit" class="px-5 py-2.5 bg-brand-900 hover:bg-brand-950 text-white rounded-lg text-xs font-bold shadow">Save all &amp; submit</button>
    </div>`);
}

async function doSubmit() {
  const endorser = $("#submit-endorser").value.trim();
  if (!endorser) return toast("Enter who endorses this application.", "warn");
  if (!$("#submit-cert").checked) return toast("Tick the certification box to submit.", "warn");
  const rd = linkReadiness();
  if (!rd.all) return toast(`Add a Google Drive link to all ${rd.total} MOVs first.`, "warn");
  // Save every link along with the submission, in one write.
  const updates = { submittedAt: serverTimestamp(), endorser, updatedAt: serverTimestamp() };
  for (const r of checklist(state.app.award)) {
    const v = draftLink(r.key).trim();
    if (v !== savedLink(r.key)) updates[`items.${r.key}`] = { submitted: true, link: v };
  }
  try {
    await updateDoc(doc(db, "applications", state.user.uid), updates);
    state.linkDrafts = {};
    closeModal();
    toast("All links saved and submitted to the PRAISE Committee.");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Admin: applicants list -----
function renderAdmin() {
  const all = Object.values(state.apps).map((app) => {
    const review = state.reviews[app.uid];
    return { app, review, st: statusOf(app, review), p: progress(app, review) };
  });
  const f = state.filter;
  const rows = all
    .filter((r) => !f.award || r.app.award === f.award)
    .filter((r) => !f.status || r.st === f.status)
    .filter((r) => !f.q || (r.app.name + " " + r.app.dept).toLowerCase().includes(f.q.toLowerCase()))
    .sort((x, y) => (x.st === "submitted" ? 0 : 1) - (y.st === "submitted" ? 0 : 1) || String(x.app.name).localeCompare(String(y.app.name)));

  const count = (s) => all.filter((r) => r.st === s).length;
  const tile = (label, n, cls) => `<div class="rounded-xl border p-4 ${cls}"><div class="text-[11px] font-bold uppercase tracking-wider opacity-80">${label}</div><div class="tabular text-2xl font-extrabold mt-0.5">${n}</div></div>`;

  main.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      ${tile("Applicants", all.length, "bg-brand-900 text-white border-brand-950")}
      ${tile("Awaiting review", count("submitted"), "bg-blue-50 text-blue-900 border-blue-200")}
      ${tile("For compliance", count("compliance") + count("incomplete"), "bg-amber-50 text-amber-900 border-amber-300")}
      ${tile("Qualified", count("qualified"), "bg-emerald-50 text-emerald-900 border-emerald-300")}
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
        <tbody class="divide-y divide-slate-100">
          ${rows.map(({ app, st, p }) => `<tr data-act="open" data-uid="${esc(app.uid)}" tabindex="0" class="hover:bg-blue-50/50 cursor-pointer focus:outline-none focus:bg-blue-50">
            <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(app.name)}</div><div class="text-xs text-slate-500">${esc(app.dept) || "—"}</div></td>
            <td class="px-4 py-3 text-xs text-slate-700 max-w-[240px]">${esc(awardName(app.award).name)}</td>
            <td class="px-4 py-3 tabular text-xs font-bold text-blue-700">${p.sub}/${p.total}</td>
            <td class="px-4 py-3 tabular text-xs font-bold text-emerald-700">${p.ver}/${p.total}</td>
            <td class="px-4 py-3 whitespace-nowrap">${pill(st)}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap"><button data-act="report" data-uid="${esc(app.uid)}" title="Generate report" class="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-brand-900 hover:bg-brand-950 text-white transition"><i data-lucide="file-text" class="w-3.5 h-3.5"></i>Report</button><button data-act="delete" data-uid="${esc(app.uid)}" title="Delete application" class="ml-1.5 inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 transition"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>Delete</button></td>
          </tr>`).join("")}
        </tbody></table></div>`
      : `<div class="p-10 text-center text-sm text-slate-400">${all.length ? "No applicants match these filters." : "No applicants yet. Teachers appear here once they choose an award."}</div>`}
    </div>`;
}

// ----- Admin: review one applicant -----
function renderReview() {
  const app = state.apps[state.selected];
  if (!app) { state.selected = null; return renderAdmin(); }
  const review = state.reviews[app.uid] || {};
  const draft = state.drafts[app.uid] || (state.drafts[app.uid] = {});
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
            ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">Saved</span>`
            : `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Missing</span>`}
          ${url
            ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>Open</a>`
            : `<span class="text-xs text-slate-400">No link</span>`}
          <label class="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${ver[key] ? "text-emerald-700" : "text-slate-600"}">
            <input type="checkbox" data-act="verify" data-key="${key}" ${ver[key] ? "checked" : ""} class="w-5 h-5 rounded border-2 border-slate-300 text-emerald-600 focus:ring-emerald-500">Verified</label>
        </div>`;
      }).join("")}
    </div>
  </div>`;

  main.innerHTML = `
    <button data-act="back" class="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-900"><i data-lucide="arrow-left" class="w-3.5 h-3.5"></i>All applicants</button>
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5 flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-xl font-bold text-slate-900">${esc(app.name)}</h2>
        <div class="text-sm text-slate-500">${esc(app.dept) || "—"}</div>
        <div class="mt-2 text-sm font-semibold text-brand-900">${esc(a.name)}${a.local ? ` <span class="font-serif italic font-normal text-depedGold-600">· ${esc(a.local)}</span>` : ""}</div>
        <div class="mt-1 text-xs text-slate-500">${app.submittedAt ? `Submitted <strong class="text-slate-700">${fmtDate(app.submittedAt)}</strong>${app.endorser ? ` · endorsed by <strong class="text-slate-700">${esc(app.endorser)}</strong>` : ""}` : `<span class="text-amber-700 font-semibold">Not submitted yet</span>`} · updated ${fmtDate(app.updatedAt)}</div>
      </div>
      <div class="flex flex-col items-end gap-2">
        <button data-act="report" data-uid="${esc(app.uid)}" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-depedGold-500 to-amber-500 hover:from-depedGold-600 hover:to-amber-600 text-brand-950 text-sm font-bold shadow transition"><i data-lucide="file-text" class="w-4 h-4"></i>Generate report</button>
        <button data-act="delete" data-uid="${esc(app.uid)}" class="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 transition"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>Delete application</button>
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
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3 lg:sticky lg:top-28">
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
          <button data-act="save-decision" class="w-full py-2.5 rounded-lg bg-brand-900 hover:bg-brand-950 text-white text-sm font-bold shadow transition">Save decision</button>
          ${review.reviewer ? `<p class="text-[11px] text-slate-400">Last saved by ${esc(review.reviewer)} · ${fmtDate(review.reviewedAt)}</p>` : ""}
        </div>
      </aside>
    </div>`;
}

async function setVerified(map) {
  try {
    await setDoc(doc(db, "reviews", state.selected), { verified: map, updatedAt: serverTimestamp() }, { merge: true });
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
      status, remarks, reviewer: state.user.email, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp()
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

function buildReport(app, review, profile) {
  const a = awardName(app.award);
  const g = groupOf(app.award);
  const st = statusOf(app, review);
  const p = progress(app, review);
  const items = app.items || {};
  const ver = (review && review.verified) || {};
  const pct = (n) => (p.total ? Math.round((n / p.total) * 100) : 0);
  const now = new Date();
  const ref = `BP-${now.getFullYear()}-${String(app.uid).slice(0, 6).toUpperCase()}`;
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
        <td class="link">${url ? `<a href="${esc(url)}">${esc(url)}</a>` : `<span class="muted">${it.link ? "Invalid link (not Google Drive)" : "No link submitted"}</span>`}</td>
        <td class="mark ${ver[key] ? "yes" : "no"}">${ver[key] ? "✔ Verified" : "—"}</td>
      </tr>`;
    }).join("");
    const done = CATEGORIES[cat].items.filter((_, i) => ver[`${cat}_${i}`]).length;
    return `<table class="movs">
      <thead><tr><th class="num">#</th><th>Means of Verification</th><th>Google Drive link</th><th class="mark">Committee check</th></tr></thead>
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
<style>
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
</style></head><body>
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
    const snap = await getDoc(doc(db, "users", uid));
    profile = snap.exists() ? snap.data() : null;
  } catch (e) { profile = null; }
  w.document.open();
  w.document.write(buildReport(app, state.reviews[uid], profile));
  w.document.close();
}

// ----- Guidelines (both roles) -----
function renderGuide() {
  const step = (n, title, text, cls) => `<div class="rounded-xl border p-4 ${cls}"><div class="tabular text-xs font-extrabold opacity-70">STEP ${n}</div><div class="text-sm font-bold mt-0.5">${title}</div><div class="text-xs mt-0.5 opacity-80">${text}</div></div>`;
  const L = (c) => `<span class="text-depedGold-600 font-extrabold">${c}</span>`;
  const objectives = ["Define MOVs per category", "Standardize portfolios", "Speed up validation", "Require authentic evidence",
    "Strengthen accountability", "Support objective decisions", "Improve record-keeping", "Comply with CSC &amp; DepEd"];
  main.innerHTML = `<div class="max-w-4xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-7">
    <div>
      <div class="text-xs font-bold text-depedGold-600 uppercase tracking-widest">DepEd Panabo City</div>
      <h2 class="text-xl sm:text-2xl font-bold text-slate-900 mt-1">Program on Awards and Incentives for Service Excellence</h2>
      <p class="text-sm text-slate-700 mt-2"><strong class="text-brand-900">BLESS</strong>: ${L("B")}uilding ${L("L")}eadership, ${L("E")}xcellence &amp; ${L("S")}teadfast ${L("S")}ervice.</p>
    </div>
    <section class="space-y-3">
      <h3 class="text-base font-bold text-brand-900 border-l-4 border-brand-800 pl-3">How it works</h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        ${step(1, "Choose your award", "General MOVs are added automatically.", "bg-blue-50 border-blue-200 text-blue-900")}
        ${step(2, "Save a Drive link per MOV", "Paste the link, click Save. Submit when all are done.", "bg-amber-50 border-amber-200 text-amber-900")}
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
      if (state.app && state.app.award === el.dataset.key) { state.tab = "main"; render(); }
      else if (state.app && state.app.submittedAt) toast("Your award is locked after submitting.", "warn");
      else confirmPick(el.dataset.key);
      break;
    case "confirm-pick": savePick(el.dataset.key); break;
    case "change-award": state.tab = "home"; render(); window.scrollTo({ top: 0 }); break;
    case "go-award": state.tab = "main"; render(); window.scrollTo({ top: 0 }); break;
    case "save-link": saveLink(el.dataset.key); break;
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
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter" && e.target.id === "delete-confirm") { const b = document.querySelector("[data-act=do-delete]"); if (b) doDelete(b.dataset.uid); }
  if (e.key === "Enter" && e.target.matches("tr[data-act=open]")) e.target.click();
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.act === "link") { e.preventDefault(); saveLink(e.target.dataset.key); }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  switch (el.dataset.act) {
    case "verify": setVerified({ [el.dataset.key]: el.checked }); break;
    case "decision": (state.drafts[state.selected] ||= {}).status = el.value; render(); break;
    case "filter": state.filter[el.dataset.f] = el.value; render(); break;
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.act === "remarks") (state.drafts[state.selected] ||= {}).remarks = el.value;
  if (el.dataset.act === "link") { state.linkDrafts[el.dataset.key] = el.value; render(); }
  if (el.dataset.act === "filter" && el.tagName === "INPUT") { state.filter.q = el.value; render(); }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "auth-form") { e.preventDefault(); handleAuthSubmit(e.target); }
});
