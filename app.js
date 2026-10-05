import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, serverTimestamp, writeBatch, Bytes
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { CATEGORIES, AWARD_GROUPS, GENERAL } from "./data.js";

// ---------- Helpers ----------
const $ = (s) => document.querySelector(s);
const main = $("#main");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icons = () => window.lucide && window.lucide.createIcons();
const MAX_PDF_MB = 5;
const hasPdf = (it) => !!(it && it.file && it.file.path);
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
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
    "permission-denied": "You don't have permission to do that.",
    "unavailable": "No internet connection. Check it and try again.",
    "resource-exhausted": "Storage is full for today. Try again tomorrow or tell the admin."
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
    sub: rows.filter((r) => hasPdf(items[r.key])).length,
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
  uploads: {}, uploadKey: null
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
    apps: {}, reviews: {}, selected: null, drafts: {}, tab: "main", unsubs: []
  });
  if (!u) { state.authMode = "login"; return render(); }
  if (!u.emailVerified) return render();

  let isAdmin = false;
  try { isAdmin = (await getDoc(doc(db, "admins", u.email))).exists(); } catch (e) { isAdmin = false; }
  if (state.user !== u) return; // signed out meanwhile
  state.role = isAdmin ? "admin" : "awardee";

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
  else (state.app ? renderAwardee() : renderPicker());
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
  const items = [["main", state.role === "admin" ? "Applicants" : "My Award", state.role === "admin" ? "users" : "award"], ["guide", "Guidelines", "book-open"]];
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
const GROUP_COLORS = {
  blue: { dot: "bg-blue-600", chip: "bg-blue-50 text-blue-800 border-blue-200", hover: "hover:border-blue-400" },
  emerald: { dot: "bg-emerald-600", chip: "bg-emerald-50 text-emerald-800 border-emerald-200", hover: "hover:border-emerald-400" },
  amber: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 border-amber-200", hover: "hover:border-amber-400" }
};

