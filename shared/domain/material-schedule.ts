// Onde uma apostila entra no cronograma: os trechos dela agrupados por matéria e sessão, com as tarefas de cada sessão.
export interface RangeInput { id: string; session_id: string; page_from: number; page_to: number; manual: boolean; title: string; subject: string }
export interface TaskInput { id: string; session_id: string | null; date: string; kind: string; done_at: string | null }

export interface ScheduleSession<R, T> { sessionId: string; title: string; ranges: R[]; tasks: T[] }
export interface ScheduleSubject<R, T> { name: string; sessions: ScheduleSession<R, T>[] }
export interface MaterialSchedule<R, T> {
  subjects: ScheduleSubject<R, T>[];
  outside: ScheduleSession<R, T>[]; // sessões de uma versão antiga do plano, sem tarefas no cronograma atual
  totals: { sessions: number; tasks: number; done: number };
  next: T | null;
}

const byDate = <T extends TaskInput>(a: T, b: T) => a.date.localeCompare(b.date);
// Primeiro o que ainda falta, na ordem do cronograma; sessão toda feita vai para o fim.
const pending = <T extends TaskInput>(s: { tasks: T[] }) => s.tasks.find((t) => !t.done_at)?.date ?? '9999';

export function materialSchedule<R extends RangeInput, T extends TaskInput>(ranges: R[], tasks: T[]): MaterialSchedule<R, T> {
  const sessions = new Map<string, ScheduleSession<R, T> & { subject: string }>();
  for (const r of ranges) {
    const s = sessions.get(r.session_id);
    if (s) s.ranges.push(r);
    else sessions.set(r.session_id, { sessionId: r.session_id, title: r.title, subject: r.subject, ranges: [r], tasks: [] });
  }
  for (const t of tasks) if (t.session_id) sessions.get(t.session_id)?.tasks.push(t);

  const placed = [...sessions.values()].filter((s) => s.tasks.length);
  for (const s of placed) s.tasks.sort(byDate);
  placed.sort((a, b) => pending(a).localeCompare(pending(b)) || (a.tasks[0]!.date).localeCompare(b.tasks[0]!.date));

  const subjects: ScheduleSubject<R, T>[] = [];
  for (const { subject, ...s } of placed) {
    const group = subjects.find((g) => g.name === subject);
    if (group) group.sessions.push(s);
    else subjects.push({ name: subject, sessions: [s] });
  }
  const all = placed.flatMap((s) => s.tasks);
  return {
    subjects,
    outside: [...sessions.values()].filter((s) => !s.tasks.length).map(({ subject: _subject, ...s }) => s),
    totals: { sessions: placed.length, tasks: all.length, done: all.filter((t) => t.done_at).length },
    next: all.filter((t) => !t.done_at).sort(byDate)[0] ?? null,
  };
}
