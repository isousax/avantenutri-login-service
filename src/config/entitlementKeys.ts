export const PLAN_LIMIT_KEYS = [
  'DIETA_REVISOES_MES',
  'CONSULTAS_INCLUIDAS_MES',
  'WATER_ML_DIA'
] as const;

export const CAPABILITY_CODES = [
  'DIETA_EDIT',
  'DIETA_VIEW',
  'AGUA_LOG',
  'CONSULTA_AGENDAR',
  'CONSULTA_CANCELAR',
  'CHAT_NUTRI',
  'RELATORIO_DOWNLOAD',
  'PESO_LOG',
  'REFEICAO_LOG'
] as const;

export function isCapability(code: string){ return CAPABILITY_CODES.includes(code as any); }
export function isLimitKey(key: string){ return PLAN_LIMIT_KEYS.includes(key as any); }