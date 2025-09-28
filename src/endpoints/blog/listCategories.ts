import type { Env } from "../../types/Env";
import { json } from "./utils";

// GET /blog/categories -> { ok, categories: [{ category, count }] }
export async function listBlogCategoriesHandler(_request: Request, env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(`SELECT category, COUNT(*) as count FROM blog_posts WHERE status='published' AND category IS NOT NULL AND category <> '' GROUP BY category ORDER BY count DESC`).all<any>();
  const categories = (rows.results || []).map(r => ({ category: r.category, count: r.count }));
  const etag = 'W/"cat:' + categories.map(c=> c.category+':'+c.count).join('|') + '"';
  const ifNone = _request.headers.get('if-none-match');
  if (ifNone && ifNone === etag) return new Response(null, { status: 304, headers: { 'ETag': etag } });
  return new Response(JSON.stringify({ ok: true, categories }), { status: 200, headers: { 'Content-Type': 'application/json', 'ETag': etag, 'Cache-Control': 'public, max-age=300' } });
  } catch (err: any) {
    return json({ error: 'failed_to_list_categories', message: err?.message || String(err) }, 500);
  }
}