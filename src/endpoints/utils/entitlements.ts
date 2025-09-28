import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function entitlementsHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "GET")
    return json({ error: "Method Not Allowed" }, 405);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { valid, payload } = await verifyAccessToken(env, token, {
    issuer: env.SITE_DNS,
    audience: env.SITE_DNS,
  });
  if (!valid || !payload?.sub) return json({ error: "Unauthorized" }, 401);
  const userId = String(payload.sub);
  try {
    const ent = await computeEffectiveEntitlements(env, userId);
    // Optionally attach session_version for client-side caching decisions
  let version: number | null = null;
    // Diet revision usage (monthly)
    let usage: Record<string, any> = {};
    try {
      const row = await env.DB.prepare(
        `SELECT u.session_version, v.version as ent_version FROM users u
          LEFT JOIN user_entitlements_version v ON v.user_id = u.id
          WHERE u.id = ?`
      ).bind(userId).first<{ session_version?: number; ent_version?: number }>();
      // Combine both: high 16 bits session_version, low 16 bits ent_version to keep ETag stable ordering
      const sv = row?.session_version ?? 0;
      const ev = row?.ent_version ?? 0;
      version = (sv << 16) + (ev & 0xFFFF);
    } catch {}
    // Compute current month start/end (UTC) and count revisions (versions beyond #1)
    try {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
      const pad = (n:number)=> String(n).padStart(2,'0');
      const fmt = (d:Date)=> `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
      const startStr = fmt(start); const endStr = fmt(end);
      // Count revisions across all active plans of the user (versions number > 1)
      const countRow = await env.DB.prepare(`SELECT COUNT(1) as c FROM diet_plan_versions v
          INNER JOIN diet_plans p ON p.id = v.plan_id
          WHERE p.user_id = ? AND v.version_number > 1
            AND v.created_at >= ? || ' 00:00:00' AND v.created_at <= ? || ' 23:59:59'`)
        .bind(userId, startStr, endStr)
        .first<{ c?: number }>();
      const used = countRow?.c || 0;
      const limit = ent.limits?.['DIETA_REVISOES_MES'] ?? null;
      usage.DIETA_REVISOES_MES = { used, limit, remaining: (limit == null ? null : Math.max(0, limit - used)) };
    } catch {}
    // Water daily usage (sum ml today)
    try {
      const d = new Date();
      const pad = (n:number)=> String(n).padStart(2,'0');
      const today = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
      const row = await env.DB.prepare('SELECT COALESCE(SUM(amount_ml),0) as ml FROM water_logs WHERE user_id = ? AND log_date = ?')
        .bind(userId, today)
        .first<{ ml?: number }>();
      const usedMl = row?.ml || 0;
      const waterLimit = ent.limits?.['WATER_ML_DIA'] ?? null; // future plan limit
      usage.WATER_ML_DIA = { used: usedMl, limit: waterLimit, remaining: waterLimit == null ? null : Math.max(0, waterLimit - usedMl) };
    } catch {}
    // Meal usage today (count + calories)
    try {
      const d = new Date();
      const pad = (n:number)=> String(n).padStart(2,'0');
      const today = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
      const row = await env.DB.prepare('SELECT COUNT(1) as c, COALESCE(SUM(calories),0) as kcal FROM meal_logs WHERE user_id = ? AND log_date = ?')
        .bind(userId, today)
        .first<{ c?: number; kcal?: number }>();
      usage.REFEICOES_DIA = { count: row?.c || 0, calories: row?.kcal || 0 };
    } catch {}
    // Last weight (for quick dashboard) & delta 7d (if available)
    try {
      const rows = await env.DB.prepare(`SELECT log_date, weight_kg FROM weight_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 8`)
        .bind(userId)
        .all<{ log_date: string; weight_kg: number }>();
      const list = rows.results || [];
      if (list.length) {
        const latest = list[0];
        const weekAgo = list.find((_,i)=> i === 7); // 8th record ~7 dias atrás se diário
        let diff_kg: number | null = null;
        if (weekAgo) diff_kg = +(latest.weight_kg - weekAgo.weight_kg).toFixed(2);
        usage.PESO_ATUAL = { weight_kg: latest.weight_kg, date: latest.log_date, diff7d: diff_kg };
      }
    } catch {}
    // Build ETag combining ent.hash + version (session_version) to allow client caching
    const etagBase = ent.hash + ':' + (version ?? '0');
    let h = 0; for (let i=0;i<etagBase.length;i++) h = (h<<5)-h + etagBase.charCodeAt(i) | 0; const etag = 'W/"ent-'+(h>>>0).toString(16)+'"';
    const ifNone = request.headers.get('If-None-Match');
    if (ifNone === etag) {
      return new Response(null, { status: 304, headers: { ...JSON_HEADERS, 'ETag': etag, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'ETag' } });
    }
    const resBody = { ...ent, version, usage };
    const res = json(resBody);
    res.headers.set('ETag', etag);
    res.headers.set('Access-Control-Expose-Headers', 'ETag');
    return res;
  } catch (e: any) {
    return json({ error: "Internal Error", detail: e?.message }, 500);
  }
}
