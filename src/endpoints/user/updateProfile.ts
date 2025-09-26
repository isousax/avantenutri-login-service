import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { generateJWT } from "../../service/generateJWT";
import { invalidateUserListCache } from "../../cache/userListCache";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

interface Body {
  display_name?: string;
  full_name?: string;
}

export async function updateProfileHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "PATCH")
    return json({ error: "Method Not Allowed" }, 405);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { valid, payload } = await verifyAccessToken(env, token, {
    issuer: env.SITE_DNS,
    audience: env.SITE_DNS,
  });
  if (!valid || !payload?.sub) return json({ error: "Unauthorized" }, 401);
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const userId = payload.sub as string;
  const displayName = body.display_name?.trim();
  const fullName = body.full_name?.trim();
  if (!displayName && !fullName) return json({ error: "No changes" }, 400);
  try {
    // Detectar mudanças
    const existing = await env.DB.prepare(
      "SELECT display_name FROM users WHERE id = ?"
    )
      .bind(userId)
      .first<{ display_name?: string }>();
    const profile = await env.DB.prepare(
      "SELECT full_name FROM user_profiles WHERE user_id = ?"
    )
      .bind(userId)
      .first<{ full_name?: string }>();
    let updateUser = false;
    let updateProfile = false;
    if (displayName && displayName !== existing?.display_name)
      updateUser = true;
    if (fullName && fullName !== profile?.full_name) updateProfile = true;
    if (!updateUser && !updateProfile)
      return json({ success: true, unchanged: true });
    if (updateUser) {
      await env.DB.prepare(
        "UPDATE users SET display_name = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
        .bind(displayName, userId)
        .first();
    }
    if (updateProfile) {
      if (profile) {
        await env.DB.prepare(
          "UPDATE user_profiles SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
        )
          .bind(fullName, userId)
          .first();
      } else {
        await env.DB.prepare(
          "INSERT INTO user_profiles (user_id, full_name) VALUES (?, ?)"
        )
          .bind(userId, fullName)
          .first();
      }
    }
    // Invalidate list users cache so admin listing reflects new name
    if (updateUser || updateProfile) invalidateUserListCache();
    let access_token: string | undefined;
    if (updateUser) {
      // Emitir novo token com session_version e display_name atualizados
      const row = await env.DB.prepare(
        `SELECT u.id, u.email, u.role, u.session_version, u.display_name, p.full_name, p.phone, p.birth_date
        FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`
      )
        .bind(userId)
        .first<any>();
      if (row && env.JWT_SECRET) {
        const expSec = env.JWT_EXPIRATION_SEC
          ? Number(env.JWT_EXPIRATION_SEC)
          : 3600;
        access_token = await generateJWT(
          {
            sub: row.id,
            email: row.email,
            role: row.role,
            session_version: row.session_version,
            display_name: row.display_name ?? undefined,
            full_name: row.full_name ?? undefined,
            phone: row.phone ?? undefined,
            birth_date: row.birth_date ?? undefined,
            iss: env.SITE_DNS,
            aud: env.SITE_DNS,
          },
          env.JWT_SECRET,
          expSec,
          env.JWT_PRIVATE_KEY_PEM
            ? {
                privateKeyPem: env.JWT_PRIVATE_KEY_PEM,
                kid: env.JWT_JWKS_KID || "k1",
              }
            : undefined
        );
      }
    }
    let resp: any = { success: true };
    if (access_token) {
      resp.access_token = access_token;
      resp.token_type = "Bearer";
      resp.display_name = displayName || existing?.display_name || null;
    }
    return json(resp);
  } catch (err: any) {
    return json({ error: "Internal Error", detail: err?.message }, 500);
  }
}
