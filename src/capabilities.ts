// Canonical capability codes (scaffolding only; all unused for now)
// When implementing real features, extend here but keep codes stable.
export const CAPABILITIES = {
  DIETA_EDIT: 'DIETA_EDIT',
  DIETA_VIEW: 'DIETA_VIEW',
  AGUA_LOG: 'AGUA_LOG',
  CONSULTA_AGENDAR: 'CONSULTA_AGENDAR',
  CONSULTA_CANCELAR: 'CONSULTA_CANCELAR',
  CHAT_NUTRI: 'CHAT_NUTRI',
  RELATORIO_DOWNLOAD: 'RELATORIO_DOWNLOAD'
} as const;

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES];
