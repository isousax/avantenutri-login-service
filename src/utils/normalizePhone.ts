/**
 * Normaliza números de telefone para formato E.164.
 * Regras:
 *  - Remove espaços, hífens, parênteses e outros caracteres não numéricos.
 *  - Se já começa com '+', valida comprimento (8 a 15 dígitos após '+').
 *  - Se não começa com '+':
 *      * Para BR (default): se tiver 10 ou 11 dígitos assume +55.
 *      * Caso comprimento não bata, retorna inválido.
 *  - Remove zeros à esquerda após o DDI quando aplicável.
 */
export interface NormalizePhoneResult {
  ok: boolean;
  normalized?: string;
  reason?: string;
}

export function normalizePhone(raw: string, defaultCountry: 'BR' | 'AUTO' = 'BR'): NormalizePhoneResult {
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  // Mantém '+' inicial temporariamente
  const plus = trimmed.startsWith('+');
  let digits = trimmed.replace(/[^0-9+]/g, '');
  if (plus) {
    // já em formato internacional
    digits = '+' + digits.replace(/[^0-9]/g, '');
    const core = digits.slice(1);
    if (core.length < 8 || core.length > 15) {
      return { ok: false, reason: 'length' };
    }
    // Remove zeros desnecessários após código do país? (heurística leve: não remover, evitar corromper números válidos)
    return { ok: true, normalized: digits };
  }

  // Sem '+' — heurística por país
  const onlyDigits = digits.replace(/[^0-9]/g, '');
  if (!onlyDigits) return { ok: false, reason: 'digits' };

  if (defaultCountry === 'BR') {
    // Telefones BR: 10 ou 11 dígitos após DDD (ex: 11988776655 ou 1133334444)
    if (onlyDigits.length === 10 || onlyDigits.length === 11) {
      const normalized = '+55' + onlyDigits;
      return { ok: true, normalized };
    }
    // Se veio já com 12 ou 13 dígitos e começa com '55', aceita
    if ((onlyDigits.length === 12 || onlyDigits.length === 13) && onlyDigits.startsWith('55')) {
      return { ok: true, normalized: '+' + onlyDigits };
    }
    return { ok: false, reason: 'br_length' };
  }

  // AUTO (futuro): aqui poderíamos aplicar heurísticas por prefixo; por enquanto exigir '+' se não for BR.
  return { ok: false, reason: 'no_plus' };
}

export function phoneErrorMessage(reason?: string): string {
  switch (reason) {
    case 'empty':
      return 'Informe um telefone.';
    case 'digits':
      return 'O telefone informado é inválido.';
    case 'length':
      return 'O telefone internacional deve ter entre 8 e 15 dígitos.';
    case 'br_length':
      return 'Telefone BR deve ter DDD + número (10 ou 11 dígitos).';
    case 'no_plus':
      return 'Inclua o código do país (ex: +55...).';
    default:
      return 'Telefone inválido. Verifique o formato.';
  }
}
