import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface QuestionnairePayload {
  step?: number;
  category?: string | null;
  answers?: Record<string, any>;
  submit?: boolean;
}

// Helper function to check if questionnaire is complete
function isQuestionnaireComplete(data: any): boolean {
  if (!data || !data.submitted_at) return false;
  
  const answers = data.answers || {};
  const category = data.category;
  
  // Required fields for all categories
  const requiredCommon = ['nome', 'email', 'telefone'];
  const hasCommon = requiredCommon.every(field => answers[field]?.trim());
  
  if (!hasCommon || !category) return false;
  
  // Category-specific required fields
  switch (category) {
    case 'adulto':
      return !!(answers['Peso (kg)'] && answers['Altura (cm)'] && answers['Idade']);
    case 'esportiva':
      return !!(answers['Peso (kg)'] && answers['Altura (cm)'] && answers['Idade']);
    case 'gestante':
      return !!(answers['Peso antes da gravidez (kg)'] && answers['Peso atual (kg)']);
    case 'infantil':
      return !!(answers['Peso atual (kg)'] && answers['Altura (cm)'] && answers['Idade']);
    default:
      return true; // For other categories, just check if submitted
  }
}

// POST /questionnaire { step, category, answers, submit? }
export async function upsertQuestionnaireHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  // Entitlements removidos

  let body: QuestionnairePayload; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const step = Number(body.step || 0);
  if (!Number.isFinite(step) || step < 0 || step > 200) return json({ error: 'invalid_step' }, 400);
  const category = body.category && typeof body.category === 'string' ? body.category.slice(0,100) : null;
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const answersJson = JSON.stringify(answers);
  const submit = !!body.submit;

  try {
    await env.DB.prepare(`INSERT INTO questionnaire_responses (user_id, step_count, category, answers_json, submitted_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET step_count=excluded.step_count, category=excluded.category, answers_json=excluded.answers_json, submitted_at=COALESCE(excluded.submitted_at, questionnaire_responses.submitted_at), updated_at=CURRENT_TIMESTAMP`).bind(userId, step, category, answersJson, submit ? new Date().toISOString() : null).run();
    return json({ ok: true });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}

// GET /questionnaire
export async function getQuestionnaireHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  try {
    const row = await env.DB.prepare(`SELECT step_count, category, answers_json, submitted_at, updated_at FROM questionnaire_responses WHERE user_id = ?`).bind(userId).first<any>();
    if (!row) return json({ ok: true, data: null, is_complete: false });
    let answers: Record<string, any> = {}; try { answers = JSON.parse(row.answers_json || '{}'); } catch { answers = {}; }
    const data = { step: row.step_count, category: row.category, answers, submitted_at: row.submitted_at, updated_at: row.updated_at };
    const is_complete = isQuestionnaireComplete(data);
    return json({ ok: true, data, is_complete });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}

// GET /questionnaire/status - Quick status check for questionnaire completion
export async function getQuestionnaireStatusHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  try {
    const row = await env.DB.prepare(`SELECT category, answers_json, submitted_at FROM questionnaire_responses WHERE user_id = ?`).bind(userId).first<any>();
    if (!row) return json({ ok: true, is_complete: false, has_data: false });
    let answers: Record<string, any> = {}; try { answers = JSON.parse(row.answers_json || '{}'); } catch { answers = {}; }
    const data = { category: row.category, answers, submitted_at: row.submitted_at };
    const is_complete = isQuestionnaireComplete(data);
    const has_data = !!(row.submitted_at || Object.keys(answers).length > 0);
    return json({ ok: true, is_complete, has_data });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
