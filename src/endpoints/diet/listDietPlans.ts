import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

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
  const targetUser = url.searchParams.get('user_id'); // admin pode filtrar por paciente
  try {
    // Verifica se solicitante é admin quando quiser ver outros usuários
    let roleRow: { role?: string } | null = null;
    if (targetUser && targetUser !== userId) {
      roleRow = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role?: string }>();
      if (roleRow?.role !== 'admin') {
        return json({ error: 'Forbidden (admin only for cross-user listing)' }, 403);
      }
    }
    const queryUser = targetUser && targetUser !== userId ? targetUser : userId;
  const rows = await env.DB.prepare(`SELECT dp.id,
                        dp.user_id,
                        dp.name,
                        dp.description,
                        dp.status,
                        dp.start_date,
                        dp.end_date,
                        dp.results_summary,
                        dp.current_version_id,
                        dp.created_at,
                        dp.updated_at,
                        dv.data_json as current_data_json,
                        u.display_name as user_display_name,
                        u.email as user_email
                     FROM diet_plans dp
                     LEFT JOIN diet_plan_versions dv ON dv.id = dp.current_version_id
                     LEFT JOIN users u ON u.id = dp.user_id
                     WHERE dp.user_id = ? ${includeArchived ? '' : "AND dp.status = 'active'"}
                     ORDER BY dp.created_at DESC`)
      .bind(queryUser)
      .all<any>();
    const results = (rows.results || []).map(r => {
      let format: string | undefined;
      if (r.current_data_json) {
        try { const parsed = JSON.parse(r.current_data_json); format = parsed?.format; } catch { /* ignore */ }
      }
      const { current_data_json, ...rest } = r;
      return { ...rest, format };
    });
    return json({ ok: true, results });
  } catch (err: any) {
    console.error('[listDietPlans] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
