// ---------- dom ----------
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
export const svg = (markup) => { const t = document.createElement("template"); t.innerHTML = markup.trim(); return t.content.firstChild; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const newId = (p = "") => p + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
export const plural = (n, f) => { const a = Math.abs(n) % 10, b = Math.abs(n) % 100; return f[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 1 : 2]; };
export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };

// ---------- storage ----------
export const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const drop = (k) => { try { localStorage.removeItem(k); } catch {} };

// ---------- dates (local calendar days as YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, "0");
export const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dayStr(new Date());
export const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); };
export const diffDays = (a, b) => Math.round((parseDay(a) - parseDay(b)) / 864e5);
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
export const monthName = (m) => MONTHS[m];
export const monthShort = (m) => MONTHS_SHORT[m];
export function dayLabel(s, { withWeekday = true } = {}) {
  const t = today(), d = diffDays(s, t);
  if (d === 0) return "сегодня";
  if (d === -1) return "вчера";
  if (d === 1) return "завтра";
  const x = parseDay(s);
  const base = `${x.getDate()} ${MONTHS_GEN[x.getMonth()]}` + (x.getFullYear() !== new Date().getFullYear() ? ` ${x.getFullYear()}` : "");
  return withWeekday ? `${WD[x.getDay()]}, ${base}` : base;
}

// ---------- money ----------
let fmtCache = {};
export function money(n, cur = "RUB", { sign = false } = {}) {
  const f = (fmtCache[cur] ||= new Intl.NumberFormat("ru-RU", { style: "currency", currency: cur, maximumFractionDigits: 2, minimumFractionDigits: 0 }));
  const s = f.format(Math.abs(n));
  return sign ? (n > 0 ? "+" : n < 0 ? "−" : "") + s : n < 0 ? "−" + s : s;
}
export const shortMoney = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " млн" : n >= 1e3 ? Math.round(n / 1e3) + " тыс" : String(Math.round(n)));

// ---------- parsing a quick-add line ----------
const NUM = String.raw`(\d{1,3}(?:[\s ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`;
const SUFFIX = String.raw`(к|k|тыс\.?|т\.р\.?|₽|р\.?|руб\.?|rub|\$|€|usd|eur)?`;
function toAmount(raw, suf) {
  let n = parseFloat(raw.replace(/[\s ]/g, "").replace(",", "."));
  if (/^(к|k|тыс|т\.р)/i.test(suf || "")) n *= 1000;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
const clean = (s) => s.replace(/\s{2,}/g, " ").replace(/^[\s,—–-]+|[\s,—–-]+$/g, "").trim();

/** dates written in words or as dd.mm: returns [YYYY-MM-DD | null, rest] */
export function takeDate(s, { future = false } = {}) {
  const t = today();
  const rules = [
    [/(?:^|\s)(сегодня)(?=\s|$)/i, () => t],
    [/(?:^|\s)(вчера)(?=\s|$)/i, () => addDays(t, -1)],
    [/(?:^|\s)(позавчера)(?=\s|$)/i, () => addDays(t, -2)],
    [/(?:^|\s)(завтра)(?=\s|$)/i, () => addDays(t, 1)],
    [/(?:^|\s)(послезавтра)(?=\s|$)/i, () => addDays(t, 2)],
    [/(?:^|\s)через\s+(\d{1,3})\s+(?:день|дня|дней)(?=\s|$)/i, (m) => addDays(t, +m[1])],
    [/(?:^|\s)через\s+(неделю)(?=\s|$)/i, () => addDays(t, 7)],
    [/(?:^|\s)(?:в|во)?\s*(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье|пн|вт|ср|чт|пт|сб|вс)(?=\s|$)/i, (m) => {
      const names = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
      const full = { понедельник: "пн", вторник: "вт", среду: "ср", четверг: "чт", пятницу: "пт", субботу: "сб", воскресенье: "вс" };
      const want = names.indexOf(full[m[1].toLowerCase()] || m[1].toLowerCase());
      const now = parseDay(t).getDay();
      let delta = (want - now + 7) % 7;
      if (future) delta = delta || 7; else delta = delta ? delta - 7 : 0;
      return addDays(t, delta);
    }],
    [/(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s|$)/, (m) => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date().getFullYear();
      const d = new Date(y, +m[2] - 1, +m[1]);
      return d.getMonth() === +m[2] - 1 ? dayStr(d) : null;
    }],
  ];
  for (const [re, fn] of rules) {
    const m = s.match(re);
    if (m) { const v = fn(m); if (v) return [v, clean(s.slice(0, m.index) + " " + s.slice(m.index + m[0].length))]; }
  }
  return [null, s];
}

