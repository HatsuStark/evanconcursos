import { describe, expect, it } from 'vitest';
import { citedLinks, parseCsv, parseStfSumulaList, parseStfSumulaPage, parseStjReferences, parseStjSumulas, precedentLabel, stfTheses, stjLawKey, stjTemas, unverifiedPrecedents } from './juris.ts';

// Recorte do PDF "Súmulas do STJ" (texto por linha, com cabeçalho e rodapé de página).
const STJ_PDF = `17. Súmula 17
DIREITO PENAL - ESTELIONATO
SÚMULA 17
DIREITO PENAL - ESTELIONATO
Enunciado:
Quando o falso se exaure no estelionato, sem mais
potencialidade lesiva, é por este absorvido.
Referências Legislativas:
LEG:FED DEL:002848 ANO:1940
***** CP-40 CODIGO PENAL
ART:00070 ART:00171
Órgão Julgador:
TERCEIRA SEÇÃO
Data da decisão:
20/11/1990
INTEIRO TEOR DAS SÚMULAS Súmula 17
scon.stj.jus.br/SCON/sumstj/ 84
SÚMULA 61 (SÚMULA CANCELADA)
DIREITO CIVIL - CONTRATO DE SEGURO
Enunciado:
O seguro de vida cobre o suicídio não premeditado.
A Segunda Seção, na sessão de 25 de abril de 2018, ao
apreciar o Projeto de Súmula n. 1.154, determinou o
CANCELAMENTO da Súmula n. 61-STJ.
Referências Legislativas:
LEG:FED LEI:003071 ANO:1916
***** CC-16 CODIGO CIVIL
ART:01440
Órgão Julgador:
SEGUNDA SEÇÃO
SÚMULA 203 (SÚMULA ALTERADA)
DIREITO PROCESSUAL CIVIL - AGRAVO DE INSTRUMENTO CONTRA
DECISÃO DE INADMISSÃO DE RECURSO
ESPECIAL
Enunciado:
Não cabe recurso especial contra decisão proferida por
órgão de segundo grau dos Juizados Especiais.
A Corte Especial, na sessão extraordinária de 23 de maio
de 2002, deliberou pela ALTERAÇÃO do enunciado.
Referências Legislativas:
LEG:FED CFB:****** ANO:1988
***** CF-1988 CONSTITUIÇÃO FEDERAL DE 1988
ART:00105 INC:00003
LEG:FED LEI:008213 ANO:1991
ART:00016 INC:00004
(REVOGADA PELA LEI 9.032/1995)
Órgão Julgador:
CORTE ESPECIAL
Data da decisão:
04/02/1998
`;

describe('súmulas do STJ', () => {
  const list = parseStjSumulas(STJ_PDF);

  it('lê número, ramo, enunciado e data, sem cabeçalho nem rodapé de página', () => {
    expect(list.map((s) => s.number)).toEqual([17, 61, 203]);
    expect(list[0]).toMatchObject({
      court: 'STJ', kind: 'sumula', subject: 'DIREITO PENAL - ESTELIONATO', decidedOn: '1990-11-20', active: true,
      text: 'Quando o falso se exaure no estelionato, sem mais potencialidade lesiva, é por este absorvido.',
    });
  });

  it('liga os artigos da referência legislativa à lei do registro', () => {
    expect(list[0]!.links).toEqual([{ law: 'CP', art: 70, origin: 'referencia' }, { law: 'CP', art: 171, origin: 'referencia' }]);
  });

  it('cancelada fica inativa e sem a nota do cancelamento; lei fora do registro não liga', () => {
    expect(list[1]).toMatchObject({ active: false, text: 'O seguro de vida cobre o suicídio não premeditado.', links: [] });
  });

  it('alterada continua vigente, com ramo de três linhas e sem a nota da alteração', () => {
    expect(list[2]).toMatchObject({ active: true, subject: 'DIREITO PROCESSUAL CIVIL - AGRAVO DE INSTRUMENTO CONTRA DECISÃO DE INADMISSÃO DE RECURSO ESPECIAL' });
    expect(list[2]!.text).toBe('Não cabe recurso especial contra decisão proferida por órgão de segundo grau dos Juizados Especiais.');
  });

  it('CF entra; artigo seguido de "(REVOGADA…)" não', () => {
    expect(list[2]!.links).toEqual([{ law: 'CF', art: 105, origin: 'referencia' }]);
  });
});

describe('referência legislativa do STJ', () => {
  it('mapeia tipo, número e ano para a chave do registro', () => {
    expect(stjLawKey('DEL', '002848', '1940')).toBe('CP');
    expect(stjLawKey('LEI', '013105', '2015')).toBe('CPC');
    expect(stjLawKey('LEI', '007210', '1984')).toBe('L7210');
    expect(stjLawKey('CFD', '000000', '1988')).toBe('CF');
    expect(stjLawKey('LEI', '005869', '1973')).toBeNull(); // CPC/73, fora do registro
  });

  it('artigos sob lei fora do registro não grudam na lei anterior', () => {
    const links = parseStjReferences('LEG:FED LEI:007210 ANO:1984\nART:00126\nLEG:FED LEI:009999 ANO:2000\nART:00005');
    expect(links).toEqual([{ law: 'L7210', art: 126, origin: 'referencia' }]);
  });
});

