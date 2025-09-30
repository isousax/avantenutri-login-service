import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

export async function getDietPlanFileHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401 });
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return new Response('Unauthorized', { status: 401 });
  const userId = payload.sub;

  const path = new URL(request.url).pathname; // /diet/plans/:id/version/:vid/file
  const parts = path.split('/');
  const planId = parts[3];
  const versionId = parts[5];
  if (!planId || !versionId) return new Response('Bad Request', { status: 400 });

  try {
    const plan = await env.DB.prepare('SELECT id FROM diet_plans WHERE id = ? AND user_id = ? LIMIT 1')
      .bind(planId, userId)
      .first<any>();
    if (!plan?.id) return new Response('Not Found', { status: 404 });

    const version = await env.DB.prepare('SELECT data_json FROM diet_plan_versions WHERE id = ? AND plan_id = ? LIMIT 1')
      .bind(versionId, planId)
      .first<{ data_json?: string }>();
    if (!version?.data_json) return new Response('Not Found', { status: 404 });

    let data: any = {}; try { data = JSON.parse(version.data_json); } catch { /* ignore */ }
    const key = data?.file?.key;
    if (!key) return new Response('No file', { status: 404 });
    if (!env.DIET_FILES) return new Response('Storage unavailable', { status: 503 });

    const obj = await env.DIET_FILES.get(key);
    if (!obj) return new Response('File not found', { status: 404 });

    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/pdf',
        'Cache-Control': 'private, max-age=0, no-store',
        'Content-Disposition': `attachment; filename="${(data.file?.name||'plano.pdf').replace(/"/g,'')}`
      }
    });
  } catch (err:any) {
    console.error('[getDietPlanFile] error', err?.message || err);
    return new Response('Internal Error', { status: 500 });
  }
}
