import type { Env } from "../../types/Env";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

export async function listPlansHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  try {
    const rows = await env.DB.prepare("SELECT id, name, price_cents, active FROM plans WHERE active = 1 ORDER BY price_cents ASC")
      .all<{ id: string; name: string; price_cents: number; active: number }>();
    const list = (rows.results || []).map(r => ({ id: r.id, name: r.name, price_cents: r.price_cents }));
    // Simple ETag (hash of ids+prices)
    const hashBase = JSON.stringify(list);
    let h = 0; for (let i=0;i<hashBase.length;i++) h = (h<<5)-h + hashBase.charCodeAt(i) | 0; const etag = 'W/"pl-'+(h>>>0).toString(16)+'"';
    if (request.headers.get('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'ETag' } });
    }
    return json({ plans: list }, 200, { 'ETag': etag, 'Access-Control-Expose-Headers': 'ETag' });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
