import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// POST /consultations/credits { action: 'adjust', userId, type, delta, reason? }
export async function adjustConsultationCreditsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);

  try {
  const body = (await request.json().catch(() => null)) as any;
  if (!body || typeof body !== 'object' || body.action !== 'adjust') return json({ error: 'invalid_action' }, 400);
    const role = (payload.role || '') as string;
    if (role.toLowerCase() !== 'admin') return json({ error: 'forbidden' }, 403);

  const userId = String(body.userId || '');
  const type = String(body.type || '');
  const delta = Number(body.delta || 0);
  const reason = body.reason ? String(body.reason).slice(0, 500) : null;
    if (!userId || !type || !['avaliacao_completa','reavaliacao','only_diet'].includes(type)) return json({ error: 'invalid_payload' }, 400);
    if (!Number.isInteger(delta) || delta === 0) return json({ error: 'invalid_delta' }, 400);

    if (delta > 0) {
      // Insert N available credits (no payment_id)
      const inserts = [] as string[];
      for (let i = 0; i < delta; i++) {
        const id = crypto.randomUUID();
        inserts.push(id);
        await env.DB.prepare('INSERT INTO consultation_credits (id, user_id, type, status) VALUES (?, ?, ?, "available")')
          .bind(id, userId, type).run();
      }
      // audit log
      try {
        await env.DB.prepare(`INSERT INTO admin_credit_adjust_log (admin_id, user_id, type, delta, reason) VALUES (?, ?, ?, ?, ?)`)
          .bind(payload.sub, userId, type, delta, reason).run();
      } catch (e) {
        console.warn('[adjustCredits] audit insert failed', e);
      }
      console.info(`[adjustCredits] Added ${delta} ${type} credits to ${userId} by admin`);
      return json({ ok: true, added: delta });
    }

    // delta < 0 => consume available credits (mark used)
    let toConsume = Math.abs(delta);
    try {
      // Find oldest available credits
      const rows = await env.DB.prepare('SELECT id FROM consultation_credits WHERE user_id = ? AND type = ? AND status = "available" ORDER BY created_at ASC LIMIT ?')
        .bind(userId, type, toConsume).all<any>();
      const avail = (rows.results || []).map((r:any) => r.id).filter(Boolean);
      if (!avail.length) return json({ error: 'no_available_credits', consumed: 0 }, 400);
      for (const id of avail) {
        await env.DB.prepare('UPDATE consultation_credits SET status = "used", used_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();
        toConsume--;
      }
      const consumed = avail.length;
      // audit log
      try {
        await env.DB.prepare(`INSERT INTO admin_credit_adjust_log (admin_id, user_id, type, delta, reason, consumed_ids_json) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(payload.sub, userId, type, -consumed, reason, JSON.stringify(avail)).run();
      } catch (e) {
        console.warn('[adjustCredits] audit insert failed', e);
      }
      console.info(`[adjustCredits] Consumed ${consumed} ${type} credits for ${userId} by admin`);
      return json({ ok: true, consumed });
    } catch (e) {
      console.error('[adjustCredits] consume error', e);
      return json({ error: 'Internal Error' }, 500);
    }
  } catch (err) {
    console.error('[adjustCredits] error', err);
    return json({ error: 'Internal Error' }, 500);
  }
}

export default adjustConsultationCreditsHandler;
