import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// PATCH /consultations/:id/cancel { reason? }
export async function cancelConsultationHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  // Capabilities removidas: todos podem cancelar sua própria consulta
  const url = new URL(request.url);
  const id = url.pathname.split('/').slice(-2)[0]; // .../consultations/:id/cancel
  let body: any; try { body = await request.json(); } catch { body = {}; }
  const reason = typeof body.reason === 'string' ? body.reason.slice(0,300) : null;
  try {
    const existing = await env.DB.prepare(`SELECT id, user_id, status, scheduled_at FROM consultations WHERE id = ? AND user_id = ?`).bind(id, userId).first<any>();
    if (!existing) return json({ error: 'Not Found' }, 404);
    if (existing.status !== 'scheduled') return json({ error: 'invalid_state' }, 400);
    await env.DB.prepare(`UPDATE consultations SET status = 'canceled', canceled_at = CURRENT_TIMESTAMP, canceled_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(reason, id, userId)
      .run();
    return json({ ok: true });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
