import { getStore } from "@netlify/blobs";
import { createAuth, normEmail, validEmail, validPassword } from "../../server/auth.js";
import { createData } from "../../server/data.js";

const COOKIE = "sid";
// `npm run dev` swaps in a local store; on Netlify this is always Netlify Blobs
const store = (name) => (globalThis.__stashDevStore || ((n) => getStore({ name: n, consistency: "strong" })))(name);
const MAX_PUSH = 500;

const json = (status, body, headers = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function cookie(token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
const clearCookie = () => cookie("", 0);

function readCookie(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sid=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// writes must be same-origin JSON: blocks form posts and cross-site requests
function sameOrigin(req, url) {
  if (req.method === "GET") return true;
  if (!(req.headers.get("content-type") || "").includes("application/json")) return false;
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host === url.host;
}

async function body(req) {
  try { return (await req.json()) || {}; } catch { return {}; }
}

export default async (req) => {
  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname.replace(/^\/api/, "").replace(/\/$/, "")}`;
  if (!sameOrigin(req, url)) return json(403, { error: "forbidden" });

  const auth = createAuth(store("accounts"));
  const data = createData(store("data"));

  try {
    // ---------- public ----------
    if (route === "POST /auth/register") {
      const b = await body(req);
      const email = normEmail(b.email);
      if (!validEmail(email)) return json(400, { error: "bad_email" });
      if (!validPassword(b.password)) return json(400, { error: "weak_password" });
      const invite = process.env.INVITE_CODE;
      if (invite && b.invite !== invite) return json(403, { error: "invite_required" });
      const r = await auth.register(email, b.password);
      if (r.error) return json(409, { error: r.error });
      return json(200, { email }, { "Set-Cookie": cookie(r.session.token, 90 * 86400) });
    }

    if (route === "POST /auth/login") {
      const b = await body(req);
      const r = await auth.login(normEmail(b.email), String(b.password || ""));
      if (r.error === "locked") return json(429, { error: "locked", retryAt: r.retryAt });
      if (r.error) return json(401, { error: r.error });
      return json(200, { email: r.user.email }, { "Set-Cookie": cookie(r.session.token, 90 * 86400) });
    }

    if (route === "GET /config") return json(200, { invite: !!process.env.INVITE_CODE, legacy: !!process.env.WISHLIST_KEY });

    // ---------- signed in ----------
    const token = readCookie(req);
    const session = await auth.fromToken(token);
    if (!session) return json(401, { error: "unauthorized" }, token ? { "Set-Cookie": clearCookie() } : {});
    const uid = session.uid;

    if (route === "GET /auth/me") return json(200, { email: session.email });

    if (route === "POST /auth/logout") {
      await auth.logout(token, uid);
      return json(200, { ok: true }, { "Set-Cookie": clearCookie() });
    }

    if (route === "POST /auth/logout-all") {
      await auth.revokeAll(uid, token);
      return json(200, { ok: true });
    }

    if (route === "POST /auth/password") {
      const b = await body(req);
      const user = await auth.verify(session.email, String(b.current || ""));
      if (!user) return json(401, { error: "bad_credentials" });
      if (!validPassword(b.next)) return json(400, { error: "weak_password" });
      await auth.changePassword(user, b.next, token);
      return json(200, { ok: true });
    }

    if (route === "POST /account/delete") {
      const b = await body(req);
      const user = await auth.verify(session.email, String(b.password || ""));
      if (!user) return json(401, { error: "bad_credentials" });
      await data.wipe(uid);
      await auth.deleteUser(user);
      return json(200, { ok: true }, { "Set-Cookie": clearCookie() });
    }

    if (route === "GET /sync") {
      const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
      return json(200, await data.pull(uid, since));
    }

    if (route === "POST /sync") {
      const b = await body(req);
      const list = Array.isArray(b.changes) ? b.changes.slice(0, MAX_PUSH) : [];
      return json(200, await data.push(uid, list));
    }

    // one-time move of the old single-password wishlist into this account
    if (route === "POST /import-legacy") {
      const b = await body(req);
      const legacyKey = process.env.WISHLIST_KEY;
      if (!legacyKey || b.key !== legacyKey) return json(403, { error: "bad_key" });
      const old = store("wishlist");
      const { blobs } = await old.list();
      const items = (await Promise.all(blobs.map((x) => old.get(x.key, { type: "json" })))).filter(Boolean);
      const now = Date.now();
      await data.push(uid, items.map((it) => ({ col: "wishes", rec: { ...it, updatedAt: now } })));
      return json(200, { imported: items.length });
    }

    return json(404, { error: "not_found" });
  } catch (e) {
    if (e && e.code === "quota") return json(413, { error: "quota" });
    console.error(e);
    return json(500, { error: "server_error" });
  }
};

export const config = { path: "/api/*" };
