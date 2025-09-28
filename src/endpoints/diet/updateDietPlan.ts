import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function updateDietPlanHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = payload.sub;

  const pathParts = new URL(request.url).pathname.split('/'); // /diet/plans/:id
  const planId = pathParts[pathParts.length - 1];
  if (!planId) return json({ error: 'Missing plan id' }, 400);

  let body:any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { name, description, status, results_summary, start_date, end_date } = body || {};
  if (start_date && isNaN(Date.parse(start_date))) return json({ error: 'invalid start_date' }, 400);
  if (end_date && isNaN(Date.parse(end_date))) return json({ error: 'invalid end_date' }, 400);
  if (status && !['active','archived'].includes(status)) return json({ error: 'invalid status' }, 400);

  try {
    const exists = await env.DB.prepare('SELECT id FROM diet_plans WHERE id = ? AND user_id = ? LIMIT 1')
      .bind(planId, userId)
      .first<any>();
    if (!exists?.id) return json({ error: 'Plano não encontrado' }, 404);

    const fields: string[] = []; const values: any[] = [];
    if (name) { fields.push('name = ?'); values.push(name); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description || null); }
    if (status) { fields.push('status = ?'); values.push(status); }
    if (results_summary !== undefined) { fields.push('results_summary = ?'); values.push(results_summary || null); }
    if (start_date !== undefined) { fields.push('start_date = ?'); values.push(start_date || null); }
    if (end_date !== undefined) { fields.push('end_date = ?'); values.push(end_date || null); }
    if (fields.length === 0) return json({ ok: true, unchanged: true });

    const sql = `UPDATE diet_plans SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    values.push(planId);
    await env.DB.prepare(sql).bind(...values).run();
    return json({ ok: true, plan_id: planId });
  } catch (err:any) {
    console.error('[updateDietPlan] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
