// Datas locais no formato AAAA-MM-DD (sem fuso: o cronograma trabalha com dias do calendário).
export const DAY_MS = 864e5;

const pad2 = (n: number) => String(n).padStart(2, '0');

export const ymd = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function parseYmd(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export const startOfDay = (ts: number): number => new Date(ts).setHours(0, 0, 0, 0);
