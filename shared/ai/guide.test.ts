import { describe, expect, it } from 'vitest';
import { applyBoardEvidence, boardSample, guideCacheKey, guidePrompt, lawKeys, pickSimilarGuide, roleSpecific, topicKeys, trimReview, clipText, cuePista, guideVersion, REVIEW_LIMITS, unlistedLaws, verifyGuide, type BoardQuestion, Guide, mergeGuide, partialGuide } from './guide.ts';

const law = [{ ref: 'CP, art. 312', text: 'x'.repeat(100) }, { ref: 'CP, art. 313', text: 'y'.repeat(80) }];
const base = { depth: 'completa' as const, subject: 'Direito Penal', banca: 'VUNESP', topics: ['Peculato', 'Concussão'], law };

const question = (assunto: string, enunciado = 'Enunciado'): BoardQuestion => ({ assunto, ano: 2024, enunciado, alternativas: ['A) um', 'B) dois'] });
const guide: Guide = {
  titulo: 'T', introducao: 'I', objetivos: [], esquema: [], secoes: [{ titulo: 'S', prioridade: 'alta', texto: 'X', exemplos: [], como_banca_cobra: 'Cobra a letra do art. 999 do CP.' }],
  quadros: [], legislacao: [], memorizar: [], mnemonicos: [], gatilhos: [], pontos_banca: [], pegadinhas: [], resumo: [], questoes: [], perguntas: [], depende_legislacao: false,
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
    expect(guidePrompt({ ...promptBase, part: 'pratica' })).toContain('cobranca: deixe vazio');
    const p = guidePrompt({ ...promptBase, part: 'pratica', boardQuestions: [question('Peculato', 'Sobre o peculato')] });
    expect(p).toContain('Sobre o peculato');
    expect(p).not.toContain('cobranca: deixe vazio');
    // O texto não usa as questões da banca: ele sai antes delas.
    expect(guidePrompt({ ...promptBase, part: 'texto', boardQuestions: [question('Peculato', 'Sobre o peculato')] })).not.toContain('Sobre o peculato');
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

describe('roleSpecific', () => {
  const r = (title: string, topics: string[] = []) => roleSpecific({ title, topics });
  it('reconhece tema do cargo', () => {
    expect(r('Atribuições do Cargo: rotina funcional')).toBe(true);
    expect(r('Conhecimentos específicos', ['Principais atribuições do cargo.'])).toBe(true);
    expect(r('Rotina de trabalho', ['Atribuições e responsabilidades no atendimento ao público.'])).toBe(true);
    expect(r('Funções e deveres deste cargo')).toBe(true);
  });
  it('não confunde com atribuições de instituição nem com função jurisdicional', () => {
    expect(r('Jurisdição e competência (parte 3 de 4): CPC, arts. 952 a 959; CF, arts. 102, 105', ['Jurisdição: conceito, princípios e características da função jurisdicional.', 'Competência e atribuições do STF e do STJ.'])).toBe(false);
    expect(r('Poder Executivo', ['Atribuições do Presidente da República.'])).toBe(false);
    expect(r('Funções essenciais à Justiça', ['Ministério Público: princípios, garantias e atribuições constitucionais do Ministério Público.'])).toBe(false);
    expect(r('Organização administrativa', ['Atribuições dos órgãos da administração direta.'])).toBe(false);
    expect(r('Lei 8.112/1990', ['Provimento, vacância, remoção, redistribuição e substituição. Acumulação de cargos.'])).toBe(false);
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
  it('trimReview aplica os tetos: sem seções nem questões, mapa, mnemônicos e gatilhos limitados', () => {
    const r = trimReview({ ...big, esquema: many(8, (i) => ({ topico: String(i), itens: many(6, String) })),
      mnemonicos: many(5, () => ({ alvo: 'a', mnemonico: 'm', explicacao: 'e' })), gatilhos: many(9, () => ({ pista: 'p', resposta: 'r' })) });
    expect(r.secoes).toEqual([]);
    expect(r.questoes).toEqual([]);
    expect(r.objetivos).toEqual([]);
    expect(r.esquema).toHaveLength(REVIEW_LIMITS.esquema);
    expect(r.esquema[0]!.itens).toHaveLength(REVIEW_LIMITS.ramoItens);
    expect(r.mnemonicos).toHaveLength(REVIEW_LIMITS.mnemonicos);
    expect(r.gatilhos).toHaveLength(REVIEW_LIMITS.gatilhos);
    expect(r.legislacao).toHaveLength(REVIEW_LIMITS.legislacao);
    expect(r.resumo).toHaveLength(REVIEW_LIMITS.resumo);
    expect(JSON.stringify(r).length).toBeLessThan(JSON.stringify(big).length * 0.7);
  });
  it('apostila antiga sem os campos novos continua sem eles', () => {
    const { objetivos: _o, quadros: _q, memorizar: _m, questoes: _qs, mnemonicos: _mn, gatilhos: _g, ...old } = big;
    const r = trimReview(old as Partial<Guide>);
    expect(r.objetivos).toBeUndefined();
    expect(r.mnemonicos).toBeUndefined();
  });
  it('clipText corta no fim da frase, ou na palavra com reticências', () => {
    expect(clipText('Curto.', 50)).toBe('Curto.');
    expect(clipText('Primeira frase aqui. Segunda frase bem mais longa que passa.', 30)).toBe('Primeira frase aqui.');
    expect(clipText('palavras sem ponto nenhum que passam do limite', 20)).toBe('palavras sem ponto…');
  });
  it('cuePista tira o "se a questão falar em" da pista', () => {
    expect(cuePista('se a questão falar em juízo de admissibilidade')).toBe('Juízo de admissibilidade');
    expect(cuePista('Se o enunciado mencionar que houve posse')).toBe('Houve posse');
    expect(cuePista('Funcionário figura como acionista')).toBe('Funcionário figura como acionista');
  });
  it('o prompt da revisão pede os tetos', () => {
    const p = guidePrompt({ ...promptBase, depth: 'revisao' });
    expect(p).toMatch(/folha de memorização/);
    expect(p).toMatch(/mnemonicos: 1 a 3/);
    expect(p).toMatch(/gatilhos: 4 a 6/);
    expect(p).toMatch(/mapa mental/);
    expect(p).not.toMatch(/questoes: inéditas/);
    const full = guidePrompt({ ...promptBase, part: 'pratica' });
    expect(full).toMatch(/questoes: inéditas/);
    expect(full).not.toMatch(/mnemonicos/);
    expect(guidePrompt({ ...promptBase, part: 'texto' })).not.toMatch(/questoes: inéditas/);
  });
  it('revisão tem versão própria na chave: mudar a revisão não refaz a completa', () => {
    expect(guideCacheKey({ ...base, depth: 'revisao' })).not.toBe(guideCacheKey(base));
    expect(guideVersion('revisao')).not.toBe(guideVersion('completa'));
  });
});

describe('apostila em duas partes', () => {
  const text = {
    titulo: 'Citação', introducao: 'i', objetivos: [], esquema: [], quadros: [], legislacao: [],
    secoes: [
      { titulo: 'Citação pessoal', prioridade: 'alta' as const, texto: 'O oficial entrega o mandado ao réu.', exemplos: [] },
      { titulo: 'Citação por hora certa', prioridade: 'media' as const, texto: 'Quando o réu se oculta, o oficial marca hora.', exemplos: [] },
    ],
  };
  const practice = { memorizar: ['m'], pontos_banca: [], pegadinhas: ['p'], resumo: [], questoes: [], perguntas: [], depende_legislacao: false,
    cobranca: [{ assunto: 'hora certa e ocultação do réu', como: 'Caso prático.' }, { assunto: 'Recursos', como: 'Letra da lei.' }] };
  it('junta texto e prática; "como a banca cobra" vai para a seção do assunto', () => {
    const g = mergeGuide(text, practice);
    expect(g.secoes.map((s) => s.como_banca_cobra)).toEqual(['', 'Caso prático.']);
    expect(g.pegadinhas).toEqual(['p']);
    expect(g.mnemonicos).toEqual([]);
  });
  it('texto pronto antes da prática fica marcado como parcial', () => {
    const g = partialGuide(text);
    expect(g.parcial).toBe(true);
    expect(g.questoes).toEqual([]);
    expect(Guide.safeParse(g).success).toBe(true);
  });
});

describe('apostila em partes', () => {
  it('1ª seção sozinha e as demais em até dois grupos', async () => {
    const { sectionGroups } = await import('./guide.ts');
    expect(sectionGroups(1)).toEqual([[0]]);
    expect(sectionGroups(3)).toEqual([[0], [1], [2]]);
    expect(sectionGroups(6)).toEqual([[0], [1, 2, 3], [4, 5]]);
    expect(sectionGroups(0)).toEqual([]);
  });
  it('as etapas levam o roteiro e pedem só a sua parte', async () => {
    const { guideStage, textFromOutline, partialGuide } = await import('./guide.ts');
    const outline = { titulo: 'Crase', introducao: 'i', objetivos: [], esquema: [], secoes: [
      { titulo: 'Regra geral', prioridade: 'alta' as const, cobre: 'a + a' }, { titulo: 'Casos proibidos', prioridade: 'media' as const, cobre: 'antes de verbo' }] };
    const st = guideStage({ kind: 'secoes', outline, indices: [1] });
    expect(st).toMatch(/1\. Regra geral \(prioridade alta\): a \+ a/);
    expect(st).toMatch(/escreva só a seção 2\. Casos proibidos/);
    expect(st).not.toMatch(/primeira seção/);
    expect(guideStage({ kind: 'secoes', outline, indices: [0] })).toMatch(/primeira seção/);
    expect(guideStage({ kind: 'roteiro' })).toMatch(/Não escreva o texto das seções/);
    const t = textFromOutline(outline);
    expect(t.secoes.map((x) => x.texto)).toEqual(['', '']);
    expect(partialGuide(t, [0, 1])).toMatchObject({ parcial: true, pendentes: [0, 1] });
    expect(partialGuide(t)).not.toHaveProperty('pendentes');
  });
  it('revisão: cada campo vem da metade responsável', async () => {
    const { mergeReviewHalves } = await import('./guide.ts');
    const g = mergeReviewHalves({ titulo: 'A', memorizar: ['m'], resumo: ['não é desta metade'] }, { titulo: 'B', resumo: ['r'], perguntas: [{ pergunta: 'p', resposta: 'r' }] });
    expect(g).toMatchObject({ titulo: 'A', memorizar: ['m'], resumo: ['r'], secoes: [], questoes: [] });
    expect(g.perguntas).toHaveLength(1);
  });
});
