// Edital todo visto antes da reta final. Pelo ritmo das últimas 3 semanas (sessões de teoria concluídas comparadas com
// as que o plano pede no mesmo tempo), estima quantas sessões de conteúdo novo ficariam para depois do início da reta
// final. Faltando, propõe priorizar: em cada matéria, os temas mais cobrados primeiro e os aprofundamentos depois do
// conteúdo novo, nos mesmos dias (a matéria de cada dia não muda), para o que sobrar no fim ser o menos cobrado.
import { DAY_MS, parseYmd } from './dates.ts';
import { isDeepTitle, priorityOrder } from './priority.ts';
import type { NewTask, ReplanTask } from './replan.ts';

export const PACE_DAYS = 21, MIN_PACE_DAYS = 7, COVERAGE_WARN_DAYS = 56, MIN_PACE = 0.2;
// Começo da reta final: o primeiro dia de pente-fino ou de revisão final.
const FINAL = ['pente_fino', 'final_review'];

export interface Coverage {
  finalStart: string; pending: number; slots: number; done: number; expected: number; pace: number; missing: number;
  atRisk: { subjectId: string | null; title: string }[];
}

const days = (a: string, b: string) => Math.round((parseYmd(b)!.getTime() - parseYmd(a)!.getTime()) / DAY_MS);

// null: sem reta final, longe dela (mais de 8 semanas), pouco histórico ou tudo cabe.
export function coverage(tasks: ReplanTask[], incidence: Map<string, number>, today: string, now = Date.now()): Coverage | null {
  const finalStart = tasks.filter((t) => FINAL.includes(t.kind)).map((t) => t.date).sort()[0];
  if (!finalStart || finalStart <= today || days(today, finalStart) > COVERAGE_WARN_DAYS) return null;
  const theory = tasks.filter((t) => t.kind === 'theory');
  const first = theory.map((t) => t.date).sort()[0];
  if (!first) return null;
  const window = Math.min(PACE_DAYS, days(first, today));
  if (window < MIN_PACE_DAYS) return null;
  const since = now - window * DAY_MS;
  const done = theory.filter((t) => t.done_at && new Date(t.done_at).getTime() >= since).length;
  const ahead = theory.filter((t) => !t.done_at && t.date >= today && t.date < finalStart);
  // O que o plano pede em `window` dias, pela agenda daqui até a reta final.
  const expected = Math.max(1, Math.round((ahead.length * window) / Math.max(1, days(today, finalStart))));
  const pace = Math.max(MIN_PACE, Math.min(1, done / expected));
  const content = (t: ReplanTask) => !isDeepTitle(t.title);
  const pending = theory.filter((t) => !t.done_at && content(t));
  const slots = Math.floor(ahead.length * pace);
  const missing = pending.length - slots;
  if (missing <= 0) return null;
  // Os que ficariam para o fim depois de priorizar: os menos cobrados de cada matéria, do fim da agenda.
  const after = prioritizeTasks(tasks, incidence, today).order;
  const atRisk = after.filter(content).slice(-Math.min(3, missing)).map((t) => ({ subjectId: t.subject_id, title: t.title }));
  return { finalStart, pending: pending.length, slots, done, expected, pace, missing, atRisk };
}

// Mesmos dias de teoria pendentes de cada matéria, com as sessões na ordem de prioridade. `order`: as sessões na nova
// sequência de dias.
export function prioritizeTasks(tasks: ReplanTask[], incidence: Map<string, number>, today: string) {
  const pending = tasks.filter((t) => t.kind === 'theory' && !t.done_at && t.session_id).sort((a, b) => a.date.localeCompare(b.date) || (a.position ?? 0) - (b.position ?? 0));
  const bySubject = new Map<string, ReplanTask[]>();
  for (const t of pending) bySubject.set(t.subject_id ?? '', [...(bySubject.get(t.subject_id ?? '') ?? []), t]);
  const supersede: string[] = [], out: NewTask[] = [], placed: { date: string; task: ReplanTask }[] = [];
  const moved = new Map<string, ReplanTask>(); // sessão antiga do dia → sessão que vai para ele
  for (const list of bySubject.values()) {
    const next = priorityOrder(list.map((t) => ({ title: t.title, incidence: incidence.get(t.session_id!) ?? 2 })), { deepLast: true }).map((i) => list[i]!);
    list.forEach((slot, i) => {
      const s = next[i]!;
      placed.push({ date: slot.date, task: s });
      if (s.id === slot.id) return;
      moved.set(slot.session_id!, s);
      supersede.push(slot.id);
      out.push({ date: slot.date, position: slot.position ?? 0, minutes: slot.minutes, kind: 'theory', subjectId: s.subject_id, sessionId: s.session_id,
        title: s.title, keyword: s.keyword, goal: slot.goal_questions, fromTaskId: s.id });
    });
  }
  // Lei seca: os dias de releitura ficam; cada um relê a sessão que agora é estudada no dia de teoria que ele seguia.
  for (const t of tasks) {
    const s = t.kind === 'lei_seca' && !t.done_at && t.session_id && t.date >= today ? moved.get(t.session_id) : undefined;
    if (!s) continue;
    supersede.push(t.id);
    out.push({ date: t.date, position: t.position ?? 0, minutes: t.minutes, kind: 'lei_seca', subjectId: s.subject_id, sessionId: s.session_id,
      title: `Lei seca: ${s.title}`.slice(0, 300), keyword: s.keyword, goal: 0, fromTaskId: t.id });
  }
  const order = placed.sort((a, b) => a.date.localeCompare(b.date)).map((p) => p.task);
  return { supersede, tasks: out, order };
}

// Gravado na versão do plano (summary.replan) ao priorizar.
export interface PrioritizeSummary { kind: 'prioritize'; at: string; moved: number; missing: number }
