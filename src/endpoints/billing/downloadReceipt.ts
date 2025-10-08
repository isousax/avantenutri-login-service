import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { now, formatDateBR } from "../../utils/formatDateBR";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function downloadReceiptHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "GET")
    return json({ error: "Method Not Allowed" }, 405);

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const pathSegments = url.pathname.split("/");
  const paymentId = pathSegments[pathSegments.length - 2];

  if (!paymentId) {
    return json({ error: "Payment ID required" }, 400);
  }

  try {
    // Buscar dados do pagamento e usuário
    const payment = await env.DB.prepare(
      `
        SELECT 
          p.id, p.consultation_type, p.payment_method, p.external_id,
          p.amount_cents, p.currency, p.processed_at, p.created_at, p.status,
          u.display_name, u.email
        FROM payments p
        JOIN users u ON p.user_id = u.id
        WHERE p.id = ? AND p.user_id = ?
      `
    )
      .bind(paymentId, String(payload.sub))
      .first();

    if (!payment) {
      return json({ error: "Payment not found" }, 404);
    }

    // Só permitir download de recibos para pagamentos aprovados
    const status = (payment.status as string).toLowerCase();
    if (!["approved", "completed", "paid"].includes(status)) {
      return json(
        { error: "Receipt not available for this payment status" },
        400
      );
    }

    // Gerar HTML do recibo
    const receiptHtml = generateReceiptHtml(payment);

    // Retornar HTML do recibo
    return new Response(receiptHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="recibo-${paymentId}.html"`,
        "Cache-Control": "max-age=600", // 10 minutes
      },
    });
  } catch (e: any) {
    console.error("Error generating receipt:", e);
    return json({ error: "Internal Error" }, 500);
  }
}

function generateReceiptHtml(payment: any): string {
  const formatAmount = (cents: number, currency: string = "BRL") => {
    try {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency,
      }).format(cents / 100);
    } catch (error) {
      return `R$ ${(cents / 100).toFixed(2)}`;
    }
  };

  const getServiceName = (consultationType: string) => {
    const services: Record<string, string> = {
      avaliacao_completa: "Avaliação Completa",
      reavaliacao: "Reavaliação",
      only_diet: "Apenas Dieta",
      acompanhamento_mensal: "Acompanhamento Mensal",
      orientacao_nutricional: "Orientação Nutricional",
    };
    return services[consultationType] || "Serviço de Nutrição";
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
                <p><strong>${payment.display_name || "Cliente"}</strong></p>
                <p>${payment.email}</p>
            </div>
            <div class="info-section">
                <h3>Recibo</h3>
                <p><strong>Nº:</strong> ${payment.id}</p>
                <p><strong>Data:</strong> ${formatDateBR(
                  payment.processed_at || payment.created_at
                )}</p>
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
                <span>${payment.payment_method || "Cartão/PIX"}</span>
            </div>
            ${
              payment.external_id
                ? `
            <div class="detail-row">
                <span>ID Externo:</span>
                <span>${payment.external_id}</span>
            </div>
            `
                : ""
            }
            <div class="detail-row">
                <span>Total Pago:</span>
                <span><strong>${formatAmount(
                  payment.amount_cents,
                  payment.currency
                )}</strong></span>
            </div>
        </div>
        
        <div class="footer">
          <p>Recibo informativo gerado automaticamente pela Avante Nutri, sem valor fiscal, válido apenas como comprovante de pagamento registrado no sistema.</p>
          <p>Dúvidas? Contate o suporte.</p>
          <p>Gerado em ${now.toFormat("dd/MM/yyyy")} às ${now.toFormat("HH:mm")}</p>
        </div>
    </div>
</body>
</html>
  `;
}
