// Modelo, chave e preço das avaliações. MODEL=claude-haiku-5-5 troca o provedor sem mexer no .env
// (sem MODEL, vale GEMINI_MODEL do .env). Preços em USD por milhão de tokens, tabela vigente até 31/12/2026.
const PRICES: Record<string, { inputPerMtokUsd: number; outputPerMtokUsd: number }> = {
  'gemini-3.8-flash': { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 },
  // Pedidos de até 100 mil tokens; acima disso, 0,50 / 2,50.
  'claude-haiku-5-5': { inputPerMtokUsd: 0.10, outputPerMtokUsd: 0.50 },
  'claude-sonnet-5-5': { inputPerMtokUsd: 2.00, outputPerMtokUsd: 10.00 },
};

export function evalAi(env: Record<string, string | undefined>) {
  const model = process.env.MODEL || env.GEMINI_MODEL || 'gemini-3.8-flash';
  const claude = model.startsWith('claude-');
  const apiKey = claude ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY;
  if (!apiKey) throw new Error(`Preencha ${claude ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'} no .env.`);
  const price = PRICES[model];
  if (!price) throw new Error(`Sem preço cadastrado para ${model} em evals/ai.ts.`);
  console.log(`modelo: ${model}`);
  return { model, apiKey, price };
}
