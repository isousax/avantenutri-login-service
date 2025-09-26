import type { Env } from "../../types/Env";

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
  if (!env.WORKER_API_KEY || apiKey !== env.WORKER_API_KEY) {
    return json({ error: "Unauthorized" }, 401);
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
        ? await stmt.bind(userFilter, pageSize, offset).all<any>()
        : await stmt.bind(pageSize, offset).all<any>();
      return json({ page, pageSize, results: rows.results });
    }
    if (type === "revoked") {
      const base = `SELECT jti, user_id, revoked_at, reason, expires_at FROM revoked_jti`;
      const where = userFilter ? " WHERE user_id = ?" : "";
      const stmt = env.DB.prepare(
        `${base}${where} ORDER BY revoked_at DESC LIMIT ? OFFSET ?`
      );
      const rows = userFilter
        ? await stmt.bind(userFilter, pageSize, offset).all<any>()
        : await stmt.bind(pageSize, offset).all<any>();
      return json({ page, pageSize, results: rows.results });
    }
    if (type === "role") {
      const base = `SELECT user_id, old_role, new_role, changed_by, reason, changed_at FROM role_change_log`;
      const where = userFilter ? " WHERE user_id = ?" : "";
      const stmt = env.DB.prepare(
        `${base}${where} ORDER BY changed_at DESC LIMIT ? OFFSET ?`
      );
      const rows = userFilter
        ? await stmt.bind(userFilter, pageSize, offset).all<any>()
        : await stmt.bind(pageSize, offset).all<any>();
      return json({ page, pageSize, results: rows.results });
    }
    return json({ error: "Invalid type" }, 400);
  } catch (err: any) {
    return json({ error: "Internal Error", detail: err?.message }, 500);
  }
}
