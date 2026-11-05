// Normas citadas no edital que não estão no registro: como achar o texto delas (sem rede aqui; quem busca é
// supabase/functions/_shared/resolve-laws.ts).
// - Federais (Lei, LC, Decreto-Lei, Decreto): o índice de dados abertos do Senado dá a data da norma pelo número e ano;
//   número + data dão a URN do LexML, e o texto compilado vem do normas.leg.br, como o das leis do registro.
// - Estaduais: o acervo github.com/ctresb/leis (Markdown com o texto das Assembleias Legislativas, compilado quando a
//   fonte tem). Não é oficial: a tela diz isso. A UF vem do órgão do edital.
// - Também do acervo: Constituições Estaduais, Leis Orgânicas de Município e atos de órgãos federais (Instruções
//   Normativas da Receita, resoluções de CONAMA, CONTRAN, ANVISA etc., como saíram no Diário Oficial).
// - Emendas Constitucionais e Medidas Provisórias federais: pelo mesmo caminho das leis.
import { kindName, normPattern, type UnlistedNorm } from './norms.ts';
import type { LegalArticle } from './parse.ts';

export const SENADO_TYPE: Record<string, string> = { lei: 'LEI', lc: 'LCP', dl: 'DEL', dec: 'DEC', ec: 'EMC', mp: 'MPV' };
const URN_KIND: Record<string, string> = { lei: 'lei', lc: 'lei.complementar', dl: 'decreto.lei', dec: 'decreto', ec: 'emenda.constitucional', mp: 'medida.provisoria' };
export const CTRESB_DIR: Record<string, string> = { lei: 'leis-ordinarias', lc: 'leis-complementares', dl: 'decretos-lei', dec: 'decretos', ec: 'emendas-constitucionais', mp: 'medidas-provisorias' };
export const CTRESB_RAW = 'https://raw.githubusercontent.com/ctresb/leis/main';

