import type { Env } from '../../types/Env';
import { verifyAccessToken } from '../../service/tokenVerify';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface DowngradeBody { target_plan_id?: string; reason?: string }

export async function downgradePlanHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  let body: DowngradeBody = {}; try { body = await request.json(); } catch {}
  const target = (body.target_plan_id || 'free').toLowerCase();
  if (target !== 'free') return json({ error: 'only_free_supported' }, 400);
  try {
    const userRow = await env.DB.prepare('SELECT plan_id FROM users WHERE id = ?').bind(String(payload.sub)).first<{ plan_id?: string }>();
    if (!userRow) return json({ error: 'not_found' }, 404);
    if (userRow.plan_id === target) return json({ ok: true, unchanged: true, plan: target });
    const oldPlan = userRow.plan_id || null;
    await env.DB.prepare('UPDATE users SET plan_id = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(target, String(payload.sub)).run();
    await env.DB.prepare('INSERT INTO plan_change_log (user_id, old_plan_id, new_plan_id, reason, meta_json) VALUES (?,?,?,?,?)')
      .bind(String(payload.sub), oldPlan, target, 'downgrade', JSON.stringify({ requested_at: new Date().toISOString(), reason: body.reason || null }).slice(0,4000))
      .run();
    return json({ ok: true, plan: target });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
