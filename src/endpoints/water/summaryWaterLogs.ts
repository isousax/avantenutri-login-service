import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /water/summary?days=7  -> aggregates per day (last N days, default 7, max 31)
export async function summaryWaterLogsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);

  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get('days') || '7', 10);
  const days = !isNaN(daysParam) ? Math.min(Math.max(daysParam,1), 31) : 7;

  const now = new Date();
  const pad = (n:number)=> String(n).padStart(2,'0');
  const fmt = (d:Date)=> `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const endStr = fmt(now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startStr = fmt(start);

  try {
    const daily = await env.DB.prepare(`SELECT log_date, SUM(amount_ml) as total_ml
      FROM water_logs
      WHERE user_id = ? AND log_date >= ? AND log_date <= ?
      GROUP BY log_date
      ORDER BY log_date ASC`).bind(userId, startStr, endStr).all<{ log_date: string; total_ml: number }>();
    const map: Record<string, number> = {};
    for (const r of daily.results || []) map[r.log_date] = r.total_ml;
    // Fill missing days with 0
    const daysArr: { date: string; total_ml: number }[] = [];
    const cur = new Date(start);
    while (cur <= now) {
      const ds = fmt(cur);
      daysArr.push({ date: ds, total_ml: map[ds] || 0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const totals = daysArr.map(d => d.total_ml);
    const sum = totals.reduce((a,b)=> a+b, 0);
    const avg = totals.length ? sum / totals.length : 0;
    const best = daysArr.reduce<{ date: string; total_ml: number } | null>((best, d) => !best || d.total_ml > best.total_ml ? d : best, null);
    const today = endStr;
    const todayTotal = map[today] || 0;
    
    // Fetch user water goal (daily cups) if exists to enrich response (non-fatal if fails)
  let daily_cups: number | null = null;
  let cup_ml: number | null = null;
    try {
      const goalRow = await env.DB.prepare('SELECT daily_cups FROM user_water_goals WHERE user_id = ?')
        .bind(userId)
        .first<{ daily_cups?: number }>();
      if (goalRow?.daily_cups && goalRow.daily_cups > 0) daily_cups = goalRow.daily_cups;
      const settingsRow = await env.DB.prepare('SELECT cup_ml FROM user_water_settings WHERE user_id = ?')
        .bind(userId)
        .first<{ cup_ml?: number }>();
      if (settingsRow?.cup_ml && settingsRow.cup_ml > 0) cup_ml = settingsRow.cup_ml;
    } catch { /* ignore */ }
    return json({ ok: true, range: { from: startStr, to: endStr }, days: daysArr, stats: { avg, best, today: { date: today, total_ml: todayTotal }, limit: null, daily_cups, cup_ml } });
  } catch (err:any) {
    console.error('[summaryWaterLogs] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
