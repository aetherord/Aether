import { SESSION_ROTATE_MS, SESSION_TTL_MS, SESSION_TTL_NO_REMEMBER_MS } from "@/lib/auth";
import { generateToken, hashToken } from "@/lib/crypto";
import {
  clearAuthCookies,
  handleApiError,
  json,
  jsonOk,
  readCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/lib/http";
import { getStore } from "@/lib/store";

/**
 * GET /api/auth/session
 * Returns the current user (or 401). Also rotates the session cookie when it
 * is older than 24 hours (sliding sessions, revocable server-side).
 */
export async function GET(req: Request) {
  try {
    const store = await getStore();

    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return json({ authenticated: false }, 401);

    const row = await store.getSession(hashToken(token));
    if (!row || row.expiresAt < Date.now()) {
      if (row) await store.deleteSession(row.tokenHash);
      return json({ authenticated: false }, 401);
    }

    const user = await store.getUserById(row.userId);
    if (!user) return json({ authenticated: false }, 401);

    await store.touchSession(row.tokenHash);

    const res = json({
      authenticated: true,
      user: { id: user.id, email: user.email, username: user.username, role: user.role },
      twoFactorEnabled: user.totpEnabled,
      mutedUntil: user.mutedUntil,
    });

    if (Date.now() - row.createdAt > SESSION_ROTATE_MS) {
      const newToken = generateToken();
      const now = Date.now();
      await store.rotateSession(row.tokenHash, {
        tokenHash: hashToken(newToken),
        userId: user.id,
        email: user.email,
        remember: row.remember !== false,
        expiresAt: now + (row.remember !== false ? SESSION_TTL_MS : SESSION_TTL_NO_REMEMBER_MS),
        createdAt: now,
        lastUsedAt: now,
      });
      setSessionCookie(res, newToken, row.remember !== false);
    }

    return res;
  } catch (err) {
    console.error("auth: session lookup failed");
    return json({ authenticated: false }, 500);
  }
}


/** POST /api/auth/session — logs out (invalidates the session server-side). */
export async function POST(req: Request) {
  try {
    const store = await getStore();
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      await store.deleteSession(hashToken(token));
    }
    const res = jsonOk();
    clearAuthCookies(res);
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
