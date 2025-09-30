import { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

export async function getUserNotificationsHandler(
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
    const { valid, payload, reason } = await verifyAccessToken(env, token, {
      issuer: env.SITE_DNS,
      audience: env.SITE_DNS,
    });
    
    if (!valid || !payload) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized", reason }),
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
    const url = new URL(request.url);
    const onlyUnread = url.searchParams.get('unread') === 'true';
    const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
    const offset = Number(url.searchParams.get('offset')) || 0;

    // Build query based on filters
    let query = `
      SELECT 
        un.id as user_notification_id,
        un.read_at,
        n.id as notification_id,
        n.title,
        n.message,
        n.type,
        n.created_at,
        n.expires_at
      FROM user_notifications un
      JOIN notifications n ON un.notification_id = n.id
      WHERE un.user_id = ? 
        AND n.expires_at > datetime('now')
    `;

    const params = [userId];

    if (onlyUnread) {
      query += " AND un.read_at IS NULL";
    }

    query += " ORDER BY n.created_at DESC LIMIT ? OFFSET ?";
    params.push(String(limit), String(offset));

    const notificationsResult = await env.DB.prepare(query).bind(...params).all();
    
    // Get total count
    let countQuery = `
      SELECT COUNT(*) as count
      FROM user_notifications un
      JOIN notifications n ON un.notification_id = n.id
      WHERE un.user_id = ? 
        AND n.expires_at > datetime('now')
    `;
    
    const countParams = [userId];
    if (onlyUnread) {
      countQuery += " AND un.read_at IS NULL";
    }

    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();

    return new Response(
      JSON.stringify({
        notifications: notificationsResult.results || [],
        total: countResult?.count || 0,
        limit,
        offset
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching user notifications:", error);
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