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
  name: string;
}

interface DBUser {
  id: string;
}

export async function registerUser(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await request.json();
  const { email, password, name, full_name, phone, birth_date } =
    body as RegisterRequestBody;
  const refreshDays = env.REFRESH_TOKEN_EXPIRATION_DAYS
    ? Number(env.REFRESH_TOKEN_EXPIRATION_DAYS)
    : 30;
  const plainRefresh = await generateRefreshToken(64);
  const expiresAt = new Date(
    Date.now() + refreshDays * 24 * 60 * 60 * 1000
  ).toISOString();

  if (!email || !password || !name || !full_name || !phone || !birth_date) {
    return new Response(JSON.stringify({ error: "Malformed request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const passwordHash = await hashPassword(password);

    await env.DB.prepare(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'client', CURRENT_TIMESTAMP)"
    )
      .bind(email, passwordHash)
      .run();

    const user_id = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<DBUser>();

    await env.DB.prepare(
      "INSERT INTO user_profiles (user_id, full_name, phone, birth_date) VALUES (?, ?, ?, ?)"
    )
      .bind(user_id, full_name, email, name, phone, birth_date)
      .run();

    const access_token = await generateJWT({ email }, env.JWT_SECRET, 3600);
    await createSession(
      env.DB,
      user_id.id,
      plainRefresh,
      expiresAt
    );

    return new Response(JSON.stringify({ access_token }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "User already exists" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }
}