// ---------- órgãos federais (pasta reguladores/ do acervo) ----------
// Sigla, pasta e nome por extenso. `check`: a pasta junta órgãos (poder-judiciario tem CNJ, CJF, TSE...), então o
// cabeçalho do arquivo ("orgao") precisa nomear o órgão. A Receita (rfb/) fica de fora: os arquivos têm o id do sistema
// dela ("rfb-sijut-122480.md"), sem o número da norma no nome, e não dá para achar uma IN sem abrir milhares.
export interface OrgSpec { acr: string; folder: string; name: RegExp; check?: boolean }
const ORGS: OrgSpec[] = [
  { acr: 'CONAMA', folder: 'conama', name: /Conselho Nacional do Meio Ambiente/i }, { acr: 'CONTRAN', folder: 'contran', name: /Conselho Nacional de Tr[âa]nsito/i },
  { acr: 'SENATRAN', folder: 'senatran', name: /Secretaria Nacional de Tr[âa]nsito/i }, { acr: 'ANVISA', folder: 'anvisa', name: /Vigil[âa]ncia Sanit[áa]ria/i },
  { acr: 'ANATEL', folder: 'anatel', name: /Ag[êe]ncia Nacional de Telecomunica[çc][õo]es/i }, { acr: 'ANEEL', folder: 'aneel', name: /Ag[êe]ncia Nacional de Energia El[ée]trica/i },
  { acr: 'ANAC', folder: 'anac', name: /Ag[êe]ncia Nacional de Avia[çc][ãa]o Civil/i }, { acr: 'ANTT', folder: 'antt', name: /Ag[êe]ncia Nacional de Transportes Terrestres/i },
  { acr: 'ANTAQ', folder: 'antaq', name: /Ag[êe]ncia Nacional de Transportes Aquavi[áa]rios/i }, { acr: 'ANP', folder: 'anp', name: /Ag[êe]ncia Nacional do Petr[óo]leo/i },
  { acr: 'ANS', folder: 'ans', name: /Ag[êe]ncia Nacional de Sa[úu]de Suplementar/i }, { acr: 'ANA', folder: 'ana', name: /Ag[êe]ncia Nacional de [ÁA]guas/i },
  { acr: 'ANM', folder: 'anm', name: /Ag[êe]ncia Nacional de Minera[çc][ãa]o/i }, { acr: 'ANCINE', folder: 'ancine', name: /Ag[êe]ncia Nacional do Cinema/i },
  { acr: 'CVM', folder: 'cvm', name: /Comiss[ãa]o de Valores Mobili[áa]rios/i }, { acr: 'BCB', folder: 'bcb', name: /Banco Central/i },
  { acr: 'BACEN', folder: 'bcb', name: /Banco Central/i }, { acr: 'CMN', folder: 'bcb', name: /Conselho Monet[áa]rio Nacional/i, check: true },
  { acr: 'PGFN', folder: 'pgfn', name: /Procuradoria-Geral da Fazenda Nacional/i }, { acr: 'STN', folder: 'stn', name: /Secretaria do Tesouro Nacional/i },
  { acr: 'CGU', folder: 'cgu', name: /Controladoria-Geral da Uni[ãa]o/i }, { acr: 'TCU', folder: 'tcu', name: /Tribunal de Contas da Uni[ãa]o/i },
  { acr: 'MTE', folder: 'mte', name: /Minist[ée]rio do Trabalho/i }, { acr: 'MTP', folder: 'mte', name: /Minist[ée]rio do Trabalho e Previd[êe]ncia/i },
  { acr: 'INSS', folder: 'inss', name: /Instituto Nacional do Seguro Social/i }, { acr: 'IBAMA', folder: 'ibama', name: /Instituto Brasileiro do Meio Ambiente/i },
  { acr: 'ICMBIO', folder: 'icmbio', name: /Instituto Chico Mendes/i }, { acr: 'SUSEP', folder: 'susep', name: /Superintend[êe]ncia de Seguros Privados/i },
  { acr: 'PREVIC', folder: 'previc', name: /Superintend[êe]ncia Nacional de Previd[êe]ncia Complementar/i }, { acr: 'CADE', folder: 'cade', name: /Conselho Administrativo de Defesa Econ[ôo]mica/i },
  { acr: 'CFC', folder: 'cfc', name: /Conselho Federal de Contabilidade/i }, { acr: 'CNMP', folder: 'cnmp', name: /Conselho Nacional do Minist[ée]rio P[úu]blico/i },
  { acr: 'CONFAZ', folder: 'confaz', name: /Conselho Nacional de Pol[íi]tica Fazend[áa]ria/i }, { acr: 'COAF', folder: 'coaf', name: /Conselho de Controle de Atividades Financeiras/i },
  { acr: 'INEP', folder: 'inep', name: /Instituto Nacional de Estudos e Pesquisas/i }, { acr: 'INMETRO', folder: 'inmetro', name: /Instituto Nacional de Metrologia/i },
  { acr: 'IPHAN', folder: 'iphan', name: /Instituto do Patrim[ôo]nio Hist[óo]rico/i }, { acr: 'AGU', folder: 'agu', name: /Advocacia-Geral da Uni[ãa]o/i },
  { acr: 'DPU', folder: 'dpu', name: /Defensoria P[úu]blica da Uni[ãa]o/i }, { acr: 'CNE', folder: 'cne', name: /Conselho Nacional de Educa[çc][ãa]o/i },
  { acr: 'CNJ', folder: 'poder-judiciario', name: /Conselho Nacional de Justi[çc]a/i, check: true }, { acr: 'CJF', folder: 'poder-judiciario', name: /Conselho da Justi[çc]a Federal/i, check: true },
];
export const orgOf = (org: string) => (org ? ORGS.find((o) => o.acr === org.toUpperCase()) ?? ORGS.find((o) => o.name.test(org)) ?? null : null);
const INFRA_FOLDER: Record<string, RegExp> = { res: /^resolu/, in: /^instru/, port: /^portaria/, prov: /^provimento/ };
const INFRA_FILE: Record<string, string> = { res: 'resolucao', in: 'instrucao-normativa', port: 'portaria', prov: 'provimento' };
// Subpasta do tipo, quando o órgão separa por tipo; null quando as pastas já são os anos (ex.: rfb/2022).
export const infraFolder = (children: string[], kind: string) =>
  children.some((c) => /^\d{4}$/.test(c)) ? null : children.find((c) => INFRA_FOLDER[kind]?.test(c)) ?? undefined;
// Arquivo do Diário Oficial: "resolucao-n-626-de-1-de-abril-de-2020-251063513.md", "instrucao-normativa-rfb-n-2.110-de-...".
export function pickInfraFiles(names: string[], kind: string, num: string) {
  const numRe = num.length > 3 ? `${num.slice(0, -3)}\\.?${num.slice(-3)}` : num;
  const re = new RegExp(`^${INFRA_FILE[kind]}(?:-[a-z0-9]+)*?-n[ºo]?-${numRe}-de-`);
  return names.filter((n) => re.test(n));
}

