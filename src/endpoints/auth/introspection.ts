import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import type { IntrospectionRequest } from "../../types/Introspection";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export async function introspection(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const token = await extractToken(request);

    if (!token) {
      return jsonResponse(
        { error: "Unauthorized", reason: "missing_token" },
        401
      );
    }

    const { valid, payload, reason } = await verifyAccessToken(env, token, {
      issuer: env.SITE_DNS,
      audience: env.SITE_DNS,
    });

    if (!valid || !payload) {
      return jsonResponse({ error: "Unauthorized", reason }, 401);
    }

    return jsonResponse({ valid, payload, reason }, 200);
  } catch (err: any) {
    console.error("[introspection] unexpected error:", err?.message ?? err);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}

function jsonResponse(
  body: unknown,
  status = 200,
  extra?: Record<string, string>
) {
  const headers = { ...JSON_HEADERS, ...(extra || {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

function extractToken(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("Authorization") || "";
  const tokenFromHeader = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (tokenFromHeader) return Promise.resolve(tokenFromHeader);

  return request
    .json()
    .then((raw) => {
      const body = raw as IntrospectionRequest;
      return typeof body.token === "string" ? body.token.trim() : null;
    })
    .catch(() => null);
}