import type { Env } from "../types/Env";
import { findSessionByRefreshToken, rotateSession } from "../service/sessionManager";
import { generateJWT } from "../service/generateJWT";
import { generateRefreshToken } from "../service/sessionManager";

interface RefreshRequestBody {
  refresh_token: string;
}

export async function refreshTokenHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as RefreshRequestBody;
    const { refresh_token } = body;
    if (!refresh_token) {
      return new Response(JSON.stringify({ error: "refresh_token required" }), { status: 400 });
    }

    const session = await findSessionByRefreshToken(env.DB, refresh_token);
    if (!session) {
      return new Response(JSON.stringify({ error: "Invalid refresh token" }), { status: 401 });
    }

    if (session.revoked) {
      return new Response(JSON.stringify({ error: "Refresh token revoked" }), { status: 401 });
    }

    const expiresAt = new Date(session.expires_at).getTime();
    if (isNaN(expiresAt) || expiresAt < Date.now()) {
      return new Response(JSON.stringify({ error: "Refresh token expired" }), { status: 401 });
    }

    // tudo ok: gerar novo access token
    const jwtExp = env.JWT_EXPIRATION_SEC ? Number(env.JWT_EXPIRATION_SEC) : 3600;
    const access_token = await generateJWT({ userId: session.user_id }, env.JWT_SECRET, jwtExp);

    const refreshDays = env.REFRESH_TOKEN_EXPIRATION_DAYS ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS) : 30;
    const newPlain = await generateRefreshToken(64);
    const newExpires = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000).toISOString();
    await rotateSession(env.DB, session.id, newPlain, newExpires);

    return new Response(JSON.stringify({ access_token, refresh_token: newPlain }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Malformed request" }), { status: 400 });
  }
}