// Federais pelo Senado; atos de órgão só com o órgão reconhecido. O resto (Resolução sem órgão, estadual...) pede o PDF.
export const resolvable = (n: Pick<UnlistedNorm, 'kind' | 'org'>) => n.kind in SENADO_TYPE || (n.kind in INFRA_FILE && !!orgOf(n.org));

export const federalUrn = (kind: string, date: string, num: string) => `urn:lex:br:federal:${URN_KIND[kind]}:${date};${num}`;
export const stateUrn = (uf: string, kind: string, num: string, year: string) => `ctresb:${uf.toLowerCase()}:${kind}:${num}:${year}`;

// ---------- Senado: número (e ano) → data e nome ----------
interface SenadoDoc { numero?: string; normaNome?: string; ementa?: string; dataassinatura?: string; anoassinatura?: string; apelido?: string }
export interface SenadoHit { date: string; year: string; name: string; ementa: string; nickname: string }

// Resposta de /dadosabertos/legislacao/lista. Com ano, só a do ano; sem ano, a mais recente (decretos repetem números).
export function pickSenado(json: unknown, num: string, year: string): SenadoHit | null {
  const raw = (json as { ListaDocumento?: { documentos?: { documento?: SenadoDoc | SenadoDoc[] } } })?.ListaDocumento?.documentos?.documento;
  const docs = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((d) => d.numero === num && /^\d{2}\/\d{2}\/\d{4}$/.test(d.dataassinatura ?? ''));
  const hit = (year ? docs.filter((d) => d.anoassinatura === year) : docs).sort((a, b) => Number(b.anoassinatura) - Number(a.anoassinatura))[0];
  if (!hit) return null;
  const [d, m, y] = hit.dataassinatura!.split('/');
  // "LEI-9613-1998-03-03 , Lei de Lavagem de Dinheiro (1998)" → "Lei de Lavagem de Dinheiro".
  const nickname = (hit.apelido ?? '').split(',').slice(1).join(',').replace(/\(\d{4}\)\s*$/, '').trim();
  return { date: `${y}-${m}-${d}`, year: y!, name: hit.normaNome ?? '', ementa: (hit.ementa ?? '').trim(), nickname };
}

// ---------- UF do órgão do edital ----------
const STATES: [string, RegExp][] = [
  ['DF', /Distrito Federal/i], ['MS', /Mato Grosso do Sul/i], ['MT', /Mato Grosso/i], ['RN', /Rio Grande do Norte/i], ['RS', /Rio Grande do Sul/i],
  ['RJ', /Rio de Janeiro/i], ['AC', /\bAcre\b/i], ['AL', /Alagoas/i], ['AP', /Amap[áa]/i], ['AM', /Amazonas/i], ['BA', /Bahia/i], ['CE', /Cear[áa]/i],
  ['ES', /Esp[íi]rito Santo/i], ['GO', /Goi[áa]s/i], ['MA', /Maranh[ãa]o/i], ['MG', /Minas Gerais/i], ['PB', /Para[íi]ba/i], ['PR', /Paran[áa]/i],
  ['PA', /\bPar[áa](?![\wÀ-ú])/i], ['PE', /Pernambuco/i], ['PI', /Piau[íi]/i], ['RO', /Rond[ôo]nia/i], ['RR', /Roraima/i], ['SC', /Santa Catarina/i],
  ['SP', /S[ãa]o Paulo/i], ['SE', /Sergipe/i], ['TO', /Tocantins/i],
];
const UFS = new Set(STATES.map(([uf]) => uf));
export const STATE_NAME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco',
  PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
  SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
