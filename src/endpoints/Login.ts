import { generateJWT } from "../service/generateJWT";
import { comparePassword } from "../service/managerPassword";
import { generateRefreshToken, createSession } from "../service/sessionManager";
import type { Env } from "../types/Env";

interface LoginRequestBody {
  email: string;
  password: string;
}

interface DBUser {
  id: string;
  email: string;
  password_hash: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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

  const { email, password } = body as LoginRequestBody;

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

  const refreshDays = env.REFRESH_TOKEN_EXPIRATION_DAYS
    ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS)
    : 30;

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

  console.info("[loginUser] tentando fazer login para: ", maskedEmail);

  try {
    const user = await env.DB.prepare(
      "SELECT id, email, password_hash FROM users WHERE email = ?"
    )
      .bind(email)
      .first<DBUser>();

    if (!user) {
      console.warn("[loginUser] usuário não encontrado: ", maskedEmail);
      return jsonResponse({ error: "Invalid credentials" }, 401);
    }

    const passwordMatch = await comparePassword(password, user.password_hash);
    if (!passwordMatch) {
      console.warn("[loginUser] senha inválida para: ", maskedEmail);
      return jsonResponse({ error: "Invalid credentials" }, 401);
    }

    const expiresIn = env.JWT_EXPIRATION_SEC
      ? Number(env.JWT_EXPIRATION_SEC)
      : 3600;

    console.info("[loginUser] gerando token de acesso para user_id= ", user.id);
    const access_token = await generateJWT(
      { userId: user.id, email: user.email },
      env.JWT_SECRET,
      expiresIn
    );

    console.info("[loginUser] gerando token de atualização");
    const plainRefresh = await generateRefreshToken(64);
    const expiresAt = new Date(
      Date.now() + refreshDays * 24 * 60 * 60 * 1000
    ).toISOString();

    console.info("[loginUser] criando sessão para user_id= ", user.id);
    await createSession(env.DB, user.id, plainRefresh, expiresAt);

    console.info("[loginUser] login bem-sucedido para: ", maskedEmail);
    return jsonResponse(
      {
        access_token,
        refresh_token: plainRefresh,
        expires_at: expiresAt,
      },
      200
    );
  } catch (err: any) {
    const msg = (err && (err.message || String(err))) || "unknown error";
    console.error("[loginUser] erro inesperado: ", {
      email: maskedEmail,
      error: msg,
      stack: err?.stack,
    });
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
