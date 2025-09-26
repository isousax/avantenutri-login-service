import type { Env } from "../types/Env";

export async function sendPasswordResetEmail(
  env: Env,
  to: string,
  link: string
) {
  const apiKey = env.BREVO_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn(
      "[sendPasswordResetEmail] BREVO_API_KEY ou EMAIL_FROM ausente"
    );
    return;
  }

  const subject = "Redefinição de Senha - Avante Nutri";
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redefinição de Senha</title>
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
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
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
        .reset-button {
            display: inline-block;
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: white;
            text-decoration: none;
            padding: 16px 32px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(245, 158, 11, 0.3);
        }
        .reset-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(245, 158, 11, 0.4);
        }
        .link-backup {
            word-break: break-all;
            font-size: 14px;
            color: #6b7280;
            background: #f9fafb;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
            border-left: 4px solid #f59e0b;
        }
        .security-info {
            background: #fffbeb;
            border: 1px solid #fde68a;
            border-radius: 6px;
            padding: 15px;
            margin: 25px 0;
            font-size: 14px;
            color: #92400e;
        }
        .steps {
            background: #f0f9ff;
            border-radius: 6px;
            padding: 20px;
            margin: 25px 0;
        }
        .steps h3 {
            color: #0369a1;
            margin-top: 0;
            margin-bottom: 15px;
            font-size: 16px;
        }
        .steps ol {
            margin: 0;
            padding-left: 20px;
            color: #6b7280;
        }
        .steps li {
            margin-bottom: 8px;
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
            <div style="font-size: 24px; font-weight: 300;">Redefinição de Senha</div>
        </div>
        
        <div class="content">
            <div class="greeting">Olá,</div>
            
            <div class="message">
                Recebemos uma solicitação para redefinir a senha da sua conta na <strong>Avante Nutri</strong>. 
                Para continuar com o processo, clique no botão abaixo:
            </div>

            <div class="button-container">
                <a href="${link}" class="reset-button">Redefinir Minha Senha</a>
            </div>

            <div class="message" style="text-align: center; font-size: 14px;">
                <strong>Este link expira em 15 minutos</strong><br>
                Por questões de segurança, o link de redefinição tem validade limitada.
            </div>

            <div class="steps">
                <h3>📋 O que acontece depois?</h3>
                <ol>
                    <li>Você será direcionado para uma página segura</li>
                    <li>Poderá criar uma nova senha</li>
                    <li>Receberá uma confirmação por e-mail</li>
                </ol>
            </div>

            <div class="security-info">
                <strong>🔒 Importante:</strong><br>
                Se você não solicitou a redefinição de senha, ignore este e-mail. 
                Sua senha atual permanecerá segura. Recomendamos que você verifique 
                a segurança da sua conta.
            </div>

            <div style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>Problemas com o botão?</strong><br>
                Se o botão acima não funcionar, copie e cole o link abaixo em seu navegador:
            </div>
            <div class="link-backup">${link}</div>
        </div>
        
        <div class="footer">
            <div><strong>Avante Nutri</strong> - Nutrindo hábitos, transformando vidas 💚</div>
            <div class="contact">
                Dúvidas sobre segurança? Entre em contato: 
                <a href="mailto:souzacawanne@gmail.com" style="color: #f59e0b; text-decoration: none;">
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

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar email (${res.status}): ${bodyText}`);
  }
}

function parseSender(from: string) {
  const m = from.match(/^(.*)<(.+@.+)>$/);
  if (m)
    return { name: m[1].trim().replace(/(^"|"$)/g, ""), email: m[2].trim() };
  return { name: "Avante Nutri", email: from.trim() };
}
