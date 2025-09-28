import type { Env } from "../../types/Env";
import { json } from "./utils";
import { verifyAccessToken } from "../../service/tokenVerify";

// DELETE /blog/posts/:id  (admin/nutri)
export async function adminDeleteBlogPostHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'DELETE') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const vr = await verifyAccessToken(env, token, {});
  if (!vr.valid || !['admin','nutri'].includes(vr.payload.role)) return json({ error: 'Forbidden' }, 403);
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();
  if (!id) return json({ error: 'Not Found' }, 404);
  try {
    const res = await env.DB.prepare(`DELETE FROM blog_posts WHERE id = ?`).bind(id).run();
    if (res.success && res.meta.rows_written) return json({ ok: true, id });
    return json({ error: 'Not Found' }, 404);
  } catch (err:any) {
    return json({ error: 'DB Delete Failed', detail: err?.message }, 500);
  }
}