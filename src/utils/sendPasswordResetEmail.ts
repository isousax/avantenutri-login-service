import type { Env } from "../types/Env";

export async function sendPasswordResetEmail(env: Env, to: string, code: string) {
  const apiKey = env.BREVO_API_KEY;
  const from = env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn("[sendPasswordResetEmail] BREVO_API_KEY or EMAIL_FROM missing");
    return;
  }

  const CODE_TTL_MIN = 15;
  const subject = "Recuperação de senha — Avante Nutri";
  const html = `
    <p>Olá,</p>
    <p>Você solicitou redefinir sua senha. Use o código abaixo para continuar:</p>
    <h2>${code}</h2>
    <p>Esse código expira em ${CODE_TTL_MIN} minutos.</p>
    <p>Se você não solicitou essa ação, ignore este e-mail.</p>
  `;

  const sender = parseSender(from);
  const payload: any = {
    sender,
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (env.EMAIL_REPLY_TO) payload['replyTo'] = { email: env.EMAIL_REPLY_TO };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(()=>"");
    throw new Error(`Failed to send password reset email (${res.status}): ${bodyText}`);
  }
}

function parseSender(from: string) {
  const m = from.match(/^(.*)<(.+@.+)>$/);
  if (m) return { name: m[1].trim().replace(/(^"|"$)/g, ''), email: m[2].trim() };
  return { name: 'Avante Nutri', email: from.trim() };
}
