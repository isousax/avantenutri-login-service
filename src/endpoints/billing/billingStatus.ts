import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/**
 * Gets payment status for a given payment_id
 * Used to check payment status after user returns from checkout
 */
export async function billingStatusHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  
  const url = new URL(request.url);
  const paymentId = url.searchParams.get('payment_id');
  
  if (!paymentId) return json({ error: 'payment_id parameter required' }, 400);

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);

  try {
    // Get payment from database
    const payment = await env.DB.prepare(
      'SELECT id, user_id, plan_id, status, status_detail, payment_method, installments, amount_cents, currency, external_id, preference_id, processed_at, created_at, updated_at FROM payments WHERE id = ? AND user_id = ?'
    ).bind(paymentId, String(payload.sub))
    .first<{
      id?: string;
      user_id?: string;
      plan_id?: string;
      status?: string;
      status_detail?: string;
      payment_method?: string;
      installments?: number;
      amount_cents?: number;
      currency?: string;
      external_id?: string;
      preference_id?: string;
      processed_at?: string;
      created_at?: string;
      updated_at?: string;
    }>();

    if (!payment?.id) return json({ error: 'Payment not found' }, 404);

    // Get plan details
    const plan = await env.DB.prepare('SELECT id, name FROM plans WHERE id = ?')
      .bind(payment.plan_id)
      .first<{ id?: string; name?: string }>();

    return json({
      payment_id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      payment_method: payment.payment_method,
      installments: payment.installments,
      amount_cents: payment.amount_cents,
      currency: payment.currency,
      external_id: payment.external_id,
      preference_id: payment.preference_id,
      processed_at: payment.processed_at,
      plan: plan ? { id: plan.id, name: plan.name } : null,
      created_at: payment.created_at,
      updated_at: payment.updated_at
    });
  } catch (e: any) {
    console.error('[BillingStatus] Error:', e);
    return json({ error: 'Internal Error' }, 500);
  }
}