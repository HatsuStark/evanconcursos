// Ciclo de estudos: o plano vira uma fila na ordem do cronograma, sem dias fixos. As datas só servem para medir o ritmo
// até a prova: o que já deveria estar feito hoje, contra o que foi feito.
export interface CycleTask { date: string; kind: string; done_at: string | null }

const studyTasks = <T extends CycleTask>(tasks: T[]) => tasks.filter((t) => t.kind !== 'exam');

// Espera as tarefas em ordem de data e posição, como vêm do plano ativo.
export const cycleQueue = <T extends CycleTask>(tasks: T[]) => studyTasks(tasks).filter((t) => !t.done_at);

export function cycleProgress(tasks: CycleTask[], today: string) {
  const all = studyTasks(tasks), done = all.filter((t) => t.done_at);
  return {
    total: all.length, done: done.length,
    behind: all.filter((t) => !t.done_at && t.date < today).length,
    ahead: done.filter((t) => t.date > today).length,
  };
}
