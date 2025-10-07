import type { Env } from '../../types/Env';
import { verifyAccessToken } from '../../service/tokenVerify';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function downloadReceiptHandler(request: Request, env: Env): Promise<Response> {
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
    // Buscar dados do pagamento e usuário
    const payment = await env.DB.prepare(`
      SELECT p.*, u.display_name, u.email
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ? AND p.user_id = ?
    `).bind(paymentId, String(payload.sub)).first();

    console.log('Payment fetched for receipt:', payment);
    if (!payment) {
      return json({ error: 'Payment not found' }, 404);
    }

    // Só permitir download de recibos para pagamentos aprovados
    const status = (payment.status as string).toLowerCase();
    if (!['approved', 'completed', 'paid'].includes(status)) {
      return json({ error: 'Receipt not available for this payment status' }, 400);
    }

    // Gerar HTML do recibo
    const receiptHtml = generateReceiptHtml(payment);
    
    // Retornar HTML do recibo
    return new Response(receiptHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="recibo-${paymentId}.html"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (e: any) {
    console.error('Error generating receipt:', e);
    return json({ error: 'Internal Error' }, 500);
  }
}

function generateReceiptHtml(payment: any): string {
  const formatAmount = (cents: number, currency: string = 'BRL') => {
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency 
    }).format(cents / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getServiceName = (consultationType: string) => {
    switch (consultationType) {
      case 'avaliacao_completa': return 'Avaliação Completa';
      case 'reavaliacao': return 'Reavaliação';
      case 'only_diet': return 'Apenas Dieta';
      default: return 'Serviço de Nutrição';
    }
  };

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recibo de Pagamento - Avante Nutri</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background-color: #f5f5f5;
        }
        .receipt { 
            max-width: 600px; 
            margin: 0 auto; 
            background: white; 
            padding: 30px; 
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header { 
            text-align: center; 
            border-bottom: 2px solid #10b981; 
            padding-bottom: 20px; 
            margin-bottom: 30px;
        }
        .logo { 
            color: #10b981; 
            font-size: 24px; 
            font-weight: bold; 
            margin-bottom: 5px;
        }
        .subtitle { 
            color: #6b7280; 
            font-size: 14px;
        }
        .receipt-info { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 20px; 
            margin-bottom: 30px;
        }
        .info-section h3 { 
            color: #374151; 
            margin: 0 0 10px 0; 
            font-size: 16px;
        }
        .info-section p { 
            margin: 5px 0; 
            color: #6b7280; 
            font-size: 14px;
        }
        .payment-details { 
            background: #f9fafb; 
            padding: 20px; 
            border-radius: 6px; 
            margin-bottom: 30px;
        }
        .payment-details h3 { 
            color: #374151; 
            margin: 0 0 15px 0;
        }
        .detail-row { 
            display: flex; 
            justify-content: space-between; 
            margin-bottom: 8px;
        }
        .detail-row:last-child { 
            border-top: 1px solid #e5e7eb; 
            padding-top: 8px; 
            font-weight: bold;
        }
        .status { 
            display: inline-block; 
            padding: 4px 12px; 
            background: #d1fae5; 
            color: #065f46; 
            border-radius: 4px; 
            font-size: 12px; 
            font-weight: bold;
        }
        .footer { 
            text-align: center; 
            color: #9ca3af; 
            font-size: 12px; 
            border-top: 1px solid #e5e7eb; 
            padding-top: 20px;
        }
        @media print {
            body { background: white; }
            .receipt { box-shadow: none; }
        }
    </style>
</head>
<body>
    <div class="receipt">
        <div class="header">
            <div class="logo">🥗 Avante Nutri</div>
            <div class="subtitle">Recibo de Pagamento</div>
        </div>
        
        <div class="receipt-info">
            <div class="info-section">
                <h3>Cliente</h3>
                <p><strong>${payment.display_name || 'Cliente'}</strong></p>
                <p>${payment.email}</p>
            </div>
            <div class="info-section">
                <h3>Recibo</h3>
                <p><strong>Nº:</strong> ${payment.id}</p>
                <p><strong>Data:</strong> ${formatDate(payment.processed_at || payment.created_at)}</p>
                <p><strong>Status:</strong> <span class="status">PAGO</span></p>
            </div>
        </div>
        
        <div class="payment-details">
            <h3>Detalhes do Pagamento</h3>
            <div class="detail-row">
                <span>Serviço:</span>
                <span>${getServiceName(payment.consultation_type)}</span>
            </div>
            <div class="detail-row">
                <span>Forma de Pagamento:</span>
                <span>${payment.payment_method || 'Cartão/PIX'}</span>
            </div>
            ${payment.external_id ? `
            <div class="detail-row">
                <span>ID Externo:</span>
                <span>${payment.external_id}</span>
            </div>
            ` : ''}
            <div class="detail-row">
                <span>Total Pago:</span>
                <span><strong>${formatAmount(payment.amount_cents, payment.currency)}</strong></span>
            </div>
        </div>
        
        <div class="footer">
            <p>Este é um recibo oficial do pagamento realizado na plataforma Avante Nutri.</p>
            <p>Em caso de dúvidas, entre em contato conosco.</p>
            <p>Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</p>
        </div>
    </div>
</body>
</html>
  `;
}