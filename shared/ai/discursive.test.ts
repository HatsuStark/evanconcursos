import { describe, expect, it } from 'vitest';
import { countWords, discursiveRules, itemScale, pickSession, promptCacheKey, scoreGrade, verifyPrompt, type DiscursiveGrade, type DiscursivePrompt } from './discursive.ts';

// Textos reais dos editais do TJSP, como a extração gravou.
const OFICIAL = {
  stages: [
    { kind: 'objetiva', description: 'Prova objetiva com 70 questões de múltipla escolha com 5 alternativas, de caráter eliminatório e classificatório.' },
    { kind: 'discursiva', description: 'Prova discursiva com 2 questões sobre Conhecimentos Específicos, de caráter eliminatório.' },
  ],
  notes: [
    'A prova objetiva será avaliada na escala de 0 a 10 pontos, sendo habilitado o candidato que obtiver nota final igual ou superior a 5 pontos no conjunto dos 3 blocos.',
    'A prova discursiva possui 2 questões sobre Conhecimentos Específicos, avaliada de 0 a 40 pontos, com nota mínima de aprovação de 24 pontos (ou 19,2 pontos para vagas reservadas).',
    'As provas objetiva e discursiva serão aplicadas simultaneamente, com duração total de 5 horas.',
  ],
};
const ESCREVENTE = {
  stages: [{ kind: 'discursiva', description: 'Prova discursiva (redação) em texto dissertativo-argumentativo, de caráter eliminatório, avaliada de 0 a 40 pontos.' }],
  notes: ['A prova discursiva (redação) será avaliada na escala de 0 a 40 pontos, exigindo nota mínima de 24 pontos na ampla concorrência e 19,2 pontos para candidatos cotistas (negros, indígenas, quilombolas ou PCD).'],
};

describe('discursiveRules', () => {
  it('lê questões, escala e mínimo do edital do Oficial de Justiça', () => {
    expect(discursiveRules(OFICIAL.stages, OFICIAL.notes)).toEqual({ format: 'questao', items: 2, maxPoints: 40, minPoints: 24, specificOnly: true });
  });
  it('reconhece a redação do Escrevente', () => {
    expect(discursiveRules(ESCREVENTE.stages, ESCREVENTE.notes)).toEqual({ format: 'redacao', items: 1, maxPoints: 40, minPoints: 24, specificOnly: false });
  });
  it('não usa as 70 questões nem a escala da prova objetiva', () => {
    const r = discursiveRules(OFICIAL.stages, OFICIAL.notes.slice(0, 1));
    expect(r).toMatchObject({ items: 2, maxPoints: null, minPoints: null });
  });
  it('devolve null sem discursiva', () => {
    expect(discursiveRules([{ kind: 'objetiva', description: 'Prova objetiva.' }], ['Nota mínima 5 pontos.'])).toBeNull();
    expect(discursiveRules(null, null)).toBeNull();
  });
  it('divide a prova pelo número de questões', () => {
    expect(itemScale({ items: 2, maxPoints: 40, minPoints: 24 })).toEqual({ max: 20, passPct: 60 });
    expect(itemScale({ items: 1, maxPoints: null, minPoints: null })).toEqual({ max: 10, passPct: null });
  });
});

const PROMPT: DiscursivePrompt = {
  titulo: 'Peculato', enunciado: 'Caso.', textos_apoio: [], linhas: 20, resposta_modelo: 'Modelo.',
  espelho: [
    { ponto: 'Tipifica o crime', peso: 3, fundamento: ['CP, art. 312'] },
    { ponto: 'Aponta o sujeito ativo', peso: 1, fundamento: [] },
  ],
};
const LAW = [{ lawKey: 'CP', label: '312', num: 312, suffix: '' }];
const GRADE: DiscursiveGrade = {
  fora_do_tema: false,
  pontos: [{ indice: 0, situacao: 'atendido', comentario: 'Boa tipificação.' }, { indice: 1, situacao: 'parcial', comentario: 'Faltou explicar.' }],
  estrutura: { nota: 8, comentario: 'Bem dividido.' },
  linguagem: { nota: 6, comentario: 'Revise a crase.' },
  trechos: [{ trecho: 'O   servidor\npegou o dinheiro', problema: 'Informal.', sugestao: 'Apropriou-se.' }, { trecho: 'frase que ninguém escreveu', problema: 'x', sugestao: 'y' }],
  pontos_fortes: ['Conclusão clara.'],
  prioridade: 'Explique o sujeito ativo.',
};
const BODY = 'O servidor pegou o dinheiro da repartição, o que configura peculato.';

