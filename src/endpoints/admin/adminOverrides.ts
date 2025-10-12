import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";
import { isCapability, isLimitKey } from "../../config/entitlementKeys";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface OverrideRow {
  id: string; user_id: string; type: string; key: string; value: number | null; expires_at: string | null; reason: string | null; created_by: string | null; created_at: string;
}

interface OverrideLogRow { id: number; override_id: string|null; user_id: string; action: string; snapshot_json: string|null; created_by: string|null; created_at: string; }

function parseIsoDate(input: any): string | null {
  if (!input) return null; const d = new Date(input); if (isNaN(d.getTime())) return null; return d.toISOString();
}

export async function listOverridesHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  const url = new URL(request.url);
  const userId = (url.searchParams.get('user_id') || '').trim();
  const status = (url.searchParams.get('status')||'').trim(); // active | expired | all
  const typeFilter = (url.searchParams.get('type')||'').trim(); // capability-grant | capability-revoke | limit-set
  if (!userId) return json({ error: 'user_id required' }, 400);
  try {
    const page = Math.max(1, Number(url.searchParams.get('page')||'1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')||'50')));
    const offset = (page-1)*pageSize;
  let where = `WHERE user_id = ?`;
  const params: any[] = [userId];
  if (typeFilter) { where += ` AND type = ?`; params.push(typeFilter); }
  if (status === 'active') { where += ` AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`; }
  else if (status === 'expired') { where += ` AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`; }
  const countRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM user_entitlement_overrides ${where}`).bind(...params).first<{ c:number }>();
  let base = `SELECT id, user_id, type, key, value, expires_at, reason, created_by, created_at FROM user_entitlement_overrides ${where}`;
    base += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const rows = await env.DB.prepare(base).bind(...params, pageSize, offset).all<OverrideRow>();
    const now = Date.now();
    const list = (rows.results || []).map(r => ({ ...r, expired: r.expires_at ? (new Date(r.expires_at).getTime() < now) : false }));
    return json({ results: list, page, pageSize, total: countRow?.c || 0 });
  } catch (e: any) {
    return json({ error: 'Internal Error', detail: e?.message }, 500);
  }
}

export async function createOverrideHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  const body: Partial<{ user_id: string; type: string; key: string; value: any; expires_at?: string; reason?: string }> = await request.json().catch(()=> ({}));
  const { user_id, type, key, value, expires_at, reason } = body;
  if (!user_id || !type || !key) return json({ error: 'missing fields' }, 400);
  if (!['capability-grant','capability-revoke','limit-set'].includes(type)) return json({ error: 'invalid type' }, 400);
  // Validate key semantics
  if (type === 'limit-set') {
    if (!isLimitKey(key)) return json({ error: 'invalid limit key' }, 400);
  } else {
    if (!isCapability(key)) return json({ error: 'invalid capability code' }, 400);
  }
  let val: number | null = null;
  if (type === 'limit-set') {
    if (value === null || value === undefined || value === '') val = null; else {
      const n = Number(value); if (!Number.isFinite(n) || n < 0) return json({ error: 'invalid value' }, 400); val = Math.floor(n);
    }
  }
  const expiresIso = parseIsoDate(expires_at);
  try {
    const idStmt = await env.DB.prepare("SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) as id").first<{ id: string }>();
    const id = idStmt?.id;
    await env.DB.prepare(`INSERT INTO user_entitlement_overrides (id, user_id, type, key, value, expires_at, reason, created_by) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id, user_id, type, key, val, expiresIso, reason || null, auth.auth.userId)
      .run();
    // Bump entitlements version (upsert)
    await env.DB.prepare(`INSERT INTO user_entitlements_version (user_id, version) VALUES (?,1)
       ON CONFLICT(user_id) DO UPDATE SET version = version + 1, updated_at = CURRENT_TIMESTAMP`)
      .bind(user_id)
      .run();
    // Audit log snapshot
    const snapshot = { id, user_id, type, key, value: val, expires_at: expiresIso, reason: reason || null };
    await env.DB.prepare(`INSERT INTO user_entitlement_override_log (override_id, user_id, action, snapshot_json, created_by) VALUES (?,?,?,?,?)`)
      .bind(id, user_id, 'create', JSON.stringify(snapshot), auth.auth.userId)
      .run();
    return json({ id });
  } catch (e: any) {
    return json({ error: 'Internal Error', detail: e?.message }, 500);
  }
}

