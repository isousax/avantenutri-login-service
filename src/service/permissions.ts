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

export async function computeEffectiveEntitlements(_env: Env, _userId: string): Promise<EntitlementsResult> {
  // Modelo simplificado: todos os usuários têm acesso completo.
  // Retornamos capabilities vazias (não usadas mais) e limites vazios.
  // Mantemos estrutura para não quebrar chamadas existentes.
  const capabilities: string[] = [];
  const limits: Record<string, number | null> = {};
  const hash = simpleHash('entitlements:disabled');
  return { capabilities, limits, hash };
}
