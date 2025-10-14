import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }); }

function currentMonthRange(): { start: string; end: string } {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0));
  const pad = (n:number)=> String(n).padStart(2,'0');
  const fmt = (dt:Date)=> `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`;
  return { start: fmt(start), end: fmt(end) };
}

export async function reviseDietPlanHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = payload.sub;
  const planId = request.url.split('/').slice(-2)[0]; // /diet/plans/{id}/revise
  if (!planId) return json({ error: 'plan id missing in path' }, 400);

  let body:any; try { body = await request.json(); } catch { body = {}; }
  const { notes, dataPatch, data } = body || {};

  // Apenas admin pode revisar dietas – usar util centralizado
  const adminCheck = await requireAdmin(request, env);
  if (!adminCheck.ok && 'response' in adminCheck) return adminCheck.response;
  // Sem limites de revisões no novo modelo
  const { start, end } = currentMonthRange();
  try {
    // Admin revisa planos de qualquer paciente; permitir plano de outro usuário quando admin
    const existingPlan = await env.DB.prepare('SELECT id, user_id, current_version_id FROM diet_plans WHERE id = ? AND status = "active"')
      .bind(planId)
      .first<any>();
    if (!existingPlan?.id) return json({ error: 'Plano não encontrado ou inativo' }, 404);

    // Count revisions (versions beyond #1) this month
    // Antes: contagem vs limite de revisões — agora ignorado

    // Get latest version number
    const lastV = await env.DB.prepare('SELECT version_number, data_json FROM diet_plan_versions WHERE id = ?')
      .bind(existingPlan.current_version_id)
      .first<{ version_number?: number; data_json?: string }>();
    const nextNumber = (lastV?.version_number || 0) + 1;
  let baseData: any = {}; try { baseData = JSON.parse(lastV?.data_json || '{}'); } catch { baseData = {}; }
  // Se "data" foi enviado, tratamos como substituição completa; senão aplicamos patch sobre a versão atual
  let merged: any = (data && typeof data === 'object') ? data : { ...baseData, ...(dataPatch || {}) };
  const fileSource: any = (data && typeof data === 'object') ? data : (dataPatch || {});
  if (fileSource?.format === 'pdf' && fileSource?.file?.base64) {
      try {
        const b64 = fileSource.file.base64 as string;
        if (b64.length * 0.75 > 5 * 1024 * 1024) {
          return json({ error: 'PDF excede limite de 5MB' }, 400);
        }
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const originalName: string = fileSource.file.name || `plano-${planId}-v${nextNumber}.pdf`;
        const safeName = originalName.toLowerCase().replace(/[^a-z0-9._-]/g,'_');
        const key = `diet-plans/${planId}/v${nextNumber}/${Date.now()}-${safeName}`;
        if (env.DIET_FILES) {
          await env.DIET_FILES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
          merged.file = { key, name: originalName, mime: 'application/pdf' };
        } else {
          delete merged.file?.base64;
          if (merged.file) merged.file.inline_disabled = true;
        }
      } catch (err:any) {
        console.error('[diet pdf upload revise] error', err?.message || err);
        return json({ error: 'Falha ao processar PDF' }, 500);
      }
    } else if (merged?.file?.base64) {
      // Se veio base64 mas format não é pdf, remover para evitar armazenar inline acidental
      delete merged.file.base64;
    }
    const newVid = crypto.randomUUID();

    await env.DB.prepare('INSERT INTO diet_plan_versions (id, plan_id, version_number, generated_by, data_json, notes) VALUES (?, ?, ?, "user", ?, ?)')
      .bind(newVid, planId, nextNumber, JSON.stringify(merged), notes || null)
      .run();
    await env.DB.prepare('UPDATE diet_plans SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(newVid, planId)
      .run();
    return json({ ok: true, plan_id: planId, version_id: newVid, version_number: nextNumber });
  } catch (err:any) {
    console.error('[reviseDietPlan] error', err?.message || err);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
