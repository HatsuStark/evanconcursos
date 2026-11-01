// Plano sem prazo, para edital com prova já realizada: depois da primeira volta pelo conteúdo, o plano segue em rodadas
// curtas, montadas sem IA quando a fila acaba. Os dias vão para as matérias pelo peso no edital e pela fraqueza; dentro de
// cada matéria, vêm primeiro as sessões mais fracas e há mais tempo sem ver.
import { DAY_MS, parseYmd, ymd } from './dates.ts';
import { apportion, interleave, theoryGoal } from './scheduler.ts';
import { subjectWeakness, type NewTask, type ReplanAttempt, type ReplanSubject, type ReplanTask } from './replan.ts';

const REFILL_BELOW = 3; // tarefas pendentes que disparam a próxima rodada
const ROUND_DAYS = 14;
const MAX_SUBJECT_SHARE = 0.4; // a matéria mais fraca não toma a rodada inteira
const SIMULADO_EVERY_DAYS = 28;
const MASTERY_ATTEMPTS = 10, MASTERY_RATE = 0.8, MASTERY_MAX_DAYS = 60;
const SESSION_MIN_ATTEMPTS = 5; // abaixo disso, vale o desempenho da matéria
const WEAK_ABOVE = 0.32; // acima da fraqueza de quem ainda não tem dados (0,3), a tarefa é reforço, e não manutenção
const MIN_SUBJECT_SESSIONS = 4, MAX_FIRST_PASS_DAYS = 180;

export type RoundAttempt = ReplanAttempt & { session_id?: string | null };
export interface RoundSummary { weakest: { subjectId: string; rate: number }[]; simulado: boolean; tasks: number }

export const isOpenEnded = (examDate: string | null | undefined, today: string) => !!examDate && examDate < today;

const studyDaysPerWeek = (hours: number[]) => hours.filter((h) => h > 0).length;
// Semanas para terminar as sessões de teoria pendentes, no ritmo informado no questionário.
export const firstPassWeeks = (pending: number, hours: number[]) => Math.ceil(pending / Math.max(1, studyDaysPerWeek(hours)));

// Fim fictício da primeira volta, só para o calendário dimensionar as sessões pelo tamanho do conteúdo: não vira prazo.
export function openEndDate(startDate: string, hours: number[], weeklyReview: boolean, topicsPerSubject: number[]) {
  const days = Math.min(MAX_FIRST_PASS_DAYS, topicsPerSubject.reduce((a, t) => a + Math.max(MIN_SUBJECT_SESSIONS, t), 0));
  const perWeek = studyDaysPerWeek(hours), theoryPerWeek = Math.max(1, perWeek - (weeklyReview && perWeek >= 4 ? 1 : 0));
  const end = parseYmd(startDate) ?? new Date();
  end.setDate(end.getDate() + (Math.ceil(days / theoryPerWeek) + 1) * 7);
  return ymd(end);
}

interface SessionInfo { id: string; subjectId: string; title: string; keyword: string; lastSeen: number; recent: boolean[] }

// Sessões já estudadas, com a última vez em que apareceram e os resultados, do mais recente ao mais antigo.
function studiedSessions(tasks: ReplanTask[], attempts: RoundAttempt[]) {
  const sessions = new Map<string, SessionInfo>();
  for (const t of tasks) {
    if (!t.session_id || !t.subject_id || !t.done_at) continue;
    const seen = new Date(t.done_at).getTime(), s = sessions.get(t.session_id);
    if (s) s.lastSeen = Math.max(s.lastSeen, seen);
    else sessions.set(t.session_id, { id: t.session_id, subjectId: t.subject_id, title: t.title.replace(/^(Reforço|Manutenção|Revisão): /, ''), keyword: t.keyword, lastSeen: seen, recent: [] });
  }
  for (const a of [...attempts].sort((x, y) => y.created_at.localeCompare(x.created_at))) {
    const s = a.session_id ? sessions.get(a.session_id) : undefined;
    if (!s) continue;
    s.recent.push(a.correct);
    s.lastSeen = Math.max(s.lastSeen, new Date(a.created_at).getTime());
  }
  return [...sessions.values()];
}

