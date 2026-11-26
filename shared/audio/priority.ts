// Seleção da revisão em áudio: quais temas entram, com quanto tempo e por quê. Conta fixa, sem IA, só com dados reais
// do aplicativo. Referência: 60% recentes, 25% anteriores que pedem reforço, 15% erros persistentes; balde vazio cede o
// tempo aos outros. Os motivos são fatos ("errou 4 de 6 questões"), nunca uma dificuldade presumida.
import { MIN_ATTEMPTS_FOR_DIFFICULTY, MIX, RECENT_DAYS } from './config.ts';

export type Bucket = keyof typeof MIX;

export interface ThemeInput {
  id: string; title: string; subject: string;
  stage: number;               // revisão da vez (1 a 3); 0 = estudado há pouco, sem revisão vencida
  dueOn: string | null;        // vencimento da revisão (AAAA-MM-DD)
  studiedOn: string | null;    // dia em que a teoria foi concluída
  lastResult: 'lembrei' | 'parcial' | 'esqueci' | null;
  attempts: number; wrong: number;
  incidence: number;           // 1 a 3: quanto o tema cai (estimativa do plano)
}
export interface ErrorInput { qid: string; themeId: string | null; times: number; lastAt: string }

export interface PickedTheme extends ThemeInput { bucket: Bucket; minutes: number; reasons: string[]; difficulty: boolean }
export interface Selection { themes: PickedTheme[]; errors: ErrorInput[]; minutes: Record<Bucket, number>; history: boolean }

// Tempo que sobra para conteúdo depois da preparação e da consolidação (minutos).
const FRAME_MIN = (d: number) => (d <= 10 ? 1.5 : d <= 20 ? 3 : 4);
const MIN_THEME_MIN = 2.5, ERROR_MIN = 1;
export const maxThemes = (d: number) => Math.max(2, Math.floor((d - FRAME_MIN(d)) / MIN_THEME_MIN / 1.4));

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const r1 = (n: number) => Math.round(n * 10) / 10;

// Dificuldade só com amostra: menos de 5 questões não diz nada.
export const isDifficult = (t: Pick<ThemeInput, 'attempts' | 'wrong'>) => t.attempts >= MIN_ATTEMPTS_FOR_DIFFICULTY && t.wrong / t.attempts > 0.3;

export function bucketOf(t: ThemeInput, today: string): Bucket {
  if (isDifficult(t)) return 'erros';
  const recent = t.studiedOn !== null && days(t.studiedOn, today) <= RECENT_DAYS;
  if (recent || t.stage <= 1) return 'recentes';
  return 'anteriores';
}

export function reasonsOf(t: ThemeInput, today: string): string[] {
  const out: string[] = [];
  if (t.studiedOn) { const d = days(t.studiedOn, today); out.push(d <= 0 ? 'estudado hoje' : `estudado há ${d} ${d === 1 ? 'dia' : 'dias'}`); }
  if (t.stage >= 1) out.push(`revisão ${t.stage} de 3`);
  if (t.dueOn && days(t.dueOn, today) > 0) out.push(`revisão atrasada ${days(t.dueOn, today)} ${days(t.dueOn, today) === 1 ? 'dia' : 'dias'}`);
  if (t.lastResult === 'esqueci') out.push('na revisão anterior, marcou que esqueceu');
  if (t.lastResult === 'parcial') out.push('na revisão anterior, lembrou em parte');
  if (t.attempts) out.push(`errou ${t.wrong} de ${t.attempts} ${t.attempts === 1 ? 'questão' : 'questões'}${t.attempts < MIN_ATTEMPTS_FOR_DIFFICULTY ? ' (poucas para concluir algo)' : ''}`);
  else out.push('ainda sem questões respondidas');
  if (t.incidence >= 3) out.push('tema muito cobrado (estimativa do plano)');
  return out;
}

