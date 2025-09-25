import type { Env } from "../types/Env";

export async function sendVerificationEmail(
  env: Env,
  to: string,
  link: string
) {
  const apiKey = env.BREVO_API_KEY;
  const from = env.EMAIL_FROM;

  if (!apiKey) {
    console.warn(
      "[sendVerificationEmail] BREVO_API_KEY não configurado; pulando envio",
      { to }
    );
    return;
  }

  if (!from || typeof from !== "string") {
    throw new Error(
      'EMAIL_FROM não configurado (ex: "Avante Nutri <no-reply@avantenutri.com>").'
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error(`Email inválido: ${to}`);
  }

  console.info("[sendVerificationEmail] preparando e-mail para envio");

  const subject = "Confirme seu e-mail - Avante Nutri";
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmação de E-mail</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f8fafc;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        }
        .header {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            padding: 40px 30px;
            text-align: center;
            color: white;
        }
        .logo {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .content {
            padding: 40px 30px;
        }
        .greeting {
            font-size: 18px;
            margin-bottom: 20px;
            color: #374151;
        }
        .message {
            font-size: 16px;
            color: #6b7280;
            margin-bottom: 30px;
        }
        .button-container {
            text-align: center;
            margin: 40px 0;
        }
        .confirm-button {
            display: inline-block;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            text-decoration: none;
            padding: 16px 32px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);
        }
        .confirm-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(16, 185, 129, 0.4);
        }
        .link-backup {
            word-break: break-all;
            font-size: 14px;
            color: #6b7280;
            background: #f9fafb;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
            border-left: 4px solid #10b981;
        }
        .warning {
            background: #fef3cd;
            border: 1px solid #fde68a;
            border-radius: 6px;
            padding: 15px;
            margin: 25px 0;
            font-size: 14px;
            color: #92400e;
        }
        .footer {
            background: #f8fafc;
            padding: 25px 30px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
            font-size: 14px;
            color: #6b7280;
        }
        .contact {
            margin-top: 15px;
            font-size: 13px;
        }
        @media (max-width: 600px) {
            .container {
                margin: 10px;
                border-radius: 8px;
            }
            .header, .content, .footer {
                padding: 25px 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">Avante Nutri</div>
            <div style="font-size: 24px; font-weight: 300;">Confirme seu e-mail</div>
        </div>
        
        <div class="content">
            <div class="greeting">Olá,</div>
            
            <div class="message">
                Obrigado por se cadastrar na Avante Nutri! Para ativar sua conta e começar sua 
                jornada rumo a uma vida mais saudável, precisamos confirmar seu endereço de e-mail.
            </div>

            <div class="button-container">
                <a href="${link}" class="confirm-button">Confirmar E-mail</a>
            </div>

            <div class="message" style="text-align: center; font-size: 14px;">
                <strong>Este link expira em 15 minutos</strong><br>
                Por questões de segurança, o link de confirmação tem validade limitada.
            </div>

            <div class="warning">
                <strong>⚠️ Não solicitou este e-mail?</strong><br>
                Se você não se cadastrou na Avante Nutri, ignore esta mensagem. 
                Seu e-mail será automaticamente removido de nossos registros.
            </div>

            <div style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>Problemas com o botão?</strong><br>
                Se o botão acima não funcionar, copie e cole o link abaixo em seu navegador:
            </div>
            <div class="link-backup">${link}</div>
        </div>
        
        <div class="footer">
            <div>Avante Nutri - Transformando vidas através da nutrição</div>
            <div class="contact">
                Dúvidas? Entre em contato: 
                <a href="mailto:souzacawanne@gmail.com" style="color: #10b981; text-decoration: none;">
                    souzacawanne@gmail.com
                </a>
            </div>
            <div style="margin-top: 10px; font-size: 12px;">
                © ${new Date().getFullYear()} Avante Nutri. Todos os direitos reservados.
            </div>
        </div>
    </div>
</body>
</html>
  `;

  const sender = parseSender(from);
  const payload: any = {
    sender,
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };

  if (env.EMAIL_REPLY_TO) payload.replyTo = { email: env.EMAIL_REPLY_TO };

  const maxRetries = 3;
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        return {};
      }
    }

    if (res.status === 429 || res.status >= 500) {
      const backoff = 500 * attempt;
      console.warn(
        `[sendVerificationEmail] Brevo ${res.status} — retry em ${backoff}ms (tentativa ${attempt})`
      );
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `[sendVerificationEmail] Falha (${res.status}): ${bodyText}`
    );
  }

  throw new Error(
    "[sendVerificationEmail] Máximo de tentativas de envio atingido"
  );
}

function parseSender(from: string) {
  const m = from.match(/^(.*)<(.+@.+)>$/);
  if (m)
    return { name: m[1].trim().replace(/(^"|"$)/g, ""), email: m[2].trim() };
  return { name: "Avante Nutri", email: from.trim() };
}
