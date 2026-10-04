import { handle } from "../lib/core.js";

// Vercel: Upstash Redis over REST. The Vercel integration injects KV_* names; plain Upstash uses UPSTASH_*.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = "wishlist:items";

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

const store = {
  async all() {
    const flat = (await redis(["HGETALL", HASH])) || [];
    const items = [];
    for (let i = 1; i < flat.length; i += 2) {
      try { items.push(JSON.parse(flat[i])); } catch {}
    }
    return items;
  },
  put: (item) => redis(["HSET", HASH, item.id, JSON.stringify(item)]),
  del: (id) => redis(["HDEL", HASH, id]),
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const missing = [!REDIS_URL && "KV_REST_API_URL", !REDIS_TOKEN && "KV_REST_API_TOKEN"].filter(Boolean);
  const out = await handle(
    { method: req.method, key: req.headers["x-wishlist-key"], id: req.query.id, body: req.body },
    missing.length ? null : store,
    missing,
  );
  res.status(out.status).json(out.json);
}
