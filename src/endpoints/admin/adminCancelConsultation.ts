import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// PATCH /admin/consultations/:id/cancel { reason? }
export async function adminCancelConsultationHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const adminAuth = await requireAdmin(request, env);
  if (!adminAuth.ok) {
    return (adminAuth as { ok: false; response: Response }).response;
  }
  const url = new URL(request.url);
  const match = url.pathname.match(/admin\/consultations\/([^/]+)\/cancel$/);
  if (!match) return json({ error: 'invalid_path' }, 400);
  const id = match[1];
  let body: any; try { body = await request.json(); } catch { body = {}; }
  const reason = typeof body.reason === 'string' ? body.reason.slice(0,300) : null;
  try {
    const existing = await env.DB.prepare(`SELECT id, user_id, status, scheduled_at FROM consultations WHERE id = ?`).bind(id).first<any>();
    if (!existing) return json({ error: 'not_found' }, 404);
    if (existing.status !== 'scheduled') return json({ error: 'invalid_status' }, 400);

    await env.DB.prepare(`UPDATE consultations SET status = 'canceled', canceled_at = CURRENT_TIMESTAMP, canceled_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(reason ? `admin: ${reason}` : 'admin: canceled', id)
      .run();
    // Tentar devolver crédito associado (se houver)
    try {
      const credit = await env.DB.prepare(`SELECT id, status FROM consultation_credits WHERE consultation_id = ? LIMIT 1`).bind(id).first<{ id?: string; status?: string }>();
      if (credit?.id && credit.status === 'used') {
        await env.DB.prepare(`UPDATE consultation_credits SET status = 'available', used_at = NULL, consultation_id = NULL WHERE id = ?`).bind(credit.id).run();
      }
    } catch (e) {
      console.error('[adminCancelConsultation] Falha ao devolver crédito da consulta', id, e);
    }
    return json({ ok: true, id, status: 'canceled' });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}

export default adminCancelConsultationHandler;
