import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface ConsultationPaymentIntentBody { type: 'avaliacao_completa' | 'reavaliacao'; display_name?: string }

// Fallback hardcoded (somente se tabela não configurada / ausência de registro)
const FALLBACK_PRICES: Record<string, number> = {
  avaliacao_completa: 15000,
  reavaliacao: 9000
};

export async function billingIntentHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  if (!env.MP_ACCESS_TOKEN) return json({ error: 'MP_ACCESS_TOKEN not configured' }, 500);

  let body: ConsultationPaymentIntentBody; 
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body?.type) return json({ error: 'type_required' }, 400);
  const type = body.type;
  if (!['avaliacao_completa','reavaliacao'].includes(type)) return json({ error: 'invalid_type' }, 400);

  // Elegibilidade para reavaliacao: (1) qualquer consulta concluída nos últimos 12m OU (2) reavaliacao concluída nos últimos 6m
  if (type === 'reavaliacao') {
    try {
      const recentAny = await env.DB.prepare(`SELECT id FROM consultations WHERE user_id = ? AND status = 'completed' AND scheduled_at >= datetime('now', '-12 months') LIMIT 1`)
        .bind(String(payload.sub)).first<any>();
      const recentReav = await env.DB.prepare(`SELECT id FROM consultations WHERE user_id = ? AND status = 'completed' AND type = 'reavaliacao' AND scheduled_at >= datetime('now','-6 months') LIMIT 1`)
        .bind(String(payload.sub)).first<any>();
      if (!recentAny && !recentReav) {
        return json({ error: 'reavaliacao_not_allowed', message: 'Reavaliação permitida somente para quem teve consulta concluída nos últimos 12 meses ou reavaliação nos últimos 6 meses.' }, 400);
      }
    } catch (e) {
      console.warn('[billingIntent] elegibilidade reavaliacao falhou', e);
      return json({ error: 'eligibility_check_failed' }, 500);
    }
  }

  // Buscar preço dinâmico
  let amount: number | undefined;
  try {
    const priceRow = await env.DB.prepare('SELECT amount_cents, active FROM consultation_pricing WHERE type = ?').bind(type).first<any>();
    if (priceRow && priceRow.active) amount = Number(priceRow.amount_cents);
  } catch (e) {
    console.warn('[billingIntent] Falha ao buscar preço dinâmico', e);
  }
  if (!amount) amount = FALLBACK_PRICES[type];
  if (!amount) return json({ error: 'price_not_configured' }, 500);

  try {
    const paymentId = crypto.randomUUID();
    const idempotencyKey = `consult-${paymentId}`;
    await env.DB.prepare(`INSERT INTO payments (id, user_id, purpose, consultation_type, provider, amount_cents, currency, status, idempotency_key) VALUES (?, ?, 'consultation', ?, 'MERCADOPAGO', ?, 'BRL', 'initialized', ?)`)
      .bind(paymentId, String(payload.sub), type, amount, idempotencyKey)
      .run();

    const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
    // Payer name: usar display_name enviado pelo cliente (já disponível no front) ou fallback para claim do token
    let displayName: string | undefined = body.display_name || (payload as any).display_name || (payload as any).full_name || (payload as any).name || undefined;
    if (displayName) {
      displayName = displayName.trim().slice(0, 60);
      // Remover caracteres de controle / nova linha para evitar problemas na criação da preferência
      displayName = displayName.replace(/[\r\n\t]+/g, ' ');
      if (!displayName) displayName = undefined;
    }

    const preferencePayload = {
      items: [{
        id: type,
        title: type === 'avaliacao_completa' ? 'Avaliação Completa' : 'Reavaliação',
        description: 'Crédito de consulta Avante Nutri',
        quantity: 1,
        unit_price: amount / 100,
        currency_id: 'BRL'
      }],
  payer: { email: (payload as any).email, name: displayName },
      back_urls: {
        success: `${baseUrl}/billing/success?payment_id=${paymentId}`,
        failure: `${baseUrl}/billing/failure?payment_id=${paymentId}`,
        pending: `${baseUrl}/billing/pending?payment_id=${paymentId}`
      },
      auto_return: 'approved',
      external_reference: paymentId,
      notification_url: `${env.WEBHOOK_URL}`,
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      payment_methods: { excluded_payment_methods: [], excluded_payment_types: [], installments: 12 }
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
  const mpData: any = await mpResponse.json();
    if (!mpResponse.ok) {
      console.error('[MercadoPago] Preference creation failed:', mpData);
      return json({ error: 'provider_error', details: mpData }, 500);
    }
    await env.DB.prepare('UPDATE payments SET preference_id = ?, init_point = ? WHERE id = ?')
      .bind(mpData.id || null, mpData.init_point || null, paymentId)
      .run();
  return json({ ok: true, payment_id: paymentId, type, amount_cents: amount, checkout_url: mpData?.init_point || null, preference_id: mpData?.id || null });
  } catch (e:any) {
    console.error('[ConsultationPaymentIntent] Error:', e);
    return json({ error: 'Internal Error' }, 500);
  }
}
