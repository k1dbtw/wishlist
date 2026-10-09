import * as store from "./store.js";
import { h, svg, $, load, save, toast } from "./util.js";
import { DEFAULT_CATS } from "./defaults.js";
import { moneyView } from "./views/money.js";
import { tasksView } from "./views/tasks.js";
import { wishesView } from "./views/wishes.js";
import { openSettings, ACCENTS } from "./views/settings.js";

const ICONS = {
  money: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/></svg>',
  tasks: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-5"/></svg>',
  wishes: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.5 5.3 5.7.7-4.2 3.9 1.1 5.7L12 16.3 6.9 19.1 8 13.4 3.8 9.5l5.7-.7z"/></svg>',
};
const TABS = [["money", "деньги"], ["tasks", "дела"], ["wishes", "хочу"]];
const ERRORS = {
  bad_email: "Похоже, в почте опечатка",
  weak_password: "Пароль должен быть не короче 8 символов",
  email_taken: "Эта почта уже зарегистрирована. Попробуй войти.",
  bad_credentials: "Неверная почта или пароль",
  invite_required: "Нужен код приглашения",
  locked: "Слишком много попыток. Подожди 15 минут.",
};

let me = null, config = { invite: false, legacy: false };
let look = Object.assign({ theme: "auto", accent: ACCENTS[0] }, load("stash.look", {}));

const ctx = {
  email: () => (me && me.email) || "",
  config: () => config,
  cats: (scope) => store.all("cats").filter((c) => !scope || c.scope === scope).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name)),
  cat: (id) => (id ? store.get("cats", id) : null),
  fallbackCat(kind) {
    const list = ctx.cats(kind);
    return (list.find((c) => c.id === (kind === "income" ? "c-other-in" : "c-other")) || list[list.length - 1] || {}).id || null;
  },
  prefs: () => store.get("prefs", "main") || { currency: "UZS", budget: null },
  setPrefs: (patch) => store.put("prefs", { ...ctx.prefs(), ...patch, id: "main" }),
  currency: () => ctx.prefs().currency || "UZS",
  look: () => look,
  setLook(patch) { look = { ...look, ...patch }; save("stash.look", look); applyLook(); },
  logout,
};

function applyLook() {
  const root = document.documentElement;
  root.style.setProperty("--accent", look.accent);
  if (look.theme === "auto") delete root.dataset.theme; else root.dataset.theme = look.theme;
}

// ---------- shell ----------
const views = { money: moneyView(ctx), tasks: tasksView(ctx), wishes: wishesView(ctx) };
let tab = ["money", "tasks", "wishes"].includes(location.hash.slice(1)) ? location.hash.slice(1) : load("stash.tab", "money");
let renderedVer = -1, ready = false;

const syncDot = h("i", { class: "sync", "data-s": "ok" });
const meBtn = h("button", { type: "button", class: "me", "aria-label": "настройки", onclick: () => openSettings(ctx) });
const nav = h("nav", { class: "nav", "aria-label": "разделы" }, TABS.map(([id, label]) =>
  h("button", { type: "button", "data-tab": id, onclick: () => go(id) }, svg(ICONS[id]), h("span", {}, label))));
const viewBox = h("main");
const app = h("div", { class: "wrap", hidden: true },
  h("header", { class: "top" }, h("h1", { class: "mark" }, "stash", syncDot), nav, meBtn),
  viewBox);
const authBox = h("div", { hidden: true });
document.body.append(app, authBox);

function go(id) {
  tab = id; save("stash.tab", id);
  history.replaceState(null, "", "#" + id);
  nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === id ? "page" : "false"));
  viewBox.replaceChildren(views[id].el);
  views[id].render();
  renderedVer = store.getVersion();
  scrollTo({ top: 0 });
}

