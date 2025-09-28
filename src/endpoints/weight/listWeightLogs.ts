import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /weight/logs?from=YYYY-MM-DD&to=YYYY-MM-DD (default: last 30 days)
export async function listWeightLogsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);

  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('PESO_LOG')) return json({ error: 'Forbidden (missing PESO_LOG)' }, 403);

  const url = new URL(request.url);
  const isValidDate = (s:string)=> /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
  const toParam = url.searchParams.get('to');
  const fromParam = url.searchParams.get('from');
  const today = new Date();
  const pad = (n:number)=> String(n).padStart(2,'0');
  const fmt = (d:Date)=> `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const toStr = toParam && isValidDate(toParam) ? toParam : fmt(today);
  let fromStr: string;
  if (fromParam && isValidDate(fromParam)) {
    fromStr = fromParam;
  } else {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - 29); // last 30 days
    fromStr = fmt(start);
  }
  try {
    const rows = await env.DB.prepare(`SELECT id, log_date, weight_kg, note, created_at, updated_at
      FROM weight_logs WHERE user_id = ? AND log_date >= ? AND log_date <= ? ORDER BY log_date ASC`)
      .bind(userId, fromStr, toStr)
      .all<any>();
    return json({ ok: true, results: rows.results || [], range: { from: fromStr, to: toStr } });
  } catch (err:any) {
    console.error('[listWeightLogs] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
