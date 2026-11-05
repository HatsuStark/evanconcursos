import { describe, expect, it } from 'vitest';
import { findLawRefs } from './refs.ts';
import { ownLawEntry, unlistedNorms } from './norms.ts';
import {
  cityOf, cnjIds, cnjSearchUrl, ctresbDir, federalUrn, infraFolder, localEntry, localNormsCited, orgOf, parseLawMarkdown, pickCtresbFile, pickInfraFiles, pickSenado, parseCnjAct, resolvable,
  resolvedNorm, textVersion, ufOf,
} from './resolve.ts';

const senado = (docs: object[]) => ({ ListaDocumento: { documentos: { documento: docs } } });

describe('índice do Senado', () => {
  const lavagem = { numero: '9613', normaNome: 'Lei nº 9.613 de 03/03/1998', ementa: 'Dispõe sobre os crimes de "lavagem"', dataassinatura: '03/03/1998', anoassinatura: '1998', apelido: 'LEI-9613-1998-03-03 , Lei de Lavagem de Dinheiro (1998)' };
  it('data, apelido e URN do LexML', () => {
    const hit = pickSenado(senado([lavagem]), '9613', '1998')!;
    expect(hit).toMatchObject({ date: '1998-03-03', year: '1998', nickname: 'Lei de Lavagem de Dinheiro' });
    expect(federalUrn('lei', hit.date, '9613')).toBe('urn:lex:br:federal:lei:1998-03-03;9613');
    expect(federalUrn('lc', '2000-05-04', '101')).toBe('urn:lex:br:federal:lei.complementar:2000-05-04;101');
  });
  it('ano diferente não serve; sem ano, a mais recente; documento único sem lista', () => {
    expect(pickSenado(senado([lavagem]), '9613', '2001')).toBeNull();
    const velho = { ...lavagem, dataassinatura: '10/01/1930', anoassinatura: '1930' };
    expect(pickSenado(senado([velho, lavagem]), '9613', '')!.year).toBe('1998');
    expect(pickSenado({ ListaDocumento: { documentos: { documento: lavagem } } }, '9613', '1998')!.date).toBe('1998-03-03');
    expect(pickSenado({}, '9613', '')).toBeNull();
  });
});

describe('UF do órgão', () => {
  it.each([
    ['Tribunal de Justiça do Estado de São Paulo', 'SP'], ['TJSP', 'SP'], ['MP-MG', 'MG'], ['Prefeitura Municipal de Campo Grande - Mato Grosso do Sul', 'MS'],
    ['Polícia Civil do Estado do Paraná', 'PR'], ['Tribunal de Justiça do Pará', 'PA'], ['TJDFT', 'DF'],
    ['Tribunal Regional Federal da 3ª Região', null], ['Tribunal Regional do Trabalho da 2ª Região (São Paulo)', null], ['INSS', null], ['Prefeitura de Suzano', null],
  ])('%s → %s', (org, uf) => expect(ufOf(org)).toBe(uf));
});

