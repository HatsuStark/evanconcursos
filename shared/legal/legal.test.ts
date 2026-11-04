import { describe, expect, it } from 'vitest';
import { parseLawHtml, parseNormsText } from './parse.ts';
import { ownLawEntry, shortCitation, unlistedNorms, uploadUrn } from './norms.ts';
import { aiLawRefs, citesUnlistedLaw, findLawRefs, inRanges, mergeLawRefs, rangesOrFilter, noticeLawKeys, parseRanges, rangesLabel, resolveSessionRefs, sessionLawRefs, storedLawRefs } from './refs.ts';

// Trecho real do HTML do CPP no normas.leg.br (estrutura preservada).
const HTML = `<html><body>
<p style="text-align:center; font-size:1.2em"><span>TÍTULO II</span></p>
<p style="text-align:center; font-size:1.2em"><span>DO INQUÉRITO POLICIAL</span></p>
<p style="text-indent:56.7pt"><span style="-aw-import:ignore">&#xa0;</span></p>
<p class="BodyTextIndent"><span>Art. 4º A polícia judiciária será exercida pelas autoridades policiais. </span><a href="x"><span class="Hyperlink" style="font-style:italic">(“Caput” do artigo com redação dada pela Lei nº 9.043, de 9/5/1995)</span></a></p>
<p class="BodyTextIndent"><span>Parágrafo único. A competência definida neste artigo não excluirá a de autoridades administrativas.</span></p>
<p><span>Art. 5º Nos crimes de ação pública o inquérito policial será iniciado:</span></p>
<p><span>I - de ofício;</span></p>
<p><span>Art. 35. </span><a href="y"><span class="Hyperlink" style="font-style:italic">(Revogado pela Lei nº 9.520, de 27/11/1997)</span></a><span> </span></p>
<p style="text-align:center"><span>CAPÍTULO I</span></p>
<p style="text-align:center"><span>DA AÇÃO</span></p>
<p><span>Inserção de dados</span></p>
<p><span>Art. 311-A. Texto do artigo acrescido.</span></p>
<p><span>Peculato culposo</span></p>
<p><span>Art. 1.025. Consideram-se incluídos no acórdão os elementos.</span></p>
<p><span>Pena - detenção, de três meses a um ano.</span></p>
</body></html>`;

describe('lei fora do registro', () => {
  it('reconhece a citação e não atribui os artigos a outra lei', () => {
    const title = 'Ingresso e Exercício: posse (Lei 10.261/68, arts. 1º a 14, 46 e 47)';
    expect(citesUnlistedLaw(title)).toBe(true);
    expect(citesUnlistedLaw('Juizados (Lei 9.099/1995, arts. 3º ao 19)')).toBe(false);
    expect(citesUnlistedLaw('Peculato (CP, arts. 312 a 327)')).toBe(false);
    expect(findLawRefs(title, 'Direito Penal')).toEqual([]);
    expect(findLawRefs('Peculato, arts. 312 a 327', 'Direito Penal')[0]!.law).toBe('CP');
  });
});

describe('findLawRefs com listas de edital', () => {
  it('lista longa de artigos termina na hora, sem backtracking explosivo', () => {
    const text = 'Código de Processo Penal – artigos 251 a 258; 261 a 267; 274; 351 a 372; 394 a 497; 531 a 538; 541 a 548; 574 a 667 e Lei n.º 9.099 de 26.09.1995 (artigos 60 a 83; 88 e 89).';
    const started = performance.now();
    const refs = findLawRefs(text);
    expect(performance.now() - started).toBeLessThan(200);
    expect(refs.find((r) => r.law === 'CPP')!.ranges.map((r) => [r.from, r.to])).toEqual([[251, 258], [261, 267], [274, 274], [351, 372], [394, 497], [531, 538], [541, 548], [574, 667]]);
    expect(refs.find((r) => r.law === 'L9099')!.ranges.map((r) => [r.from, r.to])).toEqual([[60, 83], [88, 88], [89, 89]]);
  });
  it('entende "ao" e número de quatro dígitos sem ponto', () => {
    expect(findLawRefs('Lei 9.099/1995, arts. 3º ao 19')[0]!.ranges).toEqual([{ from: 3, to: 19 }]);
    expect(findLawRefs('CPC, arts. 994 a 1026')[0]!.ranges).toEqual([{ from: 994, to: 1026 }]);
  });
});

