import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// PATCH /consultations/:id/complete
// Marca consulta como completed e, se for avaliacao_completa, libera reavaliacao (locked) dependente.
export async function completeConsultationHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const url = new URL(request.url);
  const idMatch = url.pathname.match(/consultations\/(.+)\/complete$/);
  if (!idMatch) return json({ error: 'invalid_path' }, 400);
  const consultationId = idMatch[1];

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);

  // No futuro: permitir apenas admin/nutri ou o próprio profissional; por ora restringir ao próprio usuário dono.
  const userId = String(payload.sub);

  try {
    const row = await env.DB.prepare('SELECT id, user_id, type, status FROM consultations WHERE id = ?')
      .bind(consultationId)
      .first<{ id?: string; user_id?: string; type?: string; status?: string }>();
    if (!row?.id) return json({ error: 'not_found' }, 404);
    if (row.user_id !== userId) return json({ error: 'forbidden' }, 403);
    if (row.status === 'completed') return json({ ok: true, already: true });
    if (row.status !== 'scheduled') return json({ error: 'invalid_status' }, 400);

    // Atualiza status para completed
    await env.DB.prepare('UPDATE consultations SET status = "completed", updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(consultationId)
      .run();

    // Liberar reavaliacao se for avaliacao_completa
    if (row.type === 'avaliacao_completa') {
      try {
        // Acha crédito de avaliacao consumed (used) vinculado a esta consulta
        const credit = await env.DB.prepare('SELECT id FROM consultation_credits WHERE consultation_id = ? AND type = "avaliacao_completa" LIMIT 1')
          .bind(consultationId)
          .first<{ id?: string }>();
        if (credit?.id) {
          await env.DB.prepare('UPDATE consultation_credits SET locked = 0 WHERE parent_credit_id = ? AND type = "reavaliacao" AND locked = 1')
            .bind(credit.id)
            .run();
        }
      } catch (e) {
        console.error('[completeConsultation] Falha ao liberar reavaliacao', e);
      }
    }

    return json({ ok: true, id: consultationId, status: 'completed' });
  } catch (e) {
    console.error('[completeConsultation] error', e);
    return json({ error: 'Internal Error' }, 500);
  }
}

export default completeConsultationHandler;