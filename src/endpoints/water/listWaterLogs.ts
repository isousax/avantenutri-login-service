import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /water/logs?from=YYYY-MM-DD&to=YYYY-MM-DD  (default: hoje)
export async function listWaterLogsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const pad = (n:number)=> String(n).padStart(2,'0');
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const isValidDate = (s:string)=> /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
  const fromStr = from && isValidDate(from) ? from : todayStr;
  const toStr = to && isValidDate(to) ? to : fromStr;

  try {
    const rows = await env.DB.prepare(`SELECT id, log_date, amount_ml, created_at FROM water_logs WHERE user_id = ? AND log_date >= ? AND log_date <= ? ORDER BY log_date ASC, created_at ASC`)
      .bind(userId, fromStr, toStr)
      .all<any>();
    return json({ ok: true, results: rows.results || [], range: { from: fromStr, to: toStr } });
  } catch (err:any) {
    console.error('[listWaterLogs] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
