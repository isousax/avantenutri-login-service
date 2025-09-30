import { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

export async function adminQuestionnaireAnalyticsHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Verify admin authorization
    const adminResult = await requireAdmin(request, env);
    if (adminResult instanceof Response) {
      return adminResult;
    }

    // Get analytics data
    const [
      totalUsers,
      completedQuestionnaires,
      categoryCounts,
      recentCompletions,
      monthlyCompletions
    ] = await Promise.all([
      // Total users
      env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE active = 1").first(),
      
      // Users with completed questionnaires
      env.DB.prepare("SELECT COUNT(DISTINCT user_id) as count FROM questionarios").first(),
      
      // Questionnaires by category
      env.DB.prepare(`
        SELECT categoria, COUNT(*) as count 
        FROM questionarios 
        GROUP BY categoria 
        ORDER BY count DESC
      `).all(),
      
      // Recent completions (last 30 days)
      env.DB.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM questionarios 
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `).all(),
      
      // Monthly completions (last 12 months)
      env.DB.prepare(`
        SELECT 
          strftime('%Y-%m', created_at) as month,
          COUNT(*) as count
        FROM questionarios 
        WHERE created_at >= datetime('now', '-12 months')
        GROUP BY strftime('%Y-%m', created_at)
        ORDER BY month DESC
      `).all()
    ]);

    const totalUsersCount = Number(totalUsers?.count || 0);
    const completedCount = Number(completedQuestionnaires?.count || 0);
    
    const analytics = {
      overview: {
        total_users: totalUsersCount,
        completed_questionnaires: completedCount,
        completion_rate: totalUsersCount ? 
          ((completedCount / totalUsersCount) * 100).toFixed(2) : '0.00'
      },
      categories: categoryCounts?.results || [],
      recent_activity: recentCompletions?.results || [],
      monthly_trends: monthlyCompletions?.results || []
    };

    return new Response(
      JSON.stringify(analytics),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching questionnaire analytics:", error);
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