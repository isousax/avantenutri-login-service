import type { Env } from "../../../types/Env";
import { verifyAccessToken } from "../../../service/tokenVerify";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// GET /water/goal -> { ok, daily_cups, cup_ml, source: 'user'|'plan'|'default', limit_ml }
export async function getWaterGoalHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);

  try {
    const row = await env.DB.prepare('SELECT daily_cups FROM user_water_goals WHERE user_id = ?')
      .bind(userId)
      .first<{ daily_cups?: number }>();
    const settings = await env.DB.prepare('SELECT cup_ml FROM user_water_settings WHERE user_id = ?')
      .bind(userId)
      .first<{ cup_ml?: number }>();
    let source: 'user'|'plan'|'default' = 'default';
    let daily_cups: number;
  if (row?.daily_cups && row.daily_cups > 0) { daily_cups = row.daily_cups; source = 'user'; }
    else {
      // fallback: default to 8 cups since we no longer have plan limits
      daily_cups = 8; 
      source = 'default';
    }
    return json({ ok: true, daily_cups, cup_ml: settings?.cup_ml || 250, source, limit_ml: null });
  } catch (e:any) {
    console.error('[getWaterGoal] error', e?.message || e);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
