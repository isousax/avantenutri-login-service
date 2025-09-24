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