describe('acervo ctresb/leis', () => {
  it('pasta e arquivo da norma', () => {
    expect(ctresbDir('SP', 'lc', '2010')).toBe('estaduais/SP/leis-complementares/2010');
    expect(ctresbDir('federal', 'dl', '1941')).toBe('federal/decretos-lei/1941');
    const names = ['lei-10260-1968-10-28-id28592.md', 'lei-10261-1968-10-28-id28593.md', 'lei-102610-1968-11-01-id1.md'];
    expect(pickCtresbFile(names, '10261', '1968')).toBe('lei-10261-1968-10-28-id28593.md');
    expect(pickCtresbFile(['lei-9613-1998-03-03.md'], '9613', '1998')).toBe('lei-9613-1998-03-03.md');
    expect(pickCtresbFile(names, '10261', '1969')).toBeNull();
  });

  it('Markdown estadual (Artigo 1° -) em artigos, com títulos, incisos e revogados', () => {
    const md = `---
titulo: "Lei nº 10.261, de 28/10/1968"
ementa: "Dispõe sôbre o Estatuto dos Funcionários Públicos Civis do Estado"
versao_texto: "atualizada"
fonte: "https://www.al.sp.gov.br/norma/28593"
---
# Lei nº 10.261, de 28/10/1968

Texto compilado

### TÍTULO I — Disposições Preliminares

**Artigo 1° -** Esta lei institui o regime jurídico dos funcionários públicos civis do Estado.

**Parágrafo único -** As suas disposições aplicam-se aos 3 Poderes.

**Artigo 5° -** O funcionário responde civil e penalmente.

#### CAPÍTULO I — Do Provimento

**Artigo 11 -** Os cargos públicos serão providos por:

**I -** nomeação;

**Artigo 12 -** *(Revogado pela Lei Complementar nº 1.080, de 17/12/2008)*

**Artigo 1.025 -** Último.

### Disposições Transitórias

**Artigo 1° -** Primeira transitória.
`;
    const { meta, articles } = parseLawMarkdown(md);
    expect(meta).toMatchObject({ ementa: 'Dispõe sôbre o Estatuto dos Funcionários Públicos Civis do Estado', versao_texto: 'atualizada', fonte: 'https://www.al.sp.gov.br/norma/28593' });
    expect(articles.map((a) => a.label)).toEqual(['1', '5', '11', '12', '1.025', 'DT 1']);
    expect(articles[0]!.text).toBe('Art. 1º Esta lei institui o regime jurídico dos funcionários públicos civis do Estado.\nParágrafo único - As suas disposições aplicam-se aos 3 Poderes.');
    expect(articles[1]!).toMatchObject({ num: 5, suffix: '', text: 'Art. 5º O funcionário responde civil e penalmente.' });
    expect(articles[2]!).toMatchObject({ heading: 'TÍTULO I — Disposições Preliminares › CAPÍTULO I — Do Provimento', text: 'Art. 11. Os cargos públicos serão providos por:\nI - nomeação;' });
    expect(articles[3]!).toMatchObject({ revoked: true, notes: ['(Revogado pela Lei Complementar nº 1.080, de 17/12/2008)'] });
    expect(articles[4]!.num).toBe(1025);
  });

  it('Markdown federal (Art. 4º-A.) com notas de redação', () => {
    const md = `---
titulo: "Lei nº 9.613 de 03/03/1998"
---
#### CAPÍTULO I

**Art. 1º** Ocultar ou dissimular a natureza de bens. *(“Caput” do artigo com redação dada pela Lei nº 12.683, de 9/7/2012)*

**Art. 4º-A.** A alienação antecipada. *(Artigo acrescido pela Lei nº 12.683, de 9/7/2012)*
`;
    const { articles } = parseLawMarkdown(md);
    expect(articles.map((a) => [a.label, a.num, a.suffix])).toEqual([['1', 1, ''], ['4-A', 4, 'A']]);
    expect(articles[0]!).toMatchObject({ text: 'Art. 1º Ocultar ou dissimular a natureza de bens.', notes: ['(“Caput” do artigo com redação dada pela Lei nº 12.683, de 9/7/2012)'], revoked: false });
    expect(articles[1]!.text).toBe('Art. 4-A. A alienação antecipada.');
  });
});

