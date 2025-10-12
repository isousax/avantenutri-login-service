import { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

export async function adminGetUserQuestionnaireHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Verify admin authorization
    const adminResult = await requireAdmin(request, env);
    if (!adminResult.ok && 'response' in adminResult) {
      return adminResult.response;
    }

    // Extract user ID from URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const userIdIndex = pathParts.indexOf('users') + 1;
    const userId = pathParts[userIdIndex];

    if (!userId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "User ID is required" 
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Query questionnaire data for the specified user
    const result = await env.DB.prepare(`
      SELECT category, answers_json, created_at, updated_at
      FROM questionnaire_responses 
      WHERE user_id = ?
      ORDER BY updated_at DESC 
      LIMIT 1
    `).bind(userId).first();

    if (!result) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "No questionnaire found for this user" 
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

  // Parse the JSON respostas field
    let parsedAnswers = {};
    try {
      parsedAnswers = JSON.parse(result.answers_json as string);
    } catch (e) {
      console.error("Error parsing questionnaire responses:", e);
      parsedAnswers = {};
    }

    const questionnaireData = {
      category: result.category,
      answers: parsedAnswers,
      created_at: result.created_at,
      updated_at: result.updated_at,
    };

    return new Response(
      JSON.stringify(questionnaireData),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching user questionnaire:", error);
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