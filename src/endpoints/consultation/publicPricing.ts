import type { Env } from "../../types/Env";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200, extraHeaders: Record<string,string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });

// Public endpoint (no auth) exposing active consultation pricing
// GET /consultations/pricing
export async function publicConsultationPricingHandler(_request: Request, env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(`SELECT type, amount_cents, currency, active, updated_at FROM consultation_pricing WHERE active = 1 ORDER BY type`).all();
    const pricing = (rows.results || []).map((r: any) => ({ type: r.type, amount_cents: Number(r.amount_cents), currency: r.currency || 'BRL', updated_at: r.updated_at }));
    // Provide a very small caching window (can be tuned later)
    return json({ ok: true, pricing }, 200, { 'Cache-Control': 'public, max-age=120' });
  } catch (e) {
    console.warn('[publicConsultationPricing] error', e);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}

// Lightweight status endpoint: returns hash + count + updated_at max
export async function publicConsultationPricingStatusHandler(_request: Request, env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(`SELECT type, amount_cents, active, updated_at FROM consultation_pricing WHERE active = 1`).all();
    const list = rows.results || [];
    let maxUpdated: string | null = null;
    const hashBaseParts: string[] = [];
    for (const r of list as any[]) {
      hashBaseParts.push(`${r.type}:${r.amount_cents}`);
      if (!maxUpdated || (r.updated_at && r.updated_at > maxUpdated)) maxUpdated = r.updated_at;
    }
    const hashBase = hashBaseParts.sort().join('|');
    // simple FNV-like hash
    let h = 2166136261 >>> 0;
    for (let i = 0; i < hashBase.length; i++) {
      h ^= hashBase.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const etag = 'W/"pr-' + h.toString(16) + '"';
    return json({ ok: true, hash: etag, count: list.length, last_updated: maxUpdated }, 200, { 'Cache-Control': 'public, max-age=60', ETag: etag });
  } catch (e) {
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
