// handlers/registerUser.ts
import { hashPassword } from "../service/managerPassword";
import { getClientIp, clearAttempts } from "../service/authAttempts";
import { generateVerificationCode } from "../utils/generateVerificationCode";
import { sendVerificationEmail } from "../utils/sendVerificationEmail";
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

const PHONE_E164_REGEX = /^\+?[1-9]\d{1,14}$/;
const PASSWORD_POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
const CODE_TTL_MIN = 15;

export async function registerUser(request: Request, env: Env): Promise<Response> {
  console.info("[registerUser] solicitação recebida");

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.warn("[registerUser] invalid JSON body");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { email, password, full_name, phone, birth_date } = body as RegisterRequestBody;

  if (!email || !password || !full_name || !phone || !birth_date) {
    console.warn("[registerUser] corpo de solicitação malformado");
    return jsonResponse({ error: "Malformed request body" }, 400);
  }
  if (!isValidEmail(email)) {
    console.warn("[registerUser] formato de e-mail inválido:", email);
    return jsonResponse({ error: "Invalid email format" }, 400);
  }
  if (!PASSWORD_POLICY_REGEX.test(password)) {
    console.warn("[registerUser] senha não atende à política de segurança");
    return jsonResponse(
      { error: "Password must be at least 8 characters and include lowercase, uppercase, number and symbol" },
      400
    );
  }
  if (isNaN(Date.parse(birth_date))) {
    console.warn("[registerUser] data de nascimento inválida:", birth_date);
    return jsonResponse({ error: "Invalid birth_date format" }, 400);
  }
  if (!PHONE_E164_REGEX.test(phone)) {
    console.warn("[registerUser] telefone inválido (esperado E.164):", phone);
    return jsonResponse({ error: "Invalid phone format (expected E.164, e.g. +5511999999999)" }, 400);
  }
  if (!env.JWT_SECRET) {
    console.error("[registerUser] JWT_SECRET ausente no ambiente");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
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

  console.info("[registerUser] registrando:", maskedEmail);

  // --- create user (non-transactional, but using INSERT ... RETURNING) ---
  let createdUser: DBUser | null = null;
  try {
    const passwordHash = await hashPassword(password);

    const userRow = await env.DB
      .prepare(
        "INSERT INTO users (email, password_hash, role, created_at, email_confirmed) VALUES (?, ?, 'client', CURRENT_TIMESTAMP, 0) RETURNING id"
      )
      .bind(email, passwordHash)
      .first<DBUser>();

    if (!userRow || !userRow.id) {
      console.error("[registerUser] failed to retrieve user id after insert");
      return jsonResponse({ error: "Failed to create user" }, 500);
    }
    createdUser = userRow;

    // insert profile
    await env.DB
      .prepare("INSERT INTO user_profiles (user_id, full_name, phone, birth_date) VALUES (?, ?, ?, ?)")
      .bind(createdUser.id, full_name, phone, birth_date)
      .run();

    // create verification code (upsert)
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000).toISOString();

    await env.DB
      .prepare(
        `INSERT INTO email_verification_codes (user_id, code, expires_at, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, created_at = CURRENT_TIMESTAMP`
      )
      .bind(createdUser.id, code, expiresAt)
      .run();

    // send verification email (network call) - outside a transaction
    try {
      await sendVerificationEmail(env, email, code);
    } catch (sendErr) {
      console.error("[registerUser] falha ao enviar email; iniciando cleanup:", sendErr);

      // best-effort cleanup: delete verification row, profile, user
      try {
        await env.DB.prepare("DELETE FROM email_verification_codes WHERE user_id = ?").bind(createdUser.id).run();
        await env.DB.prepare("DELETE FROM user_profiles WHERE user_id = ?").bind(createdUser.id).run();
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(createdUser.id).run();
        console.info("[registerUser] cleanup completo após falha no envio de email para", maskedEmail);
      } catch (cleanupErr) {
        console.error("[registerUser] cleanup falhou (não fatal):", cleanupErr);
      }

      return jsonResponse({ error: "Failed to send verification email" }, 500);
    }
    
    try {
      const clientIp = getClientIp(request);
      await clearAttempts(env.DB, email, clientIp);
    } catch (cErr) {
      console.warn("[registerUser] clearAttempts falhou (não fatal):", cErr);
    }

    console.info("[registerUser] registro bem-sucedido para", maskedEmail);
    return jsonResponse({ ok: true, user_id: createdUser.id }, 201);
  } catch (err: any) {
    const msg = (err && (err.message || String(err))) || "unknown error";
    console.error("[registerUser] erro ao criar usuário:", { email: maskedEmail, error: msg, stack: err?.stack });

    const isUniqueErr = /unique constraint|UNIQUE constraint failed|already exists|duplicate key|unique/i.test(msg);
    if (isUniqueErr) {
      return jsonResponse({ error: "User already exists" }, 409);
    }

    return jsonResponse({ error: "Internal server error" }, 500);
  }
}
