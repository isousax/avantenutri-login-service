import type { Env } from '../types/Env';

// Placeholder structure for future entitlements calculation.
export interface EntitlementsResult {
  capabilities: string[]; // list of capability codes
  limits: Record<string, number | null>; // e.g. { DIETA_EDIT: 5 }
  hash: string; // deterministic hash of capabilities+limits for change detection
}

// Simple stable hash (non-crypto) for small strings; can swap to SHA-256 later.
function simpleHash(input: string): string {
  let h = 0, i = 0, len = input.length;
  while (i < len) { h = (h << 5) - h + input.charCodeAt(i++) | 0; }
  return (h >>> 0).toString(16);
}

export async function computeEffectiveEntitlements(env: Env, userId: string): Promise<EntitlementsResult> {
  // 1. Descobre plano do usuário
  const userRow = await env.DB.prepare("SELECT plan_id, role FROM users WHERE id = ?")
    .bind(userId)
    .first<{ plan_id?: string; role?: string }>();
  const planId = (userRow?.plan_id || 'free').toLowerCase();

  // 2. Carrega capabilities do plano
  const capsRes = await env.DB.prepare("SELECT capability_code FROM plan_capabilities WHERE plan_id = ?")
    .bind(planId)
    .all<{ capability_code: string }>();
  const capabilities = (capsRes.results || []).map(r => r.capability_code);

  // 3. Limites
  const limitsRes = await env.DB.prepare("SELECT limit_key, limit_value FROM plan_limits WHERE plan_id = ?")
    .bind(planId)
    .all<{ limit_key: string; limit_value: number }>();
  const limits: Record<string, number | null> = {};
  for (const r of (limitsRes.results || [])) limits[r.limit_key] = r.limit_value;

  // 4. Overrides por usuário (capability/grant/revoke, limit-set). Expirados são ignorados.
  try {
    const nowIso = new Date().toISOString();
    const ov = await env.DB.prepare(`SELECT type, key, value FROM user_entitlement_overrides
       WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`)
      .bind(userId, nowIso)
      .all<{ type: string; key: string; value: number | null }>();
    for (const r of (ov.results || [])) {
      if (r.type === 'capability-grant') {
        if (!capabilities.includes(r.key)) capabilities.push(r.key);
      } else if (r.type === 'capability-revoke') {
        const idx = capabilities.indexOf(r.key);
        if (idx >= 0) capabilities.splice(idx, 1);
      } else if (r.type === 'limit-set') {
        limits[r.key] = r.value == null ? null : r.value; // null => infinito
      }
    }
  } catch {}

  // 5. Hash determinístico
  const hash = simpleHash(JSON.stringify({ capabilities: [...capabilities].sort(), limits }));
  return { capabilities, limits, hash };
}
