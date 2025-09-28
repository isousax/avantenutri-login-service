import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface BillingPayBody {
  payment_id: string;
  token: string; // card token (Brick)
  installments?: number;
  payment_method_id?: string;
  payer_email?: string;
}

// This endpoint creates a payment on Mercado Pago using Payments API.
export async function billingPayHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  let body: BillingPayBody; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body?.payment_id || !body?.token) return json({ error: 'missing_fields' }, 400);
  try {
    const paymentRow = await env.DB.prepare('SELECT id, user_id, plan_id, amount_cents, status, idempotency_key FROM payments WHERE id = ? AND user_id = ?')
      .bind(body.payment_id, String(payload.sub))
      .first<{ id?: string; user_id?: string; plan_id?: string; amount_cents?: number; status?: string; idempotency_key?: string }>();
    if (!paymentRow?.id) return json({ error: 'Not Found' }, 404);
    if (paymentRow.status !== 'initialized' && paymentRow.status !== 'pending') return json({ error: 'invalid_state' }, 400);
    if (!env.MP_ACCESS_TOKEN) return json({ error: 'MP not configured' }, 500);

    // Build payment payload
    const payloadMP: Record<string, any> = {
      transaction_amount: (paymentRow.amount_cents || 0) / 100,
      token: body.token,
      description: `Plano ${paymentRow.plan_id}`,
      installments: body.installments || 1,
      payment_method_id: body.payment_method_id || 'visa',
      payer: { email: body.payer_email || 'user@example.com' },
    };

    // Call Mercado Pago Payments API (placeholder; fetch available in Workers)
    let mpResp: any = null;
    try {
      const resp = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}`,
          'X-Idempotency-Key': paymentRow.idempotency_key || paymentRow.id,
        },
        body: JSON.stringify(payloadMP)
      });
      const text = await resp.text();
      try { mpResp = JSON.parse(text); } catch { mpResp = { raw: text }; }
      const status = mpResp?.status?.toLowerCase?.() || 'pending';
      const statusDetail = mpResp?.status_detail || null;
      await env.DB.prepare('UPDATE payments SET status = ?, status_detail = ?, external_id = COALESCE(external_id, ?), raw_payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(status, statusDetail, mpResp?.id ? String(mpResp.id) : null, JSON.stringify(mpResp).slice(0, 8000), paymentRow.id)
        .run();
      return json({ ok: true, status, status_detail: statusDetail, external_id: mpResp?.id || null });
    } catch (e:any) {
      return json({ error: 'provider_error', detail: e?.message });
    }
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
