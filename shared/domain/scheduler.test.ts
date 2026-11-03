import { describe, expect, it } from 'vitest';
import {
  apportion, apportionWithFloors, generateSchedule, horizonShares, interleave, splitDay, splitTopics, subjectDemand, topicKeyword, WEAK_MARK,
  type Block, type ScheduleConfig, type ScheduleInput,
} from './scheduler.ts';

describe('utilitários', () => {
  it('apportion: proporcional, mínimo 1, soma exata', () => {
    expect(apportion([3, 1], 8)).toEqual([6, 2]);
    expect(apportion([5, 1, 1], 3)).toEqual([1, 1, 1]);
    expect(apportion([2, 3, 5], 17).reduce((a, b) => a + b, 0)).toBe(17);
    expect(() => apportion([1, 1, 1], 2)).toThrow(/menos dias/);
  });
  it('apportionWithFloors: garante o mínimo de cada um e soma exata', () => {
    const r = apportionWithFloors([10, 1], [2, 6], 20);
    expect(r.reduce((a, b) => a + b, 0)).toBe(20);
    expect(r[1]).toBeGreaterThanOrEqual(6);
    expect(apportionWithFloors([1, 1], [50, 50], 10).reduce((a, b) => a + b, 0)).toBe(10); // mínimos maiores que o total
  });
  it('interleave: respeita as contagens', () => {
    const seq = interleave([3, 1, 1]);
    expect(seq).toHaveLength(5);
    expect(seq.filter((x) => x === 0)).toHaveLength(3);
  });
  it('splitDay: blocos de 1 h a 1h30, até 3, somando o dia', () => {
    expect(splitDay(60)).toEqual([60]);
    expect(splitDay(120)).toEqual([60, 60]);
    expect(splitDay(180)).toEqual([90, 90]);
    expect(splitDay(240)).toEqual([80, 80, 80]);
    expect(splitDay(600)).toHaveLength(3);
    for (const m of [65, 95, 155, 205]) expect(splitDay(m).reduce((a, b) => a + b, 0)).toBe(m);
    expect(splitDay(120, 20)).toEqual([50, 50]); // lei seca sai dos blocos, que continuam dois
  });
  it('demanda: mais pontos e menos domínio pedem mais tempo; prazo curto pede mais questões', () => {
    expect(subjectDemand({ weight: 3, level: 0, topics: [], questions: 30 })).toBeGreaterThan(subjectDemand({ weight: 3, level: 0, topics: [], questions: 10 }));
    expect(subjectDemand({ weight: 3, level: 0, topics: [], questions: 10 })).toBeGreaterThan(subjectDemand({ weight: 3, level: 3, topics: [], questions: 10 }));
    expect(subjectDemand({ weight: 3, level: 1, topics: [], minPct: 50 })).toBeGreaterThan(subjectDemand({ weight: 3, level: 1, topics: [] }));
    expect(horizonShares(6).reinforce).toBeGreaterThan(horizonShares(20).reinforce);
    expect(horizonShares(20, true)).toEqual({ final: 0, reinforce: 0, simuladoEvery: 0 });
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
  const dpTopics = splitTopics('1. Aplicação da lei penal. 2. Crime: conceito e classificação. 3. Tipicidade. 4. Ilicitude. 5. Culpabilidade. 6. Crimes contra a pessoa. 7. Crimes contra o patrimônio. 8. Crimes contra a administração pública');
  const cfg: ScheduleConfig = {
    hours: [2, 2, 2, 2, 2, 4, 0], weeklyReview: true,
    subjects: {
      'Direito Penal': { weight: 5, level: 0, topics: dpTopics, questions: 20 },
      'Processo Penal': { weight: 5, level: 1, topics: ['Inquérito policial', 'Ação penal', 'Prisões', 'Provas'], questions: 15 },
      'Português': { weight: 3, level: 2, topics: [], questions: 15 },
      'Informática': { weight: 1, level: 3, topics: ['Windows', 'Word', 'Excel'], questions: 5 },
    },
  };
  const r = generateSchedule(plan, cfg), days = r.weeks.flatMap((w) => w.days);
  const blocks = days.flatMap((d) => d.blocks), theory = blocks.filter((b) => b.kind === 'theory');
  const count = (n: string) => theory.filter((b) => b.subject === n).length;
  const studyDays = days.filter((d) => d.kind === 'study');

  it('calendário: semanas a partir da segunda, prova e véspera', () => {
    expect(r.startDate).toBe('2026-11-02');
    expect(days.length % 7).toBe(0);
    const examIdx = days.findIndex((d) => d.kind === 'exam');
    expect(examIdx % 7).toBe(6); // 16/05/2027 é domingo
    expect(days[examIdx - 1]!.kind).toBe('eve');
    expect(days.slice(0, 2).every((d) => d.hours === 0)).toBe(true);
    expect(days.every((d, i) => i % 7 !== 6 || d.hours === 0)).toBe(true);
  });
  it('dia com 2 ou 3 blocos de matérias diferentes, que somam as horas do dia', () => {
    const normal = studyDays.filter((d) => !d.light);
    expect(normal.every((d) => d.blocks.length >= 2)).toBe(true);
    for (const d of studyDays) {
      const subjects = d.blocks.filter((b) => b.kind !== 'lei_seca').map((b) => b.subject);
      expect(new Set(subjects).size, d.blocks.map((b) => b.subject).join(',')).toBe(subjects.length);
      expect(d.blocks.reduce((a, b) => a + b.minutes, 0)).toBe(Math.round(d.hours * 60));
    }
  });
  it('alterna específica e básica no mesmo dia sempre que há bloco de básica', () => {
    const core = new Set(['Direito Penal', 'Processo Penal']), multi = studyDays.filter((d) => d.blocks.length >= 2);
    const mixed = multi.filter((d) => new Set(d.blocks.map((b) => core.has(b.subject))).size === 2).length;
    const basic = multi.flatMap((d) => d.blocks).filter((b) => !core.has(b.subject)).length;
    expect(mixed).toBeGreaterThan(Math.min(multi.length, basic) * 0.85);
  });
  it('tempo pelos pontos e pelo nível; ordem dos tópicos mantida; todo tópico coberto', () => {
    expect(count('Direito Penal')).toBeGreaterThan(count('Português'));
    expect(count('Português')).toBeGreaterThan(count('Informática'));
    const dp = theory.filter((b) => b.subject === 'Direito Penal').map((b) => b.text);
    expect(dp.findIndex((t) => t.includes('Tipicidade'))).toBeLessThan(dp.findIndex((t) => t.includes('patrimônio')));
    for (const [name, s] of Object.entries(cfg.subjects))
      for (const t of s.topics) expect(theory.some((b) => b.subject === name && b.text.includes(t)), `${name}: ${t}`).toBe(true);
  });
  it('questões desde o início: teoria com meta de questões; reforço a partir da 3ª semana', () => {
    expect(theory.every((b) => b.goal >= 5)).toBe(true);
    const firstReinforce = r.weeks.findIndex((w) => w.days.some((d) => d.blocks.some((b) => b.kind === 'consolidation')));
    expect(firstReinforce).toBeGreaterThanOrEqual(2);
    expect(blocks.filter((b) => b.kind === 'consolidation').every((b) => b.keyword === WEAK_MARK && b.goal > 0)).toBe(true);
  });
  it('simulado diagnóstico na 2ª semana, periódicos depois e semanais na reta final', () => {
    const weeksWith = r.weeks.map((w, i) => (w.days.some((d) => d.kind === 'simulado') ? i : -1)).filter((i) => i >= 0);
    expect(weeksWith[0]).toBe(1);
    expect(weeksWith.length).toBeGreaterThanOrEqual(8);
    const finalWeeks = r.weeks.map((w, i) => (w.days.some((d) => d.blocks.some((b) => b.kind === 'final_review')) ? i : -1)).filter((i) => i >= 0);
    expect(finalWeeks.length).toBeGreaterThan(0);
    for (const w of finalWeeks.slice(0, -1)) expect(weeksWith).toContain(w);
  });
  it('semana leve a cada 5, com menos horas', () => {
    const light = r.weeks.filter((w) => w.days.some((d) => d.light));
    expect(light.length).toBeGreaterThan(0);
    expect(light[0]!.title).toMatch(/semana leve/);
    const d = light[0]!.days.find((x) => x.kind === 'study')!;
    expect(d.hours).toBeLessThan(2);
  });
  it('dia curto vira questões e revisão, sem teoria nova', () => {
    const short = generateSchedule(plan, { ...cfg, hours: [2, 2, 2, 2, 0.75, 4, 0] });
    const fri = short.weeks.flatMap((w) => w.days.filter((d, i) => i === 4 && d.kind === 'study' && !d.blocks.some((b) => b.kind === 'final_review')));
    expect(fri.length).toBeGreaterThan(0);
    expect(fri.every((d) => d.blocks.length === 1 && d.blocks[0]!.kind === 'consolidation')).toBe(true);
  });
  it('prazo curto: mais reforço e menos teoria em proporção', () => {
    const near = generateSchedule({ ...plan, examDate: '2026-12-20' }, cfg).summary;
    expect(near.consol / (near.theory + near.consol)).toBeGreaterThan(r.summary.consol / (r.summary.theory + r.summary.consol));
  });
  it('lei seca: relê no dia seguinte e na semana seguinte as sessões que citam lei, abrindo o dia', () => {
    const law = generateSchedule(plan, { ...cfg, lawReading: true, subjects: { ...cfg.subjects, 'Direito Penal': { ...cfg.subjects['Direito Penal']!, lawItems: dpTopics.map((_, i) => i >= 5) } } });
    const ds = law.weeks.flatMap((w) => w.days);
    const reads = ds.flatMap((d, i) => d.blocks.filter((b) => b.kind === 'lei_seca').map((b) => ({ b, i })));
    expect(reads.length).toBeGreaterThan(0);
    for (const { b, i } of reads) {
      expect(b.subject).toBe('Direito Penal');
      expect(b.item).toBeGreaterThanOrEqual(5);
      expect(ds[i]!.blocks[0]).toBe(b);
      const studiedAt = ds.findIndex((d) => d.blocks.some((x: Block) => x.kind === 'theory' && x.subject === 'Direito Penal' && x.item === b.item));
      expect(studiedAt).toBeLessThan(i);
    }
    // Sem sessão com lei, nada de lei seca e nenhuma hora perdida.
    const none = generateSchedule(plan, { ...cfg, lawReading: true });
    expect(none.summary.lawReading).toBe(0);
    for (const d of none.weeks.flatMap((w) => w.days)) expect(d.blocks.reduce((a, b) => a + b.minutes, 0)).toBe(d.kind === 'study' ? Math.round(d.hours * 60) : 0);
  });
  it('determinístico e com erros claros', () => {
    expect(generateSchedule(plan, cfg).weeks).toEqual(r.weeks);
    expect(() => generateSchedule({ ...plan, examDate: '' }, cfg)).toThrow(/data da prova/);
    expect(() => generateSchedule({ ...plan, examDate: '2026-11-06' }, cfg)).toThrow(/Pouco tempo/);
    expect(() => generateSchedule(plan, { ...cfg, hours: [0, 0, 0, 0, 0, 0, 0] })).toThrow(/horas/);
  });
});
