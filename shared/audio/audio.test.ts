import { describe, expect, it } from 'vitest';
import { INTRO_MS, OUTRO_MS } from './config.ts';
import { bucketOf, isDifficult, selectReview, type ThemeInput } from './priority.ts';
import { applyReview, buildBlocks, buildTimeline, checkScript, cleanNarration, cleanQuiz, clampPause, type ReviewScript, type Segment } from './script.ts';
import { romanToInt, speakable } from './speak.ts';

const today = '2026-11-26';
const theme = (over: Partial<ThemeInput> = {}): ThemeInput => ({
  id: 'r1', title: 'Atos administrativos', subject: 'Direito Administrativo', stage: 1, dueOn: today, studiedOn: '2026-11-20',
  lastResult: null, attempts: 0, wrong: 0, incidence: 2, ...over,
});

describe('prioridade', () => {
  it('dificuldade só com pelo menos 5 questões', () => {
    expect(isDifficult({ attempts: 2, wrong: 2 })).toBe(false);
    expect(isDifficult({ attempts: 6, wrong: 3 })).toBe(true);
    expect(isDifficult({ attempts: 10, wrong: 2 })).toBe(false);
  });
  it('balde: recente, anterior, erro', () => {
    expect(bucketOf(theme(), today)).toBe('recentes');
    expect(bucketOf(theme({ stage: 2, studiedOn: '2026-10-01' }), today)).toBe('anteriores');
    expect(bucketOf(theme({ stage: 2, attempts: 8, wrong: 5 }), today)).toBe('erros');
  });
  it('sem histórico: tudo vai para os recentes e não inventa dificuldade', () => {
    const s = selectReview([theme({ id: 'a' }), theme({ id: 'b', title: 'Poderes' })], [], 20, today);
    expect(s.history).toBe(false);
    expect(s.themes.every((t) => t.bucket === 'recentes' && !t.difficulty)).toBe(true);
    expect(s.themes.flatMap((t) => t.reasons)).toContain('ainda sem questões respondidas');
    expect(s.minutes.anteriores).toBe(0);
    expect(s.minutes.recentes).toBeGreaterThan(10);
  });
  it('com histórico: reparte entre os baldes e aponta os fatos', () => {
    const s = selectReview([
      theme({ id: 'a' }),
      theme({ id: 'b', title: 'Licitação', stage: 2, studiedOn: '2026-10-20', dueOn: '2026-11-20', lastResult: 'esqueci' }),
      theme({ id: 'c', title: 'Improbidade', stage: 3, studiedOn: '2026-09-01', attempts: 7, wrong: 4 }),
    ], [{ qid: 'q1', themeId: null, times: 2, lastAt: '2026-11-24' }], 20, today);
    expect(s.themes.map((t) => t.bucket).sort()).toEqual(['anteriores', 'erros', 'recentes']);
    const b = s.themes.find((t) => t.id === 'b')!;
    expect(b.reasons).toContain('na revisão anterior, marcou que esqueceu');
    expect(b.reasons.some((r) => r.startsWith('revisão atrasada 6'))).toBe(true);
    expect(s.themes.find((t) => t.id === 'c')!.reasons).toContain('errou 4 de 7 questões');
    expect(s.errors).toHaveLength(1);
    const total = s.minutes.recentes + s.minutes.anteriores + s.minutes.erros;
    expect(total).toBeGreaterThan(14);
    expect(total).toBeLessThanOrEqual(17.5);
  });
  it('10 minutos cabem poucos temas', () => {
    const many = Array.from({ length: 8 }, (_, i) => theme({ id: `t${i}`, title: `Tema ${i}` }));
    expect(selectReview(many, [], 10, today).themes.length).toBeLessThanOrEqual(2);
    expect(selectReview(many, [], 30, today).themes.length).toBeGreaterThan(3);
  });
  it('poucas questões viram ressalva, não dificuldade', () => {
    const s = selectReview([theme({ attempts: 2, wrong: 2 })], [], 20, today);
    expect(s.themes[0]!.difficulty).toBe(false);
    expect(s.themes[0]!.reasons).toContain('errou 2 de 2 questões (poucas para concluir algo)');
  });
});

