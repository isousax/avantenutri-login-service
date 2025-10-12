import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function adminAuditHandler(
  request: Request,
  env: Env
): Promise<Response> {
  const apiKey = request.headers.get("x-api-key") || "";
  let authorized = false;
  // 1) Autoriza por x-api-key (compatibilidade)
  if (env.WORKER_API_KEY && apiKey === env.WORKER_API_KEY) {
    authorized = true;
  }
  // 2) Se não autorizado por chave, tenta JWT de admin
  if (!authorized) {
    const adminCheck = await requireAdmin(request, env);
    if ("response" in adminCheck) {
      return adminCheck.response;
    }
    authorized = true;
  }
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") || "20"))
  );
  const offset = (page - 1) * pageSize;
  const type = url.searchParams.get("type") || "password";
  const userFilter = url.searchParams.get("user_id")?.trim();

  try {
    if (type === "password") {
      const base = `SELECT user_id, changed_at, ip FROM password_change_log`;
      const where = userFilter ? " WHERE user_id = ?" : "";
      const stmt = env.DB.prepare(
        `${base}${where} ORDER BY changed_at DESC LIMIT ? OFFSET ?`
      );
      const rows = userFilter
        ? await stmt.bind(userFilter, pageSize + 1, offset).all<any>()
        : await stmt.bind(pageSize + 1, offset).all<any>();
      const results = rows.results || [];
      const hasMore = results.length > pageSize;
      const sliced = hasMore ? results.slice(0, pageSize) : results;
      return json({ page, pageSize, hasMore, results: sliced });
    }
    if (type === "revoked") {
      const base = `SELECT jti, user_id, revoked_at, reason, expires_at FROM revoked_jti`;
      const where = userFilter ? " WHERE user_id = ?" : "";
      const stmt = env.DB.prepare(
        `${base}${where} ORDER BY revoked_at DESC LIMIT ? OFFSET ?`
      );
      const rows = userFilter
        ? await stmt.bind(userFilter, pageSize + 1, offset).all<any>()
        : await stmt.bind(pageSize + 1, offset).all<any>();
      const results = rows.results || [];
      const hasMore = results.length > pageSize;
      const sliced = hasMore ? results.slice(0, pageSize) : results;
      return json({ page, pageSize, hasMore, results: sliced });
    }
    if (type === "role") {
      const base = `SELECT user_id, old_role, new_role, changed_by, reason, changed_at FROM role_change_log`;
      const where = userFilter ? " WHERE user_id = ?" : "";
      const stmt = env.DB.prepare(
        `${base}${where} ORDER BY changed_at DESC LIMIT ? OFFSET ?`
      );
      const rows = userFilter
        ? await stmt.bind(userFilter, pageSize + 1, offset).all<any>()
        : await stmt.bind(pageSize + 1, offset).all<any>();
      const results = rows.results || [];
      const hasMore = results.length > pageSize;
      const sliced = hasMore ? results.slice(0, pageSize) : results;
      return json({ page, pageSize, hasMore, results: sliced });
    }
    if (type === "credits_adjust") {
      const base = `SELECT id, admin_id, user_id, type, delta, reason, consumed_ids_json, created_at FROM admin_credit_adjust_log`;
      const where = userFilter ? " WHERE user_id = ?" : "";
      const stmt = env.DB.prepare(`${base}${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`);
      const rows = userFilter
        ? await stmt.bind(userFilter, pageSize + 1, offset).all<any>()
        : await stmt.bind(pageSize + 1, offset).all<any>();
      const results = rows.results || [];
      const hasMore = results.length > pageSize;
      const sliced = hasMore ? results.slice(0, pageSize) : results;
      return json({ page, pageSize, hasMore, results: sliced });
    }
    return json({ error: "Invalid type" }, 400);
  } catch (err: any) {
    return json({ error: "Internal Error", detail: err?.message }, 500);
  }
}
