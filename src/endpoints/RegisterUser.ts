import { hashPassword } from "../service/managerPassword";
import { getClientIp, clearAttempts } from "../service/authAttempts";
import { generateVerificationCode } from "../utils/generateVerificationCode";
import { sendVerificationEmail } from "../utils/sendVerificationEmail"
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


// E.164 basic validation
const PHONE_E164_REGEX = /^\+?[1-9]\d{1,14}$/;

// Password policy: min 8 chars, at least one lower, one upper, one digit and one symbol
const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

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

  if (!PASSWORD_POLICY_REGEX.test(password)) {
    console.warn("[registerUser] senha não atende à política de segurança");
    return jsonResponse(
      {
        error:
          "Password must be at least 8 characters and include lowercase, uppercase, number and symbol",
      },
      400
    );
  }

  if (isNaN(Date.parse(birth_date))) {
    console.warn("[registerUser] data de nascimento inválida: ", birth_date);
    return jsonResponse({ error: "Invalid birth_date format" }, 400);
  }

  if (!PHONE_E164_REGEX.test(phone)) {
    console.warn("[registerUser] telefone inválido (esperado E.164): ", phone);
    return jsonResponse(
      { error: "Invalid phone format (expected E.164, e.g. +5511999999999)" },
      400
    );
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

  // Transactional flow: BEGIN -> checks/inserts -> COMMIT (ROLLBACK on error)
  try {
    console.info("[registerUser] BEGIN transaction");
    await env.DB.prepare("BEGIN").run();

    // Check if user already exists (inside transaction to avoid races)
    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?"
    )
      .bind(email)
      .first<DBUser>();

    if (existing && existing.id) {
      console.info("[registerUser] o usuário já existe: ", maskedEmail);
      await env.DB.prepare("ROLLBACK")
        .run()
        .catch(() => {});
      return jsonResponse({ error: "User already exists" }, 409);
    }

    console.info("[registerUser] hash de senha para: ", maskedEmail);
    const passwordHash = await hashPassword(password);

    console.info("[registerUser] inserindo usuário na tabela (RETURNING id)");
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
      await env.DB.prepare("ROLLBACK")
        .run()
        .catch(() => {});
      return jsonResponse({ error: "Failed to create user" }, 500);
    }

    console.info(
      "[registerUser] inserindo perfil de usuário para user_id= ",
      user.id
    );
    await env.DB.prepare(
      "INSERT INTO user_profiles (user_id, full_name, phone, birth_date) VALUES (?, ?, ?, ?)"
    )
      .bind(user.id, full_name, phone, birth_date)
      .run();

    console.info("[registerUser] gerando código de verificação");
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutos

    await env.DB.prepare(
      `
    INSERT INTO email_verification_codes (user_id, code, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
    code = excluded.code,
    expires_at = excluded.expires_at
    `
    )
      .bind(user.id, code, expiresAt)
      .run();

    console.info("[registerUser] enviando e-mail de verificação");
    await sendVerificationEmail(env, email, code);

    // All good => commit
    console.info("[registerUser] COMMIT transaction");
    await env.DB.prepare("COMMIT").run();

    try {
      console.info("[registerUser] Limpamos tentativas (caso existam)");
      const clientIp = getClientIp(request);
      await clearAttempts(env.DB, email, clientIp);
    } catch (err) {
      console.warn(
        "[registerUser] falha ao limpar tentativas (não fatal): ",
        err
      );
    }

    console.info("[registerUser] registro bem-sucedido para", maskedEmail);
    return jsonResponse({ ok: true, user_id: user.id }, 201);
  } catch (err: any) {
    // Try to rollback if something went wrong
    try {
      console.warn("[registerUser] error encountered, attempting ROLLBACK");
      await env.DB.prepare("ROLLBACK").run();
    } catch (rbErr) {
      console.error("[registerUser] rollback failed:", rbErr);
    }

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