store.subscribe((s) => {
  if (ready) seedIfNeeded();
  syncDot.dataset.s = s.offline ? "off" : s.pushing || s.pulling ? "busy" : "ok";
  syncDot.title = s.offline ? (s.pending ? `нет связи · ждут отправки: ${s.pending}` : "нет связи") : "синхронизировано";
  if (s.quota) { toast("Достигнут лимит записей. Удали старые или сделай экспорт."); s.quota = false; }
  if (!app.hidden && store.getVersion() !== renderedVer) {
    renderedVer = store.getVersion();
    views[tab].render();
  }
});

// ---------- auth ----------
function showAuth(message) {
  app.hidden = true; authBox.hidden = false;
  let mode = "login";
  const email = h("input", { id: "auth-email", type: "email", placeholder: "почта", autocomplete: "email", required: true, inputMode: "email" });
  const password = h("input", { id: "auth-password", type: "password", placeholder: "пароль", autocomplete: "current-password", required: true, minLength: 8 });
  const invite = h("input", { id: "auth-invite", type: "text", placeholder: "код приглашения", hidden: true, autocomplete: "off" });
  const err = h("p", { class: "err", role: "alert" }, message || "");
  const submit = h("button", { type: "submit", class: "btn" });
  const switchLine = h("p", { class: "switch" });
  const draw = () => {
    submit.textContent = mode === "login" ? "Войти" : "Создать аккаунт";
    password.autocomplete = mode === "login" ? "current-password" : "new-password";
    password.placeholder = mode === "login" ? "пароль" : "пароль, от 8 символов";
    invite.hidden = !(mode === "register" && config.invite);
    switchLine.textContent = "";
    switchLine.append(mode === "login" ? "Ещё нет аккаунта? " : "Уже есть аккаунт? ",
      h("button", { type: "button", onclick: () => { mode = mode === "login" ? "register" : "login"; err.textContent = ""; draw(); } }, mode === "login" ? "Зарегистрироваться" : "Войти"));
  };
  draw();
  const form = h("form", { noValidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = ""; submit.disabled = true;
    try {
      const r = await store.api("POST", mode === "login" ? "/auth/login" : "/auth/register", { email: email.value, password: password.value, invite: invite.value });
      me = r; password.value = "";
      startApp();
    } catch (ex) {
      err.textContent = ERRORS[ex.message] || (ex.status ? "Что-то пошло не так. Попробуй ещё раз." : "Нет связи с сервером");
    } finally { submit.disabled = false; }
  } }, email, password, invite, err, submit);

  authBox.replaceChildren(h("section", { class: "auth" },
    h("h1", { class: "mark" }, "stash"),
    h("p", { class: "pitch" }, "Деньги, дела и желания ", h("b", {}, "в одном тихом месте"), ". Записываешь одной строкой, где бы ни был: телефон и компьютер всегда показывают одно и то же."),
    h("ul", { class: "feats" },
      h("li", {}, h("b", {}, "деньги"), h("span", {}, "«кофе 25к» и готово: категория, дата, графики, бюджет на месяц")),
      h("li", {}, h("b", {}, "дела"), h("span", {}, "мысли и задачи со сроками словами: «завтра», «в пятницу», «#работа»")),
      h("li", {}, h("b", {}, "хочу"), h("span", {}, "вишлист со ссылками и ценами, и сколько месяцев копить на всё"))),
    form, switchLine));
  email.focus();
}

async function startApp() {
  authBox.hidden = true; app.hidden = false;
  meBtn.textContent = (me.email || "?").slice(0, 1);
  go(tab);
  ready = false;
  await store.start({ unauthorized: () => { ready = false; store.reset(); me = null; showAuth("Сессия закончилась, войди ещё раз"); } });
  ready = true;
  seedIfNeeded();
  takeShare();
}

