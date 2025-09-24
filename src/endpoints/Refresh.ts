import type { Env } from "../types/Env";
import {
  findSessionByRefreshToken,
  rotateSession,
  generateRefreshToken,
} from "../service/sessionManager";
import { generateJWT } from "../service/generateJWT";
import { clearAttempts } from "../service/authAttempts";

interface RefreshRequestBody {
  refresh_token: string;
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function refreshTokenHandler(
  request: Request,
  env: Env
): Promise<Response> {
  console.info("[refreshTokenHandler] solicitação recebida");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.warn("[refreshTokenHandler] corpo JSON inválido");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { refresh_token } = body as RefreshRequestBody;

  if (!refresh_token) {
    console.warn("[refreshTokenHandler] refresh_token ausente");
    return jsonResponse({ error: "refresh_token required" }, 400);
  }

  if (!env.JWT_SECRET) {
    console.error("[refreshTokenHandler] JWT_SECRET ausente no ambiente");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  try {
    console.info("[refreshTokenHandler] procurando sessão para refresh_token");
    const session = await findSessionByRefreshToken(env.DB, refresh_token);

    if (!session) {
      console.warn("[refreshTokenHandler] sessão não encontrada para token");
      return jsonResponse({ error: "Invalid refresh token" }, 401);
    }

    if (session.revoked) {
      console.warn(
        "[refreshTokenHandler] sessão revogada para user_id= ",
        session.user_id
      );
      return jsonResponse({ error: "Refresh token revoked" }, 401);
    }

    const expiresAt = new Date(session.expires_at).getTime();
    if (isNaN(expiresAt) || expiresAt < Date.now()) {
      console.warn(
        "[refreshTokenHandler] token de atualização expirado para user_id= ",
        session.user_id
      );
      return jsonResponse({ error: "Refresh token expired" }, 401);
    }

    // Tudo ok: gerar novo access token
    const jwtExp = env.JWT_EXPIRATION_SEC
      ? Number(env.JWT_EXPIRATION_SEC)
      : 3600;

    console.info(
      "[refreshTokenHandler] gerando novo token de acesso para user_id= ",
      session.user_id
    );
    const access_token = await generateJWT(
      { userId: session.user_id },
      env.JWT_SECRET,
      jwtExp
    );

    // Rotacionar refresh token
    const refreshDays = env.REFRESH_TOKEN_EXPIRATION_DAYS
      ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS)
      : 30;

    const newPlain = await generateRefreshToken(64);
    const newExpires = new Date(
      Date.now() + refreshDays * 24 * 60 * 60 * 1000
    ).toISOString();

    console.info(
      "[refreshTokenHandler] sessão rotativa para session_id= ",
      session.id
    );
    await rotateSession(env.DB, session.id, newPlain, newExpires);

    console.info(
      "[refreshTokenHandler] atualização de token bem-sucedida para user_id= ",
      session.user_id
    );

    try {
      const userRow = await env.DB.prepare(
        "SELECT email FROM users WHERE id = ?"
      )
        .bind(session.user_id)
        .first<{ email?: string }>();
      if (userRow && userRow.email) {
        await clearAttempts(env.DB, userRow.email);
      }
    } catch (err) {
      console.warn(
        "[refreshTokenHandler] clearAttempts falhou (não fatal):",
        err
      );
    }

    return jsonResponse(
      {
        access_token,
        refresh_token: newPlain,
        expires_at: newExpires,
      },
      200
    );
  } catch (err: any) {
    const msg = (err && (err.message || String(err))) || "unknown error";
    console.error("[refreshTokenHandler] erro inesperado: ", {
      error: msg,
      stack: err?.stack,
    });
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