describe('norma achada vira entrada de registro para todos', () => {
  const item = 'Lavagem de dinheiro (Lei nº 9.613/1998), arts. 1º a 5º. Estatuto (Lei nº 10.261, de 28 de outubro de 1968). Resolução CNJ nº 351/2020.';
  it('leis, decretos e atos de órgão conhecido são buscados; resolução sem órgão segue pedindo PDF', () => {
    expect(unlistedNorms(item).filter(resolvable).map((n) => n.key)).toEqual(['lei-9613-1998', 'lei-10261-1968', 'res-cnj-351-2020']);
    expect(unlistedNorms('Resolução nº 351/2020').filter(resolvable)).toEqual([]);
    expect(unlistedNorms('Lei Complementar Estadual nº 1.111/2010')[0]).toMatchObject({ kind: 'lc', num: '1111', year: '2010', scope: 'estadual' });
  });
  it('federal: casa com e sem ano, acha os artigos e sai das que faltam', () => {
    const r = resolvedNorm({ kind: 'lei', num: '9613' }, '1998', null, 'urn:lex:br:federal:lei:1998-03-03;9613', 'Lei de Lavagem de Dinheiro');
    expect(r).toMatchObject({ key: 'lei-9613-1998', short: 'Lei 9.613/1998', name: 'Lei 9.613/1998 – Lei de Lavagem de Dinheiro' });
    const e = ownLawEntry({ law_key: r.key, short_name: r.short, name: r.name, urn: r.urn, match_pattern: r.pattern })!;
    expect(findLawRefs('Lei 9.613: crimes (arts. 1º a 5º)', '', [e])).toEqual([{ law: 'lei-9613-1998', ranges: [{ from: 1, to: 5 }] }]);
    expect(unlistedNorms(item, [e]).map((n) => n.key)).toEqual(['lei-10261-1968', 'res-cnj-351-2020']);
  });
  it('estadual: mesmo número com outro ano é outra norma', () => {
    const r = resolvedNorm({ kind: 'lei', num: '10261' }, '1968', 'SP', 'ctresb:sp:lei:10261:1968', 'Estatuto dos Funcionários Públicos Civis do Estado');
    expect(r).toMatchObject({ key: 'sp-lei-10261-1968', short: 'Lei SP 10.261/1968' });
    const e = ownLawEntry({ law_key: r.key, short_name: r.short, name: r.name, urn: r.urn, match_pattern: r.pattern })!;
    expect(unlistedNorms('Estatuto (Lei nº 10.261, de 28 de outubro de 1968); Lei 10.261/68', [e])).toEqual([]);
    expect(unlistedNorms('Lei nº 10.261/2001 (federal)', [e]).map((n) => n.key)).toEqual(['lei-10261-2001']);
    expect(unlistedNorms('Lei nº 10.261, de 4/7/2001', [e]).map((n) => n.key)).toEqual(['lei-10261-2001']);
  });
});

describe('EC, MP e atos de órgãos federais', () => {
  const item = 'Instrução Normativa RFB nº 2.110/2022; Resolução CONAMA nº 237/1997; Resolução nº 302/2002 do Conselho Nacional do Meio Ambiente; '
    + 'Resolução nº 10/2020; Medida Provisória nº 1.154/2023; Emenda Constitucional nº 132/2023';
  it('cada citação com tipo, órgão e se dá para buscar', () => {
    expect(unlistedNorms(item).map((n) => [n.key, n.org, resolvable(n)])).toEqual([
      ['in-rfb-2110-2022', 'RFB', false],
      ['res-conama-237-1997', 'CONAMA', true],
      ['res-302-2002', 'Conselho Nacional do Meio Ambiente', true],
      ['res-10-2020', '', false],
      ['mp-1154-2023', '', true],
      ['ec-132-2023', '', true],
    ]);
    expect(orgOf('Conselho Nacional do Meio Ambiente')!.folder).toBe('conama');
  });
  it('a resolução achada casa só com o mesmo órgão', () => {
    const r = resolvedNorm({ kind: 'res', num: '237' }, '1997', null, 'ctresb:conama:res:237:1997', 'Licenciamento ambiental', orgOf('CONAMA'));
    expect(r).toMatchObject({ key: 'res-conama-237-1997', short: 'Resolução CONAMA 237/1997' });
    const re = new RegExp(r.pattern, 'i');
    expect(re.test('Resolução CONAMA nº 237/1997')).toBe(true);
    expect(re.test('Resolução nº 237/1997 do Conselho Nacional do Meio Ambiente')).toBe(true);
    expect(re.test('Resolução CNJ nº 237/2016')).toBe(false);
  });
  it('pasta do tipo e arquivo do Diário Oficial', () => {
    expect(infraFolder(['instrucoes-normativas', 'portarias', 'resolucoes'], 'res')).toBe('resolucoes');
    expect(infraFolder(['2021', '2022'], 'in')).toBeNull();
    expect(infraFolder(['portarias'], 'res')).toBeUndefined();
    const names = ['resolucao-n-626-de-1-de-abril-de-2020-251063513.md', 'resolucao-n-6260-de-2-de-abril-de-2020-1.md', 'instrucao-normativa-rfb-n-2.110-de-17-de-outubro-de-2022-439.md', 'resolucao-rdc-n-626-de-3-de-maio-de-2020-9.md'];
    expect(pickInfraFiles(names, 'res', '626')).toEqual(['resolucao-n-626-de-1-de-abril-de-2020-251063513.md', 'resolucao-rdc-n-626-de-3-de-maio-de-2020-9.md']);
    expect(pickInfraFiles(names, 'in', '2110')).toEqual(['instrucao-normativa-rfb-n-2.110-de-17-de-outubro-de-2022-439.md']);
  });
  it('versão do texto', () => {
    expect(textVersion('compilação oficial, edição 2026 atualizada até a Emenda 44/25')).toBe('Current');
    expect(textVersion('Texto anotado da ALESP; anotações identificadas até EC 55')).toBe('Current');
    expect(textVersion('publicação original')).toBe('Original');
  });
});