// one-time changes for accounts created by an older version; each runs once per account,
// so a later manual choice (another currency, a deleted category) is kept
const MIGRATION = 5;
function migrate(p) {
  const v = p.cv || 1;
  const patch = { cv: MIGRATION };
  if (v < 2 && p.currency === "RUB") patch.currency = "UZS";
  const def = (id) => DEFAULT_CATS.find((c) => c.id === id);
  if (v < 3 && !store.get("cats", "c-energy")) store.put("cats", def("c-energy"));
  if (v < 4) {
    for (const id of ["c-drinks", "c-gifts"]) if (!store.get("cats", id)) store.put("cats", def(id));
    // coffee now belongs to "Напитки" and presents to "Подарки"; energy drinks move to the top (an earlier version stored them at 0)
    for (const id of ["c-cafe", "c-fun"]) { const c = store.get("cats", id); if (c) store.put("cats", { ...c, keywords: def(id).keywords }); }
    const e = store.get("cats", "c-energy"); if (e && e.order >= 0) store.put("cats", { ...e, order: def("c-energy").order });
  }
  if (v < 5) {
    // "Долги" sits just above "Другое"; milkshakes go to drinks, pastries to cafe
    const other = store.get("cats", "c-other");
    if (!store.get("cats", "c-debt")) store.put("cats", { ...def("c-debt"), order: other ? other.order - 0.5 : def("c-debt").order });
    for (const id of ["c-drinks", "c-cafe"]) { const c = store.get("cats", id); if (c) store.put("cats", { ...c, keywords: def(id).keywords }); }
  }
  store.put("prefs", { ...p, ...patch });
}

// first sign-in on a fresh account: starter categories and preferences
function seedIfNeeded() {
  const s = store.getStatus();
  // accounts created while the default was rubles move to sums once; a later manual choice is kept
  const p = store.get("prefs", "main");
  if (me && !s.offline && !s.pulling && p && (p.cv || 1) < MIGRATION) migrate(p);
  if (!me || s.offline || s.pulling || store.all("cats").length) return;
  for (const c of DEFAULT_CATS) store.put("cats", c);
  if (!store.get("prefs", "main")) store.put("prefs", { id: "main", currency: "UZS", budget: null, cv: MIGRATION });
}

async function logout({ silent } = {}) {
  if (!silent) { try { await store.api("POST", "/auth/logout", {}); } catch {} }
  ready = false; store.reset(); me = null;
  showAuth();
}

// shared from another app: a link goes to the wishlist, plain text to tasks
function takeShare() {
  const sp = new URLSearchParams(location.search);
  const url = sp.get("url") || ((sp.get("text") || "").match(/https?:\/\/\S+/) || [])[0];
  const text = [sp.get("title"), sp.get("text")].filter(Boolean).join(" ").replace(url || "\u0000", "").trim();
  if (!url && !text) return;
  history.replaceState(null, "", location.pathname + location.hash);
  if (url) { go("wishes"); views.wishes.prefill([text, url].filter(Boolean).join(" ")); }
  else { go("tasks"); views.tasks.prefill(text); }
}

// ---------- keyboard ----------
document.addEventListener("keydown", (e) => {
  if (app.hidden || document.querySelector("dialog[open]") || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (!typing && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); go(TABS[+e.key - 1][0]); }
  if (!typing && (e.key === "/" || e.key === "n")) { e.preventDefault(); views[tab].focus(); }
});

// ---------- boot ----------
applyLook();
(async () => {
  try { config = await store.api("GET", "/config"); } catch {}
  try { me = await store.api("GET", "/auth/me"); startApp(); }
  catch (e) {
    // offline with a cached session: open what we have, sync later
    if (!e.status && !store.isEmpty()) { me = load("stash.me", { email: "" }); startApp(); }
    else showAuth();
  }
})();
store.subscribe(() => { if (me && me.email) save("stash.me", { email: me.email }); });

// ---------- updates ----------
let updating = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    const offer = (w) => toast("Доступна новая версия", { label: "обновить", run: () => { updating = true; w.postMessage("skip-waiting"); } });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => {});
  // reload only when the person asked for the update, never on the first install
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (updating) { updating = false; location.reload(); } });
}
