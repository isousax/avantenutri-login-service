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

function isLikelyId(s?: string) {
  if (!s) return false;
  // validação leve UUID v4-like — remove se seu id não for UUID
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}

export async function adminChangeRoleHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "PATCH")
    return json({ error: "Method Not Allowed" }, 405);

  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // remove empties
  // parts: ["admin","users","<id>","role"]
  const userId = parts.length >= 3 ? parts[2] : undefined;
  if (!userId) return json({ error: "Missing user id" }, 400);
  if (!isLikelyId(userId)) {
    // não fatal — só aviso, mas pode aceitar IDs de outro formato se necessário
    console.warn("[adminChangeRoleHandler] userId looks odd:", userId);
  }

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
    console.info("[adminChangeRoleHandler] changing role for userId=", userId);

    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
      .bind(userId)
      .first<{ role?: string }>();
    if (!row || !row.role) {
      console.info("[adminChangeRoleHandler] user not found for id=", userId);
      return json({ error: "User not found" }, 404);
    }
    if (row.role === new_role) return json({ error: "Role unchanged" }, 400);

    await env.DB.prepare(
      "UPDATE users SET role = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(new_role, userId)
      .run();

    await env.DB.prepare(
      "INSERT INTO role_change_log (user_id, old_role, new_role, changed_by, reason) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(userId, row.role, new_role, authRes.auth.userId, reason || null)
      .run();

    // Revoga refresh tokens existentes para forçar re-login e emitir novo token com claim/versão atualizada
    await env.DB.prepare(
      "UPDATE user_sessions SET revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
    )
      .bind(userId)
      .run();

    invalidateUserListCache();
    return json({
      success: true,
      user_id: userId,
      old_role: row.role,
      new_role,
    });
  } catch (err: any) {
    console.error(
      "[adminChangeRoleHandler] unexpected error:",
      err?.message ?? err
    );
    return json({ error: "Internal Server Error", detail: err?.message }, 500);
  }
}
