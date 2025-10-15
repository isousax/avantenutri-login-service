import type { D1Database } from "@cloudflare/workers-types";

interface DBUser {
  id: string;
  email: string;
  password_hash: string;
}

function base64UrlEncode(data: Uint8Array): string {
  const binary = String.fromCharCode(...Array.from(data));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generateRefreshToken(length = 64): Promise<string> {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
}

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createSession(
  db: D1Database,
  userId: string | DBUser,
  plainToken: string,
  expiresAtISO: string
) {
  const hashed = await hashToken(plainToken);
  await db
    .prepare(
      `INSERT INTO user_sessions (user_id, refresh_token, expires_at, revoked, created_at, updated_at)
       VALUES (?, ?, ?, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(userId, hashed, expiresAtISO)
    .run();

}

export async function findSessionByRefreshToken(db: D1Database, plainToken: string) {
  const hashed = await hashToken(plainToken);
  const row = await db
    .prepare(
      `SELECT id, user_id, refresh_token, expires_at, revoked FROM user_sessions
       WHERE refresh_token = ? LIMIT 1`
    )
    .bind(hashed)
    .first<any>();

  return row || null;
}

export async function revokeSessionById(db: D1Database, sessionId: string) {
  await db
    .prepare(`UPDATE user_sessions SET revoked = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(sessionId)
    .run();
}

// (Mantido apenas a versão com trava otimista abaixo)

export class OptimisticLockError extends Error {
  code = "SESSION_CONFLICT" as const;
  constructor(message = "Session optimistic lock failed") {
    super(message);
    this.name = "OptimisticLockError";
  }
}

// New signature with optimistic locking: requires current plain token
export async function rotateSession(
  db: D1Database,
  sessionId: string,
  currentPlainToken: string,
  newPlainToken: string,
  newExpiresAtISO: string
) {
  const currentHashed = await hashToken(currentPlainToken);
  const newHashed = await hashToken(newPlainToken);
  const result = await db
    .prepare(
      `UPDATE user_sessions
         SET refresh_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND refresh_token = ? AND revoked = FALSE`
    )
    .bind(newHashed, newExpiresAtISO, sessionId, currentHashed)
    .run();

  const changes = (result as any)?.changes ?? (result as any)?.meta?.changes ?? 0;
  if (!changes || changes === 0) {
    // another concurrent request likely rotated first
    throw new OptimisticLockError();
  }
}
