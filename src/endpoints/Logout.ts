import type { Env } from "../types/Env";
import {
  findSessionByRefreshToken,
  revokeSessionById,
} from "../service/sessionManager";

interface LogoutRequestBody {
  refresh_token: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function logoutHandler(
  request: Request,
  env: Env
): Promise<Response> {
  console.info("[logoutHandler] solicitação recebida");

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

    console.info("[logoutHandler] logout bem-sucedido para user_id= ", session.user_id);
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
