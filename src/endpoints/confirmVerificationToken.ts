// handlers/confirmVerificationToken.ts
import { generateJWT } from "../service/generateJWT";
import { generateRefreshToken, createSession } from "../service/sessionManager";
import { hashToken } from "../utils/hashToken";
import { getClientIp, clearAttempts } from "../service/authAttempts";
import type { Env } from "../types/Env";

interface ConfirmTokenBody {
  token?: string;
}

interface DBUser {
  id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  birth_date?: string | null;
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(body: unknown, status = 200, extra?: Record<string, string>) {
  const headers = { ...JSON_HEADERS, ...(extra || {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

export async function confirmVerificationToken(request: Request, env: Env): Promise<Response> {
  console.info("[confirmVerificationToken] solicitação recebida");

  if (!env.JWT_SECRET) {
    console.error("[confirmVerificationToken] JWT_SECRET ausente no ambiente");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.warn("[confirmVerificationToken] invalid JSON");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { token } = (body as ConfirmTokenBody) || {};
  if (!token) {
    return jsonResponse({ error: "token required" }, 400);
  }

  try {
    const tokenHash = await hashToken(token);

    // find token row
    const row = await env.DB.prepare("SELECT user_id, expires_at, used FROM email_verification_codes WHERE token_hash = ?")
      .bind(tokenHash).first<{ user_id?: string; expires_at?: string; used?: number }>();

    if (!row || !row.user_id) {
      console.warn("[confirmVerificationToken] token not found");
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }
    if (Number(row.used) === 1) {
      console.warn("[confirmVerificationToken] token already used");
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    const expiresMs = Date.parse(row.expires_at || "");
    if (isNaN(expiresMs) || expiresMs < Date.now()) {
      console.warn("[confirmVerificationToken] token expired");
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    // mark user as confirmed
    await env.DB.prepare("UPDATE users SET email_confirmed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(row.user_id).run();

    // mark token used
    await env.DB.prepare("UPDATE email_verification_codes SET used = 1, used_at = CURRENT_TIMESTAMP WHERE token_hash = ?")
      .bind(tokenHash).run();

    // fetch user + profile
    const userFull = await env.DB.prepare(
      `SELECT u.id, u.email, p.full_name, p.phone, p.birth_date
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`
    ).bind(row.user_id).first<DBUser>();

    if (!userFull || !userFull.id) {
      console.error("[confirmVerificationToken] failed to load user after confirm:", row.user_id);
      return jsonResponse({ error: "Internal Server Error" }, 500);
    }

    // issue tokens + session
    const expiresIn = env.JWT_EXPIRATION_SEC ? Number(env.JWT_EXPIRATION_SEC) : 3600;
    const access_token = await generateJWT({
      sub: userFull.id,
      email: userFull.email,
      full_name: userFull.full_name ?? undefined,
      phone: userFull.phone ?? undefined,
      birth_date: userFull.birth_date ?? undefined
    }, env.JWT_SECRET, expiresIn);

    const plainRefresh = await generateRefreshToken(64);
    const refreshDays = env.REFRESH_TOKEN_EXPIRATION_DAYS ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS) : 30;
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000).toISOString();

    await createSession(env.DB, userFull.id, plainRefresh, expiresAt);

    // clear attempts (non-fatal)
    try {
      const clientIp = getClientIp(request);
      await clearAttempts(env.DB, userFull.email, clientIp);
    } catch (e) {
      console.warn("[confirmVerificationToken] clearAttempts failed (non-fatal):", e);
    }

    return jsonResponse({
      access_token,
      refresh_token: plainRefresh,
      expires_at: expiresAt,
      user_id: userFull.id
    }, 200);
  } catch (err: any) {
    console.error("[confirmVerificationToken] unexpected error:", err?.message ?? err, err?.stack);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