export async function deleteOverrideHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'DELETE') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  const m = /\/admin\/overrides\/([a-f0-9-]+)$/.exec(new URL(request.url).pathname);
  if (!m) return json({ error: 'invalid path' }, 400);
  const id = m[1];
  try {
    const row = await env.DB.prepare('SELECT user_id, type, key, value, expires_at, reason FROM user_entitlement_overrides WHERE id = ?')
      .bind(id).first<{ user_id?: string; type?: string; key?: string; value?: number|null; expires_at?: string|null; reason?: string|null }>();
    await env.DB.prepare('DELETE FROM user_entitlement_overrides WHERE id = ?').bind(id).run();
    if (row?.user_id) {
      await env.DB.prepare(`INSERT INTO user_entitlements_version (user_id, version) VALUES (?,1)
         ON CONFLICT(user_id) DO UPDATE SET version = version + 1, updated_at = CURRENT_TIMESTAMP`)
        .bind(row.user_id).run();
      const snapshot = { id, user_id: row.user_id, type: row.type, key: row.key, value: row.value, expires_at: row.expires_at, reason: row.reason };
      await env.DB.prepare(`INSERT INTO user_entitlement_override_log (override_id, user_id, action, snapshot_json, created_by) VALUES (?,?,?,?,?)`)
        .bind(id, row.user_id, 'delete', JSON.stringify(snapshot), auth.auth.userId)
        .run();
    }
    return json({ deleted: true });
  } catch (e: any) {
    return json({ error: 'Internal Error', detail: e?.message }, 500);
  }
}

export async function patchOverrideHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  const m = /\/admin\/overrides\/([a-f0-9-]+)$/.exec(new URL(request.url).pathname);
  if (!m) return json({ error: 'invalid path' }, 400);
  const id = m[1];
  const body: Partial<{ value?: any; expires_at?: string|null; reason?: string|null }> = await request.json().catch(()=> ({}));
  try {
    const existing = await env.DB.prepare('SELECT user_id, type, key, value, expires_at, reason FROM user_entitlement_overrides WHERE id = ?')
      .bind(id).first<{ user_id?: string; type?: string; key?: string; value?: number|null; expires_at?: string|null; reason?: string|null }>();
    if (!existing?.user_id) return json({ error: 'not found' }, 404);
  let newValue = existing.value;
    if ('value' in body) {
      if (body.value === '' || body.value === null || body.value === undefined) newValue = null; else {
        const n = Number(body.value); if (!Number.isFinite(n) || n < 0) return json({ error: 'invalid value' }, 400); newValue = Math.floor(n);
      }
    }
    let newExpires = existing.expires_at;
    if ('expires_at' in body) {
      if (body.expires_at === null) newExpires = null; else if (body.expires_at) {
        const iso = parseIsoDate(body.expires_at); if (!iso) return json({ error: 'invalid expires_at' }, 400); newExpires = iso;
      }
    }
    const newReason = ('reason' in body) ? (body.reason ?? null) : existing.reason;
    await env.DB.prepare('UPDATE user_entitlement_overrides SET value = ?, expires_at = ?, reason = ? WHERE id = ?')
      .bind(newValue, newExpires, newReason, id).run();
    await env.DB.prepare(`INSERT INTO user_entitlements_version (user_id, version) VALUES (?,1)
       ON CONFLICT(user_id) DO UPDATE SET version = version + 1, updated_at = CURRENT_TIMESTAMP`)
      .bind(existing.user_id).run();
    const snapshot = { id, user_id: existing.user_id, type: existing.type, key: existing.key, value: newValue, expires_at: newExpires, reason: newReason };
    await env.DB.prepare(`INSERT INTO user_entitlement_override_log (override_id, user_id, action, snapshot_json, created_by) VALUES (?,?,?,?,?)`)
      .bind(id, existing.user_id, 'update', JSON.stringify(snapshot), auth.auth.userId).run();
    return json({ updated: true });
  } catch (e:any){
    return json({ error: 'Internal Error', detail: e?.message }, 500);
  }
}

export async function listOverrideLogsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  const url = new URL(request.url);
  const userId = (url.searchParams.get('user_id')||'').trim();
  const action = (url.searchParams.get('action')||'').trim(); // create|update|delete
  if (!userId) return json({ error: 'user_id required' }, 400);
  const page = Math.max(1, Number(url.searchParams.get('page')||'1'));
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize')||'100')));
  const offset = (page-1)*pageSize;
  try {
    let where = `WHERE user_id = ?`;
    const params: any[] = [userId];
    if (action) { where += ` AND action = ?`; params.push(action); }
    const countRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM user_entitlement_override_log ${where}`).bind(...params).first<{ c:number }>();
    let base = `SELECT id, override_id, user_id, action, snapshot_json, created_by, created_at FROM user_entitlement_override_log ${where}`;
    base += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    const rows = await env.DB.prepare(base).bind(...params, pageSize, offset).all<OverrideLogRow>();
    const results = (rows.results||[]).map(r => ({ ...r, snapshot: r.snapshot_json ? JSON.parse(r.snapshot_json) : null }));
    return json({ results, page, pageSize, total: countRow?.c || 0 });
  } catch (e:any){
    return json({ error: 'Internal Error', detail: e?.message }, 500);
  }
}
