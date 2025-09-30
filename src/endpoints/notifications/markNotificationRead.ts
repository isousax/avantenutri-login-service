import { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

export async function markNotificationReadHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Verify authentication
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

    // Extract notification ID from URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const notificationId = pathParts[pathParts.length - 2]; // /notifications/{id}/read

    if (!notificationId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Notification ID is required" 
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Mark notification as read
    const result = await env.DB.prepare(`
      UPDATE user_notifications 
      SET read_at = ? 
      WHERE notification_id = ? AND user_id = ? AND read_at IS NULL
    `).bind(
      new Date().toISOString(),
      notificationId,
      userId
    ).run();

    if (!result.success || result.meta.changes === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Notification not found or already read" 
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "Internal server error" 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}