import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const SESSION_DAYS = 90;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export const sha = (s) => createHash("sha256").update(s).digest("hex");
const userKey = (email) => `user/${sha(email)}`;
const sessionKey = (token) => `session/${sha(token)}`;
const limitKey = (email) => `limit/${sha(email)}`;

export const normEmail = (e) => (typeof e === "string" ? e.trim().toLowerCase() : "");
export const validEmail = (e) => EMAIL_RE.test(e);
export const validPassword = (p) => typeof p === "string" && p.length >= 8 && p.length <= 200;

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const buf = await scrypt(password, salt, 64);
  return { salt, hash: buf.toString("hex") };
}
async function checkPassword(password, user) {
  const { hash } = await hashPassword(password, user.salt);
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"));
}

export function createAuth(accounts) {
  async function newSession(user) {
    const token = randomBytes(32).toString("base64url");
    const exp = Date.now() + SESSION_DAYS * 864e5;
    await accounts.setJSON(sessionKey(token), { uid: user.id, email: user.email, exp });
    await accounts.set(`usess/${user.id}/${sha(token)}`, String(exp));  // index for "sign out everywhere"
    return { token, exp };
  }

  async function revokeAll(uid, keepToken) {
    const keep = keepToken ? sha(keepToken) : null;
    const { blobs } = await accounts.list({ prefix: `usess/${uid}/` });
    await Promise.all(blobs.map(async (b) => {
      const h = b.key.split("/").pop();
      if (h === keep) return;
      await accounts.delete(`session/${h}`);
      await accounts.delete(b.key);
    }));
  }

  return {
    async register(email, password) {
      const { salt, hash } = await hashPassword(password);
      const user = { id: randomBytes(12).toString("hex"), email, salt, hash, createdAt: Date.now() };
      const res = await accounts.setJSON(userKey(email), user, { onlyIfNew: true });
      if (!res.modified) return { error: "email_taken" };
      return { user, session: await newSession(user) };
    },

    async login(email, password) {
      const lim = (await accounts.get(limitKey(email), { type: "json" })) || { fails: 0, until: 0 };
      if (lim.until > Date.now()) return { error: "locked", retryAt: lim.until };
      const user = await accounts.get(userKey(email), { type: "json" });
      const ok = user ? await checkPassword(password, user) : (await hashPassword(password), false);
      if (!ok) {
        const fails = lim.fails + 1;
        await accounts.setJSON(limitKey(email), fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MS } : { fails, until: 0 });
        return { error: "bad_credentials" };
      }
      if (lim.fails) await accounts.delete(limitKey(email));
      return { user, session: await newSession(user) };
    },

    async fromToken(token) {
      if (!token) return null;
      const s = await accounts.get(sessionKey(token), { type: "json" });
      if (!s || s.exp < Date.now()) return null;
      return s;
    },

    async logout(token, uid) {
      await accounts.delete(sessionKey(token));
      if (uid) await accounts.delete(`usess/${uid}/${sha(token)}`);
    },

    revokeAll,

    async verify(email, password) {
      const user = await accounts.get(userKey(email), { type: "json" });
      return user && (await checkPassword(password, user)) ? user : null;
    },

    async changePassword(user, next, keepToken) {
      const { salt, hash } = await hashPassword(next);
      await accounts.setJSON(userKey(user.email), { ...user, salt, hash });
      await revokeAll(user.id, keepToken);
    },

    async deleteUser(user) {
      await revokeAll(user.id);
      await accounts.delete(userKey(user.email));
      await accounts.delete(limitKey(user.email));
    },
  };
}
