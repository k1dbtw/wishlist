// Local dev server: static files + the Netlify function, with storage kept in a local JSON file.
//   npm run dev  →  http://localhost:8888
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDevStores } from "./store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8888;
const DATA = process.env.DEV_DATA || path.join(ROOT, ".netlify", "dev-data.json");
fs.mkdirSync(path.dirname(DATA), { recursive: true });
globalThis.__stashDevStore = createDevStores(DATA);

const { default: api } = await import(path.join(ROOT, "netlify/functions/api.js"));
const STATIC = new Set(["index.html", "styles.css", "sw.js", "manifest.webmanifest", "favicon.svg"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const ok = STATIC.has(rel) || /^(js(\/views)?|icons)\/[\w.-]+$/.test(rel);
  const file = path.join(ROOT, rel);
  if (!ok || !fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`stash dev → http://localhost:${PORT}`));
