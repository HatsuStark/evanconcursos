// Revisão da semana guiada: monta a sessão a partir dos temas vencidos e do caderno de erros, dentro do tempo do bloco.
// Cada tema vira um passo (cartões da revisão curta e, em seguida, os erros dele); os erros sem tema, ou de temas que
// ficaram para depois, fecham a sessão misturando matérias. O que não cabe continua vencido e entra na próxima semana.

export const THEME_MIN = 4, ERROR_MIN = 1.5;
export const ERRORS_PER_THEME = 5;
const MIN_BUDGET = 30;

export interface WeeklyTheme { id: string; session_id: string | null; due_on: string; last_result: string | null }
export interface WeeklyError { qid: string; session_id: string | null }
export interface WeeklyStep<T> { theme: T; errors: string[] }

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// Prioridade: atraso, resultado da última revisão e quantos erros o tema tem.
export function themeScore(t: WeeklyTheme, errors: number, today: string) {
  return Math.max(0, daysBetween(t.due_on, today)) + (t.last_result === 'esqueci' ? 7 : t.last_result === 'parcial' ? 3 : 0) + 2 * Math.min(errors, ERRORS_PER_THEME);
}

// `errors` em ordem de vencimento (como vêm do caderno). `minutes`: tempo do bloco da revisão semanal.
export function buildWeeklyQueue<T extends WeeklyTheme>(themes: T[], errors: WeeklyError[], minutes: number, today: string) {
  const budget = Math.max(MIN_BUDGET, minutes);
  const bySession = new Map<string, string[]>();
  for (const e of errors) if (e.session_id) bySession.set(e.session_id, [...(bySession.get(e.session_id) ?? []), e.qid]);
  const own = (t: T) => (t.session_id ? bySession.get(t.session_id) ?? [] : []);
  const ranked = themes.map((t) => ({ t, errs: own(t), score: themeScore(t, own(t).length, today) }))
    .sort((a, b) => b.score - a.score || a.t.due_on.localeCompare(b.t.due_on));

  const steps: WeeklyStep<T>[] = [];
  const used = new Set<string>();
  let spent = 0;
  for (const r of ranked) {
    const errs = r.errs.slice(0, ERRORS_PER_THEME), cost = THEME_MIN + errs.length * ERROR_MIN;
    if (steps.length && spent + cost > budget) continue;
    steps.push({ theme: r.t, errors: errs });
    errs.forEach((q) => used.add(q));
    spent += cost;
  }
  const loose: string[] = [];
  for (const e of errors) {
    if (used.has(e.qid) || spent + ERROR_MIN > budget) continue;
    loose.push(e.qid);
    used.add(e.qid);
    spent += ERROR_MIN;
  }
  return {
    steps, loose, minutes: Math.round(spent),
    deferredThemes: themes.length - steps.length,
    deferredErrors: errors.length - used.size,
  };
}
