import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

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
  try {
    const ent = await computeEffectiveEntitlements(env, userId);
    // Optionally attach session_version for client-side caching decisions
    let version: number | null = null;
    try {
      const row = await env.DB.prepare(
        "SELECT session_version FROM users WHERE id = ?"
      )
        .bind(userId)
        .first<{ session_version?: number }>();
      version = row?.session_version ?? null;
    } catch {}
    return json({ ...ent, version });
  } catch (e: any) {
    return json({ error: "Internal Error", detail: e?.message }, 500);
  }
}
