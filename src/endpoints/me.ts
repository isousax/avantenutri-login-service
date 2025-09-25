import type { Env } from "../types/Env";
import { verifyJWT } from "../service/verifyJWT";

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
    if (!env.JWT_SECRET) {
      console.error("[meHandler] missing JWT_SECRET");
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }

    // Extract token
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (!token) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Verify
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) {
      return jsonResponse({ error: "Unauthorized" }, 401);
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
      `SELECT u.id, u.email, u.role, u.email_confirmed,
              p.full_name, p.phone, p.birth_date, p.photo_url
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = ?`
    )
      .bind(userId)
      .first<
        | {
            id?: string;
            email?: string;
            role?: string;
            email_confirmed?: number;
            full_name?: string | null;
            phone?: string | null;
            birth_date?: string | null;
            photo_url?: string | null;
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

    const user = {
      id: row.id,
      email: row.email ?? "",
      role: row.role ?? "patient",
      full_name: row.full_name ?? "",
      phone: row.phone ?? null,
      birth_date: row.birth_date ?? null,
      photo_url: row.photo_url ?? null,
    };

    return jsonResponse(user, 200);
  } catch (err: any) {
    console.error("[meHandler] unexpected error:", err?.message ?? err);
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
