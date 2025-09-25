import { generateJWT } from "../service/generateJWT";
import { comparePassword } from "../service/managerPassword";
import { generateRefreshToken, createSession } from "../service/sessionManager";
import type { Env } from "../types/Env";
import {
  getClientIp,
  checkLocks,
  registerFailedAttempt,
  clearAttempts,
} from "../service/authAttempts";

interface LoginRequestBody {
  email: string;
  password: string;
  remember: boolean;
}

interface DBUser {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  full_name?: string | null;
  phone?: string | null;
  birth_date?: string | null;
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
) {
  const headers = { ...JSON_HEADERS, ...(extraHeaders || {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function loginUser(request: Request, env: Env): Promise<Response> {
  console.info("[loginUser] solicitação recebida");

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.warn("[loginUser] corpo JSON inválido");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { email, password, remember } = body as LoginRequestBody;
  if (!email || !password) {
    console.warn("[loginUser] e-mail ou senha ausentes");
    return jsonResponse({ error: "Email and password required" }, 400);
  }
  if (!isValidEmail(email)) {
    console.warn("[loginUser] formato de e-mail inválido:", email);
    return jsonResponse({ error: "Invalid email format" }, 400);
  }
  if (!env.JWT_SECRET) {
    console.error("[loginUser] JWT_SECRET ausente no ambiente");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  const refreshDays = remember
    ? env.REFRESH_TOKEN_EXPIRATION_DAYS
      ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS)
      : 30
    : 0;
  const clientIp = getClientIp(request);
  const maskedEmail = (() => {
    try {
      const [local, domain] = email.split("@");
      const visible =
        local.length > 1 ? local[0] + "..." + local.slice(-1) : local;
      return `${visible}@${domain}`;
    } catch {
      return "unknown";
    }
  })();
  console.info("[loginUser] tentativa login para:", maskedEmail);

  try {
    // check locks
    const lock = await checkLocks(env, email, clientIp);
    if (lock.blocked) {
      console.warn("[loginUser] bloqueado por tentativas:", maskedEmail);
      return jsonResponse(
        { error: "Too many attempts. Try again later." },
        429,
        {
          "Retry-After": String(lock.retryAfterSec ?? 60),
        }
      );
    }

    // fetch user + profile
    const user = await env.DB.prepare(
      `SELECT u.id, u.email, u.email_confirmed, u.password_hash, u.role,
                p.full_name, p.phone, p.birth_date,
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE u.email = ?`
    )
      .bind(email)
      .first<DBUser>();

    if (user && (user as any).email_confirmed !== 1) {
      console.warn(
        "[loginUser] tentativa de login para conta não confirmada:",
        maskedEmail
      );
      // opcional: enviar a mensagem específica ou instruir front a chamar /auth/resend-code
      return jsonResponse(
        { error: "Email not verified. Check your inbox." },
        403
      );
    }

    if (!user) {
      // register failed attempt and react accordingly
      const res = await registerFailedAttempt(env, email, clientIp);
      if (res.status === 429) {
        return jsonResponse(
          { error: "Too many attempts. Try again later." },
          429,
          {
            "Retry-After": String(res.retryAfterSec ?? 60),
          }
        );
      }
      return jsonResponse({ error: "Invalid credentials" }, 401);
    }

    const passwordMatch = await comparePassword(password, user.password_hash);
    if (!passwordMatch) {
      const res = await registerFailedAttempt(env, email, clientIp);
      if (res.status === 429) {
        return jsonResponse(
          { error: "Too many attempts. Try again later." },
          429,
          {
            "Retry-After": String(res.retryAfterSec ?? 60),
          }
        );
      }
      return jsonResponse({ error: "Invalid credentials" }, 401);
    }

    // success: clear attempts
    await clearAttempts(env.DB, email, clientIp);

    // issue tokens + session
    const expiresIn = env.JWT_EXPIRATION_SEC
      ? Number(env.JWT_EXPIRATION_SEC)
      : 3600;
    const access_token = await generateJWT(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name ?? undefined,
        phone: user.phone ?? undefined,
        birth_date: user.birth_date ?? undefined,
      },
      env.JWT_SECRET,
      expiresIn
    );

    let plainRefresh: string | null = null;
    let expiresAt: string | null = null;

    if (remember) {
      plainRefresh = await generateRefreshToken(64);
      expiresAt = new Date(
        Date.now() + refreshDays * 24 * 60 * 60 * 1000
      ).toISOString();

      await createSession(env.DB, user.id, plainRefresh, expiresAt);
    }

    console.info("[loginUser] login bem-sucedido para:", maskedEmail);
    return jsonResponse(
      {
        access_token,
        ...(remember && plainRefresh
          ? { refresh_token: plainRefresh, expires_at: expiresAt }
          : {}),
      },
      200
    );
  } catch (err: any) {
    console.error("[loginUser] erro inesperado:", err);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