const GENTILIC: Record<string, string> = {
  paulista: 'SP', mineira: 'MG', fluminense: 'RJ', 'gaúcha': 'RS', gaucha: 'RS', baiana: 'BA', catarinense: 'SC', paranaense: 'PR', pernambucana: 'PE',
  cearense: 'CE', goiana: 'GO', capixaba: 'ES', paraense: 'PA', amazonense: 'AM', maranhense: 'MA', piauiense: 'PI', potiguar: 'RN', paraibana: 'PB',
  alagoana: 'AL', sergipana: 'SE', tocantinense: 'TO', rondoniense: 'RO', roraimense: 'RR', amapaense: 'AP', acreana: 'AC',
  'sul-mato-grossense': 'MS', 'mato-grossense': 'MT',
};
// Órgão federal (TRF, TRT, TRE, União, INSS...) não usa lei estadual: null. "Tribunal de Justiça do Estado de São Paulo",
// "TJSP", "MP-SP", "Prefeitura de Suzano/SP" e "Prefeitura de São Paulo" → SP.
export function ufOf(org: string): string | null {
  if (/Distrito Federal|\bTJDFT\b/i.test(org)) return 'DF';
  if (/\bFederal\b|\bUni[ãa]o\b|Regional (Federal|do Trabalho|Eleitoral)|\bTR[FTE]\b|\bINSS\b|Receita Federal/i.test(org)) return null;
  const sig = /\b(?:TJ|MP|DP|PC|PM|TCE|TCM|SEFAZ|ALE?)\s*-?\s*([A-Z]{2})\b/.exec(org)?.[1] ?? /(?:\/|\s[-–]\s|\()\s*([A-Z]{2})\)?\s*$/.exec(org)?.[1];
  if (sig && UFS.has(sig)) return sig;
  return STATES.find(([, re]) => re.test(org))?.[0] ?? null;
}

// ---------- Constituição Estadual e Lei Orgânica do Município ----------
export const slugOf = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Município do órgão: "Prefeitura Municipal de Suzano/SP", "Câmara Municipal de São Paulo".
export const cityOf = (org: string) =>
  /(?:Prefeitura|C[âa]mara|Munic[íi]pio)(?:\s+Municipal)?\s+(?:de|do|da)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ú' -]*?[\wÀ-ú])(?=\s*(?:[/(,–]|\s-\s|$))/.exec(org)?.[1] ?? null;
const UPPER = 'A-ZÁÉÍÓÚÂÊÔÃÕÇ';
const NAME = String.raw`[${UPPER}][\wÀ-ú'-]*(?:\s+(?:d[aeo]s?\s+)?[${UPPER}][\wÀ-ú'-]*)*`;
const CE_RE = new RegExp(String.raw`Constitui[çc][ãa]o\s+(?:do\s+Estado\s+(?:de|do|da)\s+(${NAME})|(Estadual)|(${Object.keys(GENTILIC).join('|')})\b)`, 'gi');
const LOM_RE = new RegExp(String.raw`Lei\s+Org[âa]nica\s+(?:do\s+Munic[íi]pio\s+(?:de|do|da)\s+(${NAME})|(Municipal|do\s+Munic[íi]pio)\b)`, 'g');
export interface LocalNorm { kind: 'ce' | 'lom'; uf: string; city?: string; generic: boolean }
// "Constituição do Estado de São Paulo", "Constituição Paulista", "Constituição Estadual" (a UF do órgão);
// "Lei Orgânica do Município de São Paulo", "Lei Orgânica Municipal" (o município do órgão).
export function localNormsCited(text: string, org: string): LocalNorm[] {
  const out = new Map<string, LocalNorm>();
  for (const m of text.matchAll(CE_RE)) {
    const uf = m[1] ? STATES.find(([, re]) => re.test(m[1]!))?.[0] : m[3] ? GENTILIC[m[3].toLowerCase()] : ufOf(org);
    if (uf) out.set(`ce:${uf}`, { kind: 'ce', uf, generic: !!m[2] });
  }
  for (const m of text.matchAll(LOM_RE)) {
    const city = m[1]?.trim() ?? cityOf(org), uf = ufOf(org);
    if (city && uf) out.set(`lom:${uf}:${slugOf(city)}`, { kind: 'lom', uf, city, generic: !m[1] });
  }
  return [...out.values()];
}
export const localKey = (l: Pick<LocalNorm, 'kind' | 'uf' | 'city'>) => `${l.uf.toLowerCase()}-${l.kind === 'ce' ? 'ce' : slugOf(l.city ?? '') + '-lom'}`;
export function localEntry(l: LocalNorm) {
  const key = localKey(l);
  if (l.kind === 'ce') {
    const name = STATE_NAME[l.uf]!, gent = Object.entries(GENTILIC).filter(([, uf]) => uf === l.uf).map(([g]) => g);
    return { key, short: `CE-${l.uf}`, name: `Constituição do Estado de ${name}`, urn: `ctresb:${l.uf.toLowerCase()}:constituicao`,
      pattern: String.raw`Constitui[çc][ãa]o\s+(?:do\s+Estado\s+(?:de|do|da)\s+${accentInsensitive(name)}${gent.length ? '|' + gent.join('|') : ''})|\bCE[-/]${l.uf}\b` };
  }
  const city = l.city!;
  return { key, short: `LOM ${city}/${l.uf}`, name: `Lei Orgânica do Município de ${city} (${l.uf})`, urn: `ctresb:${l.uf.toLowerCase()}:${slugOf(city)}:lei-organica`,
    pattern: String.raw`Lei\s+Org[âa]nica\s+do\s+Munic[íi]pio\s+(?:de|do|da)\s+${accentInsensitive(city)}\b` };
}
// "São Paulo" → "S[aáàâã]o\s+P[aáàâã]..." : casa com e sem acento, nos dois sentidos.
const VARIANTS: Record<string, string> = { a: 'aáàâã', e: 'eéê', i: 'ií', o: 'oóôõ', u: 'uú', c: 'cç' };
function accentInsensitive(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').split('').map((c) => {
    const lo = c.toLowerCase();
    if (/\s/.test(c)) return String.raw`\s+`;
    if (VARIANTS[lo]) return `[${VARIANTS[lo]}]`;
    return c.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  }).join('');
}

