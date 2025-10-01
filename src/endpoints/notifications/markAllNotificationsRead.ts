import { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

export async function markAllNotificationsReadHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.substring(7);
    const { valid, payload } = await verifyAccessToken(env, token, {
      issuer: env.SITE_DNS,
      audience: env.SITE_DNS,
    });
    if (!valid || !payload) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const userId = (payload.sub ?? payload.user_id ?? payload.id) as string | undefined;
    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token - missing user ID" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await env.DB.prepare(`
      UPDATE user_notifications
      SET read_at = COALESCE(read_at, ?)
      WHERE user_id = ?
        AND read_at IS NULL
    `).bind(new Date().toISOString(), userId).run();

    return new Response(
      JSON.stringify({ success: true, updated: result.meta.changes || 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error mark all notifications read", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