/** "кофе 250", "+80 000 зарплата", "такси 1,2к вчера" */
export function parseTxn(raw, cats) {
  let s = raw.trim(), kind = null;
  if (/^\+/.test(s)) { kind = "income"; s = s.slice(1); }
  else if (/^[-−]/.test(s)) { kind = "expense"; s = s.slice(1); }
  let date; [date, s] = takeDate(s);
  let amount = null;
  const re = new RegExp(String.raw`(?:^|\s)${NUM}\s*${SUFFIX}(?=\s|$)`, "i");
  const m = s.match(re);
  if (m) { amount = toAmount(m[1], m[2]); s = clean(s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)); }
  const note = clean(s);
  const lower = " " + note.toLowerCase();
  if (!kind) kind = cats.some((c) => c.scope === "income" && kwMatch(c, lower)) && !cats.some((c) => c.scope === "expense" && kwMatch(c, lower)) ? "income" : "expense";
  const cat = cats.find((c) => c.scope === kind && kwMatch(c, lower)) || null;
  return { kind, amount, note, date: date || today(), cat: cat && cat.id };
}
function kwMatch(c, lowerText) {
  const words = [c.name, ...(c.keywords || "").split(",")].map((w) => w.trim().toLowerCase()).filter((w) => w.length > 1);
  return words.some((w) => lowerText.includes(" " + w));
}

/** "позвонить маме завтра #личное" */
export function parseTask(raw, cats) {
  let s = raw.trim(), cat = null;
  const tag = s.match(/(?:^|\s)#([\p{L}\d_-]+)/u);
  if (tag) {
    const q = tag[1].toLowerCase();
    const found = cats.find((c) => c.scope === "task" && c.name.toLowerCase().startsWith(q));
    if (found) { cat = found.id; s = clean(s.slice(0, tag.index) + " " + s.slice(tag.index + tag[0].length)); }
  }
  let due; [due, s] = takeDate(s, { future: true });
  return { text: clean(s), cat, due };
}

/** "наушники sony https://… 32к" */
export function parseWish(raw) {
  let s = raw.trim(), url = "", price = null;
  const m = s.match(/https?:\/\/\S+/i);
  if (m) { url = m[0].replace(/[),.]+$/, ""); s = clean(s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)); }
  const p = s.match(new RegExp(String.raw`(?:^|\s)${NUM}\s*${SUFFIX}\s*$`, "i"));
  if (p) {
    const n = toAmount(p[1], p[2]);
    if (n != null && (p[2] || n >= 100)) { price = n; s = s.slice(0, p.index); }
  }
  s = clean(s);
  if (!s && url) s = host(url);
  return { title: s, url, price };
}
export const toNumber = (v) => { const n = parseFloat(String(v).replace(/[\s ]/g, "").replace(",", ".")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };

// ---------- toast ----------
let toastTimer;
export function toast(text, action) {
  let el = $("#toast");
  if (!el) { el = h("div", { id: "toast", class: "toast", role: "status" }); document.body.append(el); }
  el.textContent = "";
  el.append(h("span", {}, text));
  if (action) el.append(h("button", { type: "button", onclick: () => { el.hidden = true; action.run(); } }, action.label));
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 6000 : 2200);
}

// ---------- sheet (modal dialog) ----------
export function sheet(title, build) {
  const dlg = h("dialog", { class: "sheet" });
  const inner = h("div", { class: "sheet-in" }, h("h2", {}, title));
  dlg.append(inner);
  const close = () => dlg.close();
  build(inner, close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

// ---------- csv / download ----------
export function download(name, text, type = "text/plain") {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
