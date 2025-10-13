import type { Env } from "../../types/Env";
import { json } from "./utils";
import { requireRoles } from "../../middleware/requireRoles";

// Helper: decode repeatedly to handle double-encoding (e.g., %252F -> %2F -> /)
function decodePathMulti(input: string, max = 5): string {
  let prev = input;
  for (let i = 0; i < max; i++) {
    try {
      const next = decodeURIComponent(prev);
      if (next === prev) return next;
      prev = next;
    } catch {
      // If decoding fails at any point, return best-effort current value
      return prev;
    }
  }
  return prev;
}

function normalizeBlogKeyFromPathSegment(sub: string): string {
  // Decode multiple times to collapse %252F -> /
  let decoded = decodePathMulti(sub);
  // Normalize leading slashes
  decoded = decoded.replace(/^\/+/, "");
  // Ensure blog/ prefix
  const key = decoded.startsWith("blog/") ? decoded : `blog/${decoded}`;
  // Collapse any accidental double slashes (except the scheme, which we don't have in keys)
  return key.replace(/\/+/, "/");
}

// POST /blog/media (admin/nutri)
export async function uploadBlogMediaHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.log("[uploadBlogMediaHandler] Incoming request:", request.method);

    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
    if (!env.R2) {
      console.warn("[uploadBlogMediaHandler] R2 not available");
      return json({ error: 'Storage unavailable' }, 503);
    }

    const auth = await requireRoles(request, env, ['admin', 'nutri']);
    if (!auth.ok) {
      console.warn("[uploadBlogMediaHandler] Unauthorized access attempt");
      return (auth as { ok: false; response: Response }).response;
    }

    const contentType = request.headers.get('Content-Type') || '';

    const now = new Date();
    let key = '';

    if (contentType.startsWith('multipart/form-data')) {
      console.log(`[uploadBlogMediaHandler] Uploading multipart form file`);

      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        console.warn("[uploadBlogMediaHandler] No file found in form-data");
        return json({ error: 'Missing file' }, 400);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      key = `blog/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
      await env.R2.put(key, bytes, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });

    } else {
      console.log(`[uploadBlogMediaHandler] Uploading raw body`);

      const bytes = new Uint8Array(await request.arrayBuffer());
      const ct = request.headers.get('X-Content-Type') || 'application/octet-stream';
      const name = request.headers.get('X-Filename') || `upload-${Date.now()}`;
      const ext = (name.split('.').pop() || 'bin').toLowerCase();
      key = `blog/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
      await env.R2.put(key, bytes, { httpMetadata: { contentType: ct } });
    }

    const url = `https://login-service.avantenutri.workers.dev/blog/media/${encodeURIComponent(key.replace(/^blog\//, ''))}`;
    console.log(`[uploadBlogMediaHandler] Upload successful. Key: ${key}, URL: ${url}`);

    return json({ ok: true, key, url });

  } catch (err: any) {
    console.error("[uploadBlogMediaHandler] Upload failed:", err?.message);
    return json({ error: 'Upload failed', detail: err?.message }, 500);
  }
}

// GET /blog/media/:path (public)
export async function getBlogMediaHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.log("[getBlogMediaHandler] Incoming request");

    if (!env.R2) {
      console.warn("[getBlogMediaHandler] R2 not available");
      return new Response('Storage unavailable', { status: 503 });
    }

    const url = new URL(request.url);
    const idx = url.pathname.indexOf('/blog/media/');
    const sub = url.pathname.slice(idx + '/blog/media/'.length);
    if (!sub) {
      console.warn("[getBlogMediaHandler] Missing path");
      return new Response('Not Found', { status: 404 });
    }

  const key = normalizeBlogKeyFromPathSegment(sub);
    const obj = await env.R2.get(key);

    if (!obj) {
      console.warn(`[getBlogMediaHandler] Object not found for key: ${key}`);
      return new Response('Not Found', { status: 404 });
    }

    const ct = obj.httpMetadata?.contentType || 'application/octet-stream';
    const noCache = url.searchParams.has('nocache') || url.searchParams.has('preview');
    const headers = new Headers({ 'Content-Type': ct });

    if (noCache) {
      headers.set('Cache-Control', 'no-store, max-age=0');
      headers.set('Pragma', 'no-cache');
    } else {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }

    console.log(`[getBlogMediaHandler] Serving key: ${key}, Content-Type: ${ct}`);
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    return new Response(obj.body, { headers });
  } catch (err: any) {
    console.error("[getBlogMediaHandler] Error:", err?.message);
    return new Response('Internal Error', { status: 500 });
  }
}

// DELETE /blog/media/:path (admin/nutri)
export async function deleteBlogMediaHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.log("[deleteBlogMediaHandler] Incoming DELETE request");

    if (request.method !== 'DELETE') return json({ error: 'Method Not Allowed' }, 405);
    if (!env.R2) {
      console.warn("[deleteBlogMediaHandler] R2 not available");
      return json({ error: 'Storage unavailable' }, 503);
    }

    const auth = await requireRoles(request, env, ['admin', 'nutri']);
    if (!auth.ok) {
      console.warn("[deleteBlogMediaHandler] Unauthorized deletion attempt");
      return (auth as { ok: false; response: Response }).response;
    }

    const url = new URL(request.url);
    const idx = url.pathname.indexOf('/blog/media/');
    const sub = url.pathname.slice(idx + '/blog/media/'.length);
    if (!sub) {
      console.warn("[deleteBlogMediaHandler] Missing path");
      return json({ error: 'missing_path' }, 400);
    }

    const key = normalizeBlogKeyFromPathSegment(sub);

    const existed = !!(await env.R2.head?.(key));
    await env.R2.delete(key);

    console.log(`[deleteBlogMediaHandler] Deleted key: ${key}, Previously existed: ${existed}`);
    return json({ ok: true, deleted: key, existed });

  } catch (err: any) {
    console.error("[deleteBlogMediaHandler] Deletion failed:", err?.message);
    return json({ error: 'Delete failed', detail: err?.message }, 500);
  }
}
