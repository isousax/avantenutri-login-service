import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }); }

export async function createDietPlanHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = payload.sub;

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { name, description, start_date, end_date, data, user_id: targetUserId } = body || {};
  if (!name || typeof name !== 'string') return json({ error: 'name required' }, 400);
  if (start_date && isNaN(Date.parse(start_date))) return json({ error: 'invalid start_date' }, 400);
  if (end_date && isNaN(Date.parse(end_date))) return json({ error: 'invalid end_date' }, 400);

  // Capability + role check. Business rule: apenas ADMIN pode criar dietas (mesmo que o plano conceda capability ao paciente).
  const roleRow = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role?: string }>();
  if (roleRow?.role !== 'admin') {
    return json({ error: 'Forbidden (admin only)' }, 403);
  }

  // Start first version
  const planId = crypto.randomUUID();
  const ownerUserId = targetUserId && typeof targetUserId === 'string' && targetUserId !== userId ? targetUserId : userId;
  const versionId = crypto.randomUUID();
  const versionNumber = 1;
  let processedData: any = data || { meals: [], macros: {}, notes: '' };
  // Upload PDF se fornecido e bucket disponível
  if (processedData?.format === 'pdf' && processedData?.file?.base64) {
    try {
      const b64 = processedData.file.base64 as string;
      if (b64.length * 0.75 > 5 * 1024 * 1024) {
        return json({ error: 'PDF excede limite de 5MB' }, 400);
      }
      const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const originalName: string = processedData.file.name || `${name}.pdf`;
      const safeName = originalName.toLowerCase().replace(/[^a-z0-9._-]/g,'_');
      const key = `diet-plans/${planId}/v1/${Date.now()}-${safeName}`;
      if (env.DIET_FILES) {
        await env.DIET_FILES.put(key, binary, { httpMetadata: { contentType: 'application/pdf' } });
        processedData.file = { key, name: originalName, mime: 'application/pdf' };
      } else {
        // Sem bucket: manter aviso e remover base64 para evitar growth
        delete processedData.file.base64;
        processedData.file.inline_disabled = true;
      }
    } catch (err:any) {
      console.error('[diet pdf upload] erro', err?.message || err);
      return json({ error: 'Falha ao processar PDF' }, 500);
    }
  }
  const dataJson = JSON.stringify(processedData);
  try {
    await env.DB.prepare(`INSERT INTO diet_plans (id, user_id, name, description, start_date, end_date, current_version_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(planId, ownerUserId, name, description || null, start_date || null, end_date || null, versionId)
      .run();
    await env.DB.prepare(`INSERT INTO diet_plan_versions (id, plan_id, version_number, generated_by, data_json, notes)
                          VALUES (?, ?, ?, 'user', ?, ?)`)
      .bind(versionId, planId, versionNumber, dataJson, null)
      .run();
    return json({ ok: true, plan_id: planId, version_id: versionId });
  } catch (err: any) {
    console.error('[createDietPlan] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
