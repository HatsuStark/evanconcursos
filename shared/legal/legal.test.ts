import { describe, expect, it } from 'vitest';
import { parseLawHtml } from './parse.ts';
import { findLawRefs, inRanges, noticeLawKeys, parseRanges } from './refs.ts';

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
