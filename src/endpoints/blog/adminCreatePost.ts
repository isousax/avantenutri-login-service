import type { Env } from "../../types/Env";
import { json, slugify, ensureUniqueSlug, computeReadTime, tagsToCsv } from "./utils";
import { marked } from 'marked';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { requireRoles } from "../../middleware/requireRoles";

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

// POST /blog/posts  (admin/nutri)
export async function adminCreateBlogPostHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const roleCheck = await requireRoles(request, env, ['admin','nutri']);
  if (!roleCheck.ok && 'response' in roleCheck) return roleCheck.response;
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { title, content_html, content_md, excerpt, category, tags, cover_image_url, status } = body || {};
  if (!title || (!content_html && !content_md)) return json({ error: 'Missing title or content (html or md)' }, 400);
  let finalHtml = content_html;
  if (!finalHtml && content_md) {
    try { finalHtml = marked(content_md) as string; } catch { finalHtml = content_md; }
  }
  if (finalHtml) {
    finalHtml = sanitizeHtml(finalHtml);
  }
  const baseSlug = slugify(title);
  const slug = await ensureUniqueSlug(env, baseSlug);
  const rt = computeReadTime(finalHtml!);
  const published = status === 'published' ? new Date().toISOString() : null;
  const finalExcerpt = deriveExcerpt({ explicit: excerpt, html: finalHtml });
  try {
    await env.DB.prepare(`INSERT INTO blog_posts (slug, title, excerpt, content_html, author_name, author_id, category, tags_csv, cover_image_url, status, read_time_min, published_at, content_md) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(slug, title, finalExcerpt, finalHtml, roleCheck.auth.display_name || null, roleCheck.auth.userId || null, category || null, tagsToCsv(tags) || null, cover_image_url || null, status === 'published' ? 'published' : 'draft', rt, published, content_md || null)
      .run();
    return json({ ok: true, slug });
  } catch (err:any) {
    return json({ error: 'DB Insert Failed', detail: err?.message }, 500);
  }
}