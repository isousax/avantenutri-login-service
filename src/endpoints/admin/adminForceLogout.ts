import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";
import { invalidateUserListCache } from "../../cache/userListCache";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function adminForceLogoutHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "Method Not Allowed" }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  const url = new URL(request.url);
  const userId = url.pathname.split("/").slice(-2, -1)[0]; // /admin/users/:id/force-logout
  if (!userId) return json({ error: "Missing user id" }, 400);
  try {
    await env.DB.prepare(
      "UPDATE user_sessions SET revoked = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
    )
      .bind(userId)
      .first();
    // Incrementa session_version para invalidar access tokens atuais também
    await env.DB.prepare(
      "UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(userId)
      .first();
    invalidateUserListCache();
    return json({ success: true, user_id: userId });
  } catch (err: any) {
    return json({ error: "Internal Error", detail: err?.message }, 500);
  }
}
