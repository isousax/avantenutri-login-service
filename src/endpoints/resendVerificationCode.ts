import { generateVerificationCode } from "../utils/generateVerificationCode";
import type { Env } from "../types/Env";
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

const RESEND_COOLDOWN_SEC = 60; // 1 minuto entre envios
const CODE_TTL_MIN = 15; // validade do código em minutos

export async function resendVerificationCode(request: Request, env: Env): Promise<Response> {
  console.info("[resendVerificationCode] solicitação recebida");

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.warn("[resendVerificationCode] corpo JSON inválido");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { email } = (body as { email?: string }) || {};
  if (!email || !isValidEmail(email)) {
    console.warn("[resendVerificationCode] e-mail ausente/inválido");
    // Não vaza se o email existe — resposta genérica
    return jsonResponse({ ok: true }, 200);
  }

  // Resolve user; if not found -> return 200 (no-op) to avoid enumeration
  try {
    // Find user by email
    const userRow = await env.DB
      .prepare("SELECT id, email_confirmed FROM users WHERE email = ?")
      .bind(email)
      .first<{ id?: string; email_confirmed?: number }>();

    if (!userRow || !userRow.id) {
      console.info("[resendVerificationCode] e-mail não encontrado (sem operação) para: ", email.replace(/(.{2}).+(@.+)/, "$1***$2"));
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

    // If email already confirmed, return 200 (no-op) — don't reveal state
    if (userRow.email_confirmed) {
      console.info("[resendVerificationCode] e-mail já confirmado (sem operação) para: ", maskedEmail);
      return jsonResponse({ ok: true }, 200);
    }

    // Check cooldown: look at created_at of existing row (if any)
    const existing = await env.DB
      .prepare("SELECT created_at FROM email_verification_codes WHERE user_id = ?")
      .bind(userRow.id)
      .first<{ created_at?: string }>();

    const nowMs = Date.now();
    if (existing && existing.created_at) {
      const lastSentMs = Date.parse(existing.created_at);
      if (!isNaN(lastSentMs)) {
        const diffSec = Math.floor((nowMs - lastSentMs) / 1000);
        if (diffSec < RESEND_COOLDOWN_SEC) {
          const retryAfter = RESEND_COOLDOWN_SEC - diffSec;
          console.warn("[resendVerificationCode] reenviar cooldown ativo para: ", maskedEmail, "retryAfterSec:", retryAfter);
          return jsonResponse({ error: "Too many requests. Try again later." }, 429, { "Retry-After": String(retryAfter) });
        }
      }
    }

    // Generate new code and upsert into email_verification_codes
    const code = generateVerificationCode(6);
    const expiresAt = new Date(nowMs + CODE_TTL_MIN * 60_000).toISOString();

    // Upsert: INSERT ... ON CONFLICT(user_id) DO UPDATE SET ...
    await env.DB.prepare(
      `INSERT INTO email_verification_codes (user_id, code, expires_at, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         code = excluded.code,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`
    ).bind(userRow.id, code, expiresAt).run();

    console.info("[resendVerificationCode] enviando e-mail de verificação para: ", maskedEmail);
    // sendVerificationEmail throws on failure — let it bubble to be handled below
    await sendVerificationEmail(env, email, code);

    console.info("[resendVerificationCode] e-mail enviado (ok) para: ", maskedEmail);
    return jsonResponse({ ok: true }, 200);
  } catch (err: any) {
    // In case of transient failures (email provider down), return 500 so client can retry
    console.error("[resendVerificationCode] unexpected error:", err?.message ?? err, err?.stack);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
