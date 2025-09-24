import type { Env } from "../types/Env";

export type AttemptsConfig = {
  maxPerIp?: number;
  lockMinutesIp?: number;
  maxGlobal?: number;
  lockMinutesGlobal?: number;
};

const DEFAULTS: Required<AttemptsConfig> = {
  maxPerIp: 5,
  lockMinutesIp: 15,
  maxGlobal: 10,
  lockMinutesGlobal: 30,
};

/**
 * Tenta extrair o IP do cliente.
 * Prioriza Cloudflare header, depois X-Forwarded-For, X-Real-IP.
 * Retorna 'unknown' se não achar.
 */
export function getClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri;
  return "unknown";
}

/**
 * Verifica locks por email+ip e global.
 * Retorna { blocked, retryAfterSec, reason }.
 */
export async function checkLocks(
  env: Env,
  email: string,
  ip: string,
  cfg?: AttemptsConfig
): Promise<{ blocked: boolean; retryAfterSec?: number; reason?: "ip" | "global" }> {
  const { lockMinutesIp, lockMinutesGlobal } = { ...DEFAULTS, ...(cfg || {}) };
  const nowMs = Date.now();

  const ipRow = await env.DB
    .prepare("SELECT locked_until FROM login_attempts WHERE email = ? AND ip = ?")
    .bind(email, ip)
    .first<{ locked_until?: string }>();

  if (ipRow && ipRow.locked_until) {
    const lockedMs = Date.parse(ipRow.locked_until);
    if (!isNaN(lockedMs) && lockedMs > nowMs) {
      return { blocked: true, retryAfterSec: Math.ceil((lockedMs - nowMs) / 1000), reason: "ip" };
    }
  }

  const globalRow = await env.DB
    .prepare("SELECT locked_until FROM login_attempts_global WHERE email = ?")
    .bind(email)
    .first<{ locked_until?: string }>();

  if (globalRow && globalRow.locked_until) {
    const lockedMs = Date.parse(globalRow.locked_until);
    if (!isNaN(lockedMs) && lockedMs > nowMs) {
      return { blocked: true, retryAfterSec: Math.ceil((lockedMs - nowMs) / 1000), reason: "global" };
    }
  }

  return { blocked: false };
}

/**
 * Registra uma tentativa falhada (upsert em email+ip e global) e aplica locks se os limiares forem atingidos.
 * Retorna { status: 401 | 429, retryAfterSec?: number } para orientar o handler.
 */
export async function registerFailedAttempt(
  env: Env,
  email: string,
  ip: string,
  cfg?: AttemptsConfig
): Promise<{ status: 401 | 429; retryAfterSec?: number }> {
  const { maxPerIp, lockMinutesIp, maxGlobal, lockMinutesGlobal } = { ...DEFAULTS, ...(cfg || {}) };
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // Upsert per-ip
  await env.DB
    .prepare(
      `INSERT INTO login_attempts(email, ip, attempts, last_attempt_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(email, ip) DO UPDATE SET
         attempts = login_attempts.attempts + 1,
         last_attempt_at = excluded.last_attempt_at`
    )
    .bind(email, ip, nowIso)
    .run();

  // Upsert global
  await env.DB
    .prepare(
      `INSERT INTO login_attempts_global(email, attempts, last_attempt_at)
       VALUES (?, 1, ?)
       ON CONFLICT(email) DO UPDATE SET
         attempts = login_attempts_global.attempts + 1,
         last_attempt_at = excluded.last_attempt_at`
    )
    .bind(email, nowIso)
    .run();

  // Re-read counters
  const ipAfter = await env.DB
    .prepare("SELECT attempts FROM login_attempts WHERE email = ? AND ip = ?")
    .bind(email, ip)
    .first<{ attempts?: number }>();
  const globalAfter = await env.DB
    .prepare("SELECT attempts FROM login_attempts_global WHERE email = ?")
    .bind(email)
    .first<{ attempts?: number }>();

  const ipAttempts = (ipAfter && ipAfter.attempts) || 0;
  const globalAttempts = (globalAfter && globalAfter.attempts) || 0;

  // apply locks if thresholds reached
  if (ipAttempts >= maxPerIp) {
    const lockedUntil = new Date(nowMs + lockMinutesIp * 60_000).toISOString();
    await env.DB
      .prepare("UPDATE login_attempts SET locked_until = ? WHERE email = ? AND ip = ?")
      .bind(lockedUntil, email, ip)
      .run();
    return { status: 429, retryAfterSec: Math.ceil((lockMinutesIp * 60)) };
  }

  if (globalAttempts >= maxGlobal) {
    const lockedUntilG = new Date(nowMs + lockMinutesGlobal * 60_000).toISOString();
    await env.DB
      .prepare("UPDATE login_attempts_global SET locked_until = ? WHERE email = ?")
      .bind(lockedUntilG, email)
      .run();
    return { status: 429, retryAfterSec: Math.ceil((lockMinutesGlobal * 60)) };
  }

  return { status: 401 };
}

/**
 * Limpa tentativas para um par (email, ip) e global -> chamado em sucesso de login/registro.
 * Não é fatal se falhar.
 */
export async function clearAttempts(db: any, email: string, ip?: string) {
  try {
    if (ip) {
      await db.prepare("DELETE FROM login_attempts WHERE email = ? AND ip = ?").bind(email, ip).run();
    }
    await db.prepare("DELETE FROM login_attempts_global WHERE email = ?").bind(email).run();
  } catch (err) {
    console.warn("[authAttempts] clearAttempts failed (non-fatal):", err);
  }
}
