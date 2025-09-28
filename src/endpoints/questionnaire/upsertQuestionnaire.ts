import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface QuestionnairePayload {
  step?: number;
  category?: string | null;
  answers?: Record<string, any>;
  submit?: boolean;
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
  const ent = await computeEffectiveEntitlements(env, userId); // maybe later require specific capability
  if (!ent) return json({ error: 'Unauthorized' }, 401);

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
    if (!row) return json({ ok: true, data: null });
    let answers: Record<string, any> = {}; try { answers = JSON.parse(row.answers_json || '{}'); } catch { answers = {}; }
    return json({ ok: true, data: { step: row.step_count, category: row.category, answers, submitted_at: row.submitted_at, updated_at: row.updated_at } });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