// Ordem dentro de cada balde.
function score(t: ThemeInput, b: Bucket, today: string) {
  const late = t.dueOn ? Math.max(0, days(t.dueOn, today)) : 0;
  const result = t.lastResult === 'esqueci' ? 6 : t.lastResult === 'parcial' ? 3 : 0;
  if (b === 'recentes') return -(t.studiedOn ? days(t.studiedOn, today) : 30) + t.incidence + result;
  if (b === 'anteriores') return late + result + 2 * t.incidence;
  return t.wrong / Math.max(1, t.attempts) * 10 + t.wrong + t.incidence;
}

export function selectReview(themes: ThemeInput[], errors: ErrorInput[], duration: number, today: string): Selection {
  const content = duration - FRAME_MIN(duration);
  const grouped: Record<Bucket, ThemeInput[]> = { recentes: [], anteriores: [], erros: [] };
  for (const t of themes) grouped[bucketOf(t, today)].push(t);
  for (const b of Object.keys(grouped) as Bucket[]) grouped[b].sort((x, y) => score(y, b, today) - score(x, b, today) || x.title.localeCompare(y.title));

  // Erros soltos (questões erradas) também usam o balde de erros, mesmo sem tema difícil.
  const looseErrors = [...errors].sort((a, b) => b.times - a.times || b.lastAt.localeCompare(a.lastAt));
  const has: Record<Bucket, boolean> = { recentes: grouped.recentes.length > 0, anteriores: grouped.anteriores.length > 0, erros: grouped.erros.length > 0 || looseErrors.length > 0 };
  const share = (Object.keys(MIX) as Bucket[]).reduce((s, b) => s + (has[b] ? MIX[b] : 0), 0) || 1;
  const minutes = { recentes: 0, anteriores: 0, erros: 0 } as Record<Bucket, number>;
  for (const b of Object.keys(MIX) as Bucket[]) minutes[b] = has[b] ? (content * MIX[b]) / share : 0;

  const cap = maxThemes(duration);
  const picked: PickedTheme[] = [];
  // Erros primeiro: as questões erradas ocupam até metade do balde, o resto vai para os temas difíceis.
  const errorBudget = grouped.erros.length ? minutes.erros / 2 : minutes.erros;
  const pickedErrors = looseErrors.slice(0, Math.floor(errorBudget / ERROR_MIN));
  const themeBudget: Record<Bucket, number> = { ...minutes, erros: minutes.erros - pickedErrors.length * ERROR_MIN };

  for (const b of ['recentes', 'anteriores', 'erros'] as Bucket[]) {
    const room = Math.max(grouped[b].length ? 1 : 0, Math.floor(themeBudget[b] / MIN_THEME_MIN));
    const take = grouped[b].slice(0, Math.min(room, cap - picked.length));
    for (const t of take) picked.push({ ...t, bucket: b, minutes: r1(themeBudget[b] / take.length), reasons: reasonsOf(t, today), difficulty: isDifficult(t) });
  }
  // Tempo de baldes que não acharam tema volta para os escolhidos, sem passar de 2x o previsto (não estica conteúdo).
  const used = picked.reduce((s, t) => s + t.minutes, 0) + pickedErrors.length * ERROR_MIN;
  const spare = content - used;
  if (spare > 0.5 && picked.length) for (const t of picked) t.minutes = r1(Math.min(t.minutes * 2, t.minutes + spare / picked.length));

  return {
    themes: picked, errors: pickedErrors,
    minutes: { recentes: r1(sum(picked, 'recentes')), anteriores: r1(sum(picked, 'anteriores')), erros: r1(sum(picked, 'erros') + pickedErrors.length * ERROR_MIN) },
    history: themes.some((t) => t.attempts > 0 || t.lastResult !== null) || errors.length > 0,
  };
}
const sum = (ts: PickedTheme[], b: Bucket) => ts.filter((t) => t.bucket === b).reduce((s, t) => s + t.minutes, 0);