describe('temas do STJ (CSV de dados abertos)', () => {
  const csv = `sequencialPrecedente,tipoPrecedente,numeroPrecedente,dataJulgamento,situacao,teseFirmada,referenciaLegislativa,Assuntos
1,Tema,47,2010-05-12,Trânsito em Julgado,"A presunção de veracidade contida no art. 359 do Código de Processo Civil não se aplica às ações cautelares de exibição de documentos.",,"8826- DIREITO PROCESSUAL CIVIL E DO TRABALHO, 9192- Tutela Provisória"
2,Tema,177,2012-01-01,Revisado,"A ação penal nos crimes de lesão corporal leve ""doméstica"" é pública incondicionada.",,
3,Controvérsia,9,,Pendente,,,
4,IAC,5,2020-03-03,Acórdão Publicado,"Tese do IAC.",,
5,Tema,900,,Afetado,,,
6,Tema,177,2019-01-01,Trânsito em Julgado,"Tese repetida, agora vigente.",,
`;
  const temas = stjTemas(parseCsv(csv));

  it('só temas e IACs com tese; revisado fica inativo; tema repetido fica um só, o vigente', () => {
    expect(temas.map((t) => [t.kind, t.number, t.active])).toEqual([['repetitivo', 47, true], ['repetitivo', 177, true], ['iac', 5, true]]);
    expect(temas[1]!.text).toBe('Tese repetida, agora vigente.');
    expect(stjTemas(parseCsv(csv.split('\n').slice(0, 3).join('\n')))[1]!.active).toBe(false);
  });

  it('assunto sem os códigos da tabela do CNJ, aspas duplas do CSV, artigo citado na tese', () => {
    expect(temas[0]!.subject).toBe('DIREITO PROCESSUAL CIVIL E DO TRABALHO, Tutela Provisória');
    expect(stjTemas(parseCsv(csv.split('\n').slice(0, 3).join('\n')))[1]!.text).toContain('"doméstica"');
    expect(temas[0]!.links).toEqual([{ law: 'CPC', art: 359, origin: 'citacao' }]);
    expect(temas[0]!.sourceUrl).toContain('cod_tema_inicial=47');
  });
});

describe('STF', () => {
  it('lista de súmulas: id da página, número e situação', () => {
    const html = `<div class="sumula-item"><a target="_blank" href="sumariosumulas.asp?base=26&sumula=1199">
	Súmula Vinculante 5
</a></div><div class="sumula-item"><a target="_blank" href="sumariosumulas.asp?base=26&sumula=1212">
	Súmula Vinculante 9 <em>(cance&#8203;lada)</em>
</a></div><div class="sumula-item"><a target="_blank" href="sumariosumulas.asp?base=30&sumula=1300">
	Súmula&nbsp;3 <em>(superada)</em>
</a></div>`;
    expect(parseStfSumulaList(html)).toEqual([{ id: 1199, number: 5, active: true }, { id: 1212, number: 9, active: false }, { id: 1300, number: 3, active: false }]);
  });

  it('página da súmula: só o enunciado, com entidades decodificadas', () => {
    const html = `<div class="titulo-formulario">Aplicação das Súmulas no STF</div><div class="titulo">
	Súmula Vinculante 5
</div><div class="parCOM"><p>
	A falta de defesa t&eacute;cnica&nbsp;por advogado n&#227;o ofende a &#147;Constitui&#231;&#227;o&#148;.</p>
</div><div class="titulo">
	Precedente Representativo
</div><div class="parCOM"><p>Outro texto.</p></div>`;
    expect(parseStfSumulaPage(html)).toBe('A falta de defesa técnica por advogado não ofende a “Constituição”.');
  });

  it('teses de repercussão geral: número, data, link e artigos citados', () => {
    const [t] = stfTheses([{ numeroTema: '1103', incidente: '5909870', siglaClasse: 'ARE', numeroProcesso: '1267879', descricaoTese: 'Nos termos do art. 5º, LV, da CF, é constitucional…', dataAndamento: '17/12/2020' }]);
    expect(t).toMatchObject({ court: 'STF', kind: 'repercussao_geral', number: 1103, decidedOn: '2020-12-17', active: true });
    expect(t!.sourceUrl).toContain('incidente=5909870');
    expect(t!.links).toEqual([{ law: 'CF', art: 5, origin: 'citacao' }]);
    expect(precedentLabel(t!)).toBe('Tema de Repercussão Geral 1103/STF');
  });

  it('súmula ou tema citado fora dos fornecidos é apontado', () => {
    const provided = [{ court: 'STJ' as const, kind: 'sumula' as const, number: 17 }, { court: 'STF' as const, kind: 'sumula_vinculante' as const, number: 5 }, { court: 'STF' as const, kind: 'repercussao_geral' as const, number: 1103 }];
    const text = 'Pela Súmula 17 do STJ e pela Súmula Vinculante 5 (Tema 1103/STF), mas também a Súmula 17/STF, a Súmula nº 491 e o Tema 990 do STJ.';
    expect(unverifiedPrecedents(text, provided)).toEqual(['Súmula 17/STF', 'Súmula 491', 'Tema 990/STJ']);
    expect(unverifiedPrecedents('Tema da sessão: súmulas em geral.', [])).toEqual([]);
  });

  it('intervalo grande citado não vira dezenas de ligações', () => {
    expect(citedLinks('arts. 1º a 200 do CP')).toEqual([]);
    expect(citedLinks('arts. 312 a 314 do CP').map((l) => l.art)).toEqual([312, 313, 314]);
  });
});
