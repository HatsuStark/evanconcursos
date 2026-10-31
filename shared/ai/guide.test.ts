import { describe, expect, it } from 'vitest';
import { applyBoardEvidence, boardSample, guideCacheKey, guidePrompt, lawKeys, pickSimilarGuide, topicKeys, unlistedLaws, verifyGuide, type BoardQuestion, type Guide } from './guide.ts';

const law = [{ ref: 'CP, art. 312', text: 'x'.repeat(100) }, { ref: 'CP, art. 313', text: 'y'.repeat(80) }];
const base = { depth: 'completa' as const, subject: 'Direito Penal', banca: 'VUNESP', topics: ['Peculato', 'Concussão'], law };

const question = (assunto: string, enunciado = 'Enunciado'): BoardQuestion => ({ assunto, ano: 2024, enunciado, alternativas: ['A) um', 'B) dois'] });
const guide: Guide = {
  titulo: 'T', introducao: 'I', secoes: [{ titulo: 'S', texto: 'X', exemplos: [], como_banca_cobra: 'Cobra a letra do art. 999 do CP.' }],
  legislacao: [], pontos_banca: [], pegadinhas: [], resumo: [], perguntas: [], depende_legislacao: false,
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
