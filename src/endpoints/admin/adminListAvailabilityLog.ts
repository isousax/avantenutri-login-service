import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /admin/consultations/availability/log?rule_id=&action=&sort=&direction=&page=&pageSize=
// action: one of create|update|activate|deactivate|delete
// sort: created_at (default) | action | weekday
// direction: asc|desc (default desc)
export async function adminListAvailabilityLogHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return (auth as { ok: false; response: Response }).response;
  const url = new URL(request.url);
  const ruleId = url.searchParams.get('rule_id')?.trim();
  const action = url.searchParams.get('action')?.trim();
  const sort = (url.searchParams.get('sort') || 'created_at').trim();
  const direction = (url.searchParams.get('direction') || 'desc').trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '30')));
  const offset = (page - 1) * pageSize;
  try {
    const clauses: string[] = [];
    const values: any[] = [];
    if (ruleId) { clauses.push('rule_id = ?'); values.push(ruleId); }
    if (action) {
      const allowedActions = new Set(['create','update','activate','deactivate','delete']);
      if (!allowedActions.has(action)) return json({ error: 'invalid action' }, 400);
      clauses.push('action = ?'); values.push(action);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // Sorting
    let orderColumn: string;
    switch (sort) {
      case 'action': orderColumn = 'action'; break;
      case 'weekday': orderColumn = 'weekday'; break;
      case 'created_at':
      default: orderColumn = 'created_at'; break;
    }
    const dir = direction === 'asc' ? 'ASC' : 'DESC';
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM availability_rule_log ${where}`)
      .bind(...values)
      .first<{ c: number }>();
    const rows = await env.DB.prepare(`SELECT rule_id, action, weekday, start_time, end_time, slot_duration_min, max_parallel, active, created_at FROM availability_rule_log ${where} ORDER BY ${orderColumn} ${dir}, id DESC LIMIT ? OFFSET ?`)
      .bind(...values, pageSize, offset)
      .all<any>();
    return json({ ok: true, page, pageSize, total: totalRow?.c || 0, results: rows.results || [], sort: orderColumn, direction: dir.toLowerCase() });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
