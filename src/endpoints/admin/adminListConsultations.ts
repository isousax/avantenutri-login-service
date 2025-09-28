import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /admin/consultations?status=&user_id=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&pageSize=
export async function adminListConsultationsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const adminAuth = await requireAdmin(request, env);
  if (!adminAuth.ok) {
    return (adminAuth as { ok: false; response: Response }).response;
  }
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const userId = url.searchParams.get('user_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '50')));
  const offset = (page - 1) * pageSize;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return json({ error: 'from inválido' }, 400);
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json({ error: 'to inválido' }, 400);
  if (from && to && from > to) return json({ error: 'intervalo inválido' }, 400);
  const clauses: string[] = [];
  const values: any[] = [];
  if (status) { clauses.push('status = ?'); values.push(status); }
  if (userId) { clauses.push('user_id = ?'); values.push(userId); }
  if (from) { clauses.push(`date(scheduled_at) >= ?`); values.push(from); }
  if (to) { clauses.push(`date(scheduled_at) <= ?`); values.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  try {
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM consultations ${where}`)
      .bind(...values)
      .first<{ c: number }>();
    const rows = await env.DB.prepare(`SELECT id, user_id, type, status, scheduled_at, duration_min, urgency, notes, created_at, updated_at FROM consultations ${where} ORDER BY scheduled_at DESC LIMIT ? OFFSET ?`)
      .bind(...values, pageSize, offset)
      .all();
    return json({ ok: true, page, pageSize, total: totalRow?.c || 0, results: rows.results || [] });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}