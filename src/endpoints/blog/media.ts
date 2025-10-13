import type { Env } from "../../types/Env";
import { json } from "./utils";
import { requireRoles } from "../../middleware/requireRoles";

// POST /blog/media (admin/nutri)
export async function uploadBlogMediaHandler(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
    if (!env.R2) return json({ error: 'Storage unavailable' }, 503);
    // Require admin or nutri role
    const auth = await requireRoles(request, env, ['admin', 'nutri']);
    if (!auth.ok) {
      // return error response from middleware
      return (auth as { ok: false; response: Response }).response;
    }

    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return json({ error: 'Missing file' }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const now = new Date();
      const key = `blog/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${crypto.randomUUID()}.${ext}`;
      await env.R2.put(key, bytes, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
      const base = "https://login-service.avantenutri.workers.dev";
      const url = `${base}/blog/media/${encodeURIComponent(key.replace(/^blog\//,''))}`;
      return json({ ok: true, key, url });
    } else {
      // Raw body upload (fallback)
      const bytes = new Uint8Array(await request.arrayBuffer());
      const ct = request.headers.get('X-Content-Type') || 'application/octet-stream';
      const name = request.headers.get('X-Filename') || `upload-${Date.now()}`;
      const ext = (name.split('.').pop() || 'bin').toLowerCase();
      const now = new Date();
      const key = `blog/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${crypto.randomUUID()}.${ext}`;
      await env.R2.put(key, bytes, { httpMetadata: { contentType: ct } });
      const base = "https://login-service.avantenutri.workers.dev";
      const url = `${base}/blog/media/${encodeURIComponent(key.replace(/^blog\//,''))}`;
      return json({ ok: true, key, url });
    }
  } catch (err: any) {
    return json({ error: 'Upload failed', detail: err?.message }, 500);
  }
}

// GET /blog/media/:path  (public)
export async function getBlogMediaHandler(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.R2) return new Response('Storage unavailable', { status: 503 });
    const url = new URL(request.url);
    const idx = url.pathname.indexOf('/blog/media/');
    const sub = url.pathname.slice(idx + '/blog/media/'.length);
    if (!sub) return new Response('Not Found', { status: 404 });
    const key = `blog/${decodeURIComponent(sub)}`;
    const obj = await env.R2.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    const ct = obj.httpMetadata?.contentType || 'application/octet-stream';
    const headers = new Headers({ 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' });
    return new Response(obj.body, { headers });
  } catch {
    return new Response('Internal Error', { status: 500 });
  }
}
