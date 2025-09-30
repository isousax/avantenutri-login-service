import type {
  D1Database as CF_D1Database,
  D1PreparedStatement as CF_D1PreparedStatement,
  R2Bucket
} from "@cloudflare/workers-types";

export type D1PreparedStatement = CF_D1PreparedStatement;
export type D1Database = CF_D1Database;

export interface Env {
  SITE_DNS: string;
  DB: D1Database;
  WORKER_API_KEY: string;
  // Legacy HMAC secret (mantido para rollback rápido). Novo fluxo usará RSA se chaves presentes.
  JWT_SECRET: string;
  JWT_EXPIRATION_SEC: number;
  REFRESH_TOKEN_EXPIRATION_DAYS: number;

  // Novas variáveis para RS256
  JWT_PRIVATE_KEY_PEM?: string; // chave privada PKCS8 (BEGIN PRIVATE KEY)
  JWT_PUBLIC_KEY_PEM?: string; // chave pública (BEGIN PUBLIC KEY)
  JWT_JWKS_KID?: string; // identificador da chave no JWKS (default k1)
  JWT_EXPECTED_ISSUER?: string; //n ta sendo usado
  JWT_EXPECTED_AUDIENCE?: string; //n ta sendo usado
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  INITIAL_ADMIN_EMAIL?: string;
  // Mercado Pago credentials
  MP_PUBLIC_KEY?: string; // usada no frontend (exposta via endpoint seguro)
  MP_ACCESS_TOKEN?: string; // server-side secret for Payments API
  MP_WEBHOOK_SECRET?: string; // shared secret to verify webhook signatures
  // URLs for checkout redirects
  WEBHOOK_URL?: string;
  FRONTEND_URL?: string; // base URL for frontend (e.g., https://avantenutri.com)
  BACKEND_URL?: string; // base URL for backend API (e.g., https://api.avantenutri.com)
  // R2 bucket para armazenar PDFs de dietas
  DIET_FILES?: R2Bucket; // binding opcional - se ausente, PDFs permanecem inline (evitar em produção)
}