// ---------- acervo ctresb/leis ----------
// Pasta da norma: federal/leis-ordinarias/1998 ou estaduais/SP/leis-complementares/2010.
export const ctresbDir = (where: 'federal' | string, kind: string, year: string) =>
  `${where === 'federal' ? 'federal' : `estaduais/${where.toUpperCase()}`}/${CTRESB_DIR[kind]}/${year}`;
// Arquivo da norma na pasta do ano: "lei-10261-1968-10-28-id28593.md", "lei-9613-1998-03-03.md".
export function pickCtresbFile(names: string[], num: string, year: string): string | null {
  const re = new RegExp(`^[a-z]+-${num}-${year}-\\d{2}-\\d{2}(?:-id\\d+)?\\.md$`);
  return names.find((n) => re.test(n)) ?? null;
}

// Markdown do acervo: cabeçalho YAML + texto com "**Art. 1º**" / "**Artigo 1° -**", títulos em "###", notas em itálico.
export interface CtresbMeta { titulo?: string; ementa?: string; versao_texto?: string; fonte?: string; revogada?: string; situacao?: string }
const HEADING_RE = /^(PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O)\b/i;
const LEVEL: Record<string, number> = { PARTE: 0, LIVRO: 1, TITULO: 2, CAPITULO: 3, SECAO: 4, SUBSECAO: 5 };
const levelOf = (s: string) => LEVEL[s.split(/\s/)[0]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()] ?? 6;
// Sufixo só colado no número ("4º-A"): "Artigo 5° - O funcionário" não é o art. 5-O.
const MD_ART_RE = /^(?:Art\.?|Artigo)\s*(\d{1,3}(?:\.\d{3})+|\d{1,4})\s*(?:º|°|o(?=\s))?(?:-([A-Z]{1,2})\b)?\s*[.\-–]?\s*/;
const normLabel = (n: number) => n.toLocaleString('pt-BR').replace(/\s/g, '.');