describe('scoreGrade', () => {
  const base = { format: 'questao' as const, prompt: PROMPT, body: BODY, maxPoints: 20, law: LAW };

  it('calcula a nota pela régua, sem usar nota total da IA', () => {
    const r = scoreGrade(GRADE, base);
    // conteúdo (3×1 + 1×0,5)/4 = 87,5%; total 0,7×87,5 + 0,15×80 + 0,15×60 = 82,25%
    expect(r.pct).toBe(82);
    expect(r.points).toBe(16.5);
    expect(r.report.criterios.conteudo.pct).toBe(88);
  });
  it('usa os pesos da redação', () => {
    const r = scoreGrade(GRADE, { ...base, format: 'redacao' });
    expect(r.pct).toBe(79); // 0,5×87,5 + 0,25×80 + 0,25×60
  });
  it('conta como ausente o ponto que a IA não avaliou', () => {
    const r = scoreGrade({ ...GRADE, pontos: [GRADE.pontos[0]!] }, base);
    expect(r.report.pontos[1]!.situacao).toBe('ausente');
    expect(r.report.criterios.conteudo.pct).toBe(75);
  });
  it('fora do tema zera', () => {
    const r = scoreGrade({ ...GRADE, fora_do_tema: true }, base);
    expect(r.pct).toBe(0);
    expect(r.points).toBe(0);
  });
  it('limita notas fora de 0 a 10', () => {
    const r = scoreGrade({ ...GRADE, estrutura: { nota: 50, comentario: '' }, linguagem: { nota: -3, comentario: '' } }, base);
    expect(r.report.criterios.estrutura.pct).toBe(100);
    expect(r.report.criterios.linguagem.pct).toBe(0);
  });
  it('descarta trecho que não está na resposta e tolera espaços', () => {
    const r = scoreGrade(GRADE, base);
    expect(r.report.trechos.map((t) => t.problema)).toEqual(['Informal.']);
  });
  it('aponta artigo sem fonte citado na correção', () => {
    const r = scoreGrade({ ...GRADE, prioridade: 'Veja o art. 121 do CP e o art. 312 do CP.' }, base);
    expect(r.report.unverified).toEqual(['CP, art. 121']);
  });
});

describe('verifyPrompt', () => {
  it('remove fundamento sem fonte, aponta citação no texto e limita valores', () => {
    const v = verifyPrompt({
      ...PROMPT, linhas: 90, resposta_modelo: 'Conforme o art. 121 do CP.',
      espelho: [{ ponto: 'x', peso: 9, fundamento: ['CP, art. 312', 'CP, art. 999'] }],
    }, LAW);
    expect(v.prompt.espelho[0]).toMatchObject({ peso: 5, fundamento: ['CP, art. 312'] });
    expect(v.prompt.linhas).toBe(40);
    expect(v.unverified).toEqual(['CP, art. 121']);
  });
});

describe('pickSession', () => {
  const s = (id: string, done: boolean, answers: number) => ({ id, subjectId: 's', done, answers });
  it('prefere o estudado e menos treinado', () => {
    expect(pickSession([s('a', false, 0), s('b', true, 2), s('c', true, 0)])?.id).toBe('c');
  });
  it('usa pendente quando nada foi estudado e sorteia nos empates', () => {
    expect(pickSession([s('a', false, 1), s('b', false, 0), s('c', false, 0)], () => 0.99)?.id).toBe('c');
    expect(pickSession([])).toBeNull();
  });
});

describe('promptCacheKey e contagem', () => {
  const input = { format: 'questao' as const, banca: 'VUNESP', subject: 'Direito Penal', topics: ['Peculato'], law: [{ ref: 'CP, art. 312', text: 'x' }] };
  it('muda com o conteúdo e ignora maiúsculas', () => {
    expect(promptCacheKey(input)).toBe(promptCacheKey({ ...input, banca: 'vunesp', topics: ['PECULATO'] }));
    expect(promptCacheKey(input)).not.toBe(promptCacheKey({ ...input, topics: ['Concussão'] }));
  });
  it('a redação não depende da matéria', () => {
    expect(promptCacheKey({ ...input, format: 'redacao' })).toBe(promptCacheKey({ ...input, format: 'redacao', subject: 'x', topics: [] }));
  });
  it('conta palavras', () => { expect(countWords('  uma  resposta\ncurta ')).toBe(3); expect(countWords('')).toBe(0); });
});