function renderPicker() {
  const changing = !!state.app;
  main.innerHTML = `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-2xl font-bold text-slate-900">${changing ? "Change your award" : "Choose your award"}</h2>
        <p class="text-sm text-slate-500 mt-0.5"><span class="font-semibold text-blue-700">General MOVs</span> (${CATEGORIES[GENERAL].items.length}) are included automatically.</p>
      </div>
      ${changing ? `<button data-act="cancel-change" class="text-sm font-semibold text-slate-600 hover:text-slate-900">Cancel</button>` : ""}
    </div>
    <div class="space-y-8">
      ${AWARD_GROUPS.map((g) => {
        const c = GROUP_COLORS[g.color];
        return `<section>
          <h3 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600 mb-3"><span class="w-2.5 h-2.5 rounded-full ${c.dot}"></span>${g.name}</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${g.keys.map((k) => {
              const a = awardName(k);
              const current = state.app && state.app.award === k;
              return `<button data-act="pick" data-key="${k}" class="text-left bg-white rounded-xl border ${current ? "border-2 border-depedGold-500" : "border-slate-200"} ${c.hover} p-4 shadow-sm hover:shadow transition flex flex-col gap-1.5">
                <span class="text-sm font-bold text-slate-900">${esc(a.name)}</span>
                ${a.local ? `<span class="font-serif italic text-sm text-depedGold-600">${esc(a.local)}</span>` : ""}
                <span class="mt-1 self-start text-[11px] font-bold px-2 py-0.5 rounded-full border ${c.chip}">${CATEGORIES[k].items.length} MOVs</span>
                ${current ? `<span class="text-[11px] font-bold text-depedGold-600">Current choice</span>` : ""}
              </button>`;
            }).join("")}
          </div>
        </section>`;
      }).join("")}
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
    state.picking = false;
    closeModal();
    toast("Award selected. Your MOVs are ready.");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

// ----- Awardee: MOVs checklist -----
function renderAwardee() {
  if (state.picking) return renderPicker();
  const { app, review } = state;
  const st = statusOf(app, review);
  const p = progress(app, review);
  const locked = LOCKED.includes(st);
  const a = awardName(app.award);
  const g = groupOf(app.award);
  const items = app.items || {};
  const ver = (review && review.verified) || {};

  const part = (cat, heading) => {
    const list = CATEGORIES[cat].items;
    const done = list.filter((_, i) => hasPdf(items[`${cat}_${i}`])).length;
    return `<div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
        <h3 class="text-sm font-bold text-slate-800">${heading}</h3>
        <span class="tabular text-[11px] font-bold px-2 py-0.5 rounded-full border ${done === list.length ? "bg-blue-600 text-white border-blue-700" : "bg-blue-50 text-blue-800 border-blue-200"}">${done}/${list.length} uploaded</span>
      </div>
      <div class="divide-y divide-slate-100">
        ${list.map((text, i) => {
          const key = `${cat}_${i}`;
          const it = items[key] || {};
          const ok = ver[key];
          const up = state.uploads[key];
          const has = hasPdf(it);
          let fileUi;
          if (up !== undefined) {
            fileUi = `<div class="flex items-center gap-2">
                <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div id="upbar-${key}" class="h-full rounded-full bg-blue-600 transition-all" style="width:${up}%"></div></div>
                <span id="uppct-${key}" class="tabular text-xs font-bold text-blue-700 w-10 text-right">${up}%</span>
              </div>`;
          } else if (has) {
            fileUi = `<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <button data-act="view" data-uid="${esc(state.user.uid)}" data-key="${key}" class="inline-flex items-center gap-1.5 min-w-0 max-w-full font-semibold text-red-700 hover:underline">
                  <i data-lucide="file-text" class="w-4 h-4 flex-shrink-0"></i><span class="truncate">${esc(it.file.name)}</span></button>
                <span class="text-slate-400 tabular">${fmtSize(it.file.size || 0)}</span>
                ${locked ? "" : `<button data-act="upload" data-key="${key}" class="font-semibold text-blue-700 hover:underline">Replace</button>
                <button data-act="remove" data-key="${key}" class="font-semibold text-slate-500 hover:text-red-700">Remove</button>`}
              </div>`;
          } else {
            fileUi = locked
              ? `<span class="text-xs text-slate-400">No PDF uploaded</span>`
              : `<button data-act="upload" data-key="${key}" class="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border-2 border-dashed border-blue-300 text-blue-700 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-500 transition">
                  <i data-lucide="upload" class="w-3.5 h-3.5"></i>Upload PDF</button>`;
          }
          return `<div class="p-3 sm:px-4 flex gap-3 items-start ${ok ? "bg-emerald-50/60" : ""}">
            <span class="mt-0.5 w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${has ? "bg-blue-600 text-white" : "border-2 border-slate-300 text-transparent"}"><i data-lucide="check" class="w-4 h-4"></i></span>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-slate-800"><span class="tabular font-mono text-xs text-slate-400 mr-1">${i + 1}</span>${esc(text)}</div>
              <div class="mt-1.5">${fileUi}</div>
            </div>
            ${ok
              ? `<span class="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white"><i data-lucide="check-check" class="w-3 h-3"></i>Verified</span>`
              : `<span class="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Pending</span>`}
          </div>`;
        }).join("")}
      </div>
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
        ${bar("Uploaded", p.sub, p.total, BLUE)}
        ${bar("Verified", p.ver, p.total, GREEN)}
        ${!app.submittedAt
          ? `<div class="flex flex-col gap-2 pt-1">
              <button data-act="open-submit" class="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-depedGold-500 to-amber-500 hover:from-depedGold-600 hover:to-amber-600 text-brand-950 text-sm font-bold shadow transition">
                <i data-lucide="send" class="w-4 h-4"></i>Submit for review</button>
              <button data-act="change-award" class="text-xs font-semibold text-slate-500 hover:text-slate-800">Change award</button>
            </div>`
          : `<div class="text-xs text-slate-500 border-t border-slate-100 pt-3">Submitted <strong class="text-slate-700">${fmtDate(app.submittedAt)}</strong>${app.endorser ? ` · endorsed by <strong class="text-slate-700">${esc(app.endorser)}</strong>` : ""}${locked ? "" : `<br><span class="text-sky-700">You can still upload PDFs if the committee asks.</span>`}</div>`}
      </div>
      ${review && review.remarks ? `<div class="rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <div class="text-[11px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5"><i data-lucide="message-square" class="w-3.5 h-3.5"></i>Committee remarks</div>
        <p class="text-sm text-amber-950 mt-1 whitespace-pre-line">${esc(review.remarks)}</p>
      </div>` : ""}
      <div class="rounded-2xl bg-gradient-to-br from-brand-900 to-slate-900 text-white p-4 text-xs">
        <span class="text-blue-300 font-bold">Uploaded</span> + <span class="text-emerald-300 font-bold">Verified</span> = <span class="text-depedGold-400 font-bold">Cleared</span>
        <div class="mt-1.5 text-slate-300"><strong class="text-white">PDF only</strong> · max ${MAX_PDF_MB} MB · one file per MOV</div>
      </div>
    </aside>
    <section class="lg:col-span-8 space-y-5 min-w-0">
      ${part(GENERAL, "General MOVs")}
      ${part(app.award, esc(a.name) + " MOVs")}
    </section>
  </div>`;
}

// ----- PDF files -----
// PDFs are stored in Firestore (free plan): split into chunks of raw bytes.
//   pdfs/{uid}/movs/{movKey}            -> { name, size, chunks, uploadedAt }
//   pdfs/{uid}/movs/{movKey}/chunks/{n} -> { data: Bytes }
const CHUNK_BYTES = 900000;
const movDoc = (uid, key) => doc(db, "pdfs", uid, "movs", key);
const chunkDoc = (uid, key, n) => doc(db, "pdfs", uid, "movs", key, "chunks", String(n));

function pickPdf(key) {
  state.uploadKey = key;
  const input = $("#pdf-input");
  input.value = "";
  input.click();
}

function setUploadProgress(key, pct) {
  state.uploads[key] = pct;
  const barEl = document.getElementById("upbar-" + key);
  const pctEl = document.getElementById("uppct-" + key);
  if (barEl) barEl.style.width = pct + "%";
  if (pctEl) pctEl.textContent = pct + "%";
}

async function uploadPdf(key, file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return toast("Only PDF files are allowed.", "warn");
  if (file.size > MAX_PDF_MB * 1048576) {
    return toast(`That PDF is ${fmtSize(file.size)}. The limit is ${MAX_PDF_MB} MB. Compress it first (e.g. ilovepdf.com).`, "warn");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return toast("That file isn't a real PDF. Save or export it as PDF first.", "warn");

  const uid = state.user.uid;
  const old = (state.app.items || {})[key];
  const oldChunks = hasPdf(old) ? old.file.chunks || 0 : 0;
  const chunks = Math.ceil(bytes.length / CHUNK_BYTES);
  setUploadProgress(key, 0);
  render();
  try {
    for (let n = 0; n < chunks; n++) {
      await setDoc(chunkDoc(uid, key, n), { data: Bytes.fromUint8Array(bytes.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES)) });
      setUploadProgress(key, Math.round(((n + 1) / chunks) * 95));
    }
    const name = file.name.slice(0, 200);
    const batch = writeBatch(db);
    for (let n = chunks; n < oldChunks; n++) batch.delete(chunkDoc(uid, key, n));
    batch.set(movDoc(uid, key), { name, size: bytes.length, chunks, uploadedAt: serverTimestamp() });
    batch.update(doc(db, "applications", uid), {
      [`items.${key}`]: { submitted: true, file: { name, size: bytes.length, chunks, path: `pdfs/${uid}/movs/${key}` } },
      updatedAt: serverTimestamp()
    });
    await batch.commit();
    toast("PDF uploaded");
  } catch (e) {
    toast(errorText(e), "error");
  }
  delete state.uploads[key];
  render();
}

function confirmRemove(key) {
  const it = (state.app.items || {})[key];
  if (!hasPdf(it)) return;
  openModal(`<div class="p-6 space-y-2">
    <h3 class="text-lg font-bold text-slate-900">Remove this PDF?</h3>
    <p class="text-sm text-slate-600"><span class="font-semibold text-red-700">${esc(it.file.name)}</span> will be deleted.</p>
  </div>
  <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
    <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
    <button data-act="do-remove" data-key="${key}" class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow">Remove</button>
  </div>`);
}

async function removePdf(key) {
  const it = (state.app.items || {})[key];
  closeModal();
  if (!hasPdf(it)) return;
  const uid = state.user.uid;
  try {
    const batch = writeBatch(db);
    for (let n = 0; n < (it.file.chunks || 0); n++) batch.delete(chunkDoc(uid, key, n));
    batch.delete(movDoc(uid, key));
    batch.update(doc(db, "applications", uid), { [`items.${key}`]: { submitted: false }, updatedAt: serverTimestamp() });
    await batch.commit();
    toast("PDF removed");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

async function viewPdf(uid, key) {
  // Open the tab first so pop-up blockers allow it, then fill it once the chunks have loaded.
  const w = window.open("", "_blank");
  if (w) w.document.write('<p style="font:14px system-ui,sans-serif;padding:24px;color:#475569">Opening PDF…</p>');
  try {
    const meta = await getDoc(movDoc(uid, key));
    if (!meta.exists()) throw { code: "not-found" };
    const { chunks } = meta.data();
    const parts = [];
    for (let n = 0; n < chunks; n++) {
      const c = await getDoc(chunkDoc(uid, key, n));
      if (!c.exists()) throw { code: "not-found" };
      parts.push(c.data().data.toUint8Array());
    }
    const url = URL.createObjectURL(new Blob(parts, { type: "application/pdf" }));
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) {
    if (w) w.close();
    toast(e && e.code === "not-found" ? "That file is no longer there. Upload it again." : errorText(e), "error");
  }
}

function openSubmit() {
  const p = progress(state.app, state.review);
  const full = p.sub === p.total;
  openModal(`<div class="bg-gradient-to-r from-brand-950 to-brand-900 text-white px-6 py-4 border-b-2 border-depedGold-500">
      <h3 class="text-base font-bold">Submit for review</h3>
      <p class="text-xs text-slate-300">${esc(awardName(state.app.award).name)}</p>
    </div>
    <div class="p-6 space-y-4">
      <div class="text-xs font-bold px-3 py-2 rounded-lg border ${full ? "bg-blue-50 text-blue-800 border-blue-200" : "bg-amber-50 text-amber-800 border-amber-300"}">
        <span class="tabular">${p.sub} of ${p.total}</span> MOVs uploaded${full ? "" : ". You can still submit and add the rest later."}
      </div>
      ${field("submit-endorser", 'Endorsed by <span class="text-red-500">*</span>', "text", `value="${esc(myName())}" maxlength="120"`)}
      <label class="flex items-start gap-3 bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 cursor-pointer">
        <input id="submit-cert" type="checkbox" class="w-4 h-4 mt-0.5 rounded border-slate-300 text-brand-600">
        <span class="text-xs text-amber-950">I certify all MOVs are <strong class="underline decoration-amber-400 decoration-2 underline-offset-2">authentic</strong> and <strong class="underline decoration-amber-400 decoration-2 underline-offset-2">original</strong>, per CSC &amp; DepEd guidelines.</span>
      </label>
    </div>
    <div class="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex justify-end gap-2">
      <button data-close class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
      <button data-act="do-submit" class="px-5 py-2.5 bg-brand-900 hover:bg-brand-950 text-white rounded-lg text-xs font-bold shadow">Confirm &amp; submit</button>
    </div>`);
}

async function doSubmit() {
  const endorser = $("#submit-endorser").value.trim();
  if (!endorser) return toast("Enter who endorses this application.", "warn");
  if (!$("#submit-cert").checked) return toast("Tick the certification box to submit.", "warn");
  try {
    await updateDoc(doc(db, "applications", state.user.uid), { submittedAt: serverTimestamp(), endorser, updatedAt: serverTimestamp() });
    closeModal();
    toast("Submitted to the PRAISE Committee.");
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
          <th class="text-left font-bold px-4 py-2.5">Uploaded</th>
          <th class="text-left font-bold px-4 py-2.5">Verified</th>
          <th class="text-left font-bold px-4 py-2.5">Status</th>
        </tr></thead>
        <tbody class="divide-y divide-slate-100">
          ${rows.map(({ app, st, p }) => `<tr data-act="open" data-uid="${esc(app.uid)}" tabindex="0" class="hover:bg-blue-50/50 cursor-pointer focus:outline-none focus:bg-blue-50">
            <td class="px-4 py-3"><div class="font-semibold text-slate-900">${esc(app.name)}</div><div class="text-xs text-slate-500">${esc(app.dept) || "—"}</div></td>
            <td class="px-4 py-3 text-xs text-slate-700 max-w-[240px]">${esc(awardName(app.award).name)}</td>
            <td class="px-4 py-3 tabular text-xs font-bold text-blue-700">${p.sub}/${p.total}</td>
            <td class="px-4 py-3 tabular text-xs font-bold text-emerald-700">${p.ver}/${p.total}</td>
            <td class="px-4 py-3 whitespace-nowrap">${pill(st)}</td>
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
        return `<div class="p-3 sm:px-4 flex flex-wrap sm:flex-nowrap gap-x-3 gap-y-2 items-center ${ver[key] ? "bg-emerald-50/60" : ""}">
          <div class="flex-1 min-w-[200px] text-sm font-medium text-slate-800"><span class="tabular font-mono text-xs text-slate-400 mr-1">${i + 1}</span>${esc(text)}</div>
          ${hasPdf(it)
            ? `<button data-act="view" data-uid="${esc(app.uid)}" data-key="${key}" title="${esc(it.file.name)}" class="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition">
                <i data-lucide="file-text" class="w-3.5 h-3.5"></i>View PDF <span class="font-normal text-red-500 tabular">${fmtSize(it.file.size || 0)}</span></button>`
            : `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">No PDF</span>`}
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
        ${pill(st)}
        <div class="tabular text-xs"><span class="font-bold text-blue-700">${p.sub}/${p.total} uploaded</span> · <span class="font-bold text-emerald-700">${p.ver}/${p.total} verified</span></div>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <section class="lg:col-span-8 space-y-5 min-w-0">
        <div class="flex justify-end">
          <button data-act="verify-ticked" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 transition">Verify all uploaded</button>
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
        ${step(2, "Upload a PDF per MOV", "One PDF each, up to 5 MB.", "bg-amber-50 border-amber-200 text-amber-900")}
        ${step(3, "Committee verifies", "Watch for the green Verified badge.", "bg-emerald-50 border-emerald-200 text-emerald-900")}
      </div>
      <p class="text-xs text-slate-500">Several pages for one MOV? <strong class="text-slate-700">Combine them into one PDF</strong> before uploading.</p>
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
      if (state.app && state.app.award === el.dataset.key) { state.picking = false; render(); } else confirmPick(el.dataset.key);
      break;
    case "confirm-pick": savePick(el.dataset.key); break;
    case "change-award": state.picking = true; render(); break;
    case "cancel-change": state.picking = false; render(); break;
    case "upload": pickPdf(el.dataset.key); break;
    case "remove": confirmRemove(el.dataset.key); break;
    case "do-remove": removePdf(el.dataset.key); break;
    case "view": viewPdf(el.dataset.uid, el.dataset.key); break;
    case "open-submit": openSubmit(); break;
    case "do-submit": doSubmit(); break;
    case "open": state.selected = el.dataset.uid; window.scrollTo({ top: 0 }); render(); break;
    case "back": state.selected = null; render(); break;
    case "verify-ticked": {
      const app = state.apps[state.selected];
      const map = {};
      checklist(app.award).forEach((r) => { if (hasPdf(app.items && app.items[r.key])) map[r.key] = true; });
      if (!Object.keys(map).length) return toast("No PDFs uploaded yet.", "warn");
      await setVerified(map);
      toast(`${Object.keys(map).length} MOVs verified`);
      break;
    }
    case "save-decision": saveDecision(); break;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter" && e.target.matches("tr[data-act=open]")) e.target.click();
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "pdf-input") {
    if (state.uploadKey && el.files && el.files[0]) uploadPdf(state.uploadKey, el.files[0]);
    state.uploadKey = null;
    return;
  }
  switch (el.dataset.act) {
    case "verify": setVerified({ [el.dataset.key]: el.checked }); break;
    case "decision": (state.drafts[state.selected] ||= {}).status = el.value; render(); break;
    case "filter": state.filter[el.dataset.f] = el.value; render(); break;
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.act === "remarks") (state.drafts[state.selected] ||= {}).remarks = el.value;
  if (el.dataset.act === "filter" && el.tagName === "INPUT") { state.filter.q = el.value; render(); }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "auth-form") { e.preventDefault(); handleAuthSubmit(e.target); }
});
