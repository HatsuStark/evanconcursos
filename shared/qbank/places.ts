// Lugares citados em nomes de matéria e assunto do banco de questões. Muitas matérias são de um estado, município ou órgão
// ("Normas da Corregedoria-Geral de Justiça do Estado de Minas Gerais", "Lei Orgânica do Município de Natal"): para outro
// concurso, as questões delas não servem, mesmo com o tema parecido.
import { normalizeText } from '../ai/notice.ts';

const STATES: Record<string, string> = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA', 'mato grosso do sul': 'MS', 'mato grosso': 'MT', 'minas gerais': 'MG',
  'paraiba': 'PB', 'parana': 'PR', 'para': 'PA', 'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
  'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
};
const UFS = new Set(Object.values(STATES));
// Nome de estado depois de "Estado de", ou o nome inteiro ("São Paulo", "Minas Gerais - MG"). Do mais longo ao mais curto:
// "mato grosso do sul" antes de "mato grosso". "Pará" sozinho só vale assim, porque "para" também é preposição.
const BY_LENGTH = Object.keys(STATES).sort((a, b) => b.length - a.length);
// Sigla de órgão colada à UF: "TJSP", "TJ-SP", "CGJ RS", "DPESP", "TCE MG".
const ORGAN_UF = /\b(?:TJ|TRE|TCE|TCM|MPE?|PCE?|PM|DPE|CGJ|PGE|CBM|SEE|SEFAZ)[\s-]?([A-Z]{2})\b/g;
// UF depois de traço, parêntese, barra ou preposição: "- SP", "(MG)", "/RJ", "Municípios de SC". Solta no texto não vale:
// em maiúsculas, "SE" e "TO" também são palavras.
const LOOSE_UF = /(?:[(/–-]\s*|\b(?:de|do|da|em|no|na) )([A-Z]{2})(?=$|[\s),./–-])/g;
// Nome do município: palavras com maiúscula, ligadas ou não por "de/do/da/dos/das" ("São José dos Campos").
const CITY = /(?:[Mm]unic[ií]pio|MUNIC[IÍ]PIO|[Cc][aâ]mara [Mm]unicipal|C[AÂ]MARA MUNICIPAL|[Pp]refeitura(?: [Mm]unicipal)?|PREFEITURA(?: MUNICIPAL)?) (?:de|do|da|dos|das|DE|DO|DA|DOS|DAS) (\p{Lu}[\p{L}'’]*(?:\s+(?:(?:de|do|da|dos|das)\s+)?\p{Lu}[\p{L}'’]*)*)/gu;

export interface Places { ufs: Set<string>; cities: Set<string> }

export function placesIn(text: string): Places {
  const ufs = new Set<string>(), cities = new Set<string>();
  for (const m of text.matchAll(ORGAN_UF)) if (UFS.has(m[1]!)) ufs.add(m[1]!);
  if (/\bTJDFT\b/.test(text)) ufs.add('DF');
  for (const m of text.matchAll(LOOSE_UF)) if (UFS.has(m[1]!)) ufs.add(m[1]!);
  for (const m of text.matchAll(CITY)) {
    const city = normalizeText(m[1]!).replace(/ [a-z]{2}$/, '');
    if (city && !/^(estados?|municipios?)\b/.test(city)) cities.add(city);
  }
  const n = ` ${normalizeText(text)} `;
  for (const m of n.matchAll(/ estado (?:de|do|da) ([a-z ]+)/g)) {
    const name = BY_LENGTH.find((s) => `${m[1]!} `.startsWith(`${s} `));
    if (name) ufs.add(STATES[name]!);
  }
  // Distrito Federal só pela UF ou por "TJDFT": o nome é também assunto de Direito Constitucional (art. 32 da CF).
  const whole = normalizeText(text.replace(/\s[-–]\s*[A-Z]{2}$/, ''));
  if (STATES[whole] && whole !== 'distrito federal') ufs.add(STATES[whole]!);
  // Nome composto em qualquer parte ("Corregedoria Geral da Justiça de São Paulo"); o mais longo consome o texto, para
  // "Mato Grosso do Sul" não contar também como Mato Grosso.
  let rest = n;
  for (const name of BY_LENGTH) {
    if (!name.includes(' ') || name === 'distrito federal' || !rest.includes(` ${name} `)) continue;
    ufs.add(STATES[name]!);
    rest = rest.replaceAll(` ${name} `, ' | ');
  }
  return { ufs, cities };
}

// Categorias que juntam questões de vários estados ou municípios: nunca servem para estudar um lugar.
const MIXED = /^(conhecimentos especificos d(os|as) (estados|municipios)|legislacao (estadual|municipal|estadual distrital e municipal)|brasil e localidades especificas|municipios com populacao inferior a 50 mil habitantes)$/;
export const mixedPlaces = (name: string) => MIXED.test(normalizeText(name));

// Matéria ou assunto que serve ao concurso: sem lugar, ou só com lugares do edital e da sessão (`context`).
export function placeFilter(context: string) {
  const allowed = placesIn(context);
  return (name: string) => {
    if (mixedPlaces(name)) return false;
    const p = placesIn(name);
    return [...p.ufs].every((u) => allowed.ufs.has(u)) && [...p.cities].every((c) => allowed.cities.has(c));
  };
}

// Órgão do edital como a API o nomeia: "Tribunal de Justiça do Estado de São Paulo" → "TJ SP" ("Legislação Aplicada - TJ SP"),
// "Tribunal Regional do Trabalho da 2ª Região" → "TRT 2". `marks`: como a sessão cita o órgão ("Normas TJSP").
const ORGANS: [RegExp, string, 'uf' | 'region'][] = [
  [/tribunal de justi[cç]a/i, 'TJ', 'uf'], [/minist[eé]rio p[uú]blico/i, 'MPE', 'uf'], [/pol[ií]cia civil/i, 'PC', 'uf'],
  [/pol[ií]cia militar/i, 'PM', 'uf'], [/tribunal de contas d[oa] estado/i, 'TCE', 'uf'], [/defensoria p[uú]blica/i, 'DPE', 'uf'],
  [/tribunal regional do trabalho/i, 'TRT', 'region'], [/tribunal regional federal/i, 'TRF', 'region'], [/tribunal regional eleitoral/i, 'TRE', 'uf'],
];
export function organSearch(organization: string): { queries: string[]; marks: string[] } {
  const organ = ORGANS.find(([re]) => re.test(organization));
  if (!organ) return { queries: [], marks: [] };
  const [, acr, by] = organ;
  const where = by === 'region' ? /(\d{1,2})\s*[ªa°º]?\s*regi[aã]o/i.exec(organization)?.[1] : [...placesIn(organization).ufs][0];
  if (!where) return { queries: [], marks: [] };
  const short = `${acr} ${where}`;
  return { queries: [short, organization.replace(/ do estado (de|do|da) /i, ' de ')], marks: [normalizeText(short), normalizeText(`${acr}${where}`)] };
}
