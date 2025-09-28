import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }); }

export async function listDietPlansHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);

  const userId = payload.sub;
  const url = new URL(request.url);
  const includeArchived = url.searchParams.get('archived') === '1';
  try {
    const rows = await env.DB.prepare(`SELECT id, name, description, status, start_date, end_date, results_summary, current_version_id, created_at, updated_at
                                       FROM diet_plans WHERE user_id = ? ${includeArchived ? '' : "AND status = 'active'"} ORDER BY created_at DESC`)
      .bind(userId)
      .all<any>();
    return json({ ok: true, results: rows.results || [] });
  } catch (err: any) {
    console.error('[listDietPlans] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
