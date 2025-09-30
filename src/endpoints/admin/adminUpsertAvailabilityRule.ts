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
    // overlap check: any active & not deleted rule with intersecting time on same weekday
    try {
      const overlap = await env.DB.prepare(`SELECT id, weekday, start_time, end_time FROM consultation_availability_rules
        WHERE deleted_at IS NULL AND active = 1 AND weekday = ?
          AND NOT (end_time <= ? OR start_time >= ?)
        LIMIT 1`).bind(weekday, start_time, end_time).first<any>();
      if (overlap) return json({ error: 'overlap', conflict: overlap }, 400);
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO consultation_availability_rules (id, weekday, start_time, end_time, slot_duration_min, max_parallel) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, weekday, start_time, end_time, slot_duration, max_parallel)
        .run();
      // audit log
      await env.DB.prepare(`INSERT INTO availability_rule_log (rule_id, action, weekday, start_time, end_time, slot_duration_min, max_parallel, active, snapshot_json)
        VALUES (?, 'create', ?, ?, ?, ?, ?, 1, ?)`)
        .bind(id, weekday, start_time, end_time, slot_duration, max_parallel, JSON.stringify({ id, weekday, start_time, end_time, slot_duration_min: slot_duration, max_parallel, active: 1 }))
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
    if (body.weekday !== undefined) {
      if (body.weekday < 0 || body.weekday > 6) return json({ error: 'invalid_weekday' }, 400);
      fields.push('weekday = ?'); values.push(body.weekday);
    }
    if (typeof body.active === 'number') {
      fields.push('active = ?'); values.push(body.active ? 1 : 0);
    }
    if (!fields.length) return json({ error: 'no_updates' }, 400);
    // If enabling or changing times, perform overlap check with new values
    try {
      // Fetch existing to know weekday/start/end if not updated
      const existing = await env.DB.prepare(`SELECT * FROM consultation_availability_rules WHERE id = ? AND deleted_at IS NULL`).bind(id).first<any>();
      if (!existing) return json({ error: 'not_found' }, 404);
  const newStart = body.start_time || existing.start_time;
  const newEnd = body.end_time || existing.end_time;
  const weekday = body.weekday !== undefined ? body.weekday : existing.weekday; // now editable
      // Only check overlap if (a) times changed OR (b) active being set to 1
      const activating = typeof body.active === 'number' ? !!body.active : existing.active === 1;
      if (activating) {
        const overlap = await env.DB.prepare(`SELECT id, weekday, start_time, end_time FROM consultation_availability_rules
          WHERE deleted_at IS NULL AND active = 1 AND weekday = ? AND id != ?
            AND NOT (end_time <= ? OR start_time >= ?)
          LIMIT 1`).bind(weekday, id, newStart, newEnd).first<any>();
        if (overlap) return json({ error: 'overlap', conflict: overlap }, 400);
      }
      await env.DB.prepare(`UPDATE consultation_availability_rules SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...values, id)
        .run();
      // fetch updated for logging
      const updated = await env.DB.prepare(`SELECT * FROM consultation_availability_rules WHERE id = ?`).bind(id).first<any>();
      if (updated) {
        const action = typeof body.active === 'number' ? (body.active ? 'activate' : 'deactivate') : 'update';
        await env.DB.prepare(`INSERT INTO availability_rule_log (rule_id, action, weekday, start_time, end_time, slot_duration_min, max_parallel, active, snapshot_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, action, updated.weekday, updated.start_time, updated.end_time, updated.slot_duration_min, updated.max_parallel, updated.active, JSON.stringify(updated))
          .run();
      }
      return json({ ok: true });
    } catch (e:any) {
      return json({ error: 'Internal Error' }, 500);
    }
  }
}
