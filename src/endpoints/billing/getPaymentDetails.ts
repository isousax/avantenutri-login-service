import type { Env } from '../../types/Env';
import { verifyAccessToken } from '../../service/tokenVerify';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function getPaymentDetailsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  
  const url = new URL(request.url);
  const paymentId = url.pathname.split('/').pop();
  
  if (!paymentId) {
    return json({ error: 'Payment ID required' }, 400);
  }
  
  try {
    // Buscar detalhes completos do pagamento
    const payment = await env.DB.prepare(`
      SELECT id, user_id, purpose, consultation_type, amount_cents, currency, status, status_detail, 
             payment_method, installments, external_id, preference_id, processed_at, created_at, updated_at
      FROM payments 
      WHERE id = ? AND user_id = ?
    `).bind(paymentId, String(payload.sub)).first();

    if (!payment) {
      return json({ error: 'Payment not found' }, 404);
    }

    return json({ 
      ok: true, 
      payment: {
        ...payment,
        // Adicionar campos calculados úteis para exibição
        formatted_amount: new Intl.NumberFormat('pt-BR', { 
          style: 'currency', 
          currency: (payment.currency as string) || 'BRL' 
        }).format((payment.amount_cents as number) / 100),
        
        service_description: (payment.consultation_type as string) === 'avaliacao_completa' 
          ? 'Avaliação Completa' 
          : (payment.consultation_type as string) === 'reavaliacao'
          ? 'Reavaliação'
          : (payment.consultation_type as string) === 'only_diet'
          ? 'Apenas Dieta'
          : 'Serviço',
          
        status_description: getStatusDescription(payment.status as string),
        
        // Data formatada
        formatted_date: payment.processed_at 
          ? new Date(payment.processed_at as string).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit', 
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : new Date(payment.created_at as string).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit', 
              minute: '2-digit'
            })
      }
    });
  } catch (e: any) {
    console.error('Error fetching payment details:', e);
    return json({ error: 'Internal Error' }, 500);
  }
}

function getStatusDescription(status: string): string {
  switch (status.toLowerCase()) {
    case 'approved':
    case 'completed':
    case 'paid':
      return 'Pagamento Aprovado';
    case 'pending':
    case 'processing':
      return 'Aguardando Pagamento';
    case 'failed':
    case 'cancelled':
    case 'declined':
      return 'Pagamento Rejeitado';
    default:
      return 'Status Desconhecido';
  }
}