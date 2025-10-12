import type { Env } from "../types/Env";
import { verifyAccessToken } from "../service/tokenVerify";

export interface RoleAuthContext {
  userId: string;
  role: string | undefined;
  display_name?: string | null;
  session_version?: number;
}

export async function requireRoles(
  request: Request,
  env: Env,
  allowedRoles: string[]
): Promise<{ ok: true; auth: RoleAuthContext } | { ok: false; response: Response }> {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  const { valid, payload, reason } = await verifyAccessToken(env, token, {
    issuer: env.SITE_DNS,
    audience: env.SITE_DNS,
  });
  if (!valid || !payload || !payload.sub) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Unauthorized", reason }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }
  const row = await env.DB.prepare(
    "SELECT role, session_version, display_name FROM users WHERE id = ?"
  )
    .bind(payload.sub)
    .first<{ role?: string; session_version?: number; display_name?: string | null }>();
  if (!row || !row.role) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  if (
    row.session_version !== undefined &&
    typeof payload.session_version === "number" &&
    row.session_version !== payload.session_version
  ) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Token outdated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  if (!allowedRoles.includes(row.role)) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  return {
    ok: true,
    auth: {
      userId: payload.sub as string,
      role: row.role,
      display_name: row.display_name ?? null,
      session_version: row.session_version,
    },
  };
}
