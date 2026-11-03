import { describe, expect, it } from 'vitest';
import { applyBoardEvidence, boardSample, guideCacheKey, guidePrompt, lawKeys, pickSimilarGuide, roleSpecific, topicKeys, trimReview, clipText, REVIEW_LIMITS, unlistedLaws, verifyGuide, type BoardQuestion, type Guide } from './guide.ts';

const law = [{ ref: 'CP, art. 312', text: 'x'.repeat(100) }, { ref: 'CP, art. 313', text: 'y'.repeat(80) }];
const base = { depth: 'completa' as const, subject: 'Direito Penal', banca: 'VUNESP', topics: ['Peculato', 'Concussão'], law };

const question = (assunto: string, enunciado = 'Enunciado'): BoardQuestion => ({ assunto, ano: 2024, enunciado, alternativas: ['A) um', 'B) dois'] });
const guide: Guide = {
  titulo: 'T', introducao: 'I', objetivos: [], esquema: [], secoes: [{ titulo: 'S', prioridade: 'alta', texto: 'X', exemplos: [], como_banca_cobra: 'Cobra a letra do art. 999 do CP.' }],
  quadros: [], legislacao: [], memorizar: [], pontos_banca: [], pegadinhas: [], resumo: [], questoes: [], perguntas: [], depende_legislacao: false,
};
const promptBase = { depth: 'completa' as const, banca: 'VUNESP', cargo: 'Escrevente', subject: 'Direito Penal', title: 'Peculato', topics: ['Peculato'], law: [] };

describe('como a banca cobra', () => {
  it('a amostra passa por todos os assuntos e respeita o limite', () => {
    const qs = [question('a', '1'), question('a', '2'), question('a', '3'), question('b', '4'), question('c', '5')];
    expect(boardSample(qs, 4).map((q) => q.enunciado)).toEqual(['1', '4', '5', '2']);
    expect(boardSample(qs, 50)).toHaveLength(5);
    expect(boardSample([])).toEqual([]);
  });
  it('sem questões reais, o texto da IA é descartado e não há perfil', () => {
    const r = applyBoardEvidence(guide, 'VUNESP', 0);
    expect(r.secoes[0]!.como_banca_cobra).toBe('');
    expect(r.perfil_banca).toBeNull();
  });
  it('com questões reais, guarda o texto, a banca e o tamanho da amostra', () => {
    const r = applyBoardEvidence(guide, 'VUNESP', 8);
    expect(r.secoes[0]!.como_banca_cobra).toBe(guide.secoes[0]!.como_banca_cobra);
    expect(r.perfil_banca).toEqual({ banca: 'VUNESP', questoes: 8 });
  });
  it('o prompt só pede o perfil quando recebe questões', () => {
    expect(guidePrompt(promptBase)).toContain('deixe vazio em todas as seções');
    const p = guidePrompt({ ...promptBase, boardQuestions: [question('Peculato', 'Sobre o peculato')] });
    expect(p).toContain('Sobre o peculato');
    expect(p).not.toContain('deixe vazio em todas as seções');
  });
  it('artigo citado no perfil também passa pela conferência', () => {
    expect(verifyGuide(guide, []).unverified).toContain('CP, art. 999');
  });
});

describe('reaproveitamento de apostilas', () => {
  it('chave não depende do título nem da ordem/acentos dos tópicos', () => {
    expect(guideCacheKey(base)).toBe(guideCacheKey({ ...base, topics: ['concussao', 'PECULATO'], law: [...law].reverse() }));
    expect(guideCacheKey(base)).not.toBe(guideCacheKey({ ...base, depth: 'revisao' }));
    expect(guideCacheKey(base)).not.toBe(guideCacheKey({ ...base, topics: ['Peculato'] }));
  });
  it('acha apostila semelhante (mesmos artigos, tópicos parecidos) e recusa as diferentes', () => {
    const t = { topics: topicKeys(['Peculato', 'Concussão', 'Corrupção passiva']), law: lawKeys(law) };
    const cands = [
      { topic_keys: topicKeys(['Peculato']), sources: ['CP, art. 327'] },                      // outros artigos
      { topic_keys: topicKeys(['Peculato', 'Concussão']), sources: lawKeys(law) },              // serve
      { topic_keys: topicKeys(['Furto', 'Roubo']), sources: lawKeys(law) },                     // tópicos diferentes
    ];
    expect(pickSimilarGuide(t, cands)).toBe(1);
    expect(pickSimilarGuide(t, [cands[0]!, cands[2]!])).toBe(-1);
  });
  it('sessões de temas diferentes no mesmo tópico do edital não dividem apostila', () => {
    const topics = ['Estatuto SP e Lei de Improbidade'], sources = ['Lei 8.429/92, art. 9'];
    const ingresso = 'Ingresso e Exercício: Conceito, provimento, posse e exercício (Lei 10.261/68, arts. 1º a 14)';
    const improbidade = 'Improbidade Administrativa: Enriquecimento ilícito e declaração de bens (Lei 8.429/92, arts. 9º e 13)';
    expect(guideCacheKey({ ...base, topics, title: ingresso })).not.toBe(guideCacheKey({ ...base, topics, title: improbidade }));
    const keys = { topics: topicKeys(topics), law: sources }, stored = { title: improbidade, topic_keys: topicKeys(topics), sources };
    expect(pickSimilarGuide({ ...keys, title: ingresso }, [stored])).toBe(-1);
    expect(pickSimilarGuide({ ...keys, title: 'Improbidade Administrativa: enriquecimento ilícito e bens' }, [stored])).toBe(0);
  });
  it('"provimento" como forma de ingresso não é norma; com número, é', () => {
    expect(unlistedLaws('Provimento e Vacância: posse e provimento')).toEqual([]);
    expect(unlistedLaws('Provimento CG 50/89')).toEqual(['Provimento CG 50/89']);
    expect(unlistedLaws('Estatuto (Lei 10.261/68)')).toEqual(['Lei 10.261/68']);
  });
  it('sem lei, só reaproveita com tópicos quase iguais', () => {
    const t = { topics: topicKeys(['Crase', 'Regência verbal']), law: [] };
    expect(pickSimilarGuide(t, [{ topic_keys: topicKeys(['Regência verbal', 'Crase']), sources: [] }])).toBe(0);
    expect(pickSimilarGuide(t, [{ topic_keys: topicKeys(['Crase']), sources: [] }])).toBe(-1);
  });
});

