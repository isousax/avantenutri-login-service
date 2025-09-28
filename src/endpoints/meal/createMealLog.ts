import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// POST /meal/logs { meal_type, description?, calories?, protein_g?, carbs_g?, fat_g?, datetime? ISO8601 }
export async function createMealLogHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('REFEICAO_LOG')) return json({ error: 'Forbidden (missing REFEICAO_LOG)' }, 403);

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const meal_type = typeof body?.meal_type === 'string' ? body.meal_type.toLowerCase() : '';
  const allowed = ['breakfast','lunch','dinner','snack','other'];
  if (!allowed.includes(meal_type)) return json({ error: 'meal_type inválido' }, 400);
  let dt: Date;
  if (body?.datetime) {
    const d = new Date(body.datetime);
    if (isNaN(d.getTime())) return json({ error: 'datetime inválido' }, 400);
    dt = d;
  } else {
    dt = new Date();
  }
  const iso = dt.toISOString();
  const pad = (n:number)=> String(n).padStart(2,'0');
  const dateStr = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`;
  const description = typeof body?.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 500) : null;
  const num = (v:any, max:number, decimals=0) => {
    if (v==null || v==='') return null;
    const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) return null; return decimals? Math.round(n * Math.pow(10,decimals))/Math.pow(10,decimals) : Math.round(n);
  };
  const calories = num(body?.calories, 5000);
  const protein_g = num(body?.protein_g, 300, 2);
  const carbs_g = num(body?.carbs_g, 600, 2);
  const fat_g = num(body?.fat_g, 300, 2);

  try {
    await env.DB.prepare(`INSERT INTO meal_logs (user_id, log_datetime, log_date, meal_type, description, calories, protein_g, carbs_g, fat_g) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(userId, iso, dateStr, meal_type, description, calories, protein_g, carbs_g, fat_g)
      .run();
    return json({ ok: true });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}

// GET /meal/logs?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function listMealLogsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('REFEICAO_LOG')) return json({ error: 'Forbidden (missing REFEICAO_LOG)' }, 403);

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json({ error: 'from/to inválidos' }, 400);
  if (from > to) return json({ error: 'intervalo inválido' }, 400);
  try {
    const rows = await env.DB.prepare(`SELECT id, log_datetime, log_date, meal_type, description, calories, protein_g, carbs_g, fat_g, created_at, updated_at FROM meal_logs WHERE user_id = ? AND log_date >= ? AND log_date <= ? ORDER BY log_datetime ASC`)
      .bind(userId, from, to)
      .all();
    return json({ ok: true, range: { from, to }, results: rows.results || [] });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}

// GET /meal/summary?days=7 -> aggregated macros + per-day totals
export async function summaryMealLogsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('REFEICAO_LOG')) return json({ error: 'Forbidden (missing REFEICAO_LOG)' }, 403);
  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get('days') || 7);
  const days = !Number.isFinite(daysRaw) || daysRaw <= 0 ? 7 : Math.min(90, Math.round(daysRaw));
  const end = new Date();
  const pad = (n:number)=> String(n).padStart(2,'0');
  const fmt = (d:Date)=> `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const endStr = fmt(end);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startStr = fmt(start);
  try {
    // fetch goals
    const goalsRow = await env.DB.prepare(`SELECT calories_goal_kcal, protein_goal_g, carbs_goal_g, fat_goal_g FROM meal_goals WHERE user_id = ?`)
      .bind(userId)
      .first<{ calories_goal_kcal?: number; protein_goal_g?: number; carbs_goal_g?: number; fat_goal_g?: number }>();
    const rows = await env.DB.prepare(`SELECT log_date, meal_type, calories, protein_g, carbs_g, fat_g FROM meal_logs WHERE user_id = ? AND log_date >= ? AND log_date <= ? ORDER BY log_date ASC`)
      .bind(userId, startStr, endStr)
      .all<{ log_date: string; meal_type: string; calories: number|null; protein_g: number|null; carbs_g: number|null; fat_g: number|null }>();
    const list = rows.results || [];
    const goals = goalsRow ? {
      calories: goalsRow.calories_goal_kcal ?? null,
      protein_g: goalsRow.protein_goal_g ?? null,
      carbs_g: goalsRow.carbs_goal_g ?? null,
      fat_g: goalsRow.fat_goal_g ?? null,
    } : { calories: null, protein_g: null, carbs_g: null, fat_g: null };
    if (!list.length) return json({ ok: true, range: { from: startStr, to: endStr }, days: [], stats: null, goals });
    const byDate: Record<string, { date: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; count: number }> = {};
    for (const r of list) {
      if (!byDate[r.log_date]) byDate[r.log_date] = { date: r.log_date, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, count: 0 };
      byDate[r.log_date].calories += r.calories || 0;
      byDate[r.log_date].protein_g += r.protein_g || 0;
      byDate[r.log_date].carbs_g += r.carbs_g || 0;
      byDate[r.log_date].fat_g += r.fat_g || 0;
      byDate[r.log_date].count += 1;
    }
    const daysArr = Object.values(byDate).sort((a,b)=> a.date.localeCompare(b.date));
    const totalCalories = daysArr.reduce((s,d)=> s + d.calories, 0);
    const totalProtein = daysArr.reduce((s,d)=> s + d.protein_g, 0);
    const totalCarbs = daysArr.reduce((s,d)=> s + d.carbs_g, 0);
    const totalFat = daysArr.reduce((s,d)=> s + d.fat_g, 0);
    const avgCalories = totalCalories / daysArr.length;
    const stats = { totalCalories, totalProtein, totalCarbs, totalFat, avgCalories: Math.round(avgCalories * 100)/100 };
    return json({ ok: true, range: { from: startStr, to: endStr }, days: daysArr, stats, goals });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}

// PATCH /meal/logs/:id  { description?, calories?, protein_g?, carbs_g?, fat_g? }
export async function patchMealLogHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('REFEICAO_LOG')) return json({ error: 'Forbidden (missing REFEICAO_LOG)' }, 403);
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop()!;
  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const num = (v:any, max:number, decimals=0) => { if (v==null || v==='') return undefined; const n = Number(v); if(!Number.isFinite(n)|| n<0 || n>max) return undefined; return decimals? Math.round(n*Math.pow(10,decimals))/Math.pow(10,decimals) : Math.round(n); };
  const fields: string[] = []; const values: any[] = [];
  if (typeof body.description === 'string') { fields.push('description = ?'); values.push(body.description.trim().slice(0,500) || null); }
  const c = num(body.calories, 5000); if (c !== undefined) { fields.push('calories = ?'); values.push(c); }
  const p = num(body.protein_g, 300, 2); if (p !== undefined) { fields.push('protein_g = ?'); values.push(p); }
  const cb = num(body.carbs_g, 600, 2); if (cb !== undefined) { fields.push('carbs_g = ?'); values.push(cb); }
  const f = num(body.fat_g, 300, 2); if (f !== undefined) { fields.push('fat_g = ?'); values.push(f); }
  if (!fields.length) return json({ error: 'Nenhum campo para atualizar' }, 400);
  fields.push('updated_at = CURRENT_TIMESTAMP');
  try {
    const res = await env.DB.prepare(`UPDATE meal_logs SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, id, userId).run();
    if (res.meta.changes === 0) return json({ error: 'Not Found' }, 404);
    return json({ ok: true });
  } catch { return json({ error: 'Internal Error' }, 500); }
}

