// Shared questionnaire completeness logic
// Mantido consistente com regras originais do upsertQuestionnaire.
export interface QuestionnaireDataShape {
  category?: string | null;
  answers?: Record<string, any>;
  submitted_at?: string | null;
}

function parseNumeric(val: any): number | null {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const n = parseFloat(String(val).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function isQuestionnaireComplete(data: QuestionnaireDataShape): boolean {
  if (!data || !data.submitted_at) return false;
  const answers = data.answers || {};
  const category = data.category as string | null | undefined;
  if (!category) return false;

  const hasAllNumeric = (...keys: string[]) => keys.every(k => {
    const v = answers[k];
    const num = parseNumeric(v);
    return num !== null && Math.abs(num) > 0;
  });

  switch (category) {
    case 'adulto':
    case 'esportiva':
      return hasAllNumeric('peso', 'altura', 'idade');
    case 'gestante':
      return hasAllNumeric('peso_antes', 'peso_atual');
    case 'infantil':
      return hasAllNumeric('peso_atual', 'altura', 'idade');
    default:
      // Categorias futuras: considerar submetido suficiente
      return true;
  }
}
