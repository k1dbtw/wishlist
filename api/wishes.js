import { createHash, timingSafeEqual } from "node:crypto";

// Upstash Redis REST. The Vercel integration injects KV_* names; plain Upstash uses UPSTASH_*.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = process.env.WISHLIST_KEY;
const HASH = "wishlist:items";
const ID_RE = /^[a-z0-9-]{4,40}$/i;

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `redis ${r.status}`);
  return j.result;
}

function authorized(req) {
  const got = String(req.headers["x-wishlist-key"] || "");
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(KEY).digest();
  return timingSafeEqual(a, b);
}

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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const missing = [
    !REDIS_URL && "KV_REST_API_URL",
    !REDIS_TOKEN && "KV_REST_API_TOKEN",
    !KEY && "WISHLIST_KEY",
  ].filter(Boolean);
  if (missing.length) return res.status(500).json({ error: "not_configured", missing });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });

  try {
    if (req.method === "GET") {
      const flat = (await redis(["HGETALL", HASH])) || [];
      const items = [];
      for (let i = 1; i < flat.length; i += 2) {
        try { items.push(JSON.parse(flat[i])); } catch {}
      }
      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "null") : req.body;
      const item = clean(body);
      if (!item) return res.status(400).json({ error: "bad_item" });
      await redis(["HSET", HASH, item.id, JSON.stringify(item)]);
      return res.status(200).json({ item });
    }

    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!ID_RE.test(id)) return res.status(400).json({ error: "bad_id" });
      await redis(["HDEL", HASH, id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(502).json({ error: "storage_failed" });
  }
}
