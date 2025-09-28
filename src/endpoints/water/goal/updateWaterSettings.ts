import type { Env } from "../../../types/Env";
import { verifyAccessToken } from "../../../service/tokenVerify";
import { computeEffectiveEntitlements } from "../../../service/permissions";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// PATCH /water/settings  { cup_ml: number }
export async function updateWaterSettingsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return json({ error: 'Method Not Allowed' }, 405);
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  const userId = String(payload.sub);

  const ent = await computeEffectiveEntitlements(env, userId);
  if (!ent.capabilities.includes('AGUA_LOG')) return json({ error: 'Forbidden (missing AGUA_LOG)' }, 403);

  let body: any; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const cup_ml = Number(body?.cup_ml);
  if (!Number.isFinite(cup_ml) || cup_ml < 50 || cup_ml > 1000) return json({ error: 'cup_ml inválido (50-1000)' }, 400);

  try {
    await env.DB.prepare(`INSERT INTO user_water_settings (user_id, cup_ml) VALUES (?, ?)\n      ON CONFLICT(user_id) DO UPDATE SET cup_ml=excluded.cup_ml, updated_at=CURRENT_TIMESTAMP`)
      .bind(userId, Math.round(cup_ml))
      .run();
    return json({ ok: true, cup_ml: Math.round(cup_ml) });
  } catch (e:any) {
    console.error('[updateWaterSettings] error', e?.message || e);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
