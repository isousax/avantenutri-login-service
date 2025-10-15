import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// PATCH /admin/consultations/:id/complete
// Conclui consulta (admin) e libera reavaliação vinculada à avaliação completa, definindo validade de 6 meses para o crédito de reavaliação.
export async function adminCompleteConsultationHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/admin\/consultations\/([^/]+)\/complete$/);
  if (!match) return json({ error: 'invalid_path' }, 400);
  const consultationId = match[1];

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const role = String(payload.role || '').toLowerCase();
  if (role !== 'admin') return json({ error: 'forbidden' }, 403);

  try {
    const row = await env.DB.prepare("SELECT id, user_id, type, status FROM consultations WHERE id = ?")
      .bind(consultationId)
      .first<{ id?: string; user_id?: string; type?: string; status?: string }>();
    if (!row?.id) return json({ error: 'not_found' }, 404);
    if (row.status === 'completed') return json({ ok: true, already: true });
    if (row.status !== 'scheduled') return json({ error: 'invalid_status' }, 400);

    await env.DB.prepare("UPDATE consultations SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(consultationId)
      .run();

    let unlocked = 0;
    if (row.type === 'avaliacao_completa') {
      try {
        const credit = await env.DB.prepare("SELECT id FROM consultation_credits WHERE consultation_id = ? AND type = 'avaliacao_completa' LIMIT 1")
          .bind(consultationId)
          .first<{ id?: string }>();
        if (credit?.id) {
          // Definir expires_at da reavaliacao para +6 meses
          await env.DB.prepare("UPDATE consultation_credits SET locked = 0, expires_at = datetime('now', '+6 months') WHERE parent_credit_id = ? AND type = 'reavaliacao' AND locked = 1")
            .bind(credit.id)
            .run();
          unlocked = 1;
        }
      } catch (e) {
        console.error('[adminCompleteConsultation] unlock failed', e);
      }
    }

    return json({ ok: true, id: consultationId, status: 'completed', reavaliacao_unlocked: unlocked });
  } catch (e) {
    console.error('[adminCompleteConsultation] error', e);
    return json({ error: 'Internal Error' }, 500);
  }
}

export default adminCompleteConsultationHandler;