export function parseLawMarkdown(md: string): { meta: CtresbMeta; articles: LegalArticle[] } {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md);
  const meta: Record<string, string> = {};
  for (const l of (fm?.[1] ?? '').split(/\r?\n/)) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(l);
    if (m) meta[m[1]!] = m[2]!.trim().replace(/^"(.*)"$/, '$1');
  }
  const out: LegalArticle[] = [];
  const headings: { level: number; text: string }[] = [];
  const seen = new Set<string>();
  let current: LegalArticle | null = null;
  // Numeração que recomeça no art. 1º depois do corpo: Disposições Transitórias ("DT 1"), como o ADCT da CF.
  let maxNum = 0, transitory = false;
  for (const rawLine of md.slice(fm?.[0].length ?? 0).split(/\r?\n/)) {
    const h = /^#{2,6}\s+(.*)$/.exec(rawLine.trim());
    if (h) {
      const text = h[1]!.replace(/\*+/g, '').trim();
      if (HEADING_RE.test(text)) {
        const level = levelOf(text);
        while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
        headings.push({ level, text });
        current = null;
      }
      continue;
    }
    // Linha toda em itálico é anotação do texto ("*- "Caput" com redação dada pela Emenda Constitucional n° 36...*").
    const italic = /^\*(?!\*)(.+?)(?<!\*)\*$/.exec(rawLine.trim());
    if (italic) {
      if (current) {
        const note = italic[1]!.replace(/^[-–]\s*/, '').trim();
        current.notes.push(note);
        // "**Artigo 12 -**" sem texto e, na linha seguinte, "*(Revogado pela ...)*".
        if (/revogad/i.test(note) && /^Art\. [\d.]+(?:-[A-Z]{1,2})?[º.]?$/.test(current.text)) current.revoked = true;
      }
      continue;
    }
    // Notas de alteração em itálico: "*(Redação dada pela Lei nº ...)*".
    const notes = [...rawLine.matchAll(/(?<!\*)\*(\([^*]+\))\*(?!\*)/g)].map((n) => n[1]!.trim());
    const line = rawLine.replace(/(?<!\*)\*(\([^*]+\))\*(?!\*)/g, '').replace(/\*+/g, '').replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1').replace(/\s+/g, ' ').trim();
    if (!line && !notes.length) continue;
    const a = MD_ART_RE.exec(line);
    if (a && /^\*\*/.test(rawLine.trim())) {
      const num = Number(a[1]!.replace(/\./g, '')), suffix = a[2] ?? '';
      if (num === 1 && !suffix && maxNum > 1) transitory = true;
      maxNum = Math.max(maxNum, num);
      let label = `${transitory ? 'DT ' : ''}${normLabel(num)}${suffix ? '-' + suffix : ''}`;
      if (seen.has(label)) label = `${label} (${out.filter((x) => x.label.startsWith(label)).length + 1})`;
      seen.add(label);
      const rest = line.slice(a[0].length).trim();
      current = {
        ord: out.length, label, num, suffix, heading: headings.map((x) => x.text).join(' › '),
        text: `Art. ${normLabel(num)}${suffix ? '-' + suffix : ''}${num < 10 && !suffix ? 'º' : '.'} ${rest}`.trim(), notes,
        revoked: (!rest || /^\(?revogad[oa]/i.test(rest)) && (notes.some((n) => /revogad/i.test(n)) || /^\(?revogad[oa]/i.test(rest)),
      };
      out.push(current);
      continue;
    }
    if (!current) continue;
    if (line) current.text += '\n' + line;
    current.notes.push(...notes);
  }
  return { meta: meta as CtresbMeta, articles: out };
}

// Texto atualizado (compilado, anotado com as emendas) ou como foi publicado.
export const textVersion = (versao = '') => (/compila|vigente|atualizad|anotad/i.test(versao) ? 'Current' : 'Original');

// ---------- entrada de registro da norma achada ----------
// O padrão não casa a mesma norma citada com outro ano ("Lei 10.261/2001" federal × "Lei 10.261/68" estadual), já que a
// norma achada vale para todos os estudantes. Sem ano na citação, casa. Ato de órgão: a sigla ou o nome do órgão perto.
export function resolvedPattern(kind: string, num: string, year: string, org: OrgSpec | null = null) {
  const yy = year.slice(-2);
  return normPattern(kind, num, org ? `(?:${org.acr}|${org.name.source})` : '')
    + String.raw`(?!\s*\/\s*(?!(?:${year}|${yy})\b)\d{2,4}\b)`
    + String.raw`(?!,?\s+de\s+\d{1,2}[./]\d{1,2}[./](?!${year}\b)\d{4})`
    + String.raw`(?!,?\s+de\s+\d{1,2}\s*[º°]?\s+de\s+[a-zç]+\s+de\s+(?!${year}\b)\d{4})`;
}

const fmtNum = (num: string) => (num.length > 3 ? Number(num).toLocaleString('pt-BR').replace(/\s/g, '.') : num);
export interface ResolvedNorm { key: string; short: string; name: string; citation: string; pattern: string; urn: string }
// uf nulo = federal. Chave "lei-9613-1998" (federal), "sp-lei-10261-1968" (estadual) ou "in-rfb-2110-2022" (órgão).
export function resolvedNorm(n: Pick<UnlistedNorm, 'kind' | 'num'>, year: string, uf: string | null, urn: string, title: string, org: OrgSpec | null = null): ResolvedNorm {
  const kind = kindName(n.kind), scope = uf ? ` ${uf}` : org ? ` ${org.acr}` : '';
  const short = `${kind}${scope} ${fmtNum(n.num)}/${year}`;
  const name = (title ? `${short} – ${title.replace(/\s+/g, ' ')}` : short).slice(0, 160);
  return {
    key: `${uf ? uf.toLowerCase() + '-' : ''}${n.kind}-${org ? org.acr.toLowerCase() + '-' : ''}${n.num}-${year}`, short, name,
    citation: `${kind}${uf ? ' estadual ' + uf : scope} ${fmtNum(n.num)}/${year}`, pattern: resolvedPattern(n.kind, n.num, year, org), urn,
  };
}
