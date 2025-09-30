import { hashPassword } from "../../service/managerPassword";
import { getClientIp, clearAttempts } from "../../service/authAttempts";
import { generateToken } from "../../utils/generateToken";
import { hashToken } from "../../utils/hashToken";
import { sendVerificationEmail } from "../../utils/sendVerificationEmail";
import { normalizePhone, phoneErrorMessage } from "../../utils/normalizePhone";
import type { Env } from "../../types/Env";

interface RegisterRequestBody {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  birth_date?: string;
}

interface DBUser {
  id: string;
  email_confirmed?: number;
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
const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
const TOKEN_TTL_MIN = 15; // token expiration in minutes

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
    return jsonResponse(
      { error: "Preencha todos os campos obrigatórios antes de continuar." },
      400
    );
  }

  const { email, password, full_name, phone, birth_date } =
    body as RegisterRequestBody;

  if (!email || !password || !full_name || !phone) {
    console.warn("[registerUser] corpo de solicitação malformado");
    return jsonResponse(
      { error: "Preencha todos os campos obrigatórios antes de continuar." },
      400
    );
  }
  if (!isValidEmail(email)) {
    console.warn("[registerUser] formato de e-mail inválido:", email);
    return jsonResponse(
      {
        error:
          "O endereço de e-mail informado não é válido. Verifique e tente novamente.",
      },
      400
    );
  }
  if (!PASSWORD_POLICY_REGEX.test(password)) {
    console.warn("[registerUser] senha não atende à política de segurança");
    return jsonResponse(
      {
        error:
          "Escolha uma senha mais segura. Ela deve ter pelo menos 8 caracteres e incluir letras, números e símbolos.",
      },
      400
    );
  }
  if (birth_date && isNaN(Date.parse(birth_date))) {
    console.warn("[registerUser] data de nascimento inválida:", birth_date);
    return jsonResponse(
      {
        error:
          "A data de nascimento informada é inválida. Verifique e tente novamente.",
      },
      400
    );
  }
  // Nova validação/normalização de telefone
  const phoneNorm = normalizePhone(phone, 'BR');
  if (!phoneNorm.ok || !phoneNorm.normalized) {
    console.warn(
      "[registerUser] telefone inválido após normalização:",
      phone,
      phoneNorm.reason
    );
    return jsonResponse({ error: phoneErrorMessage(phoneNorm.reason) }, 400);
  }
  const normalizedPhone = phoneNorm.normalized;

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

  const displayName = full_name.trim().split(" ")[0];

  console.info("[registerUser] registrando:", maskedEmail);

  // --- Prepare passwordHash early ---
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    console.error("[registerUser] hashPassword failed", err);
    return jsonResponse(
      {
        error:
          "Ocorreu um erro inesperado. Por favor, tente novamente mais tarde.",
      },
      500
    );
  }

  // --- Check if user exists first ---
  try {
    const existing = await env.DB.prepare(
      "SELECT id, email_confirmed FROM users WHERE email = ?"
    )
      .bind(email)
      .first<DBUser>();

    if (existing && existing.id) {
      // If already confirmed -> reject
      if (Number(existing.email_confirmed) === 1) {
        console.warn(
          "[registerUser] tentativa de registro para email já existente e confirmado:",
          maskedEmail
        );
        return jsonResponse(
          {
            error:
              "Este e-mail já está cadastrado. Tente fazer login ou recupere sua senha.",
          },
          409
        );
      }

      // existing but NOT confirmed -> treat as re-register: update password + profile and continue
      console.info(
        "[registerUser] email já existe, não confirmado — atualizando conta existente:",
        maskedEmail
      );
      try {
        // update password_hash + updated_at
        await env.DB.prepare(
          "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
          .bind(passwordHash, existing.id)
          .run();

        // replace profile: delete + insert (simple, keeps id stable)
        await env.DB.prepare("DELETE FROM user_profiles WHERE user_id = ?")
          .bind(existing.id)
          .run();

        if (birth_date) {
          await env.DB.prepare(
            "INSERT INTO user_profiles (user_id, full_name, phone, birth_date, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
          )
            .bind(existing.id, full_name, normalizedPhone, birth_date)
            .run();
        } else {
          await env.DB.prepare(
            "INSERT INTO user_profiles (user_id, full_name, phone, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
          )
            .bind(existing.id, full_name, normalizedPhone)
            .run();
        }

        // Now create new verification token and send email (below)
        // set createdUser.id for reuse
        const createdUser = { id: existing.id };

        // create verification token (store only hash)
        const plainToken = generateToken(32);
        const tokenHash = await hashToken(plainToken);
        const expiresAt = new Date(
          Date.now() + TOKEN_TTL_MIN * 60 * 1000
        ).toISOString();

        await env.DB.prepare(
          `INSERT INTO email_verification_codes (user_id, token_hash, expires_at, created_at, used)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
           ON CONFLICT(user_id) DO UPDATE SET
             token_hash = excluded.token_hash,
             expires_at = excluded.expires_at,
             created_at = CURRENT_TIMESTAMP,
             used = 0`
        )
          .bind(createdUser.id, tokenHash, expiresAt)
          .run();

        // build verification link and send email
        const base = env.SITE_DNS;
        const link = `${base}/confirm-email?token=${encodeURIComponent(
          plainToken
        )}`;

        try {
          await sendVerificationEmail(env, email, link);
        } catch (sendErr) {
          console.error(
            "[registerUser] falha ao enviar email; iniciando cleanup token:",
            sendErr
          );
          // try to remove verification code to avoid stale token (keep account, but no token)
          try {
            await env.DB.prepare(
              "DELETE FROM email_verification_codes WHERE user_id = ?"
            )
              .bind(createdUser.id)
              .run();
          } catch (cleanupErr) {
            console.warn(
              "[registerUser] cleanup token failed (non-fatal):",
              cleanupErr
            );
          }
          return jsonResponse(
            {
              error:
                "Não foi possível enviar o e-mail de verificação. Por favor, tente novamente mais tarde.",
            },
            500
          );
        }

        // clear attempts (non-fatal)
        try {
          const clientIp = getClientIp(request);
          await clearAttempts(env.DB, email, clientIp);
        } catch (cErr) {
          console.warn(
            "[registerUser] clearAttempts falhou (não fatal):",
            cErr
          );
        }

        console.info(
          "[registerUser] re-registro bem-sucedido (conta existente atualizada) para",
          maskedEmail
        );
        return jsonResponse({ ok: true, user_id: createdUser.id }, 201);
      } catch (innerErr) {
        console.error(
          "[registerUser] erro ao atualizar conta existente:",
          innerErr
        );
        return jsonResponse(
          {
            error:
              "Ocorreu um erro ao atualizar seus dados. Por favor, tente novamente mais tarde.",
          },
          500
        );
      }
    }

    // --- No existing user: create new user (original flow) ---
    // Determina role inicial: somente o email que corresponde a INITIAL_ADMIN_EMAIL-> admin
    let initialRole: "patient" | "admin" = "patient";
    if (
      env.INITIAL_ADMIN_EMAIL &&
      env.INITIAL_ADMIN_EMAIL.toLowerCase() === email.toLowerCase()
    ) {
      initialRole = "admin";
    }

    const userRow = await env.DB.prepare(
      "INSERT INTO users (email, password_hash, role, created_at, email_confirmed) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0) RETURNING id"
    )
      .bind(email, passwordHash, initialRole)
      .first<DBUser>();

    if (!userRow || !userRow.id) {
      console.error("[registerUser] failed to retrieve user id after insert");
      return jsonResponse(
        {
          error:
            "Não foi possível criar sua conta no momento. Por favor, tente novamente mais tarde.",
        },
        500
      );
    }
    const createdUser = userRow;

    // insert profile
    // FIX: corrigido número de placeholders (antes faltavam '?') causando erro 500 na primeira tentativa de registro
    if (birth_date) {
      await env.DB.prepare(
        "INSERT INTO user_profiles (user_id, full_name, display_name, phone, birth_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      )
        .bind(createdUser.id, full_name, displayName, normalizedPhone, birth_date)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO user_profiles (user_id, full_name, display_name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      )
        .bind(createdUser.id, full_name, displayName, normalizedPhone)
        .run();
    }

    // create verification token (store only hash)
    const plainToken = generateToken(32);
    const tokenHash = await hashToken(plainToken);
    const expiresAt = new Date(
      Date.now() + TOKEN_TTL_MIN * 60 * 1000
    ).toISOString();

    try {
      await env.DB.prepare(
        `INSERT INTO email_verification_codes (user_id, token_hash, expires_at, created_at, used)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
         ON CONFLICT(user_id) DO UPDATE SET
           token_hash = excluded.token_hash,
           expires_at = excluded.expires_at,
           created_at = CURRENT_TIMESTAMP,
           used = 0`
      )
        .bind(createdUser.id, tokenHash, expiresAt)
        .run();
    } catch (dbErr) {
      console.error(
        "[registerUser] falha ao gravar token de verificação:",
        dbErr
      );
      // best-effort cleanup: remove created user+profile to avoid orphaned accounts
      try {
        await env.DB.prepare("DELETE FROM user_profiles WHERE user_id = ?")
          .bind(createdUser.id)
          .run();
        await env.DB.prepare("DELETE FROM users WHERE id = ?")
          .bind(createdUser.id)
          .run();
        console.info(
          "[registerUser] cleanup realizado após erro ao gravar token"
        );
      } catch (cleanupErr) {
        console.error("[registerUser] cleanup falhou (não fatal):", cleanupErr);
      }
      return jsonResponse(
        {
          error:
            "Ocorreu um problema ao finalizar seu cadastro. Por favor, tente novamente mais tarde.",
        },
        500
      );
    }

    // build verification link and send email
    const base = env.SITE_DNS;
    const link = `${base}/confirm-email?token=${encodeURIComponent(
      plainToken
    )}`;

    try {
      await sendVerificationEmail(env, email, link);
    } catch (sendErr) {
      console.error(
        "[registerUser] falha ao enviar email; iniciando cleanup:",
        sendErr
      );

      // best-effort cleanup: delete verification row, profile, user
      try {
        await env.DB.prepare(
          "DELETE FROM email_verification_codes WHERE user_id = ?"
        )
          .bind(createdUser.id)
          .run();
        await env.DB.prepare("DELETE FROM user_profiles WHERE user_id = ?")
          .bind(createdUser.id)
          .run();
        await env.DB.prepare("DELETE FROM users WHERE id = ?")
          .bind(createdUser.id)
          .run();
        console.info(
          "[registerUser] cleanup completo após falha no envio de email para",
          maskedEmail
        );
      } catch (cleanupErr) {
        console.error("[registerUser] cleanup falhou (não fatal):", cleanupErr);
      }

      return jsonResponse(
        {
          error:
            "Não foi possível enviar o e-mail de verificação. Seu cadastro não foi concluído. Por favor, tente novamente mais tarde.",
        },
        500
      );
    }

    // clear attempts (non-fatal)
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
    console.error("[registerUser] erro ao criar usuário:", {
      email: maskedEmail,
      error: msg,
      stack: err?.stack,
    });

    // Fallback: attach unique error detection (just in case)
    const isUniqueErr =
      /unique constraint|UNIQUE constraint failed|already exists|duplicate key|unique/i.test(
        msg
      );
    if (isUniqueErr) {
      return jsonResponse(
        {
          error:
            "Este e-mail já está cadastrado. Por favor, tente fazer login ou recupere sua senha.",
        },
        409
      );
    }

    return jsonResponse(
      {
        error:
          "Ocorreu um problema ao processar sua solicitação. Por favor, tente novamente mais tarde.",
      },
      500
    );
  }
}
