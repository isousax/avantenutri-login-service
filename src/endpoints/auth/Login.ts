import { generateJWT } from "../../service/generateJWT";
import { comparePassword } from "../../service/managerPassword";
import { generateRefreshToken, createSession } from "../../service/sessionManager";
import type { Env } from "../../types/Env";
import {
  getClientIp,
  checkLocks,
  registerFailedAttempt,
  clearAttempts,
} from "../../service/authAttempts";

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
    return jsonResponse(
      { error: "O corpo da requisição não está em formato JSON válido." },
      400
    );
  }

  const { email, password, remember } = body as LoginRequestBody;
  if (!email || !password) {
    console.warn("[loginUser] e-mail ou senha ausentes");
    return jsonResponse({ error: "E-mail e senha são obrigatórios." }, 400);
  }
  if (!isValidEmail(email)) {
    console.warn("[loginUser] formato de e-mail inválido:", email);
    return jsonResponse(
      { error: "O formato do e-mail informado é inválido." },
      400
    );
  }
  if (!env.JWT_SECRET) {
    console.error("[loginUser] JWT_SECRET ausente no ambiente");
    return jsonResponse(
      {
        error:
          "Erro interno no servidor. Por favor, tente novamente mais tarde.",
      },
      500
    );
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
  console.info("[loginUser] tentativa de login para:", maskedEmail);

  try {
    // check locks
    const lock = await checkLocks(env, email, clientIp);
    if (lock.blocked) {
      console.warn("[loginUser] bloqueado por tentativas:", maskedEmail);
      return jsonResponse(
        {
          error:
            "Muitas tentativas de acesso. Por favor, tente novamente mais tarde.",
        },
        429,
        {
          "Retry-After": String(lock.retryAfterSec ?? 60),
        }
      );
    }

    // fetch user + profile
    const user = await env.DB.prepare(
      `SELECT u.id, u.email, u.email_confirmed, u.password_hash, u.role, u.session_version,
                p.full_name, p.phone, p.birth_date
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
      return jsonResponse(
        { error: "E-mail não verificado. Verifique sua caixa de entrada." },
        403
      );
    }

    if (!user) {
      // register failed attempt and react accordingly
      const res = await registerFailedAttempt(env, email, clientIp);
      if (res.status === 429) {
        return jsonResponse(
          {
            error:
              "Muitas tentativas de acesso. Por favor, tente novamente mais tarde.",
          },
          429,
          {
            "Retry-After": String(res.retryAfterSec ?? 60),
          }
        );
      }
      return jsonResponse({ error: "Credenciais inválidas." }, 401);
    }

    const passwordMatch = await comparePassword(password, user.password_hash);
    if (!passwordMatch) {
      const res = await registerFailedAttempt(env, email, clientIp);
      if (res.status === 429) {
        return jsonResponse(
          {
            error:
              "Muitas tentativas de acesso. Por favor, tente novamente mais tarde.",
          },
          429,
          {
            "Retry-After": String(res.retryAfterSec ?? 60),
          }
        );
      }
      return jsonResponse({ error: "Credenciais inválidas." }, 401);
    }

    // success: clear attempts
    await clearAttempts(env.DB, email, clientIp);

    // Atualiza last_login_at e display_name se ainda não definido (display_name fallback para parte antes de @)
    try {
      const fallbackName = (user.email || "").split("@")[0];
      await env.DB.prepare(
        `UPDATE users SET last_login_at = CURRENT_TIMESTAMP, display_name = COALESCE(display_name, ?) , updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
        .bind(fallbackName, user.id)
        .first();
    } catch (e) {
      console.warn(
        "[loginUser] falha ao atualizar last_login_at/display_name",
        e
      );
    }

    // issue tokens + session
    const expiresIn = env.JWT_EXPIRATION_SEC
      ? Number(env.JWT_EXPIRATION_SEC)
      : 3600;
    // Recuperar display_name definitivo para inserir no token
    let displayNameRow: { display_name?: string } | null = null;
    try {
      displayNameRow = await env.DB.prepare(
        "SELECT display_name FROM users WHERE id = ?"
      )
        .bind(user.id)
        .first<{ display_name?: string }>();
    } catch {}

    const access_token = await generateJWT(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        session_version: (user as any).session_version ?? 0,
        full_name: user.full_name ?? undefined,
        phone: user.phone ?? undefined,
        birth_date: user.birth_date ?? undefined,
        display_name: displayNameRow?.display_name ?? undefined,
        iss: env.SITE_DNS,
        aud: env.SITE_DNS,
      },
      env.JWT_SECRET,
      expiresIn,
      env.JWT_PRIVATE_KEY_PEM
        ? {
            privateKeyPem: env.JWT_PRIVATE_KEY_PEM,
            kid: env.JWT_JWKS_KID || "k1",
          }
        : undefined
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
        token_type: "Bearer",
        display_name: displayNameRow?.display_name ?? null,
        ...(remember && plainRefresh
          ? { refresh_token: plainRefresh, expires_at: expiresAt }
          : {}),
      },
      200
    );
  } catch (err: any) {
    console.error("[loginUser] erro inesperado:", err);
    return jsonResponse(
      {
        error:
          "Ocorreu um problema no sistema. Por favor, tente novamente mais tarde.",
      },
      500
    );
  }
}
