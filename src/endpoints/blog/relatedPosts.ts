import type { Env } from "../../types/Env";
import { json, parseTags } from "./utils";

// GET /blog/posts/:slug/related?limit=3
export async function relatedBlogPostsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const slugIndex = parts.findIndex(p => p === 'posts') + 1;
  const slug = parts[slugIndex];
  if (!slug) return json({ error: 'Not Found' }, 404);
  const limit = Math.min(10, Math.max(1, parseInt(url.searchParams.get('limit') || '3', 10)));
  const current = await env.DB.prepare(`SELECT category, id FROM blog_posts WHERE slug = ? LIMIT 1`).bind(slug).first<any>();
  if (!current) return json({ ok: true, results: [] });
  const cat = current.category;
  let rows;
  if (cat) {
    rows = await env.DB.prepare(`SELECT id, slug, title, excerpt, category, tags_csv, cover_image_url, read_time_min, published_at FROM blog_posts WHERE status='published' AND category = ? AND id <> ? ORDER BY published_at DESC LIMIT ?`).bind(cat, current.id, limit).all<any>();
  }
  if (!rows || !rows.results || rows.results.length === 0) {
    rows = await env.DB.prepare(`SELECT id, slug, title, excerpt, category, tags_csv, cover_image_url, read_time_min, published_at FROM blog_posts WHERE status='published' AND id <> ? ORDER BY published_at DESC LIMIT ?`).bind(current.id, limit).all<any>();
  }
  const results = (rows?.results || []).map(r => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    category: r.category,
    tags: parseTags(r.tags_csv),
    cover_image_url: r.cover_image_url,
    read_time_min: r.read_time_min,
    published_at: r.published_at
  }));
  return json({ ok: true, results });
}