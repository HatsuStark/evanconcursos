// Material de estudo de uma sessão: buscas de vídeo-aula e PDF montadas pelo tema e links da lei seca
// no Planalto. Nenhum link é inventado: são buscas ou endereços oficiais fixos.
import { WEAK_MARK } from './scheduler.ts';

export interface StudyLink { label: string; href: string; kind: 'video' | 'pdf' | 'law' }

const PLANALTO = 'https://www.planalto.gov.br/ccivil_03/';
// Códigos e leis federais mais cobradas, pelo texto da tarefa.
const LAW_CODES = [
  { re: /\bCF\b|Constitui[çc][ãa]o Federal/i, name: 'CF', path: 'constituicao/constituicao.htm' },
  { re: /\bCPP\b|C[óo]digo de Processo Penal/i, name: 'CPP', path: 'decreto-lei/del3689compilado.htm' },
  { re: /\bCPC\b|C[óo]digo de Processo Civil/i, name: 'CPC', path: '_ato2015-2018/2015/lei/l13105.htm' },
  { re: /\bCP\b|C[óo]digo Penal/i, name: 'Código Penal', path: 'decreto-lei/del2848compilado.htm' },
  { re: /\bCC\b|C[óo]digo Civil/i, name: 'Código Civil', path: 'leis/2002/l10406compilada.htm' },
  { re: /\bLINDB\b/i, name: 'LINDB', path: 'decreto-lei/del4657compilado.htm' },
  { re: /\bCDC\b|C[óo]digo de Defesa do Consumidor/i, name: 'CDC', path: 'leis/l8078compilado.htm' },
  { re: /\bECA\b|Estatuto da Criança/i, name: 'ECA', path: 'leis/l8069.htm' },
];
const LAW_NUMBERS: Record<string, string> = {
  '6830': 'leis/l6830.htm', '7210': 'leis/l7210.htm', '8069': 'leis/l8069.htm', '8078': 'leis/l8078compilado.htm',
  '8112': 'leis/l8112cons.htm', '8429': 'leis/l8429.htm', '9099': 'leis/l9099.htm', '9784': 'leis/l9784.htm',
  '10406': 'leis/2002/l10406compilada.htm', '11340': '_ato2004-2006/2006/lei/l11340.htm',
  '12527': '_ato2011-2014/2011/lei/l12527.htm', '13105': '_ato2015-2018/2015/lei/l13105.htm',
  '14133': '_ato2019-2022/2021/lei/l14133.htm',
};
// Sem código citado, a matéria indica a lei principal.
const SUBJECT_LAWS: [RegExp, string][] = [[/process\w*\s+penal/i, 'CPP'], [/process\w*\s+civil/i, 'CPC'], [/penal/i, 'Código Penal'], [/civil/i, 'Código Civil'], [/constitucional/i, 'CF']];
const LAW_RE = /\bLei(?:\s+Complementar)?\s*(?:n[º°o.]*\s*)?(\d{1,2}\.?\d{3})(?:\s*\/\s*(\d{2,4}))?/gi;

const search = (base: string, param: string, q: string) => { const u = new URL(base); u.searchParams.set(param, q); return u.href; };
const youtube = (q: string) => search('https://www.youtube.com/results', 'search_query', q);
const google = (q: string) => search('https://www.google.com/search', 'q', q);

// Tema da tarefa sem a matéria e sem marcações de parte ("(parte 1 de 2)").
export function taskTopic(text: string, keyword: string): string {
  if (keyword === WEAK_MARK) return '';
  if (keyword) return keyword;
  const i = text.indexOf(':');
  return ((i < 0 ? '' : text.slice(i + 1)).split(';')[0] ?? '').replace(/\(parte \d+ de \d+\)/i, '').trim().slice(0, 90);
}

export function lawLinks(text: string, subject = ''): StudyLink[] {
  const out = new Map<string, string>();
  for (const c of LAW_CODES) if (c.re.test(text)) out.set(c.name, PLANALTO + c.path);
  for (const m of text.matchAll(LAW_RE)) {
    const n = m[1]!.replace('.', ''), label = 'Lei ' + m[1] + (m[2] ? '/' + m[2] : '');
    if (!out.has(label)) out.set(label, LAW_NUMBERS[n] ? PLANALTO + LAW_NUMBERS[n] : google(label + ' texto compilado'));
  }
  if (!out.size && subject) {
    const hit = SUBJECT_LAWS.find(([re]) => re.test(subject)), code = hit && LAW_CODES.find((c) => c.name === hit[1]);
    if (code) out.set(code.name, PLANALTO + code.path);
  }
  return [...out].map(([name, href]) => ({ label: 'Lei seca: ' + name, href, kind: 'law' as const }));
}

// Links da sessão: vídeo-aulas, PDFs/resumos e lei seca. Com roteiro da IA, entram os termos de busca
// sugeridos e as leis citadas na leitura recomendada.
export function studyLinks(
  { subject, keyword, text }: { subject: string; keyword: string; text: string },
  { searches = [], readings = [] }: { searches?: string[]; readings?: string[] } = {},
): StudyLink[] {
  const topic = taskTopic(text, keyword), q = [subject, topic].filter(Boolean).join(' ');
  if (!q) return [];
  return [
    { label: 'Vídeo-aulas', href: youtube(q + ' aula'), kind: 'video' },
    { label: 'PDFs e resumos', href: google(q + ' resumo filetype:pdf'), kind: 'pdf' },
    ...searches.map((t) => ({ label: '▶ ' + t, href: youtube(t), kind: 'video' as const })),
    ...lawLinks([text, ...readings].join(' '), subject),
  ];
}
