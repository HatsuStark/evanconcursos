import { describe, expect, it } from 'vitest';
import { isNextPart, partOf, wholeThemeTitle } from './parts.ts';
import { generateSchedule, keepPartsClose, PART_MAX_GAP, type ScheduleConfig, type ScheduleInput } from './scheduler.ts';

describe('partes de um tema', () => {
  it('lê a parte do título, com ou sem artigos e matéria', () => {
    expect(partOf('Atos processuais (parte 2 de 3): NSCGJ, arts. 310 a 315')).toEqual({ head: 'atos processuais', part: 2, parts: 3 });
    expect(partOf('Direito Civil: Contratos (parte 1 de 2)')).toEqual({ head: 'direito civil: contratos', part: 1, parts: 2 });
    expect(partOf('Contratos')).toBeNull();
    expect(partOf('Aprofundamento: Contratos (parte 1 de 2)')).toBeNull();
    expect(partOf('Direito Civil: Revisão com questões: Contratos (parte 1 de 2)')).toBeNull();
    expect(partOf('Contratos (parte 3 de 2)')).toBeNull();
  });
  it('parte seguinte: mesmo tema, mesmo total, número +1', () => {
    expect(isNextPart('Contratos (parte 1 de 2): CC, arts. 421 a 450', 'Contratos (parte 2 de 2): CC, arts. 451 a 480')).toBe(true);
    expect(isNextPart('Contratos (parte 2 de 2)', 'Contratos (parte 1 de 3)')).toBe(false);
    expect(isNextPart('Contratos (parte 1 de 2)', 'Posse (parte 2 de 2)')).toBe(false);
    expect(isNextPart('Contratos (parte 1 de 3)', 'Contratos (parte 3 de 3)')).toBe(false);
  });
  it('título do tema inteiro só na última parte', () => {
    expect(wholeThemeTitle('Atos processuais (parte 3 de 3): NSCGJ, arts. 1137 a 1247')).toBe('Atos processuais (partes 1 a 3)');
    expect(wholeThemeTitle('Atos processuais (parte 1 de 3): NSCGJ, art. 196')).toBe('Atos processuais (parte 1 de 3): NSCGJ, art. 196');
  });
});

describe('keepPartsClose', () => {
  // Um bloco por dia: dia k = bloco k.
  const one = (n: number) => ({ day: Array.from({ length: n }, (_, k) => k), groups: Array.from({ length: n }, (_, k) => [k]) });

  it('traz a parte 2 para perto da 1, trocando com outra matéria', () => {
    const { day, groups } = one(8);
    const assign = [0, 1, 1, 1, 1, 1, 0, 1];
    keepPartsClose(day, groups, assign, [['A (parte 1 de 2)', 'A (parte 2 de 2)'], ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']]);
    expect(assign.indexOf(0, 1)).toBe(1);
    expect(assign.filter((s) => s === 0)).toHaveLength(2); // total de cada matéria igual
  });
  it('não desmonta a sequência de partes de outra matéria', () => {
    const { day, groups } = one(6);
    const assign = [0, 1, 1, 0, 0, 0];
    const before = [...assign];
    keepPartsClose(day, groups, assign, [['A1', 'A2', 'A3', 'A4'], ['B (parte 1 de 2)', 'B (parte 2 de 2)']]);
    expect(assign).toEqual(before);
  });
  it('nunca põe a parte no dia de outro bloco da mesma matéria', () => {
    const day = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4], groups = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]];
    const assign = [0, 1, 0, 1, 1, 2, 1, 2, 0, 2];
    keepPartsClose(day, groups, assign, [['A1', 'A (parte 1 de 2)', 'A (parte 2 de 2)'], ['B1', 'B2', 'B3', 'B4'], ['C1', 'C2', 'C3']]);
    for (const g of groups) expect(new Set(g.map((k) => assign[k])).size).toBe(g.length);
    const a = assign.flatMap((s, k) => (s === 0 ? [day[k]!] : []));
    expect(a[2]! - a[1]!).toBeLessThanOrEqual(PART_MAX_GAP);
    expect(a[2]! - a[1]!).toBeGreaterThanOrEqual(1);
  });
});

describe('cronograma com partes', () => {
  const plan: ScheduleInput = {
    startDate: '2026-11-04', examDate: '2027-05-16',
    subjects: [{ name: 'Direito Penal', core: true }, { name: 'Processo Penal', core: true }, { name: 'Português', core: false }, { name: 'Informática', core: false }],
  };
  // Mesma quantidade de sessões que o cronograma dá a cada matéria, com alguns temas em 2 ou 3 partes (como a montagem
  // faz com lei longa). Informática pesa pouco: sem a correção, a parte 2 cairia uma ou duas semanas depois da 1.
  const base: ScheduleConfig = {
    hours: [2, 2, 2, 2, 2, 4, 0], weeklyReview: true,
    subjects: {
      'Direito Penal': { weight: 5, level: 0, topics: [], questions: 20 },
      'Processo Penal': { weight: 5, level: 1, topics: [], questions: 15 },
      'Português': { weight: 3, level: 2, topics: [], questions: 15 },
      'Informática': { weight: 1, level: 3, topics: [], questions: 5 },
    },
  };
  const counts = generateSchedule(plan, base).summary.perSubject;
  const sessions = (name: string, n: number) => Array.from({ length: n }, (_, j) => (j % 5 === 1 ? `Tema ${j} (parte 1 de 2)` : j % 5 === 2 ? `Tema ${j - 1} (parte 2 de 2)` : `${name} ${j}`));
  const cfg: ScheduleConfig = { ...base, subjects: Object.fromEntries(counts.map((c) => [c.name, { ...base.subjects[c.name]!, topics: sessions(c.name, c.days) }])) };
  it('cada parte cai até 3 dias de estudo depois da anterior, nunca no mesmo dia', () => {
    const days = generateSchedule(plan, cfg).weeks.flatMap((w) => w.days).filter((d) => d.blocks.length);
    const seen = new Map<string, { text: string; day: number }>();
    let checked = 0;
    days.forEach((d, i) => d.blocks.filter((b) => b.kind === 'theory').forEach((b) => {
      const last = seen.get(b.subject);
      if (last && isNextPart(last.text, b.text)) {
        checked++;
        expect(i - last.day, `${b.text}`).toBeGreaterThanOrEqual(1);
        expect(i - last.day, `${b.text}`).toBeLessThanOrEqual(PART_MAX_GAP);
      }
      seen.set(b.subject, { text: b.text, day: i });
    }));
    expect(checked).toBeGreaterThan(0);
  });
});
