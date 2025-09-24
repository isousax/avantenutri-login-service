import type { Env } from "../types/Env";

export async function sendVerificationEmail(env: Env, to: string, link: string) {
  const apiKey = env.BREVO_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("[sendVerificationEmail] BREVO_API_KEY ou EMAIL_FROM ausente");
    return;
  }

  const subject = "Confirme seu cadastro na Avante Nutri";
  const html = `
    <p>Olá,</p>
    <p>Clique no link abaixo para confirmar seu cadastro:</p>
    <p><a href="${link}">${link}</a></p>
    <p>O link expira em alguns minutos. Se você não solicitou, ignore este email.</p>
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
  if (m) return { name: m[1].trim().replace(/(^"|"$)/g, ""), email: m[2].trim() };
  return { name: "Avante Nutri", email: from.trim() };
}
