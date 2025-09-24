import { generateJWT } from "../service/generateJWT";
import { hashPassword } from "../service/managerPassword";
import { generateRefreshToken, createSession } from "../service/sessionManager";
import type { Env } from "../types/Env";

interface RegisterRequestBody {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  birth_date: string;
}

interface DBUser {
  id: string;
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isValidEmail(email: string) {
  // regex simples — não perfeita, suficiente para validação básica
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function registerUser(
  request: Request,
  env: Env
): Promise<Response> {
  console.info("[registerUser] solicitação recebida");

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.warn("[registerUser] invalid JSON body");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { email, password, full_name, phone, birth_date } =
    body as RegisterRequestBody;

  if (!email || !password || !full_name || !phone || !birth_date) {
    console.warn("[registerUser] corpo de solicitação malformado: ", {
      missing: [
        !email && "email",
        !password && "password",
        !full_name && "full_name",
        !phone && "phone",
        !birth_date && "birth_date",
      ].filter(Boolean),
    });
    return jsonResponse({ error: "Malformed request body" }, 400);
  }

  if (!isValidEmail(email)) {
    console.warn("[registerUser] formato de e-mail inválido: ", email);
    return jsonResponse({ error: "Invalid email format" }, 400);
  }

  if (password.length < 8) {
    console.warn("[registerUser] senha inválida pois é muito curta:");
    return jsonResponse(
      { error: "Password must be at least 8 characters" },
      400
    );
  }

  if (isNaN(Date.parse(birth_date))) {
    console.warn("[registerUser] data de nascimento inválida: ", birth_date);
    return jsonResponse({ error: "Invalid birth_date format" }, 400);
  }

  if (!env.JWT_SECRET) {
    console.error("[registerUser] JWT_SECRET ausente no ambiente");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  const refreshDays = env.REFRESH_TOKEN_EXPIRATION_DAYS
    ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS)
    : 30;

  // Do not log the full email + password pair. Log only non-sensitive info.
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

  console.info("[registerUser] registrando: ", maskedEmail);

  try {
    // Check if user already exists
    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?"
    )
      .bind(email)
      .first<DBUser>();

    if (existing && existing.id) {
      console.info("[registerUser] o usuário já existe: ", maskedEmail);
      return jsonResponse({ error: "User already exists" }, 409);
    }

    // Hash password
    console.info("[registerUser] hash de senha para: ", maskedEmail);
    const passwordHash = await hashPassword(password);

    // Insert user and get id - try to use RETURNING if available, fallback to select.
    // Use a single INSERT then SELECT for compatibility.
    console.info("[registerUser] inserindo usuário na tabela");
    const user = await env.DB.prepare(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'client', CURRENT_TIMESTAMP) RETURNING id"
    )
      .bind(email, passwordHash)
      .first<DBUser>();

    if (!user || !user.id) {
      console.error(
        "[registerUser] failed to retrieve user id after insert for",
        maskedEmail
      );
      return jsonResponse({ error: "Failed to create user" }, 500);
    }

    // Insert user profile (correct binding order)
    console.info(
      "[registerUser] inserindo perfil de usuário para user_id= ",
      user.id
    );
    await env.DB.prepare(
      "INSERT INTO user_profiles (user_id, full_name, phone, birth_date) VALUES (?, ?, ?, ?)"
    )
      .bind(user.id, full_name, phone, birth_date)
      .run();

    // Tokens: access + refresh
    const accessTokenTtlSeconds = env.JWT_EXPIRATION_SEC
      ? Number(env.JWT_EXPIRATION_SEC)
      : 3600;
    console.info("[registerUser] gerando token de acesso");
    const access_token = await generateJWT(
      { sub: user.id, email, full_name, phone, birth_date },
      env.JWT_SECRET,
      accessTokenTtlSeconds
    );

    // Create & persist refresh token/session
    console.info("[registerUser] gerando token de atualização");
    const plainRefresh = await generateRefreshToken(64);
    const expiresAt = new Date(
      Date.now() + refreshDays * 24 * 60 * 60 * 1000
    ).toISOString();

    console.info("[registerUser] criando sessão no DB para user_id= ", user.id);
    await createSession(env.DB, user.id, plainRefresh, expiresAt);

    console.info("[registerUser] registro bem-sucedido para", maskedEmail);
    return jsonResponse(
      {
        access_token,
        refresh_token: plainRefresh,
        expires_at: expiresAt,
      },
      201
    );
  } catch (err: any) {
    // Detect unique constraint (DB-specific): attempt to match common messages
    const msg = (err && (err.message || String(err))) || "unknown error";
    console.error("[registerUser] erro ao registrar: ", {
      email: maskedEmail,
      error: msg,
      stack: err?.stack,
    });

    const isUniqueErr =
      /unique constraint|UNIQUE constraint failed|already exists|duplicate key|unique/i.test(
        msg
      );

    if (isUniqueErr) {
      return jsonResponse({ error: "User already exists" }, 409);
    }

    return jsonResponse({ error: "Internal server error" }, 500);
  }
}
