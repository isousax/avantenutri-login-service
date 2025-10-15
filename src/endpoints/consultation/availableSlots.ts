import type { Env } from "../../types/Env";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /consultations/available?from=YYYY-MM-DD&to=YYYY-MM-DD
// Generates discrete slots from availability rules excluding blocked slots and already booked consultations
export async function availableConsultationSlotsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) return json({ error: 'missing_range' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json({ error: 'invalid_date' }, 400);
  if (from > to) return json({ error: 'invalid_range' }, 400);
  const tzOffsetMin = Number(env.BUSINESS_TZ_OFFSET_MINUTES ?? -180);
  const offsetMs = tzOffsetMin * 60000;
  try {
    const rulesRows = await env.DB.prepare(`SELECT * FROM consultation_availability_rules WHERE active = 1`).all();
    const rules = (rulesRows.results || []) as any[];
    if (!rules.length) return json({ ok: true, slots: [] });
    const blockedRows = await env.DB.prepare(`SELECT slot_start, slot_end FROM consultation_blocked_slots WHERE date(slot_start) <= ? AND date(slot_end) >= ?`).bind(to, from).all();
    const blocked = (blockedRows.results || []) as { slot_start: string; slot_end: string; }[];
    const consultationsRows = await env.DB.prepare(`SELECT scheduled_at, duration_min FROM consultations WHERE status = 'scheduled' AND date(scheduled_at) >= ? AND date(scheduled_at) <= ?`).bind(from, to).all();
    const consultations = (consultationsRows.results || []) as { scheduled_at: string; duration_min: number; }[];

    // Build a map per day of generated slots
    const daySlots: { date: string; slots: { start: string; end: string; taken: boolean; available: boolean; }[] }[] = [];
    const fromLocal = new Date(from + 'T00:00:00Z'); // provisional
    const toLocal = new Date(to + 'T00:00:00Z');
    // Calcular início local em UTC ajustando pelo offset
    let curLocalUtc = Date.UTC(fromLocal.getUTCFullYear(), fromLocal.getUTCMonth(), fromLocal.getUTCDate(), 0, 0) - offsetMs;
    const endLocalUtc = Date.UTC(toLocal.getUTCFullYear(), toLocal.getUTCMonth(), toLocal.getUTCDate(), 0, 0) - offsetMs;
    for (; curLocalUtc <= endLocalUtc; curLocalUtc += 24 * 60 * 60 * 1000) {
      const localDate = new Date(curLocalUtc + offsetMs);
      const dateStr = localDate.toISOString().slice(0,10);
      const weekday = localDate.getUTCDay();
      const applicable = rules.filter(r => r.weekday === weekday);
      const slots: { start: string; end: string; taken: boolean; available: boolean; }[] = [];
      for (const r of applicable) {
        const [sh, sm] = r.start_time.split(':').map(Number);
        const [eh, em] = r.end_time.split(':').map(Number);
        const slotDur = Number(r.slot_duration_min) || 40;
        let cursorUtc = curLocalUtc + (sh * 60 + sm) * 60000; // início local convertido para UTC
        const endBoundaryUtc = curLocalUtc + (eh * 60 + em) * 60000;
        while (cursorUtc + slotDur * 60000 <= endBoundaryUtc) {
          const startIso = new Date(cursorUtc).toISOString();
          const endIso = new Date(cursorUtc + slotDur * 60000).toISOString();
          // Check blocked
          const isBlocked = blocked.some(b => !(endIso <= b.slot_start || startIso >= b.slot_end));
          // Check taken
          const isTaken = consultations.some(c => {
            const cStart = new Date(c.scheduled_at).getTime();
            const cEnd = cStart + c.duration_min*60000;
            const sStart = new Date(startIso).getTime();
            const sEnd = new Date(endIso).getTime();
            return !(sEnd <= cStart || sStart >= cEnd);
          });
          if (!isBlocked) {
            // Campo 'available' esperado pelo frontend admin: disponível quando não está tomado
            slots.push({ start: startIso, end: endIso, taken: isTaken, available: !isTaken });
          }
          cursorUtc += slotDur*60000;
        }
      }
      daySlots.push({ date: dateStr, slots });
    }
    return json({ ok: true, days: daySlots });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
