// Busca de matérias do banco de questões. A API mistura matérias e assuntos soltos ("Atos Administrativos" vem antes de
// "Direito Administrativo"), então as matérias principais vão primeiro. Abreviações e palavras soltas também valem.
import { normalizeText } from '../ai/notice.ts';

// Conferidas com o nome exato na Quest API e com volume de questões.
const MAIN: { name: string; also?: string }[] = [
  { name: 'Língua Portuguesa', also: 'português gramática redação' }, { name: 'Matemática' }, { name: 'Matemática Financeira' }, { name: 'Raciocínio Lógico', also: 'rlm' }, { name: 'Informática', also: 'computação' },
  { name: 'Direito Administrativo' }, { name: 'Direito Constitucional' }, { name: 'Direito Penal' }, { name: 'Direito Processual Penal', also: 'cpp' }, { name: 'Direito Civil' }, { name: 'Direito Processual Civil - CPC 2015' },
  { name: 'Direito Tributário' }, { name: 'Direito do Trabalho' }, { name: 'Direito Processual do Trabalho' }, { name: 'Direito Previdenciário' }, { name: 'Direito Eleitoral' }, { name: 'Direito Empresarial (Comercial)' }, { name: 'Direito Ambiental' }, { name: 'Direitos Humanos' },
  { name: 'Administração Geral' }, { name: 'Administração Pública' }, { name: 'Contabilidade Geral' }, { name: 'Contabilidade Pública' }, { name: 'Economia' }, { name: 'Atualidades e Conhecimentos Gerais' }, { name: 'Língua Inglesa', also: 'inglês' },
  { name: 'Ética' }, { name: 'Legislação Especial' }, { name: 'Arquivologia' }, { name: 'Estatística' }, { name: 'Geografia' }, { name: 'História' }, { name: 'Pedagogia' },
];

// Nomes que existem na API, mas quase sem questões (7, 60 e 36, medidos em 2026-11-01): a matéria de verdade é a versão cheia.
const HOLLOW: Record<string, string> = {
  'Direito Processual Civil': 'Direito Processual Civil - CPC 2015',
  'Direito Empresarial': 'Direito Empresarial (Comercial)',
  'Atualidades': 'Atualidades e Conhecimentos Gerais',
};

export const fullMaterias = (names: string[]) => [...new Set(names.map((n) => HOLLOW[n] ?? n))];

// Nomes de disciplina de edital cuja matéria não dá para achar pelas palavras: "Português" casaria com "Alfabeto português".
const SUBJECT_NAMES: Record<string, string> = {
  'portugues': 'Língua Portuguesa', 'portugues e redacao': 'Língua Portuguesa', 'lingua portuguesa e redacao': 'Língua Portuguesa', 'interpretacao de texto': 'Língua Portuguesa',
  'ingles': 'Língua Inglesa', 'espanhol': 'Língua Espanhola',
  'raciocinio logico matematico': 'Raciocínio Lógico', 'raciocinio logico e matematico': 'Raciocínio Lógico', 'raciocinio logico e matematica': 'Raciocínio Lógico',
  'matematica e raciocinio logico': 'Raciocínio Lógico',
};
export const subjectMateria = (subject: string): string | undefined => SUBJECT_NAMES[normalizeText(subject).replace(/^(nocoes|conhecimentos) (de|do|da|dos|das|basicos de) /, '')];

const tokens = (s: string) => normalizeText(s).split(' ').filter(Boolean);
// Toda palavra digitada precisa ser o começo de uma palavra do nome: "proc penal" acha "Direito Processual Penal".
const matches = (query: string[], text: string) => { const w = tokens(text); return query.every((q) => w.some((x) => x.startsWith(q))); };

export function rankMaterias(q: string, found: string[], limit = 15) {
  const query = tokens(q);
  if (!query.length) return found.slice(0, limit);
  const main = MAIN.filter((m) => matches(query, `${m.name} ${m.also ?? ''}`)).map((m) => m.name);
  const norm = normalizeText(q);
  const score = (s: string) => { const n = normalizeText(s); return n === norm ? 0 : n.startsWith(norm) ? 1 : matches(query, s) ? 2 : 3; };
  const rest = found.filter((s) => !main.includes(s) && !HOLLOW[s]).map((s, i) => ({ s, i })).sort((a, b) => score(a.s) - score(b.s) || a.s.length - b.s.length || a.i - b.i).map((x) => x.s);
  return [...main, ...rest].slice(0, limit);
}

// O nome oficial do que foi digitado: a versão cheia, o exato ignorando acento e maiúscula, ou a primeira opção, se `first`.
export function resolveMateria(typed: string, options: string[], first = false) {
  const norm = normalizeText(typed);
  const full = Object.keys(HOLLOW).find((h) => normalizeText(h) === norm);
  if (full) return HOLLOW[full]!;
  return options.find((o) => normalizeText(o) === norm) ?? (first ? options[0] : undefined) ?? typed;
}
