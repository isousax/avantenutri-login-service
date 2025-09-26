import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";
import { invalidateUserListCache } from "../../cache/userListCache";

interface Body {
  new_role?: string;
  reason?: string;
}

const ALLOWED_ROLES = ["patient", "admin"]; // ajustar se houver mais

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function adminChangeRoleHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "PATCH")
    return json({ error: "Method Not Allowed" }, 405);

  const url = new URL(request.url);
  const userId = url.pathname.split("/").pop();
  if (!userId) return json({ error: "Missing user id" }, 400);

  const authRes = await requireAdmin(request, env);
  if (!authRes.ok) {
    return (authRes as any).response as Response;
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { new_role, reason } = body;
  if (!new_role || !ALLOWED_ROLES.includes(new_role))
    return json({ error: "Invalid new_role" }, 400);

  try {
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
      .bind(userId)
      .first<{ role?: string }>();
    if (!row || !row.role) return json({ error: "User not found" }, 404);
    if (row.role === new_role) return json({ error: "Role unchanged" }, 400);

    await env.DB.prepare(
      "UPDATE users SET role = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(new_role, userId)
      .first();
    await env.DB.prepare(
      "INSERT INTO role_change_log (user_id, old_role, new_role, changed_by, reason) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(userId, row.role, new_role, authRes.auth.userId, reason || null)
      .first();
    // Revoga refresh tokens existentes para forçar re-login e emitir novo token com claim/versão atualizada
    await env.DB.prepare(
      "UPDATE user_sessions SET revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
    )
      .bind(userId)
      .first();
    invalidateUserListCache();
    return json({
      success: true,
      user_id: userId,
      old_role: row.role,
      new_role,
    });
  } catch (err: any) {
    return json({ error: "Internal Server Error", detail: err?.message }, 500);
  }
}