// DELETE /meal/logs/:id
export async function deleteMealLogHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'DELETE') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('REFEICAO_LOG')) return json({ error: 'Forbidden (missing REFEICAO_LOG)' }, 403);
  const url = new URL(request.url); const id = url.pathname.split('/').pop()!;
  try {
    const res = await env.DB.prepare(`DELETE FROM meal_logs WHERE id = ? AND user_id = ?`).bind(id, userId).run();
    if (res.meta.changes === 0) return json({ error: 'Not Found' }, 404);
    return json({ ok: true });
  } catch { return json({ error: 'Internal Error' }, 500); }
}

// PUT /meal/goals  { calories_goal_kcal?, protein_goal_g?, carbs_goal_g?, fat_goal_g? } (valores null para remover)
export async function updateMealGoalsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PUT') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('REFEICAO_LOG')) return json({ error: 'Forbidden (missing REFEICAO_LOG)' }, 403);
  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const normInt = (v:any,max:number)=> { if(v==null) return null; const n=Number(v); if(!Number.isFinite(n)|| n<=0 || n>max) return undefined; return Math.round(n); };
  const normFloat = (v:any,max:number)=> { if(v==null) return null; const n=Number(v); if(!Number.isFinite(n)|| n<=0 || n>max) return undefined; return Math.round(n*100)/100; };
  const cal = normInt(body.calories_goal_kcal, 10000); if (cal===undefined) return json({ error: 'calories_goal_kcal inválido' }, 400);
  const prot = normFloat(body.protein_goal_g, 1000); if (prot===undefined) return json({ error: 'protein_goal_g inválido' }, 400);
  const carb = normFloat(body.carbs_goal_g, 1500); if (carb===undefined) return json({ error: 'carbs_goal_g inválido' }, 400);
  const fat = normFloat(body.fat_goal_g, 1000); if (fat===undefined) return json({ error: 'fat_goal_g inválido' }, 400);
  try {
    await env.DB.prepare(`INSERT INTO meal_goals (user_id, calories_goal_kcal, protein_goal_g, carbs_goal_g, fat_goal_g) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET calories_goal_kcal=excluded.calories_goal_kcal, protein_goal_g=excluded.protein_goal_g, carbs_goal_g=excluded.carbs_goal_g, fat_goal_g=excluded.fat_goal_g, updated_at=CURRENT_TIMESTAMP`)
      .bind(userId, cal, prot, carb, fat)
      .run();
    return json({ ok: true, goals: { calories: cal, protein_g: prot, carbs_g: carb, fat_g: fat } });
  } catch { return json({ error: 'Internal Error' }, 500); }
}