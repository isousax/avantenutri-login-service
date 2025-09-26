import type {
  D1Database as CF_D1Database,
  D1PreparedStatement as CF_D1PreparedStatement,
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
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
}
