import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }); }

export async function createDietPlanHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = payload.sub;

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { name, description, start_date, end_date, data } = body || {};
  if (!name || typeof name !== 'string') return json({ error: 'name required' }, 400);
  if (start_date && isNaN(Date.parse(start_date))) return json({ error: 'invalid start_date' }, 400);
  if (end_date && isNaN(Date.parse(end_date))) return json({ error: 'invalid end_date' }, 400);

  // Capability check
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('DIETA_EDIT')) return json({ error: 'Forbidden (missing capability DIETA_EDIT)' }, 403);

  // Start first version
  const planId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const versionNumber = 1;
  const dataJson = JSON.stringify(data || { meals: [], macros: {}, notes: '' });
  try {
    await env.DB.prepare(`INSERT INTO diet_plans (id, user_id, name, description, start_date, end_date, current_version_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(planId, userId, name, description || null, start_date || null, end_date || null, versionId)
      .run();
    await env.DB.prepare(`INSERT INTO diet_plan_versions (id, plan_id, version_number, generated_by, data_json, notes)
                          VALUES (?, ?, ?, 'user', ?, ?)`)
      .bind(versionId, planId, versionNumber, dataJson, null)
      .run();
    return json({ ok: true, plan_id: planId, version_id: versionId });
  } catch (err: any) {
    console.error('[createDietPlan] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
