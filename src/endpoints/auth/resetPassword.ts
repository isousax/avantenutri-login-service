import type { Env } from "../../types/Env";
import { hashToken } from "../../utils/hashToken";
import { hashPassword } from "../../service/managerPassword";
import { clearAttempts } from "../../service/authAttempts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

export async function resetPassword(
  request: Request,
  env: Env
): Promise<Response> {
  console.info("[resetPassword] request received");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.warn("[resetPassword] invalid JSON");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { token, new_password } =
    (body as { token?: string; new_password?: string }) || {};

  if (!token || !new_password) {
    return jsonResponse({ error: "token and new_password required" }, 400);
  }

  if (!PASSWORD_POLICY_REGEX.test(new_password)) {
    return jsonResponse(
      {
        error:
          "Password must be at least 8 characters and include lowercase, uppercase, number and symbol",
      },
      400
    );
  }

  try {
    const tokenHash = await hashToken(token);

    // find by token_hash
    const row = await env.DB.prepare(
      "SELECT user_id, expires_at, used FROM password_reset_codes WHERE token_hash = ?"
    )
      .bind(tokenHash)
      .first<{ user_id?: string; expires_at?: string; used?: number }>();

    if (!row || !row.user_id) {
      console.warn("[resetPassword] token not found");
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }
    if (Number(row.used) === 1) {
      console.warn("[resetPassword] token already used");
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    const expiresMs = Date.parse(row.expires_at || "");
    if (isNaN(expiresMs) || expiresMs < Date.now()) {
      console.warn("[resetPassword] token expired");
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }

    // hash new password and update user
    const newHash = await hashPassword(new_password);
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(newHash, row.user_id)
      .run();

    // mark token used
    try {
      await env.DB.prepare(
        "UPDATE password_reset_codes SET used = 1, used_at = CURRENT_TIMESTAMP WHERE token_hash = ?"
      )
        .bind(tokenHash)
        .run();
    } catch (e) {
      console.warn("[resetPassword] failed to mark token used (non-fatal):", e);
    }

    // revoke sessions for user (non-fatal)
    try {
      await env.DB.prepare(
        "UPDATE user_sessions SET revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
      )
        .bind(row.user_id)
        .run();
    } catch (revErr) {
      console.warn(
        "[resetPassword] revoke sessions failed (non-fatal):",
        revErr
      );
    }

    // clear attempts (non-fatal) - try to resolve user email for better clearAttempts call
    try {
      const userRow = await env.DB.prepare(
        "SELECT email FROM users WHERE id = ?"
      )
        .bind(row.user_id)
        .first<{ email?: string }>();
      const clientIp =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
        "unknown";
      await clearAttempts(env.DB, userRow?.email ?? "", clientIp);
    } catch (clearErr) {
      console.warn(
        "[resetPassword] clearAttempts failed (non-fatal):",
        clearErr
      );
    }

    console.info("[resetPassword] password reset OK for user_id:", row.user_id);
    return jsonResponse({ ok: true }, 200);
  } catch (err: any) {
    console.error(
      "[resetPassword] unexpected error:",
      err?.message ?? err,
      err?.stack
    );
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
