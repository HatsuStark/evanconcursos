import { describe, expect, it } from 'vitest';
import { theoryGoal } from '../domain/scheduler.ts';
import { equalIncidence, measureIncidence, planPicks, searchFilters } from './map.ts';

const tally = (picks: string[]) => picks.reduce<Record<string, number>>((m, a) => ({ ...m, [a]: (m[a] ?? 0) + 1 }), {});

describe('theoryGoal', () => {
  it('fica entre 5 e 10 questões, qualquer que seja o tempo', () => {
    expect([30, 60, 90, 120, 240].map(theoryGoal)).toEqual([5, 5, 8, 10, 10]);
  });
});

describe('planPicks', () => {
  it('passa por todos os assuntos antes de repetir, do mais ao menos cobrado', () => {
    const inc = [{ assunto: 'raro', total: 5 }, { assunto: 'comum', total: 500 }, { assunto: 'médio', total: 50 }];
    expect(planPicks(inc, new Map(), 3)).toEqual(['comum', 'médio', 'raro']);
  });
  it('depois da primeira passada, o mais cobrado recebe mais', () => {
    const inc = [{ assunto: 'comum', total: 300 }, { assunto: 'raro', total: 100 }];
    expect(tally(planPicks(inc, new Map(), 8))).toEqual({ comum: 6, raro: 2 });
  });
  it('assunto ainda sem questão respondida vem primeiro, mesmo sendo o menos cobrado', () => {
    const inc = [{ assunto: 'Comum', total: 300 }, { assunto: 'Raro', total: 10 }];
    expect(planPicks(inc, new Map([['comum', 4]]), 1)).toEqual(['Raro']);
  });
  it('conta o que já foi respondido, sem diferenciar acento e caixa', () => {
    const inc = [{ assunto: 'Prisão', total: 100 }, { assunto: 'Fiança', total: 100 }];
    expect(planPicks(inc, new Map([['prisao', 3], ['fianca', 1]]), 2)).toEqual(['Fiança', 'Fiança']);
  });
  it('assunto sem questões na banca ainda recebe a primeira passada', () => {
    expect(planPicks([{ assunto: 'a', total: 100 }, { assunto: 'b', total: 0 }], new Map(), 2)).toEqual(['a', 'b']);
  });
  it('sem assuntos, não escolhe nada', () => {
    expect(planPicks([], new Map(), 5)).toEqual([]);
  });
});

describe('measureIncidence', () => {
  const filter = { materia: 'Direito Penal', assuntos: ['a', 'b'], how: '' };
  it('mede na banca do edital', async () => {
    const calls: Record<string, string>[] = [];
    const r = await measureIncidence(async (p) => { calls.push(p); return p.assunto === 'a' ? 10 : 0; }, filter, 'FGV');
    expect(r).toEqual([{ assunto: 'a', total: 10 }, { assunto: 'b', total: 0 }]);
    expect(calls.every((c) => c.banca === 'FGV')).toBe(true);
  });
  it('sem nenhuma questão na banca, usa o total das outras', async () => {
    const r = await measureIncidence(async (p) => (p.banca ? 0 : 7), filter, 'FGV');
    expect(r).toEqual([{ assunto: 'a', total: 7 }, { assunto: 'b', total: 7 }]);
  });
  it('Atualidades fica em partes iguais, sem gastar créditos', async () => {
    let calls = 0;
    const r = await measureIncidence(async () => { calls++; return 1; }, { ...filter, materia: 'Atualidades' }, 'FGV');
    expect(r).toEqual(equalIncidence(['a', 'b']));
    expect(calls).toBe(0);
  });
});

describe('searchFilters', () => {
  it('cada filtro aponta para o seu assunto, banca antes das outras', () => {
    expect(searchFilters({ materia: 'M', assuntos: ['a'], how: '' }, 'FGV').map((f) => [f.key, f.assunto])).toEqual([['b:a', 'a'], ['*:a', 'a']]);
  });
});
