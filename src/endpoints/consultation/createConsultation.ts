import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface CreateConsultationBody {
  scheduledAt: string; // ISO datetime UTC
  durationMin?: number;
  type: string; // avaliacao_completa | reavaliacao | outro
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
  // Capabilities removidas: todos podem agendar (após questionário completo)

  // Check if questionnaire is complete before allowing consultation booking (unified logic)
  try {
    const questRow = await env.DB.prepare(`SELECT category, answers_json, submitted_at FROM questionnaire_responses WHERE user_id = ?`).bind(userId).first<any>();
    if (!questRow) {
      return json({ error: 'questionnaire_required', message: 'Questionário deve ser preenchido antes de agendar consulta' }, 400);
    }
    let answers: Record<string, any> = {};
    try { answers = JSON.parse(questRow.answers_json || '{}'); } catch { answers = {}; }
    const { isQuestionnaireComplete } = await import('../../utils/questionnaireCompletion');
    const complete = isQuestionnaireComplete({ category: questRow.category, answers, submitted_at: questRow.submitted_at });
    if (!complete) {
      // Distinção: se ainda não submetido, retornar questionnaire_required
      if (!questRow.submitted_at) {
        return json({ error: 'questionnaire_required', message: 'Questionário deve ser preenchido antes de agendar consulta' }, 400);
      }
      return json({ error: 'questionnaire_incomplete', message: 'Questionário incompleto. Complete todas as informações obrigatórias.' }, 400);
    }
  } catch (e: any) {
    console.error('[createConsultation] Error checking questionnaire:', e);
    return json({ error: 'Internal Error' }, 500);
  }

  // Enforce monthly included consultations limit if limit > 0 (count scheduled + completed in current month)
  try {
    // Limites de plano desativados
  } catch {}

  let body: CreateConsultationBody; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body?.scheduledAt || !body?.type) return json({ error: 'missing_fields' }, 400);
  const type = String(body.type).toLowerCase();
  const allowedTypes = ['avaliacao_completa','reavaliacao','outro','only_diet'];
  if (!allowedTypes.includes(type)) return json({ error: 'invalid_type' }, 400);

  // Exigir crédito para tipos avaliacao_completa / reavaliacao / only_diet ("outro" gratuito por enquanto)
  try {
    if (type === 'avaliacao_completa' || type === 'reavaliacao' || type === 'only_diet') {
      // Ignora créditos expirados (expires_at passado)
      const credit = await env.DB.prepare('SELECT id, type, expires_at FROM consultation_credits WHERE user_id = ? AND type = ? AND status = "available" AND locked = 0 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ORDER BY created_at ASC LIMIT 1')
        .bind(userId, type)
        .first<{ id?: string; type?: string }>();
      if (!credit?.id) return json({ error: 'no_credit', message: 'Crédito de consulta necessário. Realize o pagamento primeiro.' }, 402);
      // Guardar id de crédito para consumir após inserir a consulta
      (body as any)._creditId = credit.id;
    }
  } catch (e) {
    console.error('[createConsultation] Falha ao verificar crédito', e);
    return json({ error: 'credit_check_failed' }, 500);
  }
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
    
    // Inserir consulta com proteção contra race condition
    try {
      await env.DB.prepare(`INSERT INTO consultations (id, user_id, type, scheduled_at, duration_min, notes, urgency) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, userId, type, body.scheduledAt, durationMin, notes, urgency)
        .run();
    } catch (e: any) {
      // Capturar violação de constraint UNIQUE (race condition)
      if (e.message?.includes('UNIQUE constraint failed') || e.message?.includes('idx_consultations_unique_scheduled_slot')) {
        return json({ error: 'slot_taken', message: 'Este horário já foi ocupado por outro usuário' }, 409);
      }
      throw e; // Re-throw outros erros
    }
    
    if ((body as any)._creditId) {
      try {
        await env.DB.prepare('UPDATE consultation_credits SET status = "used", used_at = CURRENT_TIMESTAMP, consultation_id = ? WHERE id = ?')
          .bind(id, (body as any)._creditId)
          .run();
      } catch (e) {
        console.error('[createConsultation] Falha ao consumir crédito', e);
      }
    }
    return json({ ok: true, id, status: 'scheduled' }, 201);
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
