// Prioridade pela cobrança: com pouco tempo, dentro de cada matéria, os temas mais cobrados vêm primeiro, para o
// principal estar garantido se o tempo acabar. Empate fica na ordem do edital; as partes de um tema andam juntas e na
// ordem. Dias de aprofundamento e de revisão com questões ficam onde estão ou, com `deepLast`, vão para depois do
// conteúdo novo (primeira passada antes de aprofundar).
import { isNextPart } from './parts.ts';

// Prazo curto: até 12 semanas de calendário até a prova.
export const RUSH_WEEKS = 12;
const DEEP = /^(.*: )?(Aprofundamento|Revisão com questões): /;
export const isDeepTitle = (title: string) => DEEP.test(title);

export interface Prioritizable { title: string; incidence?: number | null }

// Nova ordem (índices da lista original).
export function priorityOrder(items: Prioritizable[], opts: { deepLast?: boolean } = {}): number[] {
  const deep: number[] = [], units: number[][] = [];
  let last = -1;
  items.forEach((it, i) => {
    if (isDeepTitle(it.title)) { deep.push(i); return; }
    if (last >= 0 && isNextPart(items[last]!.title, it.title)) units[units.length - 1]!.push(i);
    else units.push([i]);
    last = i;
  });
  const weight = (u: number[]) => Math.max(...u.map((i) => items[i]!.incidence ?? 2));
  const content = units.map((u, k) => ({ u, k, w: weight(u) })).sort((a, b) => b.w - a.w || a.k - b.k).flatMap((x) => x.u);
  if (opts.deepLast) return [...content, ...deep];
  const out = [...content];
  for (const i of deep) {
    let at = Math.min(i, out.length);
    while (at > 0 && at < out.length && isNextPart(items[out[at - 1]!]!.title, items[out[at]!]!.title)) at++;
    out.splice(at, 0, i);
  }
  return out;
}

export function prioritize<T extends Prioritizable>(items: T[], opts: { deepLast?: boolean } = {}): T[] {
  return priorityOrder(items, opts).map((i) => items[i]!);
}
