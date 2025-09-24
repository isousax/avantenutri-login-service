import type { Env } from "../types/Env";
import { findSessionByRefreshToken, revokeSessionById } from "../service/sessionManager";

interface LogoutRequestBody {
  refresh_token: string;
}

export async function logoutHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as LogoutRequestBody;
    const { refresh_token } = body;
    if (!refresh_token) {
      return new Response(JSON.stringify({ error: "refresh_token required" }), { status: 400 });
    }

    const session = await findSessionByRefreshToken(env.DB, refresh_token);
    if (!session) {
      // já "logout" no cliente — retornar 200 para evitar informação sobre tokens válidos
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    await revokeSessionById(env.DB, session.id);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Malformed request" }), { status: 400 });
  }
}