describe('cargo nas apostilas', () => {
  const t = { ...base, title: 'Atribuições do Cargo: rotina funcional', topics: ['Principais atribuições do cargo.'] };
  it('tema do cargo não é reaproveitado entre cargos; tema comum é', () => {
    expect(roleSpecific(t)).toBe(true);
    expect(guideCacheKey({ ...t, cargo: 'Agente Escolar' })).not.toBe(guideCacheKey({ ...t, cargo: 'Agente de Segurança Escolar' }));
    expect(guideCacheKey({ ...base, cargo: 'Agente Escolar' })).toBe(guideCacheKey({ ...base, cargo: 'Agente de Segurança Escolar' }));
  });
  it('o prompt leva as atribuições do edital e avisa dos outros cargos', () => {
    const p = guidePrompt({ ...promptBase, cargo: 'Agente Escolar', duties: 'Executar a limpeza e a conservação das instalações', otherRoles: ['Agente de Segurança Escolar'] });
    expect(p).toContain('Executar a limpeza e a conservação das instalações');
    expect(p).toContain('Agente de Segurança Escolar');
    expect(p).toMatch(/não use atribuições/);
  });
});

describe('revisão curta', () => {
  const many = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
  const big: Guide = {
    ...guide, objetivos: many(5, String), esquema: many(6, (i) => ({ topico: String(i), itens: ['a'] })),
    secoes: many(5, (i) => ({ titulo: String(i), prioridade: 'alta' as const, texto: 'p1\n\np2\n\np3', exemplos: ['e1', 'e2'], como_banca_cobra: '' })),
    quadros: many(2, () => ({ titulo: 'q', colunas: ['a', 'b'], linhas: [] })), legislacao: many(6, (i) => ({ ref: String(i), comentario: 'c' })),
    memorizar: many(12, String), pontos_banca: many(7, String), pegadinhas: many(7, String), resumo: many(12, String),
    questoes: many(5, () => ({ enunciado: 'e', alternativas: [], gabarito: 'C', comentario: 'c' })), perguntas: many(6, () => ({ pergunta: 'p', resposta: 'r' })),
  };
  it('trimReview aplica os tetos, corta parágrafos e exemplos', () => {
    const r = trimReview(big);
    expect(r.secoes).toHaveLength(REVIEW_LIMITS.secoes);
    expect(r.secoes[0]!.texto).toBe('p1\n\np2');
    expect(r.secoes[0]!.exemplos).toEqual(['e1']);
    expect(r.legislacao).toHaveLength(REVIEW_LIMITS.legislacao);
    expect(r.resumo).toHaveLength(REVIEW_LIMITS.resumo);
    expect(r.questoes).toHaveLength(REVIEW_LIMITS.questoes);
    expect(JSON.stringify(r).length).toBeLessThan(JSON.stringify(big).length * 0.7);
  });
  it('apostila antiga sem os campos novos continua sem eles', () => {
    const { objetivos: _o, quadros: _q, memorizar: _m, questoes: _qs, ...old } = big;
    const r = trimReview(old as Partial<Guide>);
    expect(r.objetivos).toBeUndefined();
    expect(r.secoes).toHaveLength(REVIEW_LIMITS.secoes);
  });
  it('clipText corta no fim da frase, ou na palavra com reticências', () => {
    expect(clipText('Curto.', 50)).toBe('Curto.');
    expect(clipText('Primeira frase aqui. Segunda frase bem mais longa que passa.', 30)).toBe('Primeira frase aqui.');
    expect(clipText('palavras sem ponto nenhum que passam do limite', 20)).toBe('palavras sem ponto…');
  });
  it('o prompt da revisão pede os tetos', () => {
    const p = guidePrompt({ ...promptBase, depth: 'revisao' });
    expect(p).toMatch(/um terço/);
    expect(p).toMatch(new RegExp(`legislacao: até ${REVIEW_LIMITS.legislacao}`));
  });
});
