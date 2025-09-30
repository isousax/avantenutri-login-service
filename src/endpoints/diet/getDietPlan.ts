import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function getDietPlanHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = payload.sub;

  const url = new URL(request.url);
  const includeData = url.searchParams.get('includeData') === '1';
  const pathParts = url.pathname.split('/'); // /diet/plans/:id
  const planId = pathParts[pathParts.length - 1];
  if (!planId) return json({ error: 'Missing plan id' }, 400);

  try {
    // Buscar plano independente primeiro
    const plan = await env.DB.prepare(`SELECT id, user_id, name, description, status, start_date, end_date, results_summary, current_version_id, created_at, updated_at
                                       FROM diet_plans WHERE id = ? LIMIT 1`)
      .bind(planId)
      .first<any>();
    if (!plan?.id) return json({ error: 'Plano não encontrado' }, 404);
    if (plan.user_id !== userId) {
      // Validar se solicitante é admin
      const roleRow = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role?: string }>();
      if (roleRow?.role !== 'admin') return json({ error: 'Forbidden' }, 403);
    }

    const versionsRes = await env.DB.prepare(`SELECT id, version_number, generated_by, data_json, notes, created_at
                                              FROM diet_plan_versions WHERE plan_id = ? ORDER BY version_number ASC`)
      .bind(planId)
      .all<any>();

    const versions = (versionsRes.results || []).map(v => {
      const base: any = {
        id: v.id,
        version_number: v.version_number,
        generated_by: v.generated_by,
        created_at: v.created_at,
        notes: v.notes || null,
      };
      if (includeData) {
        try { base.data = JSON.parse(v.data_json || '{}'); } catch { base.data = {}; }
      }
      return base;
    });

    return json({ ok: true, plan: { ...plan, versions } });
  } catch (err: any) {
    console.error('[getDietPlan] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