describe('parseLawHtml', () => {
  const arts = parseLawHtml(HTML);
  it('separa artigos com rótulo, número e sufixo', () => {
    expect(arts.map((a) => a.label)).toEqual(['4', '5', '35', '311-A', '1.025']);
    expect(arts.map((a) => a.num)).toEqual([4, 5, 35, 311, 1025]);
    expect(arts[3]!.suffix).toBe('A');
  });
  it('junta parágrafos e incisos ao artigo e separa as notas de alteração', () => {
    expect(arts[0]!.text).toBe('Art. 4º A polícia judiciária será exercida pelas autoridades policiais.\nParágrafo único. A competência definida neste artigo não excluirá a de autoridades administrativas.');
    expect(arts[0]!.notes[0]).toMatch(/redação dada pela Lei nº 9\.043/);
    expect(arts[1]!.text).toContain('I - de ofício;');
  });
  it('rubrica antes do artigo vai para o artigo seguinte', () => {
    expect(arts[3]!.text).toBe('Inserção de dados\nArt. 311-A. Texto do artigo acrescido.'); // logo após o título
    expect(arts[4]!.text).toBe('Peculato culposo\nArt. 1.025. Consideram-se incluídos no acórdão os elementos.\nPena - detenção, de três meses a um ano.');
  });
  it('marca revogado e guarda o título/capítulo', () => {
    expect(arts[2]!.revoked).toBe(true);
    expect(arts[0]!.revoked).toBe(false);
    expect(arts[0]!.heading).toBe('TÍTULO II – DO INQUÉRITO POLICIAL');
    expect(arts[3]!.heading).toBe('TÍTULO II – DO INQUÉRITO POLICIAL › CAPÍTULO I – DA AÇÃO');
  });
});

describe('leis de um edital', () => {
  it('junta as citadas nos tópicos e a principal da matéria', () => {
    expect([...noticeLawKeys([{ name: 'Direito Penal', topics: ['Lei 11.340/06 (Maria da Penha)', 'Peculato'] }])].sort()).toEqual(['CP', 'L11340']);
    expect([...noticeLawKeys([{ name: 'Português', topics: ['Crase'] }])]).toEqual([]);
  });
});

