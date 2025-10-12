import type { Env } from '../../types/Env';
import { requireAdmin } from '../../middleware/requireAdmin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /admin/consultations/pricing -> lista preços
// PUT /admin/consultations/pricing { type, amount_cents, active? }
// PATCH /admin/consultations/pricing/{type} { amount_cents?, active? }

export async function adminListConsultationPricingHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  
  try {
    const rows = await env.DB.prepare('SELECT type, amount_cents, currency, active, updated_at FROM consultation_pricing ORDER BY type').all();
    return json({ ok: true, pricing: rows.results || [] });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}

export async function adminUpsertConsultationPricingHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PUT') return json({ error: 'Method Not Allowed' }, 405);
  
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  
  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { type, amount_cents, active } = body || {};
  if (!type || typeof amount_cents !== 'number') return json({ error: 'missing_fields' }, 400);
  if (amount_cents <= 0) return json({ error: 'invalid_amount' }, 400);
  try {
    await env.DB.prepare('INSERT INTO consultation_pricing (type, amount_cents, active, updated_at) VALUES (?, ?, COALESCE(?,1), CURRENT_TIMESTAMP) ON CONFLICT(type) DO UPDATE SET amount_cents=excluded.amount_cents, active=COALESCE(?, consultation_pricing.active), updated_at=CURRENT_TIMESTAMP')
      .bind(type, amount_cents, active, active).run();
    const row = await env.DB.prepare('SELECT type, amount_cents, currency, active, updated_at FROM consultation_pricing WHERE type = ?').bind(type).first();
    return json({ ok: true, pricing: row });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}

export async function adminPatchConsultationPricingHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response;
  
  const match = request.url.match(/consultations\/pricing\/(.+)$/);
  if (!match) return json({ error: 'missing_type' }, 400);
  const type = decodeURIComponent(match[1]);
  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { amount_cents, active } = body || {};
  if (amount_cents != null && (typeof amount_cents !== 'number' || amount_cents <= 0)) return json({ error: 'invalid_amount' }, 400);
  if (active != null && !(active === 0 || active === 1)) return json({ error: 'invalid_active' }, 400);
  try {
    const existing = await env.DB.prepare('SELECT type FROM consultation_pricing WHERE type = ?').bind(type).first();
    if (!existing) return json({ error: 'not_found' }, 404);
    if (amount_cents != null) {
      await env.DB.prepare('UPDATE consultation_pricing SET amount_cents = ?, updated_at = CURRENT_TIMESTAMP WHERE type = ?').bind(amount_cents, type).run();
    }
    if (active != null) {
      await env.DB.prepare('UPDATE consultation_pricing SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE type = ?').bind(active, type).run();
    }
    const row = await env.DB.prepare('SELECT type, amount_cents, currency, active, updated_at FROM consultation_pricing WHERE type = ?').bind(type).first();
    return json({ ok: true, pricing: row });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
