import type { Env } from "../../types/Env";
import { json, parseTags } from "./utils";

// GET /blog/posts?search=&category=&tag=&page=1&limit=10&preview=1
export async function listBlogPostsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() || '';
  const category = url.searchParams.get('category')?.trim() || '';
  const tag = url.searchParams.get('tag')?.trim() || '';
  const status = url.searchParams.get('status')?.trim() || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10)));
  const offset = (page - 1) * limit;
  const preview = url.searchParams.get('preview') === '1';

  // Only allow preview drafts if Authorization present and role admin/nutri
  let allowDraft = false;
  if (preview) {
    const auth = request.headers.get('authorization');
    if (auth?.startsWith('Bearer ')) {
      const { verifyAccessToken } = await import('../../service/tokenVerify');
      const token = auth.slice(7);
      const vr = await verifyAccessToken(env, token, {});
      if (vr.valid && (vr.payload.role === 'admin' || vr.payload.role === 'nutri')) allowDraft = true;
    }
  }

  const where: string[] = [];
  const params: any[] = [];
  // Status filter logic: if not allowed drafts, force published. If allowed, honor provided status when valid.
  const validStatuses = new Set(['draft','published','archived','all']);
  if (!allowDraft) {
    where.push("status = 'published'");
  } else {
    if (status && validStatuses.has(status) && status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }
    // else no status constraint -> includes all statuses
  }
  if (search) {
    where.push('(title LIKE ? OR content_html LIKE ? OR tags_csv LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category) { where.push('category = ?'); params.push(category); }
  if (tag) { where.push('tags_csv LIKE ?'); params.push(`%${tag}%`); }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM blog_posts ${whereClause}`)
    .bind(...params)
    .first<any>();
  const total = totalRow?.c || 0;
  const rows = await env.DB.prepare(`SELECT bp.id, bp.slug, bp.title, bp.excerpt, bp.category, bp.tags_csv, bp.cover_image_url, bp.read_time_min, bp.published_at, bp.status, COALESCE(v.views,0) as views FROM blog_posts bp LEFT JOIN blog_post_views v ON v.post_id = bp.id ${whereClause} ORDER BY bp.published_at DESC NULLS LAST, bp.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<any>();
  const results = (rows?.results || []).map(r => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    category: r.category,
    tags: parseTags(r.tags_csv),
    cover_image_url: r.cover_image_url,
    read_time_min: r.read_time_min,
    published_at: r.published_at,
    status: r.status,
    views: r.views,
  }));
  const etagSeed = total + ':' + (results[0]?.id || '') + ':' + limit + ':' + page + ':' + (allowDraft?'1':'0');
  const etag = 'W/"lp:' + etagSeed + '"';
  const ifNone = request.headers.get('if-none-match');
  if (ifNone && ifNone === etag) return new Response(null, { status: 304, headers: { 'ETag': etag } });
  return new Response(JSON.stringify({ ok: true, page, limit, total, results }), { status: 200, headers: { 'Content-Type': 'application/json', 'ETag': etag, 'Cache-Control': 'no-store' } });
}