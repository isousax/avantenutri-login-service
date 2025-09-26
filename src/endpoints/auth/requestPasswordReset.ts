import type { Env } from "../../types/Env";
import { generateToken } from "../../utils/generateToken";
import { hashToken } from "../../utils/hashToken";
import { sendPasswordResetEmail } from "../../utils/sendPasswordResetEmail";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(
  body: unknown,
  status = 200,
  extra?: Record<string, string>
) {
  const headers = { ...JSON_HEADERS, ...(extra || {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const RESEND_COOLDOWN_SEC = 60; // 1 min
const TOKEN_TTL_MIN = 15;

export async function requestPasswordReset(
  request: Request,
  env: Env
): Promise<Response> {
  console.info("[requestPasswordReset] request received");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.warn("[requestPasswordReset] invalid JSON");
    return jsonResponse({ ok: true }, 200); // generic
  }

  const { email } = (body as { email?: string }) || {};
  if (!email || !isValidEmail(email)) {
    console.warn("[requestPasswordReset] missing/invalid email");
    return jsonResponse({ ok: true }, 200);
  }

  try {
    const userRow = await env.DB.prepare(
      "SELECT id, email_confirmed, email FROM users WHERE email = ?"
    )
      .bind(email)
      .first<{ id?: string; email_confirmed?: number; email?: string }>();

    if (!userRow || !userRow.id || !userRow.email) {
      console.info("[requestPasswordReset] email not found (no-op)");
      return jsonResponse({ ok: true }, 200);
    }

    // ensure table exists (idempotent)
    try {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS password_reset_codes (
           user_id TEXT PRIMARY KEY,
           token_hash TEXT,
           expires_at TEXT NOT NULL,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           used INTEGER DEFAULT 0,
           used_at TEXT,
           FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
         )`
      ).run();
    } catch (e) {
      console.warn("[requestPasswordReset] ensure table failed (proceed):", e);
    }

    // cooldown check using created_at
    const existing = await env.DB.prepare(
      "SELECT created_at FROM password_reset_codes WHERE user_id = ?"
    )
      .bind(userRow.id)
      .first<{ created_at?: string }>();

    const nowMs = Date.now();
    if (existing && existing.created_at) {
      const lastMs = Date.parse(existing.created_at);
      if (!isNaN(lastMs)) {
        const diffSec = Math.floor((nowMs - lastMs) / 1000);
        if (diffSec < RESEND_COOLDOWN_SEC) {
          const retryAfter = RESEND_COOLDOWN_SEC - diffSec;
          console.warn("[requestPasswordReset] resend cooldown active");
          return jsonResponse(
            { error: "Too many requests. Try again later." },
            429,
            { "Retry-After": String(retryAfter) }
          );
        }
      }
    }

    // create token and store hash
    const plainToken = generateToken(32);
    const tokenHash = await hashToken(plainToken);
    const expiresAt = new Date(nowMs + TOKEN_TTL_MIN * 60_000).toISOString();

    await env.DB.prepare(
      `INSERT INTO password_reset_codes (user_id, token_hash, expires_at, created_at, used)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
       ON CONFLICT(user_id) DO UPDATE SET
         token_hash = excluded.token_hash,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP,
         used = 0`
    )
      .bind(userRow.id, tokenHash, expiresAt)
      .run();

    const base = `https://${env.SITE_DNS}`;
    const link = `${base}/reset-password?token=${encodeURIComponent(
      plainToken
    )}`;

    await sendPasswordResetEmail(env, userRow.email as string, link);

    console.info(
      "[requestPasswordReset] reset email queued for:",
      userRow.email
    );
    return jsonResponse({ ok: true }, 200);
  } catch (err: any) {
    console.error(
      "[requestPasswordReset] unexpected error:",
      err?.message ?? err,
      err?.stack
    );
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