const isMastered = (s: { recent: boolean[]; lastSeen: number }, now: number) => {
  const last = s.recent.slice(0, MASTERY_ATTEMPTS);
  return last.length >= MASTERY_ATTEMPTS && last.filter(Boolean).length / last.length >= MASTERY_RATE && now - s.lastSeen <= MASTERY_MAX_DAYS * DAY_MS;
};

// Parte do edital dominada, de 0 a 100: toda matéria vale pelo peso, dividido entre as suas sessões. O que fica
// muito tempo sem ver ou passa a dar erro deixa de contar.
export function masteryPercent(tasks: ReplanTask[], subjects: ReplanSubject[], attempts: RoundAttempt[], now = Date.now()) {
  const allSessions = new Map<string, string>();
  for (const t of tasks) if (t.kind === 'theory' && t.session_id && t.subject_id) allSessions.set(t.session_id, t.subject_id);
  const perSubject = new Map<string, number>();
  for (const subject of allSessions.values()) perSubject.set(subject, (perSubject.get(subject) ?? 0) + 1);
  const weight = new Map(subjects.map((s) => [s.id, s.weight]));
  const total = [...perSubject.keys()].reduce((a, id) => a + (weight.get(id) ?? 0), 0);
  if (!total) return 0;
  const mastered = studiedSessions(tasks, attempts).filter((s) => allSessions.has(s.id) && isMastered(s, now))
    .reduce((a, s) => a + (weight.get(s.subjectId) ?? 0) / perSubject.get(s.subjectId)!, 0);
  return Math.round((mastered / total) * 100);
}

export const needsRound = (tasks: ReplanTask[]) => tasks.filter((t) => !t.done_at && t.kind !== 'exam').length < REFILL_BELOW && tasks.some((t) => t.session_id && t.done_at);

// Dias de estudo da rodada, a partir de hoje, com as horas do questionário.
function roundDays(today: string, hours: number[]) {
  const start = parseYmd(today)!, out: { date: string; minutes: number; week: number }[] = [];
  for (let i = 0; i < ROUND_DAYS; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const h = hours[(d.getDay() + 6) % 7] ?? 0;
    if (h > 0) out.push({ date: ymd(d), minutes: Math.round(h * 60), week: Math.floor(i / 7) });
  }
  return out;
}

