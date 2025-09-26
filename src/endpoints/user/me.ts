import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function jsonResponse(
  body: unknown,
  status = 200,
  extra?: Record<string, string>
) {
  const headers = { ...JSON_HEADERS, ...(extra || {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * GET / POST / any method - você já usa POST em outros endpoints.
 * Aqui assumimos POST for consistency with your router, but can also accept GET.
 */
export async function meHandler(request: Request, env: Env): Promise<Response> {
  try {
    // Extract token
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (!token) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const { valid, payload, reason } = await verifyAccessToken(env, token, {
      issuer: env.SITE_DNS,
      audience: env.SITE_DNS,
    });
    if (!valid || !payload) {
      return jsonResponse({ error: "Unauthorized", reason }, 401);
    }

    // The payload should contain sub (user id) or similar
    const userId = (payload.sub ?? payload.user_id ?? payload.id) as
      | string
      | undefined;
    if (!userId) {
      console.warn("[meHandler] token missing sub/user_id");
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Optional: if you want to enforce server-side revocation, implement logic here
    // (see notes below). For now we fetch user + profile.
    const row = await env.DB.prepare(
      `SELECT u.id, u.email, u.role, u.email_confirmed, u.session_version, u.display_name,
              p.full_name, p.phone, p.birth_date, p.photo_url
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`
    )
      .bind(userId)
      .first<
        | {
            id?: string;
            email?: string;
            role?: string;
            email_confirmed?: number;
            session_version?: number;
            full_name?: string | null;
            phone?: string | null;
            birth_date?: string | null;
            photo_url?: string | null;
            display_name?: string | null;
          }
        | undefined
      >();

    if (!row || !row.id) {
      console.info("[meHandler] user not found for id:", userId);
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // If account exists but email not confirmed -> 403 (so front can show verify flow)
    if (!row.email_confirmed || Number(row.email_confirmed) !== 1) {
      return jsonResponse({ error: "Email not verified" }, 403);
    }

    // Session version mismatch => invalida token
    if (
      typeof row.session_version === "number" &&
      typeof payload.session_version === "number"
    ) {
      if (row.session_version !== payload.session_version) {
        return jsonResponse({ error: "Token outdated" }, 401);
      }
    }

    const user = {
      id: row.id,
      email: row.email ?? "",
      role: row.role ?? "patient",
      full_name: row.full_name ?? "",
      display_name: row.display_name ?? null,
      phone: row.phone ?? null,
      birth_date: row.birth_date ?? null,
      photo_url: row.photo_url ?? null,
    };

    return jsonResponse({ user }, 200);
  } catch (err: any) {
    console.error("[meHandler] unexpected error:", err?.message ?? err);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