const seg = (over: Partial<Segment>): Segment => ({
  id: 'x', tipo: 'explicacao', formato: 'nenhum', texto: 'Texto.', pausa_apos_ms: 800, interpretacao: 'didática', trilha: 'suave', efeito: 'nenhum', referencias: ['M1'], ...over,
});
const script = (segs: Segment[], dur = 60): ReviewScript => ({ versao: '1', titulo: 'T', idioma: 'pt-BR', duracao_alvo_segundos: dur, objetivos: [], capitulos: [{ id: 'C1', titulo: 'Atos', etapa: 'revisao', segmentos: segs }] });
const qa = (q: string, a: string, f: Partial<Segment> = {}) => [seg({ tipo: 'pergunta', formato: 'conceitual', texto: q, pausa_apos_ms: 8000, ...f }), seg({ tipo: 'resposta', texto: a })];

describe('roteiro', () => {
  it('limpa marcação e direções que a voz leria', () => {
    expect(cleanNarration('**Atenção** [pausa] (pausa longa) ao #prazo {x} <b>já</b> 😀')).toBe('Atenção ao prazo já');
  });
  it('pausas ficam na faixa do formato', () => {
    expect(clampPause({ tipo: 'pergunta', formato: 'certo_errado', pausa_apos_ms: 20000 })).toBe(6000);
    expect(clampPause({ tipo: 'pergunta', formato: 'enumeracao', pausa_apos_ms: 2000 })).toBe(10000);
    expect(clampPause({ tipo: 'transicao', formato: 'nenhum', pausa_apos_ms: NaN })).toBe(1000);
  });
  it('pergunta sem resposta sai; referência inexistente cai; ids renumerados', () => {
    const r = checkScript(script([
      ...qa('Quais são os elementos?', 'Competência, finalidade, forma, motivo e objeto.'),
      seg({ tipo: 'pergunta', texto: 'E a pergunta solta?' }),
      seg({ tipo: 'explicacao', referencias: ['M9'] }),
      ...qa('Motivo é o mesmo que motivação?', 'Não.'), ...qa('Certo ou errado: o prazo é de 5 dias.', 'Errado, 10 dias.', { formato: 'certo_errado' }),
    ]), new Set(['M1']));
    const segs = r.script.capitulos[0]!.segmentos;
    expect(segs.some((s) => s.texto.includes('solta'))).toBe(false);
    expect(segs.map((s) => s.id)).toEqual(['s001', 's002', 's003', 's004', 's005', 's006', 's007']);
    expect(segs[2]!.referencias).toEqual([]);
    expect(r.issues.some((i) => i.startsWith('pergunta sem resposta'))).toBe(true);
    expect(r.questions).toBe(3);
    expect(segs[0]!.efeito).toBe('recuperacao');
    expect(segs[0]!.trilha).toBe('reduzida');
    expect(r.ok).toBe(true);
  });
  it('sem perguntas suficientes não vale gerar áudio', () => {
    expect(checkScript(script([seg({}), ...qa('P?', 'R.')]), new Set(['M1'])).ok).toBe(false);
  });
  it('conferência corrige, tira o grave sem correção e reprova se for demais', () => {
    const s = script([seg({ id: 'a', texto: 'Prazo de 5 dias.' }), seg({ id: 'b', texto: 'Inventado.' }), seg({ id: 'c' }), seg({ id: 'd' }), seg({ id: 'e' }), seg({ id: 'f' })]);
    const fixed = applyReview(s, { problemas: [
      { segmento_id: 'a', gravidade: 'grave', motivo: 'prazo', texto_corrigido: 'Prazo de 10 dias.' },
      { segmento_id: 'b', gravidade: 'grave', motivo: 'fora', texto_corrigido: '' },
    ] })!;
    expect(fixed.capitulos[0]!.segmentos.map((g) => g.texto)).toEqual(['Prazo de 10 dias.', 'Texto.', 'Texto.', 'Texto.', 'Texto.']);
    expect(applyReview(s, { problemas: ['a', 'b', 'c'].map((id) => ({ segmento_id: id, gravidade: 'grave' as const, motivo: '', texto_corrigido: '' })) })).toBeNull();
  });
  it('blocos quebram na pergunta e guardam a pausa; linha do tempo soma tudo', () => {
    const s = checkScript(script([seg({ texto: 'Vamos revisar atos.' }), ...qa('Quais são os elementos?', 'São cinco.'), seg({ tipo: 'transicao', texto: 'Agora, poderes.', efeito: 'transicao', pausa_apos_ms: 1500 })]), new Set(['M1'])).script;
    const blocks = buildBlocks(s);
    expect(blocks.map((b) => b.text)).toEqual(['Vamos revisar atos.\nQuais são os elementos?', 'São cinco.\nAgora, poderes.']);
    expect(blocks[0]!.cue).toBe(true);
    expect(blocks[0]!.pauseAfterMs).toBe(8000);
    expect(blocks[0]!.music).toBe('reduzida');
    expect(blocks[1]!.transition).toBe(true);
    const tl = buildTimeline(blocks, [3000, 2000], [{ id: 'C1', titulo: 'Atos' }]);
    expect(tl.blocks[0]!.startMs).toBe(INTRO_MS);
    expect(tl.blocks[1]!.startMs).toBe(INTRO_MS + 3000 + 8000);
    expect(tl.totalMs).toBe(INTRO_MS + 3000 + 8000 + 2000 + OUTRO_MS);
    expect(tl.chapters).toEqual([{ id: 'C1', titulo: 'Atos', startMs: 0 }]);
  });
  it('bloco não passa do tamanho máximo', () => {
    const long = Array.from({ length: 6 }, (_, i) => seg({ id: `l${i}`, texto: 'palavra '.repeat(40) + i }));
    expect(buildBlocks(script(long)).every((b) => b.text.length <= 1000)).toBe(true);
  });
  it('miniavaliação: 4 alternativas distintas, sem repetir pergunta do áudio', () => {
    const q = (enunciado: string, alternativas = ['a', 'b', 'c', 'd'], correta = 1) => ({ enunciado, alternativas, correta, comentario: 'Porque sim.', referencias: ['M1', 'M7'] });
    const r = cleanQuiz([q('Quais são os elementos?'), q('Pergunta nova 1'), q('Pergunta nova 2', ['a', 'a', 'c', 'd']), q('Pergunta nova 3'), q('Pergunta nova 4', ['a', 'b', 'c', 'd'], 7), q('Pergunta nova 5')], ['Quais são os elementos?'], new Set(['M1']));
    expect(r.map((x) => x.enunciado)).toEqual(['Pergunta nova 1', 'Pergunta nova 3', 'Pergunta nova 5']);
    expect(r[0]!.referencias).toEqual(['M1']);
    expect(cleanQuiz([q('só uma')], [], new Set())).toEqual([]);
  });
});

