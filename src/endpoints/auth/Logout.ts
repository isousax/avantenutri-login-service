import type { Env } from "../../types/Env";
import { getDynamicCorsOrigin } from "../../utils/getDynamicCorsOrigin";
import {
  findSessionByRefreshToken,
  revokeSessionById,
} from "../../service/sessionManager";
import { verifyAccessToken } from "../../service/tokenVerify";
import { getClientIp, clearAttempts } from "../../service/authAttempts";

interface LogoutRequestBody {
  refresh_token: string;
}

export async function logoutHandler(
  request: Request,
  env: Env
): Promise<Response> {
  console.info("[logoutHandler] solicitação recebida");

  const origin = request.headers.get("Origin");
  const JSON_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": getDynamicCorsOrigin(origin ?? undefined, env),
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  };
  
  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: JSON_HEADERS,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.warn("[logoutHandler] corpo JSON inválido");
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { refresh_token } = body as LogoutRequestBody;

  if (!refresh_token) {
    console.warn("[logoutHandler] refresh_token ausente");
    return jsonResponse({ error: "refresh_token required" }, 400);
  }

  try {
    console.info("[logoutHandler] procurando sessão para refresh_token");
    const session = await findSessionByRefreshToken(env.DB, refresh_token);

    if (!session) {
      console.info(
        "[logoutHandler] sessão não encontrada para token, retornando ok (logout idempotente)"
      );
      return jsonResponse({ ok: true }, 200);
    }

    console.info("[logoutHandler] revogando session_id= ", session.id);
    await revokeSessionById(env.DB, session.id);

    try {
      const userRow = await env.DB.prepare(
        "SELECT email FROM users WHERE id = ?"
      )
        .bind(session.user_id)
        .first<{ email?: string }>();
      const clientIp = getClientIp(request);
      if (userRow && userRow.email) {
        await clearAttempts(env.DB, userRow.email, clientIp);
      }
    } catch (err) {
      console.warn("[logoutHandler] clearAttempts falhou (não fatal):", err);
    }

    // Revogar jti se access token presente
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)/i);
    if (m) {
      const { valid, payload } = await verifyAccessToken(env, m[1], {
        issuer: env.SITE_DNS,
        audience: env.SITE_DNS,
      });
      if (valid && payload?.jti) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO revoked_jti (jti, user_id, reason) VALUES (?, ?, 'logout')`
        )
          .bind(payload.jti, session.user_id)
          .first();
      }
    }

    console.info(
      "[logoutHandler] logout bem-sucedido para user_id= ",
      session.user_id
    );
    return jsonResponse({ ok: true }, 200);
  } catch (err: any) {
    const msg = (err && (err.message || String(err))) || "unknown error";
    console.error("[logoutHandler] erro inesperado: ", {
      error: msg,
      stack: err?.stack,
    });
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
