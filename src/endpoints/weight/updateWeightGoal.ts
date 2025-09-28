import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// PUT /weight/goal  { weight_goal_kg: number|null }
export async function updateWeightGoalHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PUT') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);
  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('PESO_LOG')) return json({ error: 'Forbidden' }, 403);

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  let goal: number | null = null;
  if (body && Object.prototype.hasOwnProperty.call(body, 'weight_goal_kg')) {
    if (body.weight_goal_kg == null) goal = null; else {
      const v = Number(body.weight_goal_kg);
      if (!Number.isFinite(v) || v <= 0 || v > 500) return json({ error: 'weight_goal_kg inválido' }, 400);
      goal = Math.round(v * 100) / 100;
    }
  } else return json({ error: 'weight_goal_kg requerido (pode ser null)' }, 400);

  try {
    await env.DB.prepare(`INSERT INTO user_goals(user_id, weight_goal_kg) VALUES(?, ?)
      ON CONFLICT(user_id) DO UPDATE SET weight_goal_kg=excluded.weight_goal_kg, updated_at=CURRENT_TIMESTAMP`)
      .bind(userId, goal)
      .run();
    return json({ ok: true, weight_goal_kg: goal });
  } catch (e:any) {
    return json({ error: 'Internal Error' }, 500);
  }
}