describe('referências a leis', () => {
  const r = (t: string, subject = '') => findLawRefs(t, subject).map((x) => `${x.law}:${x.ranges.map((y) => y.from === y.to ? `${y.from}${y.fromSuffix ?? ''}` : `${y.from}-${y.to}`).join(',')}`);
  it('separa artigos citados antes de cada lei', () => {
    expect(r('Veja o art. 121 do CP e o art. 312 do CP.')).toEqual(['CP:121,312']);
    expect(r('O art. 121 do CP e o art. 5º da CF.')).toEqual(['CP:121', 'CF:5']);
  });
  it('títulos de sessão gerados pela IA', () => {
    expect(r('Funcionário Público e Peculato: conceito e modalidades (CP, arts. 327 e 312 a 315)')).toEqual(['CP:327,312-315']);
    expect(r('Inquérito policial: natureza, prazos e arquivamento (CPP, arts. 4º a 23)')).toEqual(['CPP:4-23']);
    expect(r('Juizados: competência e atos (Lei 9.099/95, arts. 60 a 83)')).toEqual(['L9099:60-83']);
  });
  it('itens do edital', () => {
    expect(r('DIREITO PENAL: Código Penal - artigos 293 a 305; 307; 308; 311-A; 312 a 317')).toEqual(['CP:293-305,307,308,311A,312-317']);
    expect(r('Código de Processo Penal - artigos 251 a 258 e Lei n.º 9.099 de 26.09.1995 (artigos 60 a 83; 88 e 89)')).toEqual(['CPP:251-258', 'L9099:60-83,88,89']);
    expect(r('Lei Federal n.º 8.429/92 (Lei de Improbidade Administrativa)')).toEqual(['L8429:']);
    expect(r('Código de Processo Civil - artigos 1.000 a 1.026')).toEqual(['CPC:1000-1026']);
  });
  it('artigo antes da lei e artigos soltos pela matéria', () => {
    expect(r('Direitos fundamentais (art. 5º da CF)')).toEqual(['CF:5']);
    expect(r('Prisão em flagrante: arts. 301 a 310', 'Direito Processual Penal')).toEqual(['CPP:301-310']);
    expect(r('Crase e regência', 'Língua Portuguesa')).toEqual([]);
  });
  it('intervalos e pertinência', () => {
    expect(parseRanges('293 a 305; 307 e 311-A')).toEqual([{ from: 293, to: 305 }, { from: 307, to: 307 }, { from: 311, to: 311, fromSuffix: 'A' }]);
    const rg = parseRanges('312 a 315; 311-A');
    expect(inRanges(rg, 313)).toBe(true);
    expect(inRanges(rg, 311, 'A')).toBe(true);
    expect(inRanges(rg, 311)).toBe(false);
    expect(inRanges([], 999)).toBe(true);
  });
});

describe('Normas Judiciais da CGJ SP (PDF)', () => {
  const pdf = [
    '=== PÁGINA 1 ===', 'CAPÍTULO I - DA MISSÃO ........ 1º a 4º', 'Art. 1º Dar nova redação aos Capítulos I a X.', 'Art. 2º Revogar os Capítulos XI e XII.',
    '=== PÁGINA 2 ===', 'CAPÍTULO I', 'DA MISSÃO, VISÃO E PRINCÍPIOS', 'Art. 1º A Corregedoria Geral da Justiça alinha-se às diretrizes', 'do Conselho Nacional de Justiça.',
    'Art. 2º São princípios institucionais:', 'I - a eticidade;', 'II - a satisfação do usuário, sem preconceitos; 1', 'Parágrafo único. Os princípios regem a atuação.',
    '1 Prov. CG 15/2020.',
    '=== PÁGINA 3 ===', 'CAPÍTULO III', 'DOS OFÍCIOS DE JUSTIÇA EM GERAL', 'Seção V', 'Do Sistema Informatizado Oficial 2',
    'Art. 49. Os níveis de acesso serão estabelecidos pela Corregedoria, com a STI.3', '§ 1º É vedado ceder a senha.', 'Art. 1 do CPC, citado numa linha quebrada.',
    'Art.. 50. O CEVAT rege-se por estas normas.', 'Artigo 51. Sempre que o sistema permitir.', 'Art. 51-A. (Revogado).',
    '2 Prov. CG 1/2024.', '3 Provs. CG 2/2024 e 3/2024.',
  ].join('\n');
  const arts = parseNormsText(pdf);
  it('começa no corpo, não no provimento de abertura, com capítulo e seção', () => {
    expect(arts.map((a) => a.label)).toEqual(['1', '2', '49', '50', '51', '51-A']);
    expect(arts[0]!.heading).toBe('CAPÍTULO I – DA MISSÃO, VISÃO E PRINCÍPIOS');
    expect(arts[2]!.heading).toBe('CAPÍTULO III – DOS OFÍCIOS DE JUSTIÇA EM GERAL › Seção V – Do Sistema Informatizado Oficial');
  });
  it('junta as linhas quebradas, separa incisos e parágrafos e tira as notas de rodapé', () => {
    expect(arts[0]!.text).toBe('Art. 1º A Corregedoria Geral da Justiça alinha-se às diretrizes do Conselho Nacional de Justiça.');
    expect(arts[1]!.text).toBe('Art. 2º São princípios institucionais:\nI - a eticidade;\nII - a satisfação do usuário, sem preconceitos;\nParágrafo único. Os princípios regem a atuação.');
    expect(arts[2]!.text).toBe('Art. 49. Os níveis de acesso serão estabelecidos pela Corregedoria, com a STI.\n§ 1º É vedado ceder a senha.\nArt. 1 do CPC, citado numa linha quebrada.');
    expect(arts[5]!.revoked).toBe(true);
  });
  it('o título da sessão e o item do edital apontam os artigos das Normas', () => {
    expect(findLawRefs('Disposições Gerais e Expediente: Normas da CGJ (arts. 1º a 4º, 33, 47 e 49)')).toEqual([{ law: 'NSCGJ', ranges: [{ from: 1, to: 4 }, { from: 33, to: 33 }, { from: 47, to: 47 }, { from: 49, to: 49 }] }]);
    expect(findLawRefs('Normas Judiciais da Corregedoria Geral da Justiça (Tomo I – Capítulo I: art. 1º a 4º)').map((r) => r.law)).toEqual(['NSCGJ']);
    expect(findLawRefs('Normas Extrajudiciais da Corregedoria Geral da Justiça').map((r) => r.law)).toEqual([]);
  });
  it('incisos, parágrafos e alíneas no meio da lista não cortam os artigos seguintes', () => {
    const one = (n: number, s?: string) => ({ from: n, to: n, ...(s ? { fromSuffix: s } : {}) });
    expect(sessionLawRefs('Expedição de Mandados e Citações: Tomo I, arts. 196, XX, 282, § 1º, 310, 315, 410, 436, 436-A, 439, 440 e 440-A', [], 'Normas da Corregedoria'))
      .toEqual([{ law: 'NSCGJ', ranges: [one(196), one(282), one(310), one(315), one(410), one(436), one(436, 'A'), one(439), one(440), one(440, 'A')] }]);
    expect(findLawRefs('CPP, arts. 351, parágrafo único, 352, inciso II, 357, alínea b, e 311-C')[0]!.ranges)
      .toEqual([one(351), one(352), one(357), one(311, 'C')]);
    expect(findLawRefs('Tomo II, arts. 1 a 5').map((r) => r.law)).toEqual([]);
  });
});

