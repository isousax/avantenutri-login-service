import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }); }

export async function adminChangePlanHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice('Bearer '.length);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  if (payload.role !== 'admin') return json({ error: 'Forbidden' }, 403);
  // Optionally enforce ADMIN_PANEL capability if present in plan capabilities
  try {
    const ent = await computeEffectiveEntitlements(env, String(payload.sub));
    if (ent.capabilities.includes('ADMIN_PANEL') === false) {
      // Soft fallback: still allow legacy admin role, but future tighten
    }
  } catch {}

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { user_id, new_plan } = body || {};
  if (!user_id || !new_plan) return json({ error: 'user_id and new_plan required' }, 400);
  const allowed = ['free','self','full'];
  if (!allowed.includes(String(new_plan).toLowerCase())) return json({ error: 'invalid plan' }, 400);

  try {
    const exists = await env.DB.prepare('SELECT id, plan_id FROM users WHERE id = ?')
      .bind(user_id)
      .first<{ id?: string; plan_id?: string }>();
    if (!exists?.id) return json({ error: 'User not found' }, 404);
    if (exists.plan_id === new_plan) return json({ ok: true, unchanged: true });

    await env.DB.prepare('UPDATE users SET plan_id = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(new_plan, user_id)
      .run();
    await env.DB.prepare('INSERT INTO plan_change_log (user_id, old_plan_id, new_plan_id, reason, meta_json) VALUES (?,?,?,?,?)')
      .bind(user_id, exists.plan_id || null, new_plan, 'admin', JSON.stringify({ by: payload.sub }))
      .run();
    return json({ ok: true, user_id, old_plan: exists.plan_id, new_plan });
  } catch (err: any) {
    console.error('[adminChangePlan] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
