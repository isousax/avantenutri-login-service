import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  SITE_DNS: string;
  DB: D1Database;
  WORKER_API_KEY: string;
  JWT_SECRET: string;
  JWT_EXPIRATION_SEC: number;
  REFRESH_TOKEN_EXPIRATION_DAYS: number;
	BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
}
