import type { Env } from "../../types/Env";
import { json, slugify, ensureUniqueSlug, computeReadTime, tagsToCsv } from "./utils";
import { marked } from 'marked';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { verifyAccessToken } from "../../service/tokenVerify";

function deriveExcerpt({ explicit, html, max = 220 }: { explicit?: string; html?: string; max?: number }) {
  if (explicit && explicit.trim()) return explicit.trim().slice(0, max);
  if (!html) return null;
  const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'")
    .replace(/\s+/g,' ')  
    .trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 40 ? slice.slice(0, lastSpace) : slice).trim() + '…';
}

// PATCH /blog/posts/:id  (admin/nutri)
export async function adminUpdateBlogPostHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const vr = await verifyAccessToken(env, token, {});
  if (!vr.valid || !['admin','nutri'].includes(vr.payload.role)) return json({ error: 'Forbidden' }, 403);
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();
  if (!id) return json({ error: 'Not Found' }, 404);
  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const existing = await env.DB.prepare(`SELECT * FROM blog_posts WHERE id = ? LIMIT 1`).bind(id).first<any>();
  if (!existing) return json({ error: 'Not Found' }, 404);
  const { title, content_html, content_md, excerpt, category, tags, cover_image_url, status } = body || {};
  let slug = existing.slug;
  if (title && title !== existing.title) {
    const baseSlug = slugify(title);
    slug = await ensureUniqueSlug(env, baseSlug);
  }
  let finalHtml = content_html;
  if (!finalHtml && content_md) {
    try { finalHtml = marked(content_md) as string; } catch { finalHtml = content_md; }
  }
  if (finalHtml) {
    finalHtml = sanitizeHtml(finalHtml);
  }
  const content = finalHtml ?? existing.content_html;
  const rt = computeReadTime(content);
  let published_at = existing.published_at;
  let newStatus = status || existing.status;
  if (existing.status !== 'published' && newStatus === 'published' && !published_at) {
    published_at = new Date().toISOString();
  }
  if (newStatus === 'draft') published_at = null;
  const finalExcerpt = deriveExcerpt({ explicit: excerpt ?? existing.excerpt, html: content });
  try {
    await env.DB.prepare(`UPDATE blog_posts SET slug=?, title=?, excerpt=?, content_html=?, category=?, tags_csv=?, cover_image_url=?, status=?, read_time_min=?, published_at=?, content_md=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(slug, title ?? existing.title, finalExcerpt, content, category ?? existing.category, tagsToCsv(tags) ?? existing.tags_csv, cover_image_url ?? existing.cover_image_url, newStatus, rt, published_at, content_md ?? existing.content_md, id)
      .run();
    return json({ ok: true, id, slug, status: newStatus, published_at });
  } catch (err:any) {
    return json({ error: 'DB Update Failed', detail: err?.message }, 500);
  }
}