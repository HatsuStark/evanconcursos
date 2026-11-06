// Modelo de IA de cada função. GUIDE_MODEL (apostila), DISCURSIVE_MODEL (discursiva) e PLAN_MODEL (cronograma) escolhem o
// modelo de cada uma; sem eles, vale GEMINI_MODEL. Modelos "claude-*" usam ANTHROPIC_API_KEY; os demais, GEMINI_API_KEY.
// Edital, questões geradas, triagem, explicação e mnemônico seguem no modelo padrão (avaliação de 06/11/2026: o Haiku
// errou gabaritos e o quadro de provas do edital).
export type AiTask = 'guide' | 'discursive' | 'plan';

export const defaultModel = () => Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
export const keyFor = (model: string) => Deno.env.get(model.startsWith('claude-') ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY') ?? '';

export function aiFor(task: AiTask) {
  const model = Deno.env.get(`${task.toUpperCase()}_MODEL`) || defaultModel();
  return { model, apiKey: keyFor(model) };
}
