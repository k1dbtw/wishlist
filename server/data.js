import { COLLECTIONS, cleanRecord } from "./schema.js";

// One JSON document per user per collection: { records: {id: record}, maxTs }.
// Writes merge record by record (last writer wins on the client's updatedAt) and
// commit with an ETag check, so two devices saving at once never lose each other's edits.

const MAX_RECORDS = 20000;
const TOMBSTONE_TTL = 180 * 864e5;

export function createData(store) {
  const key = (uid, col) => `u/${uid}/${col}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function read(uid, col) {
    const k = key(uid, col);
    const r = await store.getWithMetadata(k, { type: "json" });
    if (!r) return { doc: { records: {}, maxTs: 0 }, etag: null };
    if (r.etag) return { doc: r.data, etag: r.etag };
    // the local dev emulator sends no ETag on reads: take it from a listing first, then
    // re-read, so a write that lands in between still fails the ETag check
    const { blobs } = await store.list({ prefix: k });
    const etag = (blobs.find((b) => b.key === k) || {}).etag;
    return { doc: (await store.get(k, { type: "json" })) || { records: {}, maxTs: 0 }, etag };
  }

  async function apply(uid, col, recs) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const { doc, etag } = await read(uid, col);
      const stamp = Math.max(Date.now(), (doc.maxTs || 0) + 1);
      for (const r of recs) {
        const cur = doc.records[r.id];
        if (cur && cur.updatedAt > r.updatedAt) continue;  // a newer edit already won
        doc.records[r.id] = { ...r, _ts: stamp };
      }
      for (const [id, r] of Object.entries(doc.records)) {
        if (r.deleted && stamp - r._ts > TOMBSTONE_TTL) delete doc.records[id];
      }
      if (Object.keys(doc.records).length > MAX_RECORDS) throw Object.assign(new Error("quota"), { code: "quota" });
      doc.maxTs = stamp;
      const res = await store.setJSON(key(uid, col), doc, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
      if (res.modified) return;
      await sleep(40 + Math.random() * 120 * (attempt + 1));
    }
    throw new Error("write_conflict");
  }

  return {
    async pull(uid, since) {
      const now = Date.now();
      const changes = {};
      await Promise.all(COLLECTIONS.map(async (col) => {
        const { doc } = await read(uid, col);
        changes[col] = Object.values(doc.records).filter((r) => (r._ts || 0) > since);
      }));
      return { now, changes };
    },

    async push(uid, list) {
      const byCol = {};
      let rejected = 0;
      for (const c of list) {
        const rec = cleanRecord(c && c.col, c && c.rec);
        if (!rec) { rejected++; continue; }
        (byCol[c.col] ||= []).push(rec);
      }
      await Promise.all(Object.entries(byCol).map(([col, recs]) => apply(uid, col, recs)));
      return { applied: list.length - rejected, rejected };
    },

    wipe: (uid) => Promise.all(COLLECTIONS.map((col) => store.delete(key(uid, col)))),
  };
}
