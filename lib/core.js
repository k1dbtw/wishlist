import { createHash, timingSafeEqual } from "node:crypto";

// Platform-neutral API: storage adapters and request plumbing live in
// api/wishes.js (Vercel) and netlify/functions/wishes.js (Netlify).

const ID_RE = /^[a-z0-9-]{4,40}$/i;

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

function clean(x) {
  if (!x || typeof x !== "object" || !ID_RE.test(String(x.id))) return null;
  const url = str(x.url, 2000);
  return {
    id: String(x.id),
    title: str(x.title, 200) || "без названия",
    url: /^https?:\/\//i.test(url) ? url : "",
    price: num(x.price),
    priority: [1, 2, 3].includes(x.priority) ? x.priority : 2,
    note: str(x.note, 1000),
    done: x.done === true,
    createdAt: num(x.createdAt) ?? Date.now(),
    doneAt: num(x.doneAt),
    updatedAt: Date.now(),
  };
}

function keyMatches(got, expected) {
  const a = createHash("sha256").update(String(got || "")).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * @param req     { method, key, id, body }  — key from the x-wishlist-key header, id from ?id=
 * @param store   { all(): item[], put(item), del(id) } or null when storage is not configured
 * @param missing names of env vars that are not set
 * @returns       { status, json }
 */
export async function handle(req, store, missing = []) {
  const KEY = process.env.WISHLIST_KEY;
  if (!KEY) missing = ["WISHLIST_KEY", ...missing];
  if (missing.length || !store) return { status: 500, json: { error: "not_configured", missing } };
  if (!keyMatches(req.key, KEY)) return { status: 401, json: { error: "unauthorized" } };

  try {
    if (req.method === "GET") return { status: 200, json: { items: await store.all() } };

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body || "null"); } catch { body = null; } }
      const item = clean(body);
      if (!item) return { status: 400, json: { error: "bad_item" } };
      await store.put(item);
      return { status: 200, json: { item } };
    }

    if (req.method === "DELETE") {
      const id = String(req.id || "");
      if (!ID_RE.test(id)) return { status: 400, json: { error: "bad_id" } };
      await store.del(id);
      return { status: 200, json: { ok: true } };
    }

    return { status: 405, json: { error: "method_not_allowed" } };
  } catch {
    return { status: 502, json: { error: "storage_failed" } };
  }
}
