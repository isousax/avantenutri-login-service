import { generateJWT } from "../service/generateJWT";
import { comparePassword } from "../service/managerPassword";
import { generateRefreshToken } from "../service/sessionManager";
import { createSession } from "../service/sessionManager";
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

export async function loginUser(request: Request, env: Env): Promise<Response> {
  const body = await request.json();
  const { email, password } = body as LoginRequestBody;
  const refreshDays = env.REFRESH_TOKEN_EXPIRATION_DAYS
    ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS)
    : 30;
  const plainRefresh = await generateRefreshToken(64);
  const expiresAt = new Date(
    Date.now() + refreshDays * 24 * 60 * 60 * 1000
  ).toISOString();

  if (!email || !password) {
    return new Response(
      JSON.stringify({ error: "Email and password required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const user = await env.DB.prepare(
      "SELECT id, email, password_hash FROM users WHERE email = ?"
    )
      .bind(email)
      .first<DBUser>();

    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
      });
    }

    if (!(await comparePassword(password, user.password_hash))) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
      });
    }

    const expiresIn = env.JWT_EXPIRATION_SEC
      ? Number(env.JWT_EXPIRATION_SEC)
      : 3600;
    const access_token = await generateJWT(
      { userId: user.id, email: user.email },
      env.JWT_SECRET,
      expiresIn
    );

    await createSession(env.DB, user.id, plainRefresh, expiresAt);

    return new Response(
      JSON.stringify({ access_token, refresh_token: plainRefresh }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
    });
  }
}
