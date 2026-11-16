// Simulado do conteúdo estudado. Prova com o edital inteiro antes de o estudante ter visto boa parte dele mede chute, não
// aprendizado, e desanima. Até a cobertura do edital (sessões de teoria concluídas, pesadas pelas questões de cada
// matéria na prova) chegar a FULL_COVERAGE, o simulado do concurso só cobra os assuntos já estudados: cada matéria entra
// com a parte da prova proporcional ao que dela já foi visto (cumulativo, mistura matérias e puxa conteúdo antigo).
// Depois disso, vale a prova completa da banca.

export const FULL_COVERAGE = 0.7;
// Abaixo disto o simulado vira um bloco de questões: sobe até este tamanho, sem passar da prova inteira de cada matéria.
export const MIN_STUDIED_QUESTIONS = 20;

export type SimuladoScope = 'estudado' | 'edital';

// count: questões da matéria na prova (já no tamanho escolhido); total: sessões de teoria da matéria no plano; done:
// sessões dela concluídas.
export interface ScopeSubject { key: string; count: number; total: number; done: number }

export const subjectCoverage = (s: Pick<ScopeSubject, 'total' | 'done'>) => (s.total > 0 ? Math.min(1, s.done / s.total) : 0);

// Parte da prova já estudada (0–1), pelas questões de cada matéria.
export function examCoverage(subjects: ScopeSubject[]) {
  const total = subjects.reduce((a, s) => a + s.count, 0);
  return total ? subjects.reduce((a, s) => a + s.count * subjectCoverage(s), 0) / total : 0;
}

// Pedido explícito vale; sem ele, o conteúdo estudado até a cobertura chegar a FULL_COVERAGE.
export const chooseScope = (coverage: number, asked?: unknown): SimuladoScope =>
  asked === 'estudado' || asked === 'edital' ? asked : coverage >= FULL_COVERAGE ? 'edital' : 'estudado';

// Questões de cada matéria no simulado do conteúdo estudado: a parte da prova já vista (matéria não começada fica fora).
// Somando menos que `min`, sobe todas na mesma proporção, sem passar das questões da matéria na prova.
export function studiedCounts(subjects: ScopeSubject[], min = MIN_STUDIED_QUESTIONS): Map<string, number> {
  const seen = subjects.filter((s) => subjectCoverage(s) > 0);
  const raw = seen.map((s) => ({ s, n: s.count * subjectCoverage(s) }));
  const sum = raw.reduce((a, r) => a + r.n, 0);
  const cap = seen.reduce((a, s) => a + s.count, 0);
  const scale = sum > 0 && sum < min ? Math.min(min, cap) / sum : 1;
  const out = new Map<string, number>();
  for (const { s, n } of raw) out.set(s.key, Math.min(s.count, Math.max(1, Math.round(n * scale))));
  return out;
}
