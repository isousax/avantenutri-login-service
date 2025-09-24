import type { Env } from "../types/Env";
import { sendPasswordResetEmail } from "../utils/sendPasswordResetEmail"

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

// secure numeric code
function generateCode(length = 6): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  const rv = crypto.getRandomValues(new Uint32Array(1))[0];
  const val = min + (rv % (max - min + 1));
  return String(val).padStart(length, "0");
}

const RESEND_COOLDOWN_SEC = 60; // 1 min
const CODE_TTL_MIN = 15;

export async function requestPasswordReset(request: Request, env: Env): Promise<Response> {
  console.info("[requestPasswordReset] request received");

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.warn("[requestPasswordReset] invalid JSON");
    return jsonResponse({ ok: true }, 200); // generic to avoid enumeration
  }

  const { email } = (body as { email?: string }) || {};
  if (!email || !isValidEmail(email)) {
    console.warn("[requestPasswordReset] missing/invalid email");
    return jsonResponse({ ok: true }, 200); // don't reveal existence
  }

  // find user
  try {
    const userRow = await env.DB
      .prepare("SELECT id, email_confirmed FROM users WHERE email = ?")
      .bind(email)
      .first<{ id?: string; email_confirmed?: number }>();

    // Always return ok (no enumeration). If no user, do nothing but return 200.
    if (!userRow || !userRow.id) {
      console.info("[requestPasswordReset] email not found (no-op):", email.replace(/(.{2}).+(@.+)/, "$1***$2"));
      return jsonResponse({ ok: true }, 200);
    }

    const maskedEmail = (() => {
      try {
        const [local, domain] = email.split("@");
        const visible = local.length > 1 ? local[0] + "..." + local.slice(-1) : local;
        return `${visible}@${domain}`;
      } catch {
        return "unknown";
      }
    })();

    // ensure table exists (idempotent)
    try {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS password_reset_codes (
           user_id TEXT PRIMARY KEY,
           code TEXT NOT NULL,
           expires_at TEXT NOT NULL,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
         )`
      ).run();
    } catch (err) {
      console.warn("[requestPasswordReset] ensure table password_reset_codes failed (proceed):", err);
    }

    // check cooldown using created_at
    const existing = await env.DB
      .prepare("SELECT created_at FROM password_reset_codes WHERE user_id = ?")
      .bind(userRow.id)
      .first<{ created_at?: string }>();

    const nowMs = Date.now();
    if (existing && existing.created_at) {
      const lastMs = Date.parse(existing.created_at);
      if (!isNaN(lastMs)) {
        const diffSec = Math.floor((nowMs - lastMs) / 1000);
        if (diffSec < RESEND_COOLDOWN_SEC) {
          const retryAfter = RESEND_COOLDOWN_SEC - diffSec;
          console.warn("[requestPasswordReset] resend cooldown active for:", maskedEmail, "retryAfter:", retryAfter);
          return jsonResponse({ error: "Too many requests. Try again later." }, 429, { "Retry-After": String(retryAfter) });
        }
      }
    }

    // generate code and upsert
    const code = generateCode(6);
    const expiresAt = new Date(nowMs + CODE_TTL_MIN * 60_000).toISOString();

    await env.DB.prepare(
      `INSERT INTO password_reset_codes (user_id, code, expires_at, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         code = excluded.code,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`
    ).bind(userRow.id, code, expiresAt).run();

    // send email (throws on failure)
    await sendPasswordResetEmail(env, email, code);

    console.info("[requestPasswordReset] reset email queued for:", maskedEmail);
    return jsonResponse({ ok: true }, 200);
  } catch (err: any) {
    console.error("[requestPasswordReset] unexpected error:", err?.message ?? err, err?.stack);
    // For safety, do not leak internal error — return generic 200 or 500?
    // We'll return 500 to indicate failure to client in case of email provider problem.
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
