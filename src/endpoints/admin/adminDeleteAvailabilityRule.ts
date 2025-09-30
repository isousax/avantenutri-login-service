import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// DELETE /admin/consultations/availability/:id (soft delete)
export async function adminDeleteAvailabilityRuleHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'DELETE') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return (auth as { ok:false; response: Response }).response;
  const m = request.url.match(/availability\/(.+)$/);
  const id = m ? m[1] : null;
  if (!id) return json({ error: 'missing_id' }, 400);
  try {
    // fetch existing for logging
    const existing = await env.DB.prepare(`SELECT * FROM consultation_availability_rules WHERE id = ? AND deleted_at IS NULL`).bind(id).first<any>();
    await env.DB.prepare(`UPDATE consultation_availability_rules SET deleted_at = CURRENT_TIMESTAMP, active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();
    if (existing) {
      await env.DB.prepare(`INSERT INTO availability_rule_log (rule_id, action, weekday, start_time, end_time, slot_duration_min, max_parallel, active, snapshot_json)
        VALUES (?, 'delete', ?, ?, ?, ?, ?, 0, ?)`)
        .bind(id, existing.weekday, existing.start_time, existing.end_time, existing.slot_duration_min, existing.max_parallel, JSON.stringify(existing))
        .run();
    }
    return json({ ok: true });
  } catch (e:any) {
    return json({ error: 'internal' }, 500);
  }
}
