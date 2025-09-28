import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }); }

function currentMonthRange(): { start: string; end: string } {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0));
  const pad = (n:number)=> String(n).padStart(2,'0');
  const fmt = (dt:Date)=> `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`;
  return { start: fmt(start), end: fmt(end) };
}

export async function reviseDietPlanHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = payload.sub;
  const planId = request.url.split('/').slice(-2)[0]; // /diet/plans/{id}/revise
  if (!planId) return json({ error: 'plan id missing in path' }, 400);

  let body:any; try { body = await request.json(); } catch { body = {}; }
  const { notes, dataPatch } = body || {};

  // Capability check
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('DIETA_EDIT')) return json({ error: 'Forbidden (missing DIETA_EDIT)' }, 403);

  // Revision limit enforcement (monthly)
  const limit = ent.limits['DIETA_REVISOES_MES'] ?? 0;
  if (limit <= 0) return json({ error: 'Limite de revisões atingido para seu plano' }, 403);
  const { start, end } = currentMonthRange();
  try {
    const existingPlan = await env.DB.prepare('SELECT id, user_id, current_version_id FROM diet_plans WHERE id = ? AND user_id = ? AND status = "active"')
      .bind(planId, userId)
      .first<any>();
    if (!existingPlan?.id) return json({ error: 'Plano não encontrado' }, 404);

    // Count revisions (versions beyond #1) this month
    const countRow = await env.DB.prepare(`SELECT COUNT(1) as c FROM diet_plan_versions 
       WHERE plan_id = ? AND created_at >= ? || ' 00:00:00' AND created_at <= ? || ' 23:59:59'`)
      .bind(planId, start, end)
      .first<{ c?: number }>();
    const used = (countRow?.c || 0) - 1; // first version not a revision
    if (used >= limit) return json({ error: 'Você já usou todas as revisões deste mês' }, 403);

    // Get latest version number
    const lastV = await env.DB.prepare('SELECT version_number, data_json FROM diet_plan_versions WHERE id = ?')
      .bind(existingPlan.current_version_id)
      .first<{ version_number?: number; data_json?: string }>();
    const nextNumber = (lastV?.version_number || 0) + 1;
    let baseData: any = {}; try { baseData = JSON.parse(lastV?.data_json || '{}'); } catch { baseData = {}; }
    const merged = { ...baseData, ...(dataPatch || {}) };
    const newVid = crypto.randomUUID();

    await env.DB.prepare('INSERT INTO diet_plan_versions (id, plan_id, version_number, generated_by, data_json, notes) VALUES (?, ?, ?, "user", ?, ?)')
      .bind(newVid, planId, nextNumber, JSON.stringify(merged), notes || null)
      .run();
    await env.DB.prepare('UPDATE diet_plans SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(newVid, planId)
      .run();
    return json({ ok: true, plan_id: planId, version_id: newVid, version_number: nextNumber });
  } catch (err:any) {
    console.error('[reviseDietPlan] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
