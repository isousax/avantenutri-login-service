import type { Env } from "../../types/Env";
import { requireAdmin } from "../../middleware/requireAdmin";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/*
POST /admin/consultations/block-slot { slot_start: ISO, slot_end: ISO, reason? }
Used to block exceptional periods (vacation, meeting, etc.)
*/
export async function adminBlockSlotHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return (auth as { ok: false; response: Response }).response;
  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { slot_start, slot_end, reason } = body || {};
  if (!slot_start || !slot_end) return json({ error: 'missing_fields' }, 400);
  const start = new Date(slot_start); const end = new Date(slot_end);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return json({ error: 'invalid_datetime' }, 400);
  if (end <= start) return json({ error: 'invalid_range' }, 400);
  try {
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO consultation_blocked_slots (id, slot_start, slot_end, reason) VALUES (?, ?, ?, ?)`)
      .bind(id, slot_start, slot_end, typeof reason === 'string' ? reason.slice(0,200) : null)
      .run();
    return json({ ok: true, id });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
