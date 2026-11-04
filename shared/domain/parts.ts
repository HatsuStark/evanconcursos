// Tema dividido em partes ("Atos processuais (parte 2 de 3): NSCGJ, arts. 310 a 315"). As partes são estudadas perto
// uma da outra, a revisão espaçada conta o tema inteiro e cada parte começa recordando a anterior.
// Aprofundamento, revisão com questões e revisão de conteúdo já visto não fazem parte da sequência.
export interface PartOf { head: string; part: number; parts: number }

const PART_RE = /^(.*?)\s*\(parte (\d+) de (\d+)\)/i;
// No cronograma, o título pode vir depois do nome da matéria ("Direito Civil: Aprofundamento: ...").
const NOT_A_PART = /(^|: )(Aprofundamento|Revisão com questões|Revisão): /i;

export function partOf(title: string): PartOf | null {
  if (NOT_A_PART.test(title)) return null;
  const m = PART_RE.exec(title);
  if (!m) return null;
  const part = Number(m[2]), parts = Number(m[3]);
  if (!(part >= 1 && parts >= 2 && part <= parts)) return null;
  return { head: m[1]!.trim().toLowerCase(), part, parts };
}

// `next` é a parte seguinte de `prev` no mesmo tema.
export function isNextPart(prev: string, next: string) {
  const a = partOf(prev), b = partOf(next);
  return !!a && !!b && a.head === b.head && a.parts === b.parts && b.part === a.part + 1;
}

// Título do tema inteiro, para a revisão da última parte: "Atos processuais (partes 1 a 3)".
export function wholeThemeTitle(title: string) {
  const m = PART_RE.exec(title), p = partOf(title);
  if (!m || !p || p.part !== p.parts) return title;
  return `${m[1]!.trim()} (partes 1 a ${p.parts})`;
}