describe('artigos de lei da sessão: o título manda', () => {
  const item = ['Lei n.º 6.830/1980 (artigos 1º; 2º; 7º; 8º; 11; 37); Resolução n.º 354/2020 do Conselho Nacional de Justiça (artigos 1º; 8º a 10); Lei n.º 11.340/2006 (artigos 5º a 7º)'];
  it('título com artigos de lei conhecida: só eles, nada do item', () => {
    expect(sessionLawRefs('Disposições Gerais e Expediente: Normas da CGJ (arts. 1º a 4º, 33, 47 e 49)', item).map((r) => r.law)).toEqual(['NSCGJ']);
  });
  it('título que cita artigos de norma fora do registro não recebe a primeira lei do item', () => {
    expect(sessionLawRefs('Resolução CNJ 354/2020: cumprimento digital de atos (arts. 8º a 10)', item)).toEqual([]);
  });
  it('título que nomeia a lei sem artigos: os artigos dela no item', () => {
    expect(sessionLawRefs('Execução Fiscal: citação e penhora', item)).toEqual([{ law: 'L6830', ranges: [{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 7, to: 7 }, { from: 8, to: 8 }, { from: 11, to: 11 }, { from: 37, to: 37 }] }]);
  });
  it('título sem lei: o item só vale com uma lei só', () => {
    expect(sessionLawRefs('Custas e despesas processuais', item)).toEqual([]);
    expect(sessionLawRefs('Prazos processuais', ['Código de Processo Penal: artigos 798 e 798-A'])).toEqual([{ law: 'CPP', ranges: [{ from: 798, to: 798 }, { from: 798, to: 798, fromSuffix: 'A' }] }]);
  });
});

