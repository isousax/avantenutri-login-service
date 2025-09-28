import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// POST /water/logs  { amount_ml: number, date?: 'YYYY-MM-DD' }
export async function createWaterLogHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);

  // Capability check (AGUA_LOG)
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('AGUA_LOG')) return json({ error: 'Forbidden (missing AGUA_LOG)' }, 403);

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const amount_ml = Number(body?.amount_ml);
  if (!Number.isFinite(amount_ml) || amount_ml <= 0 || amount_ml > 2000) return json({ error: 'amount_ml inválido (1-2000)' }, 400);
  let dateStr: string;
  if (body?.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || isNaN(Date.parse(body.date))) return json({ error: 'date inválida (YYYY-MM-DD)' }, 400);
    dateStr = body.date;
  } else {
    const d = new Date();
    const pad = (n:number)=> String(n).padStart(2,'0');
    dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  }

  try {
    // Daily limit enforcement (WATER_ML_DIA)
    const waterLimit = ent.limits?.['WATER_ML_DIA'];
    if (typeof waterLimit === 'number') {
      const sumRow = await env.DB.prepare('SELECT COALESCE(SUM(amount_ml),0) as ml FROM water_logs WHERE user_id = ? AND log_date = ?')
        .bind(userId, dateStr)
        .first<{ ml?: number }>();
      const used = sumRow?.ml || 0;
      if (used + amount_ml > waterLimit) {
        return json({ error: 'Limite diário de água atingido', used, limit: waterLimit, remaining: Math.max(0, waterLimit - used) }, 429);
      }
    }

    await env.DB.prepare(`INSERT INTO water_logs (user_id, log_date, amount_ml) VALUES (?, ?, ?)`)
        .bind(userId, dateStr, amount_ml)
        .run();

    // Increment usage counter month bucket (optional optimization for analytics) key: WATER_LOGS_QTD
    try {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
      const pad = (n:number)=> String(n).padStart(2,'0');
      const fmt = (d:Date)=> `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
      const startStr = fmt(monthStart); const endStr = fmt(monthEnd);
      await env.DB.prepare(`INSERT INTO user_usage_counters (user_id, key, period_start, period_end, value) VALUES (?, 'WATER_LOGS_QTD', ?, ?, 1)
          ON CONFLICT(user_id, key, period_start) DO UPDATE SET value = value + 1`)
        .bind(userId, startStr, endStr)
        .run();
    } catch (e) { /* silent */ }
    return json({ ok: true });
  } catch (err:any) {
    console.error('[createWaterLog] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
