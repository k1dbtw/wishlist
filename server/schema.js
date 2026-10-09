// Record shapes for every synced collection. The server never trusts the client:
// each record is rebuilt field by field from what the client sent.

export const COLLECTIONS = ["wishes", "tasks", "txns", "cats", "prefs"];

const ID_RE = /^[a-z0-9-]{4,40}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v, max = 1e12) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null);
const ts = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);
const date = (v) => (typeof v === "string" && DATE_RE.test(v) ? v : null);
const id = (v) => (typeof v === "string" && ID_RE.test(v) ? v : null);
const url = (v) => { const s = str(v, 2000); return /^https?:\/\//i.test(s) ? s : ""; };
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);

const shapes = {
  wishes: (x) => ({
    title: str(x.title, 200) || "без названия",
    url: url(x.url),
    price: num(x.price),
    priority: oneOf(x.priority, [1, 2, 3], 2),
    note: str(x.note, 1000),
    done: x.done === true,
    doneAt: ts(x.doneAt),
  }),
  tasks: (x) => ({
    text: str(x.text, 1000) || "…",
    cat: id(x.cat),
    due: date(x.due),
    done: x.done === true,
    doneAt: ts(x.doneAt),
    pinned: x.pinned === true,
  }),
  txns: (x) => ({
    kind: oneOf(x.kind, ["expense", "income"], "expense"),
    amount: num(x.amount) ?? 0,
    cat: id(x.cat),
    date: date(x.date) || new Date().toISOString().slice(0, 10),
    note: str(x.note, 300),
  }),
  cats: (x) => ({
    scope: oneOf(x.scope, ["expense", "income", "task"], "expense"),
    name: str(x.name, 40) || "категория",
    color: oneOf(x.color, [0, 1, 2, 3, 4, 5, 6, 7, 8], 0),  // 0–7 palette slots, 8 = neutral
    order: typeof x.order === "number" && Number.isFinite(x.order) && Math.abs(x.order) <= 1e6 ? x.order : 0,
    keywords: str(x.keywords, 300),
  }),
  prefs: (x) => ({
    currency: oneOf(x.currency, ["UZS", "RUB", "USD", "EUR", "KZT", "UAH", "BYN", "GBP", "TRY", "GEL", "AMD"], "UZS"),
    cv: oneOf(x.cv, [1, 2, 3, 4], 1),  // one-time client migrations done: 2 = currency → UZS, 3 = "Энергетики", 4 = "Напитки" and "Подарки"
    budget: num(x.budget),
    name: str(x.name, 60),
  }),
};

/** Clean one incoming record; null when it can't be stored. */
export function cleanRecord(col, x) {
  if (!COLLECTIONS.includes(col) || !x || typeof x !== "object") return null;
  const rid = id(x.id);
  const updatedAt = ts(x.updatedAt);
  if (!rid || !updatedAt) return null;
  const base = { id: rid, updatedAt, createdAt: ts(x.createdAt) ?? updatedAt };
  if (x.deleted === true) return { ...base, deleted: true };
  return { ...base, ...shapes[col](x) };
}