export function nextRound(p: { tasks: ReplanTask[]; subjects: ReplanSubject[]; attempts: RoundAttempt[]; hours: number[]; weeklyReview: boolean; totalQuestions: number; today: string; now?: number }) {
  const now = p.now ?? Date.now(), sessions = studiedSessions(p.tasks, p.attempts), days = roundDays(p.today, p.hours);
  if (!sessions.length || !days.length) return null;
  const out: NewTask[] = [], free = new Set(days);

  const lastSimulado = p.tasks.filter((t) => t.kind === 'simulado').map((t) => t.date).sort().pop();
  const simulado = p.totalQuestions > 0 && days.length > 1 && (!lastSimulado || (parseYmd(p.today)!.getTime() - parseYmd(lastSimulado)!.getTime()) / DAY_MS >= SIMULADO_EVERY_DAYS);
  if (simulado) {
    const day = days.filter((d) => d.week === 1).reduce((a, b) => (b.minutes > (a?.minutes ?? 0) ? b : a), undefined as (typeof days)[number] | undefined) ?? days[days.length - 1]!;
    free.delete(day);
    out.push({ date: day.date, position: 0, minutes: day.minutes, kind: 'simulado', subjectId: null, sessionId: null, title: 'Simulado completo + correção', keyword: '', goal: p.totalQuestions, fromTaskId: null });
  }
  if (p.weeklyReview) {
    for (const week of [0, 1]) {
      const list = [...free].filter((d) => d.week === week);
      if (list.length < 4) continue;
      const day = list[list.length - 1]!;
      free.delete(day);
      out.push({ date: day.date, position: 0, minutes: day.minutes, kind: 'weekly_review', subjectId: null, sessionId: null, title: 'Revisão da semana e caderno de erros', keyword: '', goal: 0, fromTaskId: null });
    }
  }

  const weak = subjectWeakness(p.subjects, p.attempts, now);
  const bySession = subjectWeakness(sessions.map((s) => ({ id: s.id, weight: 1 })), p.attempts.map((a) => ({ ...a, subject_id: a.session_id ?? null })), now);
  const weaknessOf = (s: SessionInfo) => (s.recent.length >= SESSION_MIN_ATTEMPTS ? bySession.get(s.id)!.weakness : weak.get(s.subjectId)?.weakness ?? 0.3);
  // Dentro da matéria, primeiro a sessão mais fraca e há mais tempo sem ver.
  const score = (s: SessionInfo) => (0.5 + 2 * weaknessOf(s)) * Math.min(3, Math.max(0.5, (now - s.lastSeen) / DAY_MS / 14));

  // Os dias vão para as matérias pelo peso e pela fraqueza. Toda matéria aparece; só se faltarem dias, ficam as há mais tempo sem estudo.
  const slots = [...free];
  const lastSeen = (id: string) => Math.max(...sessions.filter((s) => s.subjectId === id).map((s) => s.lastSeen));
  const active = p.subjects.filter((x) => sessions.some((s) => s.subjectId === x.id)).sort((a, b) => lastSeen(a.id) - lastSeen(b.id)).slice(0, slots.length);
  const demand = active.map((x) => x.weight * (0.5 + 2 * (weak.get(x.id)?.weakness ?? 0.3)));
  const counts = slots.length ? apportion(demand, slots.length) : [];
  const cap = Math.max(1, Math.ceil(slots.length * MAX_SUBJECT_SHARE));
  for (let i = 0; i < counts.length; i++) {
    while (counts[i]! > cap) {
      const others = counts.map((c, k) => (k !== i && c < cap ? k : -1)).filter((k) => k >= 0);
      if (!others.length) break;
      const to = others.reduce((a, b) => (demand[b]! / counts[b]! > demand[a]! / counts[a]! ? b : a));
      counts[i]!--; counts[to]!++;
    }
  }
  const used = new Set<string>();
  interleave(counts).forEach((subjectIndex, k) => {
    const slot = slots[k]!, subjectId = active[subjectIndex]!.id, own = sessions.filter((s) => s.subjectId === subjectId);
    // Com poucas sessões para o tamanho da rodada, a matéria repete em vez de deixar o dia vazio.
    if (own.every((s) => used.has(s.id))) for (const s of own) used.delete(s.id);
    const pick = own.filter((s) => !used.has(s.id)).reduce((a, b) => (score(b) > score(a) ? b : a));
    used.add(pick.id);
    out.push({
      date: slot.date, position: 0, minutes: slot.minutes, kind: 'consolidation', subjectId, sessionId: pick.id,
      title: `${weaknessOf(pick) > WEAK_ABOVE ? 'Reforço' : 'Manutenção'}: ${pick.title}`, keyword: pick.keyword, goal: theoryGoal(slot.minutes), fromTaskId: null,
    });
  });
  out.sort((a, b) => a.date.localeCompare(b.date));

  const weakest = p.subjects.filter((s) => (weak.get(s.id)?.count ?? 0) >= SESSION_MIN_ATTEMPTS && weak.get(s.id)!.weakness > WEAK_ABOVE)
    .map((s) => ({ subjectId: s.id, rate: 1 - weak.get(s.id)!.weakness })).sort((a, b) => a.rate - b.rate).slice(0, 2)
    .map((w) => ({ subjectId: w.subjectId, rate: Math.round(w.rate * 100) }));
  const summary: RoundSummary = { weakest, simulado, tasks: out.length };
  return { supersede: [] as string[], tasks: out, summary: { round: summary } };
}
