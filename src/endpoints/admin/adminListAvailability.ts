import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /admin/consultations/availability?weekday=1
export async function adminListAvailabilityHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return (auth as { ok: false; response: Response }).response;
  const url = new URL(request.url);
  const weekday = url.searchParams.get('weekday');
  const clauses: string[] = [];
  const values: any[] = [];
  if (weekday !== null) { clauses.push('weekday = ?'); values.push(Number(weekday)); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  try {
    const rows = await env.DB.prepare(`SELECT * FROM consultation_availability_rules ${where} ORDER BY weekday, start_time`)
      .bind(...values)
      .all();
    return json({ ok: true, results: rows.results || [] });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
