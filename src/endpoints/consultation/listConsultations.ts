import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /consultations?from=YYYY-MM-DD&to=YYYY-MM-DD&status=
export async function listConsultationsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  // Modelo sem planos/capabilities: todos usuários autenticados podem listar.

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const status = url.searchParams.get('status');
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return json({ error: 'from inválido' }, 400);
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json({ error: 'to inválido' }, 400);
  if (from && to && from > to) return json({ error: 'intervalo inválido' }, 400);
  const clauses: string[] = ['user_id = ?'];
  const values: any[] = [userId];
  if (status) { clauses.push('status = ?'); values.push(status); }
  if (from) { clauses.push(`date(scheduled_at) >= ?`); values.push(from); }
  if (to) { clauses.push(`date(scheduled_at) <= ?`); values.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  try {
    // Ordenação: futuras primeiro (mais próximas -> mais distantes), depois passadas (mais recentes -> mais antigas)
    const rows = await env.DB.prepare(
      `SELECT id, type, status, scheduled_at, duration_min, notes, created_at, updated_at
       FROM consultations ${where}
       ORDER BY
         (datetime(scheduled_at) >= datetime('now')) DESC,
         CASE WHEN datetime(scheduled_at) >= datetime('now') THEN datetime(scheduled_at) END ASC,
         CASE WHEN datetime(scheduled_at) < datetime('now') THEN datetime(scheduled_at) END DESC
       LIMIT 20`
    )
      .bind(...values)
      .all();
    return json({ ok: true, results: rows.results || [] });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
