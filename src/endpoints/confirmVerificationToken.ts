// handlers/confirmVerificationToken.ts
import { hashToken } from "../utils/hashToken";
import { getClientIp, clearAttempts } from "../service/authAttempts";
import type { Env } from "../types/Env";

interface ConfirmTokenBody {
  token?: string;
}

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

export async function confirmVerificationToken(
  request: Request,
  env: Env
): Promise<Response> {
  console.info("[confirmVerificationToken] solicitação recebida");

  if (!env) {
    console.error("[confirmVerificationToken] env missing");
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
    const row = await env.DB.prepare(
      `SELECT user_id, expires_at, used
         FROM email_verification_codes
         WHERE token_hash = ?`
    )
      .bind(tokenHash)
      .first<{ user_id?: string; expires_at?: string; used?: number }>();

    if (!row || !row.user_id) {
      console.warn("[confirmVerificationToken] token not found");
      // generic message to client
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    // already used?
    if (Number(row.used) === 1) {
      console.info(
        "[confirmVerificationToken] token already used for user_id=",
        row.user_id
      );
      // If token already used but user maybe not confirmed, still safe to return generic success or 401.
      // We'll return 200 idempotent so clicking twice is harmless.
      return jsonResponse({ ok: true, already_confirmed: true }, 200);
    }

    // expired?
    const expiresMs = Date.parse(row.expires_at || "");
    if (isNaN(expiresMs) || expiresMs < Date.now()) {
      console.warn(
        "[confirmVerificationToken] token expired for user_id=",
        row.user_id
      );
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    // Mark user as confirmed
    await env.DB.prepare(
      "UPDATE users SET email_confirmed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(row.user_id)
      .run();

    // Mark token used (one-time)
    await env.DB.prepare(
      "UPDATE email_verification_codes SET used = 1, used_at = CURRENT_TIMESTAMP WHERE token_hash = ?"
    )
      .bind(tokenHash)
      .run();

    // Clear attempts (non-fatal)
    try {
      const clientIp = getClientIp(request);
      // We clear attempts by email — need the user's email; fetch it safely:
      const u = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
        .bind(row.user_id)
        .first<{ email?: string }>();
      if (u && u.email) {
        await clearAttempts(env.DB, u.email, clientIp);
      }
    } catch (clrErr) {
      console.warn(
        "[confirmVerificationToken] clearAttempts failed (non-fatal):",
        clrErr
      );
    }

    console.info(
      "[confirmVerificationToken] email confirmed for user_id=",
      row.user_id
    );
    // Return success — front should redirect to login
    return jsonResponse({ ok: true, message: "Email confirmed." }, 200);
  } catch (err: any) {
    console.error(
      "[confirmVerificationToken] unexpected error:",
      err?.message ?? err,
      err?.stack
    );
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
