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
    // Bloqueia cancelamento nas últimas 48h antes do horário agendado
    try {
      const sched = new Date(existing.scheduled_at);
      if (!Number.isNaN(sched.getTime())) {
        const msLeft = sched.getTime() - Date.now();
        if (msLeft <= 48 * 60 * 60 * 1000) {
          return json({ error: 'cancellation_window' }, 422);
        }
      }
    } catch {}
    await env.DB.prepare(`UPDATE consultations SET status = 'canceled', canceled_at = CURRENT_TIMESTAMP, canceled_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .bind(reason, id, userId)
      .run();
    // Tentar devolver crédito associado (se houver)
    try {
      const credit = await env.DB.prepare(`SELECT id, status FROM consultation_credits WHERE consultation_id = ? LIMIT 1`).bind(id).first<{ id?: string; status?: string }>();
      if (credit?.id && credit.status === 'used') {
        await env.DB.prepare(`UPDATE consultation_credits SET status = 'available', used_at = NULL, consultation_id = NULL WHERE id = ?`).bind(credit.id).run();
      }
    } catch (e) {
      // Não falhar cancelamento por erro ao devolver crédito, apenas logar
      console.error('[cancelConsultation] Falha ao devolver crédito da consulta', id, e);
    }
    return json({ ok: true });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
