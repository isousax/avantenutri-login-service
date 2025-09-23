import type { Env } from "../index";

export function validateApiKey(apiKey: string, env: Env): boolean {
	return apiKey === env.WORKER_API_KEY;
}