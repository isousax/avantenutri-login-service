import type { Env } from "../../types/Env";
import { json, parseTags } from "./utils";
import { verifyAccessToken } from "../../service/tokenVerify";

// GET /blog/posts/:slug
export async function getBlogPostHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const url = new URL(request.url);
  const slug = url.pathname.split('/').pop();
  if (!slug) return json({ error: 'Not Found' }, 404);
  const auth = request.headers.get('authorization');
  let isAdmin = false;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const vr = await verifyAccessToken(env, token, {});
    if (vr.valid && (vr.payload.role === 'admin' || vr.payload.role === 'nutri')) isAdmin = true;
  }
  const row = await env.DB.prepare(`SELECT * FROM blog_posts WHERE slug = ? LIMIT 1`).bind(slug).first<any>();
  if (!row) return json({ error: 'Not Found' }, 404);
  if (!isAdmin && row.status !== 'published') return json({ error: 'Not Found' }, 404);
  const etag = `W/"${row.id}:${row.updated_at}:${row.published_at || ''}"`;
  const ifNone = request.headers.get('if-none-match');
  if (ifNone && ifNone === etag) {
    return new Response(null, { status: 304, headers: { 'ETag': etag } });
  }
  // increment view counter (best-effort, ignore errors)
  try {
    // simple rate limit by IP per 60s (in-memory KV surrogate with Durable Objects suggestion for future)
    const ip = (request.headers.get('cf-connecting-ip') || '').slice(0, 60);
    const key = `vc:${row.id}:${ip}`;
    // @ts-ignore - using globalThis as ephemeral cache bucket
    const globalCache = (globalThis as any).__VCACHE || ((globalThis as any).__VCACHE = new Map());
    const now = Date.now();
    const prev = globalCache.get(key);
    if (!prev || (now - prev) > 60000) {
      globalCache.set(key, now);
      const existing = await env.DB.prepare(`SELECT views FROM blog_post_views WHERE post_id=?`).bind(row.id).first<any>();
      if (!existing) {
        await env.DB.prepare(`INSERT INTO blog_post_views (post_id, views) VALUES (?,1)`).bind(row.id).run();
      } else {
        await env.DB.prepare(`UPDATE blog_post_views SET views = views + 1, updated_at=CURRENT_TIMESTAMP WHERE post_id=?`).bind(row.id).run();
      }
    }
  } catch {}
  const vc = await env.DB.prepare(`SELECT views FROM blog_post_views WHERE post_id=?`).bind(row.id).first<any>();
  const body = { ok: true, post: {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content_html: row.content_html,
    author_name: row.author_name,
    category: row.category,
    tags: parseTags(row.tags_csv),
    cover_image_url: row.cover_image_url,
    status: row.status,
    read_time_min: row.read_time_min,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    views: vc?.views || 0
  }};
  const res = new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'ETag': etag, 'Cache-Control': 'public, max-age=60' } });
  return res;
}