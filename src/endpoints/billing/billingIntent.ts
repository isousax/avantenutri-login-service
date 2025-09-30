import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface BillingIntentBody { plan_id: string }

/**
 * Creates a payment intent and Mercado Pago preference for Checkout Pro
 * Returns the init_point URL for redirect-based checkout
 */
export async function billingIntentHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  if (!env.MP_ACCESS_TOKEN) return json({ error: 'MP_ACCESS_TOKEN not configured' }, 500);
  
  let body: BillingIntentBody; 
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body?.plan_id) return json({ error: 'plan_id required' }, 400);
  const planId = String(body.plan_id).toLowerCase();
  
  try {
    const plan = await env.DB.prepare('SELECT id, name, price_cents FROM plans WHERE id = ? AND active = 1')
      .bind(planId)
      .first<{ id?: string; name?: string; price_cents?: number }>();
    if (!plan?.id) return json({ error: 'plan_not_found' }, 404);

    const paymentId = crypto.randomUUID();
    const idempotencyKey = `checkout-pro-${paymentId}`;
    
    // Create payment record
    await env.DB.prepare(`INSERT INTO payments (id, user_id, plan_id, provider, amount_cents, currency, status, idempotency_key) VALUES (?, ?, ?, 'MERCADOPAGO', ?, 'BRL', 'initialized', ?)`)
      .bind(paymentId, String(payload.sub), planId, plan.price_cents || 0, idempotencyKey)
      .run();

    // Create MP Preference for Checkout Pro
    const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
    const preferencePayload = {
      items: [{
        id: plan.id,
        title: `Plano ${plan.name} - Avante Nutri`,
        description: `Assinatura do plano ${plan.name}`,
        quantity: 1,
        unit_price: (plan.price_cents || 0) / 100,
        currency_id: 'BRL'
      }],
      payer: {
        email: payload.email
      },
      back_urls: {
        success: `${baseUrl}/billing/success?payment_id=${paymentId}`,
        failure: `${baseUrl}/billing/failure?payment_id=${paymentId}`,
        pending: `${baseUrl}/billing/pending?payment_id=${paymentId}`
      },
      auto_return: 'approved',
      external_reference: paymentId,
      notification_url: `${env.BACKEND_URL}/billing/webhook/mercadopago`,
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 12
      }
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(preferencePayload)
    });

    const mpData = await mpResponse.json() as any;
    
    if (!mpResponse.ok) {
      console.error('[MercadoPago] Preference creation failed:', mpData);
      return json({ error: 'Payment provider error', details: mpData }, 500);
    }

    // Update payment with preference details
    await env.DB.prepare(
      'UPDATE payments SET preference_id = ?, init_point = ?, raw_payload_json = ? WHERE id = ?'
    ).bind(mpData.id || null, mpData.init_point || null, JSON.stringify(mpData).slice(0, 8000), paymentId).run();

    return json({
      ok: true,
      payment_id: paymentId,
      plan: { id: plan.id, name: plan.name, price_cents: plan.price_cents },
      currency: 'BRL',
      provider: 'MERCADOPAGO',
      checkout_url: mpData.init_point || null,
      preference_id: mpData.id || null
    });
  } catch (e: any) {
    console.error('[BillingIntent] Error:', e);
    return json({ error: 'Internal Error' }, 500);
  }
}
