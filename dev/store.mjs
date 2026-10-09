// In-memory stand-in for Netlify Blobs used by `npm run dev` and the tests.
// Conditional writes are atomic and ETags are content hashes, like production;
// the official local emulator checks ETags non-atomically and loses concurrent writes.
import { createHash } from "node:crypto";
import fs from "node:fs";

export function createDevStores(file) {
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  let timer = null;
  const persist = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFileSync(file, JSON.stringify(all)), 200); };
  const etagOf = (s) => `"${createHash("sha256").update(s).digest("hex").slice(0, 32)}"`;
  const tick = () => new Promise((r) => setImmediate(r));  // keep calls async, like the network

  return (name) => {
    const m = (all[name] ||= {});
    return {
      async get(key, opts = {}) { await tick(); const v = m[key]; return v === undefined ? null : opts.type === "json" ? JSON.parse(v) : v; },
      async getWithMetadata(key, opts = {}) { await tick(); const v = m[key]; return v === undefined ? null : { data: opts.type === "json" ? JSON.parse(v) : v, etag: etagOf(v), metadata: {} }; },
      async set(key, value, opts = {}) { await tick(); return this._write(key, String(value), opts); },
      async setJSON(key, value, opts = {}) { await tick(); return this._write(key, JSON.stringify(value), opts); },
      _write(key, s, { onlyIfNew, onlyIfMatch } = {}) {
        const cur = m[key];
        if (onlyIfNew && cur !== undefined) return { modified: false };
        if (onlyIfMatch && (cur === undefined || etagOf(cur) !== onlyIfMatch)) return { modified: false };
        m[key] = s; persist();
        return { modified: true, etag: etagOf(s) };
      },
      async delete(key) { await tick(); delete m[key]; persist(); },
      async list({ prefix = "" } = {}) { await tick(); return { blobs: Object.keys(m).filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, etag: etagOf(m[k]) })), directories: [] }; },
    };
  };
}
