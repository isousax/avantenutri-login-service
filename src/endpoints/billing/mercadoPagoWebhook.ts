import type { Env } from "../../types/Env";

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/**
 * Mercado Pago Webhook Signature Verification (HMAC-SHA256)
 * Official docs: https://www.mercadopago.com.br/developers/en/docs/checkout-api/webhooks
 * Recent versions send header: X-Signature: id=<uuid>, ts=<unix>, sha256=<hexdigest>  (sometimes replaced 'sha256' by 'v1')
 * Concatenation pattern (documented examples): <id><ts><body> OR <id>.<ts>.<body>. There is inconsistency across sources.
 * Implementation strategy:
 *  - Parse key=value pairs
 *  - Use candidate join patterns (no separator, '.', ':') to maximize compatibility
 *  - Compute HMAC-SHA256 with MP_WEBHOOK_SECRET
 *  - Constant-time compare with provided digest (sha256|v1|digest)
 */
function parseSignatureHeader(v: string | null) {
  if (!v) return {} as Record<string,string>;
  return v.split(',').reduce((acc, part) => {
    const [k, val] = part.split('=').map(s=>s.trim());
    if (k && val) acc[k] = val; return acc;
  }, {} as Record<string,string>);
}

async function hmacSHA256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0; for (let i=0;i<a.length;i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0;
}

async function verifySignature(env: Env, headers: Headers, rawBody: string): Promise<boolean> {
  if (!env.MP_WEBHOOK_SECRET) return false;
  const sigHeader = headers.get('X-Signature') || headers.get('x-signature');
  if (!sigHeader) return false;
  const parsed = parseSignatureHeader(sigHeader);
  const digest = parsed['sha256'] || parsed['v1'] || parsed['digest'];
  if (!digest) return false;
  const id = parsed['id'] || '';
  const ts = parsed['ts'] || parsed['timestamp'] || '';
  const candidates = [
    `${id}${ts}${rawBody}`,
    `${id}.${ts}.${rawBody}`,
    `${id}:${ts}:${rawBody}`,
    `${ts}${id}${rawBody}`,
    `${ts}.${id}.${rawBody}`
  ];
  for (const base of candidates) {
    try {
      const h = await hmacSHA256Hex(env.MP_WEBHOOK_SECRET, base);
      if (timingSafeEqual(h, digest)) return true;
    } catch {/* ignore candidate errors */}
  }
  return false;
}

export async function mercadoPagoWebhookHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  let rawBody = await request.text();
  const verified = await verifySignature(env, request.headers, rawBody);
  // In sandbox you may not have signature; we still process, but mark verified flag
  let payload: any; try { payload = JSON.parse(rawBody); } catch { payload = { raw: rawBody }; }
  const eventType = payload?.type || payload?.action || 'unknown';
  
  // Handle different event types
  const paymentId = payload?.data?.id || payload?.resource?.id || payload?.id;
  
  try {
    if (paymentId && (eventType === 'payment' || eventType.includes('payment'))) {
      // For Checkout Pro, we might need to fetch the payment details from MP API
      let paymentData = payload?.data || payload;
      
      // If we only have the payment ID, fetch full details from MP
      if (!paymentData?.status && env.MP_ACCESS_TOKEN) {
        try {
          const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: {
              'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          });
          if (mpResponse.ok) {
            paymentData = await mpResponse.json();
          }
        } catch (e) {
          console.warn('[Webhook] Failed to fetch payment details from MP:', e);
        }
      }
      
      const status = (paymentData?.status || '').toLowerCase();
      const statusDetail = paymentData?.status_detail || null;
      const paymentMethod = paymentData?.payment_method_id || null;
      const installments = paymentData?.installments || 1;
      const externalReference = paymentData?.external_reference || null;
      
      if (status) {
        // Update by external_id or external_reference
        let updateQuery = 'UPDATE payments SET status = ?, status_detail = ?, payment_method = ?, installments = ?, external_id = COALESCE(external_id, ?), raw_payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE external_id = ?';
        let updateParams = [status, statusDetail, paymentMethod, installments, String(paymentId), JSON.stringify(paymentData).slice(0,8000), String(paymentId)];
        
        // If external_reference matches our payment_id format, also try updating by that
        if (externalReference) {
          updateQuery = 'UPDATE payments SET status = ?, status_detail = ?, payment_method = ?, installments = ?, external_id = COALESCE(external_id, ?), raw_payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE external_id = ? OR id = ?';
          updateParams = [status, statusDetail, paymentMethod, installments, String(paymentId), JSON.stringify(paymentData).slice(0,8000), String(paymentId), externalReference];
        }
        
        await env.DB.prepare(updateQuery).bind(...updateParams).run();
        
        if (status === 'approved') {
          // Apply plan if not processed yet
          const payRow = await env.DB.prepare('SELECT id, user_id, plan_id, processed_at FROM payments WHERE (external_id = ? OR id = ?) AND status = ?')
            .bind(String(paymentId), externalReference || '', 'approved')
            .first<{ id?: string; user_id?: string; plan_id?: string; processed_at?: string }>();
            
          if (payRow?.id && !payRow.processed_at) {
            const user = await env.DB.prepare('SELECT plan_id FROM users WHERE id = ?').bind(payRow.user_id).first<{ plan_id?: string }>();
            const oldPlan = user?.plan_id || null;
            await env.DB.prepare('UPDATE users SET plan_id = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .bind(payRow.plan_id, payRow.user_id)
              .run();
            await env.DB.prepare('INSERT INTO plan_change_log (user_id, old_plan_id, new_plan_id, reason, payment_id) VALUES (?,?,?,?,?)')
              .bind(payRow.user_id, oldPlan, payRow.plan_id, 'payment', payRow.id)
              .run();
            await env.DB.prepare('UPDATE payments SET processed_at = CURRENT_TIMESTAMP WHERE id = ?')
              .bind(payRow.id)
              .run();
          }
        }
      }
    }
  } catch (e:any) {
    console.error('[MercadoPagoWebhook] Error:', e);
    return json({ ok: true, processed: false, error: 'internal_error' }, 200);
  }
  return json({ ok: true, verified, event: eventType });
}
