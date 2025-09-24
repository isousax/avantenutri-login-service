// handlers/resendVerificationCode.ts
import type { Env } from "../types/Env";
import { generateToken } from "../utils/generateToken";
import { hashToken } from "../utils/hashToken";
import { sendVerificationEmail } from "../utils/sendVerificationEmail";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(body: unknown, status = 200, extra?: Record<string,string>) {
  const headers = { ...JSON_HEADERS, ...(extra || {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const RESEND_COOLDOWN_SEC = 60;
const TOKEN_TTL_MIN = 15;

export async function resendVerificationCode(request: Request, env: Env): Promise<Response> {
  console.info("[resendVerificationCode] solicitação recebida");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.warn("[resendVerificationCode] invalid JSON");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { email } = (body as { email?: string }) || {};
  if (!email || !isValidEmail(email)) {
    console.warn("[resendVerificationCode] e-mail ausente/inválido");
    return jsonResponse({ ok: true }, 200);
  }

  try {
    const userRow = await env.DB.prepare("SELECT id, email_confirmed FROM users WHERE email = ?")
      .bind(email).first<{ id?: string; email_confirmed?: number }>();
    if (!userRow || !userRow.id) {
      console.info("[resendVerificationCode] e-mail não encontrado (no-op)");
      return jsonResponse({ ok: true }, 200);
    }

    if (userRow.email_confirmed) {
      console.info("[resendVerificationCode] email already confirmed (no-op)");
      return jsonResponse({ ok: true }, 200);
    }

    // cooldown check
    const existing = await env.DB.prepare("SELECT created_at FROM email_verification_codes WHERE user_id = ?")
      .bind(userRow.id).first<{ created_at?: string }>();
    const nowMs = Date.now();
    if (existing && existing.created_at) {
      const lastMs = Date.parse(existing.created_at);
      if (!isNaN(lastMs)) {
        const diffSec = Math.floor((nowMs - lastMs) / 1000);
        if (diffSec < RESEND_COOLDOWN_SEC) {
          const retryAfter = RESEND_COOLDOWN_SEC - diffSec;
          return jsonResponse({ error: "Too many requests. Try again later." }, 429, { "Retry-After": String(retryAfter) });
        }
      }
    }

    // generate token, hash, upsert
    const plainToken = generateToken(32);
    const tokenHash = await hashToken(plainToken);
    const expiresAt = new Date(nowMs + TOKEN_TTL_MIN * 60_000).toISOString();

    await env.DB.prepare(
      `INSERT INTO email_verification_codes (user_id, token_hash, expires_at, created_at, used)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
       ON CONFLICT(user_id) DO UPDATE SET
         token_hash = excluded.token_hash,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP,
         used = 0`
    ).bind(userRow.id, tokenHash, expiresAt).run();

    // build link and send
    const base = (env.SITE_DNS || "").replace(/\/$/, "");
    const link = `${base}/confirm-email?token=${encodeURIComponent(plainToken)}`;
    await sendVerificationEmail(env, email, link);

    console.info("[resendVerificationCode] e-mail enviado (ok) para:", email);
    return jsonResponse({ ok: true }, 200);
  } catch (err: any) {
    console.error("[resendVerificationCode] unexpected error:", err?.message ?? err, err?.stack);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}