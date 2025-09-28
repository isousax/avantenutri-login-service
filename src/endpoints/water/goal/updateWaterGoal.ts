import type { Env } from "../../../types/Env";
import { verifyAccessToken } from "../../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// PUT /water/goal  { daily_cups: number }
export async function updateWaterGoalHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PUT') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);

  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('AGUA_LOG')) return json({ error: 'Forbidden (missing AGUA_LOG)' }, 403);

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const cups = Number(body?.daily_cups);
  if (!Number.isFinite(cups) || cups < 1 || cups > 40) return json({ error: 'daily_cups inválido (1-40)' }, 400);

  try {
    await env.DB.prepare(`INSERT INTO user_water_goals (user_id, daily_cups) VALUES (?, ?)\n      ON CONFLICT(user_id) DO UPDATE SET daily_cups=excluded.daily_cups, updated_at=CURRENT_TIMESTAMP`)
      .bind(userId, Math.round(cups))
      .run();
    return json({ ok: true, daily_cups: Math.round(cups) });
  } catch (e:any) {
    console.error('[updateWaterGoal] error', e?.message || e);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
