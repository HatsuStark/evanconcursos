import { describe, expect, it } from 'vitest';
import { compareTopics, diffNotices, studiedTopics, subjectEquivalence, type DiffNotice } from './notice-diff.ts';

const notice = (subjects: Record<string, string[]>, over: Partial<DiffNotice> = {}, tag = 'n'): DiffNotice => ({
  organization: 'TJSP', role: 'Escrevente', board: 'VUNESP', examDate: '2027-03-14', ...over,
  subjects: Object.entries(subjects).map(([name, topics], i) => ({ name, topics: topics.map((text, k) => ({ id: `${tag}${i}-${k}`, text })) })),
});

describe('compareTopics', () => {
  it('numeração e matéria em maiúsculas não contam como diferença', () => {
    expect(compareTopics('Crase.', '12. Crase.').status).toBe('same');
    expect(compareTopics('Código Penal - artigos 293 a 305.', '1. DIREITO PENAL: Código Penal - artigos 293 a 305.').status).toBe('same');
  });
  it('artigo diferente no mesmo texto é parecido, nunca igual', () => {
    expect(compareTopics('Código Penal - artigos 293 a 310.', 'Código Penal - artigos 293 a 305.').status).toBe('similar');
  });
  it('leis diferentes nunca casam, mesmo com texto quase igual', () => {
    expect(compareTopics('Lei n.º 8.112/90 regime jurídico dos servidores', 'Lei n.º 10.261/68 regime jurídico dos servidores').status).toBe('new');
  });
  it('trecho contido em tópico longo é parecido; assunto diferente é novo', () => {
    expect(compareTopics('Lei Federal n.º 8.429/92 (Lei de Improbidade Administrativa).', 'Estatuto dos Funcionários (Lei 10.261/68) e Lei Federal n.º 8.429/92 (Lei de Improbidade Administrativa), artigos 9 e 13.').status).toBe('similar');
    expect(compareTopics('Resolução sobre teletrabalho no tribunal', 'Concordância verbal e nominal').status).toBe('new');
  });
  it('texto vazio não casa', () => {
    expect(compareTopics('', 'Crase').status).toBe('new');
  });
});

describe('subjectEquivalence', () => {
  it('liga matérias pelo nome, com variações, e deixa de fora a que não existe mais', () => {
    expect(subjectEquivalence(
      [{ id: 'a', name: 'Noções de Direito Penal' }, { id: 'b', name: 'LÍNGUA PORTUGUESA' }, { id: 'c', name: 'Física' }],
      [{ id: '1', name: 'Direito Penal' }, { id: '2', name: 'Língua Portuguesa' }],
    )).toEqual({ a: '1', b: '2' });
  });
  it('nome exato tem preferência sobre nome contido', () => {
    expect(subjectEquivalence([{ id: 'a', name: 'Direito Processual Penal' }], [{ id: '1', name: 'Direito' }, { id: '2', name: 'Direito Processual Penal' }])).toEqual({ a: '2' });
  });
});

describe('studiedTopics', () => {
  it('tópico dividido em várias sessões só conta com todas concluídas', () => {
    const s = studiedTopics([{ topicIds: ['longo', 'a'], done: true }, { topicIds: ['longo'], done: false }, { topicIds: ['b'], done: true }]);
    expect([...s].sort()).toEqual(['a', 'b']);
  });
});

describe('diffNotices', () => {
  const previous = notice({ Português: ['1. Crase.', '2. Pontuação.', '3. Ortografia oficial.'], 'Direito Penal': ['1. DIREITO PENAL: Código Penal - artigos 293 a 305.'] }, { examDate: '2023-05-28' }, 'a');
  const next = notice({ Português: ['Crase.', 'Pontuação.', 'Interpretação de textos literários.'], 'Direito Penal': ['Código Penal - artigos 293 a 310.'], 'Legislação Interna': ['Regimento Interno do Tribunal.'] }, {}, 'b');

  it('separa iguais, parecidos, novos e os que saíram', () => {
    const d = diffNotices(previous, next);
    expect(d.counts).toMatchObject({ same: 2, similar: 1, new: 2, removed: 1 });
    expect(d.removed[0]!.text).toBe('3. Ortografia oficial.');
    expect(d.addedSubjects).toEqual(['Legislação Interna']);
    expect(d.removedSubjects).toEqual([]);
  });
  it('aponta os artigos que o tópico antigo não cobria', () => {
    const t = diffNotices(previous, next).topics.find((x) => x.subject === 'Direito Penal')!;
    expect(t.status).toBe('similar');
    expect(t.missingNumbers).toEqual(['310']);
  });
  it('entre antigos parecidos, prefere o que já cita os artigos', () => {
    const old = notice({ 'Processo Penal': ['Lei 9.099 de 1995 (artigos 60 a 83)'], 'Processo Civil': ['Lei 9.099 de 1995 (artigos 3 ao 19)'] }, {}, 'a');
    const d = diffNotices(old, notice({ 'Processo Civil': ['Lei 9.099 de 1995 (artigos 3 ao 19)'] }, {}, 'b'));
    expect(d.topics[0]).toMatchObject({ status: 'same', matchId: 'a1-0', missingNumbers: [] });
  });
  it('só conta como estudado o que casou com tópico já estudado', () => {
    const d = diffNotices(previous, next, new Set(['a0-0']));
    expect(d.topics.filter((t) => t.studied).map((t) => t.text)).toEqual(['Crase.']);
    expect(d.counts.studied).toBe(1);
  });
  it('tópico com artigos novos não conta como estudado', () => {
    const d = diffNotices(previous, next, new Set(['a1-0']));
    expect(d.topics.find((t) => t.subject === 'Direito Penal')).toMatchObject({ status: 'similar', studied: false, missingNumbers: ['310'] });
    expect(d.counts.studied).toBe(0);
  });
  it('avisa troca de banca, cargo e órgão, sem depender de acento ou caixa', () => {
    expect(diffNotices(previous, notice({}, { board: 'FGV', role: 'Técnico', organization: 'TJRJ' }))).toMatchObject({ boardChanged: true, roleChanged: true, organizationChanged: true });
    expect(diffNotices(previous, notice({}, { board: 'vunesp', role: 'ESCREVENTE', organization: 'tjsp' }))).toMatchObject({ boardChanged: false, roleChanged: false, organizationChanged: false });
  });
  it('fora da matéria, trecho apenas contido em tópico longo não casa', () => {
    const old = notice({ Constitucional: ['Direitos e garantias fundamentais, organização do Estado, administração pública e Poder Judiciário'] }, {}, 'a');
    const d = diffNotices(old, notice({ Informática: ['Administração pública digital'] }, {}, 'b'));
    expect(d.topics[0]!.status).toBe('new');
  });
});