describe('Constituição Estadual e Lei Orgânica do Município', () => {
  it('nome do estado, gentílico ou "Estadual" (UF do órgão)', () => {
    const text = 'Constituição do Estado de São Paulo, arts. 1º a 10; Constituição Mineira; Constituição Estadual; Constituição Federal';
    expect(localNormsCited(text, 'Tribunal de Justiça do Estado do Rio Grande do Sul').map((l) => [l.uf, l.generic])).toEqual([['SP', false], ['MG', false], ['RS', true]]);
  });
  it('lei orgânica do município citado ou do órgão; as leis orgânicas federais não contam', () => {
    expect(ufOf('Prefeitura Municipal de Suzano/SP')).toBe('SP');
    expect(cityOf('Prefeitura Municipal de Suzano/SP')).toBe('Suzano');
    expect(cityOf('Câmara Municipal de São José dos Campos - SP')).toBe('São José dos Campos');
    const text = 'Lei Orgânica do Município de São Paulo; Lei Orgânica Municipal; Lei Orgânica da Magistratura Nacional; Lei Orgânica da Assistência Social';
    expect(localNormsCited(text, 'Prefeitura Municipal de Suzano/SP')).toEqual([
      { kind: 'lom', uf: 'SP', city: 'São Paulo', generic: false },
      { kind: 'lom', uf: 'SP', city: 'Suzano', generic: true },
    ]);
  });
  it('entrada casa com e sem acento', () => {
    const ce = localEntry({ kind: 'ce', uf: 'SP', generic: false });
    expect(ce).toMatchObject({ key: 'sp-ce', short: 'CE-SP', name: 'Constituição do Estado de São Paulo', urn: 'ctresb:sp:constituicao' });
    for (const t of ['Constituição do Estado de Sao Paulo, art. 5º', 'Constituição Paulista', 'CE-SP, arts. 1º a 4º']) expect(new RegExp(ce.pattern, 'i').test(t)).toBe(true);
    expect(new RegExp(ce.pattern, 'i').test('Constituição do Estado de Minas Gerais')).toBe(false);
    const lom = localEntry({ kind: 'lom', uf: 'SP', city: 'São Paulo', generic: false });
    expect(lom).toMatchObject({ key: 'sp-sao-paulo-lom', short: 'LOM São Paulo/SP', urn: 'ctresb:sp:sao-paulo:lei-organica' });
    expect(new RegExp(lom.pattern, 'i').test('Lei Orgânica do Município de Sao Paulo (arts. 1º a 10)')).toBe(true);
  });
  it('anotação em itálico vira nota; revogação na linha seguinte marca o artigo', () => {
    const md = '---\ntitulo: "x"\n---\n**Artigo 10 -** A Assembleia funcionará em sessões públicas. (NR)\n\n*- "Caput" com redação dada pela Emenda Constitucional n° 36, de 17/05/2012.*\n\n**Artigo 11 -**\n\n*(Revogado pela Emenda Constitucional nº 21, de 14/02/2006)*\n';
    const { articles } = parseLawMarkdown(md);
    expect(articles[0]!).toMatchObject({ text: 'Art. 10. A Assembleia funcionará em sessões públicas. (NR)', notes: ['"Caput" com redação dada pela Emenda Constitucional n° 36, de 17/05/2012.'], revoked: false });
    expect(articles[1]!).toMatchObject({ revoked: true });
  });
});

