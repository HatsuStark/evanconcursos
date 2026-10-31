// Edital verticalizado: cada tópico do edital com o que já foi estudado e o desempenho nas questões das suas sessões.
// Sessão com vários tópicos conta as questões para todos eles, porque a tentativa aponta para a sessão, não para o tópico.
// Por isso os totais da matéria somam por sessão, sem contar a mesma questão duas vezes.
import { CORE_BOOST, WEAK } from './adaptive.ts';

export const WEAK_MIN_ATTEMPTS = 5; // com menos questões, o percentual ainda não diz muito
const FOCUS_SIZE = 5;

export interface VSubject { id: string; name: string; is_core: boolean; weight: number; questions: number }
export interface VTopic { id: string; subject_id: string; text: string }
export interface VSession { id: string; subject_id: string; plan_version_id: string; topic_ids: string[] }
export interface VTask { id: string; session_id: string | null; date: string; done_at: string | null; superseded_in_version: string | null }
export interface VStat { session_id: string; total: number; correct: number; last_at: string }

export type TopicStatus = 'estudado' | 'andamento' | 'pendente' | 'fora';
export interface TopicRow {
  id: string; subjectId: string; subjectName: string; text: string; status: TopicStatus;
  sessionsDone: number; sessionsTotal: number; attempts: number; correct: number; acc: number | null; lastSeen: string | null;
  weak: boolean; noQuestions: boolean; taskId: string | null;
}
export interface SubjectRow extends VSubject { topics: TopicRow[]; studied: number; attempts: number; correct: number; acc: number | null }

const ratio = (correct: number, total: number) => (total ? correct / total : null);
const latest = (dates: (string | null | undefined)[]) => dates.reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);

export function buildVerticalized(input: { subjects: VSubject[]; topics: VTopic[]; sessions: VSession[]; tasks: VTask[]; stats: VStat[]; activeVersionId: string | null }) {
  const statBySession = new Map(input.stats.map((s) => [s.session_id, s]));
  const tasksBySession = new Map<string, VTask[]>();
  for (const t of input.tasks) if (t.session_id) tasksBySession.set(t.session_id, [...(tasksBySession.get(t.session_id) ?? []), t]);
  const sessionsByTopic = new Map<string, VSession[]>();
  for (const s of input.sessions) for (const id of s.topic_ids) sessionsByTopic.set(id, [...(sessionsByTopic.get(id) ?? []), s]);

  const subjects: SubjectRow[] = input.subjects.map((subject) => {
    const topics = input.topics.filter((t) => t.subject_id === subject.id).map((t): TopicRow => {
      const all = sessionsByTopic.get(t.id) ?? [], active = all.filter((s) => s.plan_version_id === input.activeVersionId);
      const tasks = all.flatMap((s) => tasksBySession.get(s.id) ?? []), stats = all.flatMap((s) => statBySession.get(s.id) ?? []);
      const isDone = (s: VSession) => (tasksBySession.get(s.id) ?? []).some((x) => x.done_at);
      const sessionsDone = active.filter(isDone).length, attempts = stats.reduce((n, s) => n + s.total, 0), correct = stats.reduce((n, s) => n + s.correct, 0);
      const started = attempts > 0 || all.some(isDone);
      const status: TopicStatus = active.length && sessionsDone === active.length ? 'estudado' : started ? 'andamento' : active.length ? 'pendente' : 'fora';
      const acc = ratio(correct, attempts);
      // Atalho: a próxima tarefa aberta do tópico; sem nenhuma, a última feita.
      const activeIds = new Set(active.map((s) => s.id));
      const open = tasks.filter((x) => !x.done_at && !x.superseded_in_version && x.session_id && activeIds.has(x.session_id)).sort((a, b) => a.date.localeCompare(b.date));
      const done = tasks.filter((x) => x.done_at).sort((a, b) => b.date.localeCompare(a.date));
      return {
        id: t.id, subjectId: subject.id, subjectName: subject.name, text: t.text, status, sessionsDone, sessionsTotal: active.length, attempts, correct, acc,
        lastSeen: latest([...stats.map((s) => s.last_at), ...tasks.map((x) => x.done_at)]),
        weak: attempts >= WEAK_MIN_ATTEMPTS && acc! < WEAK,
        noQuestions: status === 'estudado' && attempts === 0,
        taskId: open[0]?.id ?? done[0]?.id ?? null,
      };
    });
    const own = input.sessions.filter((s) => s.subject_id === subject.id).flatMap((s) => statBySession.get(s.id) ?? []);
    const attempts = own.reduce((n, s) => n + s.total, 0), correct = own.reduce((n, s) => n + s.correct, 0);
    return { ...subject, topics, studied: topics.filter((t) => t.status === 'estudado').length, attempts, correct, acc: ratio(correct, attempts) };
  });

  const topics = subjects.flatMap((s) => s.topics);
  const attempts = subjects.reduce((n, s) => n + s.attempts, 0), correct = subjects.reduce((n, s) => n + s.correct, 0);
  // Onde focar: erra mais em matéria que pesa mais.
  const bySubject = new Map(subjects.map((s) => [s.id, s]));
  const priority = (t: TopicRow) => { const s = bySubject.get(t.subjectId)!; return (1 - t.acc!) * s.weight * (s.is_core ? CORE_BOOST : 1); };
  const focus = topics.filter((t) => t.weak).sort((a, b) => priority(b) - priority(a)).slice(0, FOCUS_SIZE);
  return {
    subjects, focus,
    summary: {
      total: topics.length, studied: topics.filter((t) => t.status === 'estudado').length, inProgress: topics.filter((t) => t.status === 'andamento').length,
      weak: topics.filter((t) => t.weak).length, noQuestions: topics.filter((t) => t.noQuestions).length, attempts, correct, acc: ratio(correct, attempts),
    },
  };
}
