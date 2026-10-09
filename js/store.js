// Local-first store. Every change lands in memory + localStorage at once and goes into
// an outbox; the outbox drains to the server in the background and the server's changes
// are pulled every few seconds. Records merge by updatedAt (last edit wins).
import { load, save, drop, newId } from "./util.js";

export const COLLECTIONS = ["wishes", "tasks", "txns", "cats", "prefs"];
const K = { data: "stash.data.v1", outbox: "stash.outbox.v1", cursor: "stash.cursor.v1" };
const POLL_MS = 8000;
const OVERLAP_MS = 60000;  // re-read the last minute on every pull to cover clock skew between servers

let data = {};      // col -> { id: record }  (tombstones kept until the server confirms)
let outbox = [];    // [{ col, rec }]
let cursor = 0;
let listeners = new Set();
let status = { pushing: false, pulling: false, offline: false, pending: 0 };
let onUnauthorized = () => {};
let ver = 0;  // bumps whenever records change, so views re-render only when needed
let started = false, pushing = false, pulling = false, retryTimer = null, pollTimer = null, notifyQueued = false, writeSeq = 0;

function hydrate() {
  data = load(K.data, {});
  for (const c of COLLECTIONS) data[c] ||= {};
  outbox = load(K.outbox, []);
  cursor = load(K.cursor, 0);
}
const persist = () => { save(K.data, data); save(K.outbox, outbox); save(K.cursor, cursor); };

function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; status.pending = outbox.length; listeners.forEach((fn) => fn(status)); });
}

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getStatus = () => status;
export const getVersion = () => ver;
export const all = (col) => Object.values(data[col] || {}).filter((r) => !r.deleted);
export const get = (col, id) => { const r = data[col] && data[col][id]; return r && !r.deleted ? r : null; };
export const isEmpty = () => COLLECTIONS.every((c) => !Object.keys(data[c] || {}).length);

export function put(col, rec) {
  const now = Date.now();
  const prev = data[col][rec.id] || {};
  const next = { ...prev, ...rec, id: rec.id || newId(), updatedAt: Math.max(now, (prev.updatedAt || 0) + 1) };
  next.createdAt ||= now;
  delete next.deleted;
  delete next._ts;
  data[col][next.id] = next;
  ver++;
  queue(col, next);
  return next;
}

export function remove(col, id) {
  const prev = data[col][id];
  if (!prev) return null;
  const tomb = { id, deleted: true, updatedAt: Math.max(Date.now(), (prev.updatedAt || 0) + 1) };
  data[col][id] = tomb;
  ver++;
  queue(col, tomb);
  return prev;
}

function queue(col, rec) {
  outbox = outbox.filter((o) => !(o.col === col && o.rec.id === rec.id));
  outbox.push({ col, rec });
  persist(); notify(); flush();
}

async function api(method, path, body) {
  const r = await fetch("/api" + path, {
    method, credentials: "same-origin", cache: "no-store",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "http " + r.status), { status: r.status, body: j });
  return j;
}
export { api };

export async function flush() {
  if (!started || pushing || !outbox.length) return;
  pushing = true; status.pushing = true; notify();
  clearTimeout(retryTimer);
  try {
    while (outbox.length) {
      const batch = outbox.slice(0, 200);
      await api("POST", "/sync", { changes: batch });
      writeSeq++;
      // drop exactly what was sent, unless it was edited again meanwhile
      const sent = new Set(batch);
      outbox = outbox.filter((o) => !sent.has(o));
      for (const o of batch) if (o.rec.deleted && data[o.col][o.rec.id] === o.rec) delete data[o.col][o.rec.id];
      persist();
    }
    status.offline = false;
  } catch (e) {
    if (e.status === 401) { pushing = false; status.pushing = false; return onUnauthorized(); }
    if (e.status === 413) status.quota = true;
    else { status.offline = true; retryTimer = setTimeout(flush, 5000); }
  } finally {
    pushing = false; status.pushing = false; notify();
  }
  if (!outbox.length) pull();
}

export async function pull() {
  if (!started || pulling) return;
  pulling = true; status.pulling = true; notify();
  const seq = writeSeq;
  try {
    const res = await api("GET", "/sync?since=" + Math.max(0, cursor - OVERLAP_MS));
    const pendingIds = new Set(outbox.map((o) => o.col + "/" + o.rec.id));
    for (const col of COLLECTIONS) {
      for (const rec of res.changes[col] || []) {
        if (pendingIds.has(col + "/" + rec.id)) continue;  // our unsent edit wins until it's sent
        const cur = data[col][rec.id];
        if (cur && cur.updatedAt > rec.updatedAt) continue;
        if (rec.deleted) { if (cur) { delete data[col][rec.id]; ver++; } }
        else if (!cur || cur.updatedAt !== rec.updatedAt || cur.deleted) { data[col][rec.id] = rec; ver++; }
      }
    }
    if (seq === writeSeq) cursor = res.now;
    status.offline = false;
    persist();
  } catch (e) {
    if (e.status === 401) { pulling = false; status.pulling = false; return onUnauthorized(); }
    status.offline = true;
  } finally {
    pulling = false; status.pulling = false; notify();
  }
}

export function start({ unauthorized }) {
  onUnauthorized = unauthorized;
  started = true;
  hydrate();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === "visible") { flush(); pull(); } }, POLL_MS);
  return pull().then(flush);
}
export function stop() { started = false; clearInterval(pollTimer); clearTimeout(retryTimer); }
export function reset() {
  stop();
  data = {}; outbox = []; cursor = 0;
  for (const c of COLLECTIONS) data[c] = {};
  ver++;
  Object.values(K).forEach(drop);
  notify();
}
export const snapshot = () => Object.fromEntries(COLLECTIONS.map((c) => [c, all(c)]));
hydrate();

addEventListener("online", () => { flush(); pull(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { flush(); pull(); } });