describe('rótulo dos artigos', () => {
  it('ponto de milhar e sufixo, para o título apontar os mesmos artigos', () => {
    const r = findLawRefs('Normas da CGJ (arts. 1.071 a 1.091-A, 105)')[0]!;
    expect(rangesLabel(r)).toBe('arts. 1.071 a 1.091-A, 105');
    expect(findLawRefs(`NSCGJ, ${rangesLabel(r)}`)).toEqual([r]);
  });
});

describe('normas fora do registro', () => {
  const item = 'Lei n.º 6.830/1980 (artigos 1º; 2º; 7º; 8º; 11; 37); Resolução n.º 354/2020 do Conselho Nacional de Justiça (artigos 1º; 8º a 10); Lei n.º 11.608, de 29/12/2003 e Normas Judiciais da Corregedoria Geral da Justiça (Tomo I – Capítulo I: art. 1º a 4º); Lei Complementar Estadual nº 1.111/2010';
  it('acha as do edital que faltam, sem as do registro', () => {
    expect(unlistedNorms(item).map((n) => [n.key, n.citation])).toEqual([
      ['res-354-2020', 'Resolução 354/2020 do Conselho Nacional de Justiça'],
      ['lei-11608-2003', 'Lei 11.608/2003'],
      ['lc-1111-2010', 'Lei Complementar 1.111/2010'],
    ]);
  });
  it('a norma enviada vira lei do registro para o estudante: título e artigos', () => {
    const res = unlistedNorms(item)[0]!;
    const own = ownLawEntry({ law_key: res.key, short_name: shortCitation(res.citation), name: res.citation, urn: uploadUrn('u1', res.key), match_pattern: res.pattern })!;
    expect(findLawRefs('Cumprimento digital de atos: Res. CNJ 354 (arts. 8º a 10)', '', [own])).toEqual([{ law: 'res-354-2020', ranges: [{ from: 8, to: 10 }] }]);
    expect(unlistedNorms(item, [own]).map((n) => n.key)).toEqual(['lei-11608-2003', 'lc-1111-2010']);
    expect(sessionLawRefs('Resolução CNJ 354/2020: cumprimento digital (arts. 8º a 10)', [item])).toEqual([]);
    expect(sessionLawRefs('Resolução CNJ 354/2020: cumprimento digital (arts. 8º a 10)', [item], '', [own]).map((r) => r.law)).toEqual(['res-354-2020']);
  });
  it('lei do registro citada pelo número (Decreto-Lei 4.657/1942 = LINDB) não é pedida', () => {
    expect(unlistedNorms('LINDB: vigência (Decreto-Lei nº 4.657/1942); Decreto-Lei 2.848/1940; Decreto-Lei 3.689/41')).toEqual([]);
    expect(findLawRefs('Decreto-Lei nº 4.657/1942, arts. 1º a 6º').map((r) => r.law)).toEqual(['LINDB']);
  });
  it('número curto sem ano não conta', () => {
    expect(unlistedNorms('conforme a Lei 1 e a Res. 2')).toEqual([]);
  });
});

describe('várias listas de artigos da mesma norma', () => {
  it('capítulos diferentes da mesma norma: todos os artigos', () => {
    expect(findLawRefs('Disposições Gerais e Fiscalização: Normas Judiciais da CGJ (Tomo I, Cap. I, arts. 1º a 4º; Cap. III, arts. 33, 47 e 49)'))
      .toEqual([{ law: 'NSCGJ', ranges: [{ from: 1, to: 4 }, { from: 33, to: 33 }, { from: 47, to: 47 }, { from: 49, to: 49 }] }]);
  });
  it('os artigos de cada norma param na próxima norma citada, mesmo fora do registro', () => {
    const item = 'Lei n.º 6.830/1980 (artigos 1º; 2º; 7º); Resolução n.º 354/2020 do Conselho Nacional de Justiça (artigos 1º; 8º a 10); Normas Judiciais da Corregedoria Geral da Justiça Tomo I – Capítulo I: (art. 1º a 4º); Tomo I – Capítulo III – Seção III: (art. 33)';
    expect(findLawRefs(item)).toEqual([
      { law: 'L6830', ranges: [{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 7, to: 7 }] },
      { law: 'NSCGJ', ranges: [{ from: 1, to: 4 }, { from: 33, to: 33 }] },
    ]);
  });
  it('artigo logo antes da lei seguinte continua sendo dela', () => {
    expect(findLawRefs('art. 121 do CP e art. 5º da CF')).toEqual([{ law: 'CP', ranges: [{ from: 121, to: 121 }] }, { law: 'CF', ranges: [{ from: 5, to: 5 }] }]);
  });
});

