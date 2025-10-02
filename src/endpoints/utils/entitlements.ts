import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function entitlementsHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "GET")
    return json({ error: "Method Not Allowed" }, 405);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { valid, payload } = await verifyAccessToken(env, token, {
    issuer: env.SITE_DNS,
    audience: env.SITE_DNS,
  });
  if (!valid || !payload?.sub) return json({ error: "Unauthorized" }, 401);
  const userId = String(payload.sub);
  // Novo modelo: entitlements desativados; resposta estática mínima
  const resBody = {
    capabilities: [],
    limits: {},
    hash: "disabled",
    version: 1,
    usage: {},
  };
  return json(resBody, 200);
}