describe('atos do CNJ (atos.cnj.jus.br)', () => {
  const page = `<div class="row"><div class="col-2 identificacao">Identificação</div>
                <div class="col-10 dsc_conteudo">Resolução Nº 351 de 28/10/2020</div>
            </div>
            <div class="row"><div class="col-2 identificacao">Ementa</div>
            <div class="col-10 dsc_conteudo"><p>Institui a Pol&iacute;tica de Preven&ccedil;&atilde;o do Ass&eacute;dio.</p></div>
            </div>
            <div class="row"><div class="col-2 identificacao">Texto</div><div class="col-10 dsc_conteudo">
<p style="text-align:center">CAPÍTULO I</p>
<p style="text-align:center">DA FINALIDADE</p>
<p style="text-align:justify"><s>Art. 1&ordm;&nbsp;Instituir a Política de Prevenção e Combate.</s></p>
<p style="text-align:justify">Art. 1&ordm; Instituir a Política de Prevenção e Enfrentamento. <a href="https://atos.cnj.jus.br/atos/detalhar/5242">(redação dada pela Resolução n. 518, de 31.8.2023)</a></p>
<p style="text-align:justify">Art. 18-A. Os tribunais criarão comissões.</p>
</div></div>`;
  it('busca por tipo, número e ano; ids dos resultados', () => {
    expect(cnjSearchUrl('res', '351', '2020')).toBe('https://atos.cnj.jus.br/atos?atos=sim&tipoAto%5B%5D=7&numero=351&ano=2020');
    expect(cnjSearchUrl('ec', '1', '2020')).toBeNull();
    expect(cnjIds('<a href="https://atos.cnj.jus.br/atos/detalhar/3557">x</a><a href="atos/detalhar/3557">y</a><a href="atos/detalhar/9">')).toEqual(['3557', '9']);
  });
  it('texto vigente sem a redação tachada, com nota e capítulo; outro número não serve', () => {
    const r = parseCnjAct(page, 'res', '351', '2020')!;
    expect(r.ementa).toBe('Institui a Política de Prevenção do Assédio.');
    expect(r.articles.map((a) => a.label)).toEqual(['1', '18-A']);
    expect(r.articles[0]).toMatchObject({ text: 'Art. 1º Instituir a Política de Prevenção e Enfrentamento.', notes: ['(redação dada pela Resolução n. 518, de 31.8.2023)'], heading: 'CAPÍTULO I – DA FINALIDADE' });
    expect(parseCnjAct(page, 'res', '352', '2020')).toBeNull();
    expect(parseCnjAct(page, 'port', '351', '2020')).toBeNull();
  });
  it('a citação mostra a sigla do órgão', () => {
    expect(unlistedNorms('Resolução CNJ nº 351/2020; Portaria PRES nº 4.657/2026').map((n) => n.citation)).toEqual(['Resolução CNJ 351/2020', 'Portaria PRES 4.657/2026']);
  });
});