describe('fala', () => {
  it('artigos, parágrafos e incisos', () => {
    expect(speakable('Art. 5º, § 2º, inciso III')).toBe('artigo quinto, parágrafo segundo, inciso 3');
    expect(speakable('art. 37, § único')).toBe('artigo 37, parágrafo único');
    expect(speakable('arts. 312 a 316 do CP')).toBe('artigos 312 a 316 do Código Penal');
    expect(speakable('incisos IV e V')).toBe('incisos 4 e V');
  });
  it('leis, porcentagens, datas e valores', () => {
    expect(speakable('Lei nº 9.784/1999')).toBe('Lei 9.784, de 1999');
    expect(speakable('Lei 8.112/90')).toBe('Lei 8.112, de 1990');
    expect(speakable('multa de 15%')).toBe('multa de 15 por cento');
    expect(speakable('em 05/10/1988')).toBe('em 5 de outubro de 1988');
    expect(speakable('R$ 1.000,00 e R$ 2,50')).toBe('1.000 reais e 2 reais e 50 centavos');
    expect(speakable('Ex.: prazo → 10 dias')).toBe('por exemplo, prazo: 10 dias');
  });
  it('romanos', () => {
    expect(romanToInt('XIV')).toBe(14);
    expect(romanToInt('ABC')).toBeNull();
  });
});
