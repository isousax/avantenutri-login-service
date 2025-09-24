import { generateJWT } from "../service/generateJWT";
import { generateRefreshToken, createSession } from "../service/sessionManager";
import { getClientIp, clearAttempts } from "../service/authAttempts";
import type { Env } from "../types/Env";

interface ConfirmRequestBody {
  user_id?: string;
  email?: string;
  code: string;
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

export async function confirmVerificationCode(request: Request, env: Env): Promise<Response> {
  console.info("[confirmVerificationCode] request received");

  if (!env.JWT_SECRET) {
    console.error("[confirmVerificationCode] JWT_SECRET missing in env");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.warn("[confirmVerificationCode] invalid JSON body");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { user_id, email, code } = body as ConfirmRequestBody;
  if (!code || (!user_id && !email)) {
    console.warn("[confirmVerificationCode] missing required fields");
    return jsonResponse({ error: "code and (user_id or email) required" }, 400);
  }

  try {
    await env.DB.prepare("BEGIN").run();

    let userRow: { id: string; email: string } | null = null;
    if (user_id) {
      const r = await env.DB
        .prepare("SELECT id, email FROM users WHERE id = ?")
        .bind(user_id)
        .first<{ id?: string; email?: string }>();
      if (r && r.id) userRow = { id: r.id, email: r.email ?? "" };
    } else {
      const r = await env.DB
        .prepare("SELECT id, email FROM users WHERE email = ?")
        .bind(email)
        .first<{ id?: string; email?: string }>();
      if (r && r.id) userRow = { id: r.id, email: r.email ?? "" };
    }

    // If user not found -> generic invalid (do not leak)
    if (!userRow) {
      await env.DB.prepare("ROLLBACK").run().catch(() => {});
      console.warn("[confirmVerificationCode] user not found (generic response)");
      return jsonResponse({ error: "Invalid or expired code" }, 401);
    }

    const maskedEmail = (() => {
      try {
        const [local, domain] = (userRow?.email || "unknown").split("@");
        const visible = local && local.length > 1 ? local[0] + "..." + local.slice(-1) : local;
        return `${visible}@${domain}`;
      } catch {
        return "unknown";
      }
    })();

    // Fetch verification code row
    const codeRow = await env.DB
      .prepare("SELECT code, expires_at FROM email_verification_codes WHERE user_id = ?")
      .bind(userRow.id)
      .first<{ code?: string; expires_at?: string }>();

    if (!codeRow || !codeRow.code) {
      await env.DB.prepare("ROLLBACK").run().catch(() => {});
      console.warn("[confirmVerificationCode] verification row missing for user:", maskedEmail);
      return jsonResponse({ error: "Invalid or expired code" }, 401);
    }

    // Check code and expiration
    const nowMs = Date.now();
    const expiresMs = Date.parse(codeRow.expires_at || "");
    if (codeRow.code !== code || isNaN(expiresMs) || expiresMs < nowMs) {
      await env.DB.prepare("ROLLBACK").run().catch(() => {});
      console.warn("[confirmVerificationCode] code invalid or expired for user:", maskedEmail);
      return jsonResponse({ error: "Invalid or expired code" }, 401);
    }

    // Mark user as confirmed
    await env.DB
      .prepare("UPDATE users SET email_confirmed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(userRow.id)
      .run();

    // Delete verification code (cleanup)
    await env.DB
      .prepare("DELETE FROM email_verification_codes WHERE user_id = ?")
      .bind(userRow.id)
      .run();

    // Fetch user + profile (for token payload)
    const userFull = await env.DB
      .prepare(
        `SELECT u.id, u.email, p.full_name, p.phone, p.birth_date
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE u.id = ?`
      )
      .bind(userRow.id)
      .first<DBUser>();

    if (!userFull || !userFull.id) {
      // unexpected — rollback
      await env.DB.prepare("ROLLBACK").run().catch(() => {});
      console.error("[confirmVerificationCode] failed to load user after confirm:", userRow.id);
      return jsonResponse({ error: "Internal Server Error" }, 500);
    }

    // Create session & tokens
    const accessTokenTtlSeconds = env.JWT_EXPIRATION_SEC ? Number(env.JWT_EXPIRATION_SEC) : 3600;
    const access_token = await generateJWT(
      {
        sub: userFull.id,
        email: userFull.email,
        full_name: userFull.full_name ?? undefined,
        phone: userFull.phone ?? undefined,
        birth_date: userFull.birth_date ?? undefined,
      },
      env.JWT_SECRET,
      accessTokenTtlSeconds
    );

    const refreshDays = env.REFRESH_TOKEN_EXPIRATION_DAYS
      ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS)
      : 30;
    const plainRefresh = await generateRefreshToken(64);
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000).toISOString();

    await createSession(env.DB, userFull.id, plainRefresh, expiresAt);

    // Commit transaction
    await env.DB.prepare("COMMIT").run();

    // Clear attempts (non-fatal)
    try {
      const clientIp = getClientIp(request);
      await clearAttempts(env.DB, userFull.email, clientIp);
    } catch (err) {
      console.warn("[confirmVerificationCode] clearAttempts failed (non-fatal):", err);
    }

    console.info("[confirmVerificationCode] verification OK & session created for user:", maskedEmail);
    return jsonResponse(
      {
        access_token,
        refresh_token: plainRefresh,
        expires_at: expiresAt,
        user_id: userFull.id,
      },
      200
    );
  } catch (err: any) {
    // Attempt rollback
    try {
      await env.DB.prepare("ROLLBACK").run();
    } catch (rbErr) {
      console.error("[confirmVerificationCode] rollback failed:", rbErr);
    }
    console.error("[confirmVerificationCode] unexpected error:", err?.message ?? err, err?.stack);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