describe('artigos estruturados da sessão', () => {
  const one = (n: number, s?: string) => ({ from: n, to: n, ...(s ? { fromSuffix: s } : {}) });
  it('resposta da IA: só leis conhecidas e com artigos, por lei', () => {
    expect(aiLawRefs([{ law: 'NSCGJ', articles: '196, 282, 436-A, 1º a 4º' }, { law: 'nscgj', articles: '440' }, { law: 'RES354', articles: '8 a 10' }, { law: 'CPP', articles: '' }]))
      .toEqual([{ law: 'NSCGJ', ranges: [one(196), one(282), one(436, 'A'), { from: 1, to: 4 }, one(440)] }]);
    expect(aiLawRefs(undefined)).toEqual([]);
  });
  it('lei enviada pelo estudante vale como conhecida', () => {
    const own = [{ key: 'res-354-2020', short: 'Res. 354/2020', name: 'Resolução 354/2020', urn: 'upload:u:res', match: /Resolu[çc][ãa]o[^\d]{0,40}354/i }];
    expect(aiLawRefs([{ law: 'res-354-2020', articles: '8 a 10' }], own)).toEqual([{ law: 'res-354-2020', ranges: [{ from: 8, to: 10 }] }]);
  });
  it('valor gravado: conferido; vazio ou estranho → null', () => {
    expect(storedLawRefs([{ law: 'NSCGJ', ranges: [{ from: 196, to: 196 }, { from: 436, to: 436, fromSuffix: 'A', toSuffix: 'A' }, { from: 'x', to: 2 }, { from: 9, to: 3 }] }]))
      .toEqual([{ law: 'NSCGJ', ranges: [one(196), { from: 436, to: 436, fromSuffix: 'A', toSuffix: 'A' }] }]);
    for (const v of [null, undefined, [], 'x', [{ law: 'CPP', ranges: [] }], [{ ranges: [{ from: 1, to: 1 }] }]]) expect(storedLawRefs(v)).toBeNull();
  });
  it('gravado manda; sem ele, o título', () => {
    const stored = [{ law: 'CPP', ranges: [one(351)] }];
    expect(resolveSessionRefs(stored, 'Mandados: NSCGJ, art. 196', [])).toEqual(stored);
    expect(resolveSessionRefs(null, 'Mandados: NSCGJ, art. 196', [])).toEqual([{ law: 'NSCGJ', ranges: [one(196)] }]);
  });
  it('junta por lei sem repetir', () => {
    expect(mergeLawRefs([{ law: 'CPP', ranges: [one(1)] }], null, [{ law: 'CPP', ranges: [one(1), one(2)] }, { law: 'CF', ranges: [one(5)] }]))
      .toEqual([{ law: 'CPP', ranges: [one(1), one(2)] }, { law: 'CF', ranges: [one(5)] }]);
  });
});

describe('filtro dos artigos no banco', () => {
  it('só os intervalos citados, não do menor ao maior artigo', () => {
    const r = findLawRefs('Normas da CGJ: Atos processuais, arts. 196, 436-A, 439 a 440-A, 1137 a 1139 e 1247')[0]!;
    expect(rangesOrFilter(r.ranges)).toBe('num.eq.196,num.eq.436,and(num.gte.439,num.lte.440),and(num.gte.1137,num.lte.1139),num.eq.1247');
  });
});
