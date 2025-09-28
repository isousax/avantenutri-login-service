import type { Env } from '../../types/Env';
import { verifyAccessToken } from '../../service/tokenVerify';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function listUserPaymentsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  try {
    const rows = await env.DB.prepare(`SELECT id, plan_id, amount_cents, currency, status, status_detail, external_id, processed_at, created_at, updated_at
      FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).bind(String(payload.sub)).all();
    return json({ ok: true, payments: rows.results });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
