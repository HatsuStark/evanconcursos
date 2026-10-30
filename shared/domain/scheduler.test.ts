import { describe, expect, it } from 'vitest';
import { apportion, generateSchedule, interleave, splitTopics, topicKeyword, WEAK_MARK, type ScheduleConfig, type ScheduleInput } from './scheduler.ts';

describe('utilitários', () => {
  it('apportion: proporcional, mínimo 1, soma exata', () => {
    expect(apportion([3, 1], 8)).toEqual([6, 2]);
    expect(apportion([5, 1, 1], 3)).toEqual([1, 1, 1]);
    expect(apportion([2, 3, 5], 17).reduce((a, b) => a + b, 0)).toBe(17);
    expect(() => apportion([1, 1, 1], 2)).toThrow(/menos dias/);
  });
  it('interleave: respeita as contagens', () => {
    const seq = interleave([3, 1, 1]);
    expect(seq).toHaveLength(5);
    expect(seq.filter((x) => x === 0)).toHaveLength(3);
  });
  it('splitTopics e topicKeyword', () => {
    expect(splitTopics('1. Inquérito policial. 2. Ação penal: espécies. 3 – Prisão em flagrante; Liberdade provisória'))
      .toEqual(['Inquérito policial', 'Ação penal: espécies', 'Prisão em flagrante', 'Liberdade provisória']);
    expect(splitTopics('Lei 8.112/90 e alterações\nNoções de informática')).toEqual(['Lei 8.112/90 e alterações', 'Noções de informática']);
    expect(topicKeyword('Noções de direito constitucional: princípios')).toBe('direito constitucional');
  });
});

describe('generateSchedule', () => {
  const plan: ScheduleInput = {
    startDate: '2026-11-04', examDate: '2027-05-16',
    subjects: [{ name: 'Direito Penal', core: true }, { name: 'Processo Penal', core: true }, { name: 'Português', core: false }, { name: 'Informática', core: false }],
  };
  const cfg: ScheduleConfig = {
    hours: [2, 2, 2, 2, 2, 4, 0], weeklyReview: true,
    subjects: {
      'Direito Penal': { weight: 5, level: 0, topics: splitTopics('1. Aplicação da lei penal. 2. Crime: conceito e classificação. 3. Tipicidade. 4. Ilicitude. 5. Culpabilidade. 6. Crimes contra a pessoa. 7. Crimes contra o patrimônio. 8. Crimes contra a administração pública') },
      'Processo Penal': { weight: 5, level: 1, topics: ['Inquérito policial', 'Ação penal', 'Prisões', 'Provas'] },
      'Português': { weight: 3, level: 2, topics: [] },
      'Informática': { weight: 1, level: 3, topics: ['Windows', 'Word', 'Excel'] },
    },
  };
  const r = generateSchedule(plan, cfg), days = r.weeks.flatMap((w) => w.days);
  const theory = days.filter((d) => d.subject && d.keyword !== WEAK_MARK);
  const count = (n: string) => theory.filter((d) => d.subject === n).length;

  it('calendário: semanas a partir da segunda, prova e véspera', () => {
    expect(r.startDate).toBe('2026-11-02');
    expect(days.length % 7).toBe(0);
    const examIdx = days.findIndex((d) => d.text === 'PROVA');
    expect(examIdx % 7).toBe(6); // 16/05/2027 é domingo
    expect(days[examIdx - 1]!.text).toBe('Revisão leve e descanso');
    expect(days.slice(0, 2).every((d) => d.hours === 0)).toBe(true);
    expect(days.every((d, i) => i % 7 !== 6 || d.hours === 0)).toBe(true);
  });
  it('conteúdo: pesos, ordem dos tópicos, simulados e consolidação', () => {
    expect(count('Direito Penal')).toBeGreaterThan(count('Português'));
    expect(count('Português')).toBeGreaterThan(count('Informática'));
    const dp = theory.filter((d) => d.subject === 'Direito Penal').map((d) => d.text);
    expect(dp.findIndex((t) => t.includes('Tipicidade'))).toBeLessThan(dp.findIndex((t) => t.includes('patrimônio')));
    expect(days.some((d) => d.text.startsWith('Simulado'))).toBe(true);
    expect(days.some((d) => d.keyword === WEAK_MARK && d.goal > 0)).toBe(true);
  });
  it('todo tópico do edital aparece em alguma tarefa de teoria', () => {
    for (const [name, s] of Object.entries(cfg.subjects))
      for (const t of s.topics) expect(theory.some((d) => d.subject === name && d.text.includes(t)), `${name}: ${t}`).toBe(true);
  });
  it('determinístico e com erros claros', () => {
    expect(generateSchedule(plan, cfg).weeks).toEqual(r.weeks);
    expect(() => generateSchedule({ ...plan, examDate: '' }, cfg)).toThrow(/data da prova/);
    expect(() => generateSchedule({ ...plan, examDate: '2026-11-06' }, cfg)).toThrow(/Pouco tempo/);
    expect(() => generateSchedule(plan, { ...cfg, hours: [0, 0, 0, 0, 0, 0, 0] })).toThrow(/horas/);
  });
});
