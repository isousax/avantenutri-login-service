import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface CreateConsultationBody {
  scheduledAt: string; // ISO datetime UTC
  durationMin?: number;
  type: string; // acompanhamento | reavaliacao | outro
  notes?: string;
  urgency?: string; // baixa | normal | alta
}

// POST /consultations { scheduledAt, type, durationMin?, notes?, urgency? }
export async function createConsultationHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('CONSULTA_AGENDAR')) return json({ error: 'Forbidden (missing CONSULTA_AGENDAR)' }, 403);

  // Enforce monthly included consultations limit if limit > 0 (count scheduled + completed in current month)
  try {
    const limit = ent.limits?.['CONSULTAS_INCLUIDAS_MES'];
    if (typeof limit === 'number' && limit >= 0) {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
      const pad = (n:number)=> String(n).padStart(2,'0');
      const fmt = (d:Date)=> `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
      const startStr = fmt(start); const endStr = fmt(end);
      const row = await env.DB.prepare(`SELECT COUNT(1) as c FROM consultations WHERE user_id = ? AND status IN ('scheduled','completed') AND scheduled_at >= ? || ' 00:00:00' AND scheduled_at <= ? || ' 23:59:59'`)
        .bind(userId, startStr, endStr)
        .first<{ c?: number }>();
      const used = row?.c || 0;
      if (limit === 0 && used >= 0) {
        // No included consultations at all
        return json({ error: 'limit_exceeded', limit, used });
      }
      if (limit > 0 && used >= limit) {
        return json({ error: 'limit_exceeded', limit, used });
      }
    }
  } catch {}

  let body: CreateConsultationBody; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body?.scheduledAt || !body?.type) return json({ error: 'missing_fields' }, 400);
  const type = String(body.type).toLowerCase();
  const allowedTypes = ['acompanhamento','reavaliacao','outro'];
  if (!allowedTypes.includes(type)) return json({ error: 'invalid_type' }, 400);
  const scheduledDate = new Date(body.scheduledAt);
  if (isNaN(scheduledDate.getTime())) return json({ error: 'invalid_datetime' }, 400);
  if (scheduledDate.getTime() < Date.now() - 2 * 60 * 1000) return json({ error: 'past_datetime' }, 400);
  const durationMin = body.durationMin && body.durationMin > 0 ? Math.min(body.durationMin, 180) : 40;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null;
  const urgency = body.urgency && ['baixa','normal','alta'].includes(body.urgency) ? body.urgency : null;

  try {
    // Validate slot against availability rules (must match an active rule's discrete slot boundary)
    const weekday = scheduledDate.getUTCDay();
    const rulesRows = await env.DB.prepare(`SELECT * FROM consultation_availability_rules WHERE active = 1 AND weekday = ?`).bind(weekday).all();
    const rules = (rulesRows.results || []) as any[];
    if (!rules.length) return json({ error: 'no_rule_for_weekday' }, 400);
    let matchesRule = false;
    for (const r of rules) {
      const [sh, sm] = String(r.start_time).split(':').map(Number);
      const [eh, em] = String(r.end_time).split(':').map(Number);
      const ruleStart = Date.UTC(scheduledDate.getUTCFullYear(), scheduledDate.getUTCMonth(), scheduledDate.getUTCDate(), sh, sm, 0);
      const ruleEnd = Date.UTC(scheduledDate.getUTCFullYear(), scheduledDate.getUTCMonth(), scheduledDate.getUTCDate(), eh, em, 0);
      if (scheduledDate.getTime() < ruleStart || scheduledDate.getTime() >= ruleEnd) continue;
      const slotDur = Number(r.slot_duration_min) || 40;
      // Require duration to equal rule slot duration (simplify for now)
      if (durationMin !== slotDur) continue;
      const offset = scheduledDate.getTime() - ruleStart;
      if (offset % (slotDur * 60000) === 0 && (scheduledDate.getTime() + durationMin * 60000) <= ruleEnd) {
        matchesRule = true; break;
      }
    }
    if (!matchesRule) return json({ error: 'slot_not_available' }, 400);

    // Blocked slots overlap?
    const blocked = await env.DB.prepare(`SELECT id FROM consultation_blocked_slots WHERE NOT( ? >= slot_end OR datetime(?, '+${durationMin} minutes') <= slot_start ) LIMIT 1`)
      .bind(body.scheduledAt, body.scheduledAt)
      .first<any>();
    if (blocked) return json({ error: 'blocked_slot' }, 409);

    // Any existing consultation occupying that slot? (global, not just same user)
    const taken = await env.DB.prepare(`SELECT id FROM consultations WHERE status = 'scheduled' AND NOT( datetime(scheduled_at, '+' || duration_min || ' minutes') <= ? OR scheduled_at >= datetime(?, '+${durationMin} minutes') ) LIMIT 1`)
      .bind(body.scheduledAt, body.scheduledAt)
      .first<any>();
    if (taken) return json({ error: 'slot_taken' }, 409);
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO consultations (id, user_id, type, scheduled_at, duration_min, notes, urgency) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, userId, type, body.scheduledAt, durationMin, notes, urgency)
      .run();
    return json({ ok: true, id, status: 'scheduled' }, 201);
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
