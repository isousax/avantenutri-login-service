import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";
import { getUserListCache, setUserListCache } from "../../cache/userListCache";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function adminListUsersHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "GET")
    return json({ error: "Method Not Allowed" }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok && 'response' in auth) return auth.response as Response;
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") || "20"))
  );
  const q = (url.searchParams.get("q") || "").trim();
  const userId = (url.searchParams.get("user_id") || "").trim();
  const offset = (page - 1) * pageSize;
  try {
    const cacheProbe = getUserListCache({
      page,
      pageSize,
      q: q || undefined,
      user_id: userId || undefined,
    });
    if (cacheProbe.hit) {
      const resp = json({ page, pageSize, results: cacheProbe.data });
      resp.headers.set("X-Cache", "HIT");
      return resp;
    }
  let base = `SELECT id, email, role, email_confirmed, session_version, created_at, display_name, last_login_at FROM users`;
    let where = "";
    const params: any[] = [];
    if (userId) {
      where = " WHERE id = ?";
      params.push(userId);
    } else if (q) {
      where = " WHERE email LIKE ?";
      params.push(`%${q}%`);
    }
    const order = " ORDER BY created_at DESC";
    const limit = " LIMIT ? OFFSET ?";
    params.push(pageSize, offset);
    const stmt = env.DB.prepare(base + where + order + limit).bind(...params);
    const rows = await stmt.all<any>();
    setUserListCache(
      { page, pageSize, q: q || undefined, user_id: userId || undefined },
      rows.results
    );
    const resp = json({ page, pageSize, results: rows.results });
    resp.headers.set("X-Cache", "MISS");
    return resp;
  } catch (err: any) {
    return json({ error: "Internal Error", detail: err?.message }, 500);
  }
}
