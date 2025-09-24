import type { Env } from "../types/Env";
import { hashPassword } from "../service/managerPassword";
import { clearAttempts } from "../service/authAttempts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

export async function resetPassword(request: Request, env: Env): Promise<Response> {
  console.info("[resetPassword] request received");

  if (!env.JWT_SECRET) {
    console.error("[resetPassword] JWT_SECRET missing");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.warn("[resetPassword] invalid JSON");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { email, user_id, code, new_password } = (body as {
    email?: string;
    user_id?: string;
    code?: string;
    new_password?: string;
  }) || {};

  if (!code || !new_password || (!email && !user_id)) {
    console.warn("[resetPassword] missing fields");
    return jsonResponse({ error: "code and new_password and (email or user_id) required" }, 400);
  }

  if (!PASSWORD_POLICY_REGEX.test(new_password)) {
    return jsonResponse({ error: "Password must be at least 8 characters and include lowercase, uppercase, number and symbol" }, 400);
  }

  // Resolve user id if email provided
  try {
    // resolve user by id or email
    let userRow: { id: string; email?: string } | null = null;
    if (user_id) {
      const r = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?").bind(user_id).first<{ id?: string; email?: string }>();
      if (r && r.id) userRow = { id: r.id, email: r.email };
    } else {
      if (!isValidEmail(email!)) {
        return jsonResponse({ error: "Invalid input" }, 400);
      }
      const r = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first<{ id?: string; email?: string }>();
      if (r && r.id) userRow = { id: r.id, email: r.email };
    }

    if (!userRow) {
      // generic response to avoid enumeration
      console.warn("[resetPassword] user not found (generic)");
      return jsonResponse({ error: "Invalid code or user" }, 401);
    }

    const maskedEmail = (() => {
      try {
        const e = userRow.email || "";
        const [local, domain] = e.split("@");
        const visible = local && local.length > 1 ? local[0] + "..." + local.slice(-1) : local;
        return `${visible}@${domain}`;
      } catch {
        return "unknown";
      }
    })();

    // fetch reset code
    const codeRow = await env.DB
      .prepare("SELECT code, expires_at FROM password_reset_codes WHERE user_id = ?")
      .bind(userRow.id)
      .first<{ code?: string; expires_at?: string }>();

    if (!codeRow || !codeRow.code) {
      console.warn("[resetPassword] no reset row for user:", maskedEmail);
      return jsonResponse({ error: "Invalid or expired code" }, 401);
    }

    const nowMs = Date.now();
    const expiresMs = Date.parse(codeRow.expires_at || "");
    if (codeRow.code !== code || isNaN(expiresMs) || expiresMs < nowMs) {
      console.warn("[resetPassword] code invalid/expired for user:", maskedEmail);
      return jsonResponse({ error: "Invalid or expired code" }, 401);
    }

    // hash new password
    const newHash = await hashPassword(new_password);

    // update user's password
    await env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(newHash, userRow.id)
      .run();

    // delete reset code (cleanup)
    try {
      await env.DB.prepare("DELETE FROM password_reset_codes WHERE user_id = ?").bind(userRow.id).run();
    } catch (delErr) {
      console.warn("[resetPassword] falha ao deletar código de reset (não fatal):", delErr);
    }

    // revoke sessions for user (mark revoked) - non-fatal
    try {
      await env.DB.prepare("UPDATE user_sessions SET revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(userRow.id).run();
    } catch (revErr) {
      console.warn("[resetPassword] revoke sessions failed (non-fatal):", revErr);
    }

    // clear attempts (non-fatal)
    try {
      const clientIp = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown");
      await clearAttempts(env.DB, userRow.email || "", clientIp);
    } catch (clearErr) {
      console.warn("[resetPassword] clearAttempts failed (non-fatal):", clearErr);
    }

    console.info("[resetPassword] password reset OK for user:", maskedEmail);
    return jsonResponse({ ok: true }, 200);
  } catch (err: any) {
    console.error("[resetPassword] unexpected error:", err?.message ?? err, err?.stack);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
