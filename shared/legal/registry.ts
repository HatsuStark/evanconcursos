// Leis federais conhecidas: identificador oficial (URN LexML) no normas.leg.br, nomes e como aparecem nos textos.
// URNs conferidas na API do normas.leg.br (out/2026).
export interface LawEntry { key: string; short: string; name: string; urn: string; match: RegExp }

export const LAWS: LawEntry[] = [
  { key: 'CF', short: 'CF', name: 'Constituição Federal', urn: 'urn:lex:br:federal:constituicao:1988-10-05;1988', match: /\bCF\b|\bCF\/88\b|Constitui[çc][ãa]o( Federal| da Rep[úu]blica)/i },
  { key: 'CPP', short: 'CPP', name: 'Código de Processo Penal', urn: 'urn:lex:br:federal:decreto.lei:1941-10-03;3689', match: /\bCPP\b|C[óo]digo de Processo Penal/i },
  { key: 'CPC', short: 'CPC', name: 'Código de Processo Civil', urn: 'urn:lex:br:federal:lei:2015-03-16;13105', match: /\bCPC\b|C[óo]digo de Processo Civil|Lei (n[º°o.]*\s*)?13\.?105/i },
  { key: 'CP', short: 'CP', name: 'Código Penal', urn: 'urn:lex:br:federal:decreto.lei:1940-12-07;2848', match: /\bCP\b|C[óo]digo Penal/i },
  { key: 'CC', short: 'CC', name: 'Código Civil', urn: 'urn:lex:br:federal:lei:2002-01-10;10406', match: /\bCC\b|C[óo]digo Civil|Lei (n[º°o.]*\s*)?10\.?406/i },
  { key: 'LINDB', short: 'LINDB', name: 'Lei de Introdução às Normas do Direito Brasileiro', urn: 'urn:lex:br:federal:decreto.lei:1942-09-04;4657', match: /\bLINDB\b|Lei de Introdu[çc][ãa]o/i },
  { key: 'CDC', short: 'CDC', name: 'Código de Defesa do Consumidor', urn: 'urn:lex:br:federal:lei:1990-09-11;8078', match: /\bCDC\b|Defesa do Consumidor|Lei (n[º°o.]*\s*)?8\.?078/i },
  { key: 'ECA', short: 'ECA', name: 'Estatuto da Criança e do Adolescente', urn: 'urn:lex:br:federal:lei:1990-07-13;8069', match: /\bECA\b|Estatuto da Crian[çc]a|Lei (n[º°o.]*\s*)?8\.?069/i },
  { key: 'L8429', short: 'Lei 8.429/92', name: 'Lei de Improbidade Administrativa', urn: 'urn:lex:br:federal:lei:1992-06-02;8429', match: /Lei (Federal )?(n[º°o.]*\s*)?8\.?429|Improbidade Administrativa/i },
  { key: 'L9099', short: 'Lei 9.099/95', name: 'Lei dos Juizados Especiais', urn: 'urn:lex:br:federal:lei:1995-09-26;9099', match: /Lei (n[º°o.]*\s*)?9\.?099/i },
  { key: 'L12153', short: 'Lei 12.153/09', name: 'Lei dos Juizados Especiais da Fazenda Pública', urn: 'urn:lex:br:federal:lei:2009-12-22;12153', match: /Lei (n[º°o.]*\s*)?12\.?153/i },
  { key: 'L8112', short: 'Lei 8.112/90', name: 'Regime Jurídico dos Servidores Públicos Federais', urn: 'urn:lex:br:federal:lei:1990-12-11;8112', match: /Lei (n[º°o.]*\s*)?8\.?112/i },
  { key: 'L9784', short: 'Lei 9.784/99', name: 'Lei do Processo Administrativo', urn: 'urn:lex:br:federal:lei:1999-01-29;9784', match: /Lei (n[º°o.]*\s*)?9\.?784/i },
  { key: 'L14133', short: 'Lei 14.133/21', name: 'Lei de Licitações e Contratos', urn: 'urn:lex:br:federal:lei:2021-04-01;14133', match: /Lei (n[º°o.]*\s*)?14\.?133/i },
  { key: 'L11340', short: 'Lei 11.340/06', name: 'Lei Maria da Penha', urn: 'urn:lex:br:federal:lei:2006-08-07;11340', match: /Lei (n[º°o.]*\s*)?11\.?340|Maria da Penha/i },
  { key: 'L7210', short: 'LEP', name: 'Lei de Execução Penal', urn: 'urn:lex:br:federal:lei:1984-07-11;7210', match: /Lei (n[º°o.]*\s*)?7\.?210|Execu[çc][ãa]o Penal|\bLEP\b/i },
  { key: 'L6830', short: 'Lei 6.830/80', name: 'Lei de Execução Fiscal', urn: 'urn:lex:br:federal:lei:1980-09-22;6830', match: /Lei (n[º°o.]*\s*)?6\.?830|Execu[çc][ãa]o Fiscal/i },
  { key: 'L12527', short: 'LAI', name: 'Lei de Acesso à Informação', urn: 'urn:lex:br:federal:lei:2011-11-18;12527', match: /Lei (n[º°o.]*\s*)?12\.?527|Acesso [àa] Informa[çc][ãa]o/i },
  { key: 'L11419', short: 'Lei 11.419/06', name: 'Lei do Processo Eletrônico', urn: 'urn:lex:br:federal:lei:2006-12-19;11419', match: /Lei (n[º°o.]*\s*)?11\.?419/i },
  { key: 'L13146', short: 'Lei 13.146/15', name: 'Estatuto da Pessoa com Deficiência', urn: 'urn:lex:br:federal:lei:2015-07-06;13146', match: /Lei (n[º°o.]*\s*)?13\.?146|Estatuto da Pessoa com Defici[êe]ncia/i },
];

export const lawByKey = (key: string) => LAWS.find((l) => l.key === key);
export const lawByUrn = (urn: string) => LAWS.find((l) => l.urn === urn);

// Sem lei citada, a matéria indica a lei principal (ex.: "Direito Processual Penal" → CPP).
const SUBJECT_LAWS: [RegExp, string][] = [
  [/process\w*\s+penal/i, 'CPP'], [/process\w*\s+civil/i, 'CPC'], [/penal/i, 'CP'], [/civil/i, 'CC'], [/constitucional/i, 'CF'],
];
export const lawForSubject = (subject: string) => SUBJECT_LAWS.find(([re]) => re.test(subject))?.[1] ?? null;
