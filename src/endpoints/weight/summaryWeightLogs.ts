import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /weight/summary?days=90  (default 90, max 365)
// Returns: chronological series plus stats (first, latest, diff_kg, diff_percent, min, max, trend_slope)
export async function summaryWeightLogsHandler(request: Request, env: Env): Promise<Response> {
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
  const daysParam = parseInt(url.searchParams.get('days') || '90', 10);
  const days = !isNaN(daysParam) ? Math.min(Math.max(daysParam, 7), 365) : 90;

  const now = new Date();
  const pad = (n:number)=> String(n).padStart(2,'0');
  const fmt = (d:Date)=> `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const endStr = fmt(now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startStr = fmt(start);

  try {
    // fetch goal
    const goalRow = await env.DB.prepare('SELECT weight_goal_kg FROM user_goals WHERE user_id = ?')
      .bind(userId)
      .first<{ weight_goal_kg?: number }>();
    const weightGoal = goalRow?.weight_goal_kg ?? null;
    const rows = await env.DB.prepare(`SELECT log_date, weight_kg FROM weight_logs WHERE user_id = ? AND log_date >= ? AND log_date <= ? ORDER BY log_date ASC`)
      .bind(userId, startStr, endStr)
      .all<{ log_date: string; weight_kg: number }>();
    const series = (rows.results || []).map(r => ({ date: r.log_date, weight_kg: r.weight_kg }));
    if (!series.length) return json({ ok: true, range: { from: startStr, to: endStr }, series, stats: null });
    const first = series[0];
    const latest = series[series.length - 1];
    const min = series.reduce((m,s)=> s.weight_kg < m.weight_kg ? s : m, first);
    const max = series.reduce((m,s)=> s.weight_kg > m.weight_kg ? s : m, first);
    const diff_kg = +(latest.weight_kg - first.weight_kg).toFixed(2);
    const diff_percent = first.weight_kg ? +( (diff_kg / first.weight_kg) * 100 ).toFixed(2) : null;
    // Trend via simple linear regression slope (kg per day)
    let slope = 0;
    if (series.length >= 2) {
      const n = series.length;
      const xs = series.map((_,i)=> i); // 0..n-1 days
      const ys = series.map(s=> s.weight_kg);
      const sumX = xs.reduce((a,b)=>a+b,0);
      const sumY = ys.reduce((a,b)=>a+b,0);
      const sumXY = xs.reduce((a,x,i)=> a + x*ys[i], 0);
      const sumX2 = xs.reduce((a,x)=> a + x*x, 0);
      const denom = (n * sumX2 - sumX*sumX);
      if (denom !== 0) slope = (n*sumXY - sumX*sumY) / denom; // kg per index (~day)
      slope = +slope.toFixed(4);
    }
    return json({ ok: true, range: { from: startStr, to: endStr }, series, stats: { first, latest, diff_kg, diff_percent, min, max, trend_slope: slope, weight_goal_kg: weightGoal } });
  } catch (err:any) {
    console.error('[summaryWeightLogs] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
