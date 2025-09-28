import type { Env } from "../../types/Env";
import { json, parseTags } from "./utils";
import { verifyAccessToken } from "../../service/tokenVerify";

// GET /blog/posts/by-id/:id (admin/nutri)
export async function getBlogPostByIdHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const vr = await verifyAccessToken(env, token, {});
  if(!vr.valid || !['admin','nutri'].includes(vr.payload.role)) return json({ error: 'Forbidden' }, 403);
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const id = parts.pop();
  if(!id) return json({ error: 'Not Found' }, 404);
  const row = await env.DB.prepare(`SELECT * FROM blog_posts WHERE id=? LIMIT 1`).bind(id).first<any>();
  if(!row) return json({ error: 'Not Found' }, 404);
  return json({ ok: true, post: { ...row, tags: parseTags(row.tags_csv) } });
}