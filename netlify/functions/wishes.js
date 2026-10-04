import { getStore } from "@netlify/blobs";
import { handle } from "../../lib/core.js";

// Netlify: built-in Blobs storage, nothing to set up besides WISHLIST_KEY.
export default async (request) => {
  const blobs = getStore({ name: "wishlist", consistency: "strong" });
  const store = {
    async all() {
      const { blobs: list } = await blobs.list();
      const items = await Promise.all(list.map((b) => blobs.get(b.key, { type: "json" })));
      return items.filter(Boolean);
    },
    put: (item) => blobs.setJSON(item.id, item),
    del: (id) => blobs.delete(id),
  };

  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.text() : undefined;
  const out = await handle(
    { method: request.method, key: request.headers.get("x-wishlist-key"), id: url.searchParams.get("id"), body },
    store,
  );
  return Response.json(out.json, { status: out.status, headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/wishes" };
