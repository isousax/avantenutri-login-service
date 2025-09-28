import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// POST /weight/logs  { weight_kg: number, date?: 'YYYY-MM-DD', note?: string }
export async function createWeightLogHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);

  // Capability check (PESO_LOG)
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('PESO_LOG')) return json({ error: 'Forbidden (missing PESO_LOG)' }, 403);

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const weightRaw = Number(body?.weight_kg);
  if (!Number.isFinite(weightRaw) || weightRaw <= 0 || weightRaw > 500) return json({ error: 'weight_kg inválido (0-500]' }, 400);
  const weight_kg = Math.round(weightRaw * 100) / 100; // 2 casas
  let dateStr: string;
  if (body?.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || isNaN(Date.parse(body.date))) return json({ error: 'date inválida (YYYY-MM-DD)' }, 400);
    dateStr = body.date;
  } else {
    const d = new Date();
    const pad = (n:number)=> String(n).padStart(2,'0');
    dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  }
  const note = typeof body?.note === 'string' && body.note.length <= 300 ? body.note : null;

  try {
    // Upsert semantics: se já existe peso no dia, sobrescreve (mantendo histórico simples)
    await env.DB.prepare(`INSERT INTO weight_logs (user_id, log_date, weight_kg, note) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, log_date) DO UPDATE SET weight_kg = excluded.weight_kg, note = excluded.note, updated_at = CURRENT_TIMESTAMP`)
      .bind(userId, dateStr, weight_kg, note)
      .run();
    return json({ ok: true });
  } catch (err:any) {
    console.error('[createWeightLog] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}

// PATCH /weight/logs/:date  { weight_kg?: number, note?: string|null }
export async function patchWeightLogHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const url = new URL(request.url);
  const m = url.pathname.match(/\/weight\/logs\/(\d{4}-\d{2}-\d{2})$/);
  if (!m) return json({ error: 'Not Found' }, 404);
  const dateStr = m[1];
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('PESO_LOG')) return json({ error: 'Forbidden' }, 403);
  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  let setClauses: string[] = []; const binds: any[] = [];
  if (body.weight_kg != null) {
    const v = Number(body.weight_kg);
    if (!Number.isFinite(v) || v <= 0 || v > 500) return json({ error: 'weight_kg inválido' }, 400);
    setClauses.push('weight_kg = ?'); binds.push(Math.round(v*100)/100);
  }
  if (Object.prototype.hasOwnProperty.call(body,'note')) {
    if (body.note == null) { setClauses.push('note = NULL'); } else if (typeof body.note === 'string' && body.note.length <= 300) { setClauses.push('note = ?'); binds.push(body.note); } else return json({ error: 'note inválida' },400);
  }
  if (!setClauses.length) return json({ error: 'Nada para atualizar' }, 400);
  try {
    const res = await env.DB.prepare(`UPDATE weight_logs SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND log_date = ?`)
      .bind(...binds, userId, dateStr)
      .run();
    if (!res.success) return json({ error: 'Falha ao atualizar' }, 500);
    return json({ ok: true });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
