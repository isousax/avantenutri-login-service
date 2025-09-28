import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/*
POST /admin/consultations/availability
{ weekday: 1, start_time: "09:00", end_time: "12:00", slot_duration_min?:40, max_parallel?:1 }

PATCH /admin/consultations/availability/:id
{ start_time?, end_time?, slot_duration_min?, max_parallel?, active? }
*/
export async function adminUpsertAvailabilityRuleHandler(request: Request, env: Env): Promise<Response> {
  const method = request.method;
  if (method !== 'POST' && method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return (auth as { ok: false; response: Response }).response;
  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (method === 'POST') {
    const { weekday, start_time, end_time } = body || {};
    if (weekday === undefined || start_time === undefined || end_time === undefined) return json({ error: 'missing_fields' }, 400);
    if (weekday < 0 || weekday > 6) return json({ error: 'invalid_weekday' }, 400);
    if (!/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) return json({ error: 'invalid_time' }, 400);
    if (end_time <= start_time) return json({ error: 'invalid_range' }, 400);
    const slot_duration = body.slot_duration_min && body.slot_duration_min > 5 ? Math.min(body.slot_duration_min, 240) : 40;
    const max_parallel = body.max_parallel && body.max_parallel > 0 ? Math.min(body.max_parallel, 5) : 1;
    try {
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO consultation_availability_rules (id, weekday, start_time, end_time, slot_duration_min, max_parallel) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, weekday, start_time, end_time, slot_duration, max_parallel)
        .run();
      return json({ ok: true, id });
    } catch (e:any) {
      return json({ error: 'Internal Error' }, 500);
    }
  } else {
    // PATCH
    const idMatch = request.url.match(/availability\/(.+)$/);
    const id = idMatch ? idMatch[1] : null;
    if (!id) return json({ error: 'missing_id' }, 400);
    const fields: string[] = [];
    const values: any[] = [];
    if (body.start_time) {
      if (!/^\d{2}:\d{2}$/.test(body.start_time)) return json({ error: 'invalid_time' }, 400);
      fields.push('start_time = ?'); values.push(body.start_time);
    }
    if (body.end_time) {
      if (!/^\d{2}:\d{2}$/.test(body.end_time)) return json({ error: 'invalid_time' }, 400);
      fields.push('end_time = ?'); values.push(body.end_time);
    }
    if (body.slot_duration_min) {
      fields.push('slot_duration_min = ?'); values.push(Math.min(Math.max(body.slot_duration_min, 10), 240));
    }
    if (body.max_parallel) {
      fields.push('max_parallel = ?'); values.push(Math.min(Math.max(body.max_parallel, 1), 5));
    }
    if (typeof body.active === 'number') {
      fields.push('active = ?'); values.push(body.active ? 1 : 0);
    }
    if (!fields.length) return json({ error: 'no_updates' }, 400);
    try {
      await env.DB.prepare(`UPDATE consultation_availability_rules SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...values, id)
        .run();
      return json({ ok: true });
    } catch (e:any) {
      return json({ error: 'Internal Error' }, 500);
    }
  }
}
