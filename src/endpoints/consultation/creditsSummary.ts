import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /consultations/credits/summary
export async function consultationCreditsSummaryHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const allByUser = url.searchParams.get('all_by_user') === '1';

  try {
    if (allByUser) {
      // only admin allowed
      const role = (payload.role || '') as string;
      if (role.toLowerCase() !== 'admin') return json({ error: 'forbidden' }, 403);

      // Aggregate counts per user and type/status
      const rows = await env.DB.prepare(
        `SELECT c.user_id, u.display_name, u.email, c.type, c.status, COUNT(*) as cnt, MAX(c.created_at) as updated_at
         FROM consultation_credits c
         LEFT JOIN users u ON u.id = c.user_id
         GROUP BY c.user_id, c.type, c.status
         ORDER BY updated_at DESC`
      ).all<any>();

      const results = (rows.results || []) as any[];
      const map = new Map<string, any>();
      for (const r of results) {
        const uid = r.user_id as string;
        if (!map.has(uid)) {
          map.set(uid, {
            user_id: uid,
            name: r.display_name || undefined,
            email: r.email || undefined,
            avaliacao_completa: { available: 0, used: 0, expired: 0 },
            reavaliacao: { available: 0, used: 0, expired: 0 },
            updated_at: r.updated_at || null,
          });
        }
        const entry = map.get(uid);
        const type = String(r.type || 'unknown');
        const status = String(r.status || 'available');
        const cnt = Number(r.cnt || 0);
        if (type === 'avaliacao_completa' || type === 'reavaliacao') {
          const key = type === 'avaliacao_completa' ? 'avaliacao_completa' : 'reavaliacao';
          if (status === 'available') entry[key].available += cnt;
          else if (status === 'used') entry[key].used += cnt;
          else if (status === 'expired') entry[key].expired += cnt;
          // update updated_at if newer
          if (r.updated_at && (!entry.updated_at || new Date(r.updated_at) > new Date(entry.updated_at))) entry.updated_at = r.updated_at;
        }
      }

      const rowsOut = Array.from(map.values());
      return json({ ok: true, rows: rowsOut });
    }

    // user-level summary: counts by type/status for the authenticated user
    const userId = String(payload.sub);
    const agg = await env.DB.prepare(
      `SELECT type, status, locked, COUNT(*) as cnt FROM consultation_credits WHERE user_id = ? GROUP BY type, status, locked`
    ).bind(userId).all<any>();
    const results = (agg.results || []) as any[];
    const summary: Record<string, { available: number; used: number; expired: number; locked?: number }> = {};
    for (const r of results) {
      const type = String(r.type || 'unknown');
      const status = String(r.status || 'available');
      const locked = Number(r.locked || 0) === 1;
      const cnt = Number(r.cnt || 0);
      if (!summary[type]) summary[type] = { available: 0, used: 0, expired: 0 };
      if (status === 'available') {
        if (locked) {
          summary[type].locked = (summary[type].locked || 0) + cnt;
        } else {
          summary[type].available += cnt;
        }
      } else if (status === 'used') summary[type].used += cnt;
      else if (status === 'expired') summary[type].expired += cnt;
    }
    return json({ ok: true, summary });
  } catch (err) {
    console.error('[consultationCreditsSummary] error', err);
    return json({ error: 'Internal Error' }, 500);
  }
}

export default consultationCreditsSummaryHandler;
