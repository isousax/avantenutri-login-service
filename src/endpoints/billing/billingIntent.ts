import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface BillingIntentBody { plan_id: string }

export async function billingIntentHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  if (!env.MP_PUBLIC_KEY) return json({ error: 'MP_PUBLIC_KEY not configured' }, 500);
  let body: BillingIntentBody; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body?.plan_id) return json({ error: 'plan_id required' }, 400);
  const planId = String(body.plan_id).toLowerCase();
  try {
    const plan = await env.DB.prepare('SELECT id, name, price_cents FROM plans WHERE id = ? AND active = 1')
      .bind(planId)
      .first<{ id?: string; name?: string; price_cents?: number }>();
    if (!plan?.id) return json({ error: 'plan_not_found' }, 404);
    const paymentId = crypto.randomUUID();
    const idempotencyKey = paymentId;
    await env.DB.prepare(`INSERT INTO payments (id, user_id, plan_id, provider, amount_cents, currency, status, idempotency_key) VALUES (?, ?, ?, 'MERCADOPAGO', ?, 'BRL', 'initialized', ?)`)
      .bind(paymentId, String(payload.sub), planId, plan.price_cents || 0, idempotencyKey)
      .run();
    return json({
      ok: true,
      payment_id: paymentId,
      plan: { id: plan.id, name: plan.name, price_cents: plan.price_cents },
      currency: 'BRL',
      provider: 'MERCADOPAGO',
      public_key: env.MP_PUBLIC_KEY,
      instructions: 'Usar MP Transparent Checkout: coletar dados cartão, gerar token JS SDK, enviar POST /billing/pay.'
    });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
