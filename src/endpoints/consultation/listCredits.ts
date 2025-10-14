import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /consultations/credits?status=available|used|expired
// Admins may pass ?user_id=<id> to fetch credits for a specific user
export async function listConsultationCreditsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const requestedUserId = url.searchParams.get('user_id');

    let userId = String(payload.sub);
    // if user_id is provided, only allow admin
    if (requestedUserId) {
      const role = (payload.role || '') as string;
      if (role.toLowerCase() !== 'admin') return json({ error: 'forbidden' }, 403);
      userId = requestedUserId;
    }

    const allowedStatuses = ['available','used','expired'];
    const whereClauses: string[] = ['user_id = ?'];
    const binds: any[] = [userId];
    if (status && allowedStatuses.includes(status)) {
      whereClauses.push('status = ?');
      binds.push(status);
    }

    const sql = `SELECT id, type, status, payment_id, consultation_id, locked, parent_credit_id, created_at, used_at, expires_at,
      CASE WHEN status = 'available' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS expired_flag
      FROM consultation_credits WHERE ${whereClauses.join(' AND ')} ORDER BY created_at DESC`;
    const rows = await env.DB.prepare(sql).bind(...binds).all<any>();
    const results = (rows.results || []) as any[];
    // Map DB row to API shape
    const credits = results.map((r) => {
      const expiredVirtual = r.expired_flag === 1;
      return {
        id: r.id,
        type: r.type,
        status: expiredVirtual && r.status === 'available' ? 'expired' : r.status,
        locked: r.locked ? true : false,
        parent_credit_id: r.parent_credit_id || undefined,
        payment_id: r.payment_id || undefined,
        consultation_id: r.consultation_id || undefined,
        created_at: r.created_at,
        used_at: r.used_at || undefined,
        expires_at: r.expires_at || undefined,
        expired_virtual: expiredVirtual || undefined,
      };
    });

    return json({ ok: true, credits });
  } catch (err) {
    console.error('[listConsultationCredits] error', err);
    return json({ error: 'Internal Error' }, 500);
  }
}

export default listConsultationCreditsHandler;
