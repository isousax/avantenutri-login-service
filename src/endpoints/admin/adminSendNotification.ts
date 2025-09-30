import { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

interface NotificationRequest {
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  target_type: 'all' | 'specific' | 'group';
  target_users?: string[];
  target_group?: 'active' | 'incomplete_questionnaire' | 'recent_signups';
  expires_at?: string;
}

export async function adminSendNotificationHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Verify admin authorization
    const adminResult = await requireAdmin(request, env);
    if (adminResult instanceof Response) {
      return adminResult;
    }

    const data: NotificationRequest = await request.json();
    
    // Validate required fields
    if (!data.title || !data.message || !data.type || !data.target_type) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Missing required fields: title, message, type, target_type" 
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    let targetUserIds: string[] = [];

    // Determine target users based on target_type
    switch (data.target_type) {
      case 'all':
        const allUsersResult = await env.DB.prepare(
          "SELECT id FROM users WHERE active = 1"
        ).all();
        targetUserIds = allUsersResult.results?.map((u: any) => u.id) || [];
        break;

      case 'specific':
        if (!data.target_users || data.target_users.length === 0) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "target_users is required when target_type is 'specific'" 
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        targetUserIds = data.target_users;
        break;

      case 'group':
        if (!data.target_group) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: "target_group is required when target_type is 'group'" 
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        let groupQuery = "";
        switch (data.target_group) {
          case 'active':
            groupQuery = "SELECT id FROM users WHERE active = 1 AND last_login_at >= datetime('now', '-30 days')";
            break;
          case 'incomplete_questionnaire':
            groupQuery = `
              SELECT u.id FROM users u 
              LEFT JOIN questionarios q ON u.id = q.user_id 
              WHERE u.active = 1 AND q.user_id IS NULL
            `;
            break;
          case 'recent_signups':
            groupQuery = "SELECT id FROM users WHERE active = 1 AND created_at >= datetime('now', '-7 days')";
            break;
          default:
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: "Invalid target_group" 
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
        }

        const groupUsersResult = await env.DB.prepare(groupQuery).all();
        targetUserIds = groupUsersResult.results?.map((u: any) => u.id) || [];
        break;

      default:
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "Invalid target_type" 
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
    }

    if (targetUserIds.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "No target users found" 
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const notificationId = crypto.randomUUID();
    const expiresAt = data.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days default

    // Create notification record
    await env.DB.prepare(`
      INSERT INTO notifications (
        id, title, message, type, target_type, target_group, 
        target_user_count, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      notificationId,
      data.title,
      data.message,
      data.type,
      data.target_type,
      data.target_group || null,
      targetUserIds.length,
      expiresAt,
      new Date().toISOString()
    ).run();

    // Create user notifications
    const userNotificationInserts = targetUserIds.map(userId => 
      env.DB.prepare(`
        INSERT INTO user_notifications (
          id, notification_id, user_id, read_at, created_at
        ) VALUES (?, ?, ?, NULL, ?)
      `).bind(
        crypto.randomUUID(),
        notificationId,
        userId,
        new Date().toISOString()
      ).run()
    );

    await Promise.all(userNotificationInserts);

    return new Response(
      JSON.stringify({
        success: true,
        notification_id: notificationId,
        target_count: targetUserIds.length
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending notification:", error);
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