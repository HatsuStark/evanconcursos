// Mnemônico de uma questão (IA): só quando ajuda a memorizar (listas, requisitos, prazos, ordens).
// A IA recebe os mnemônicos já existentes do mesmo assunto e prefere reaproveitar um deles.
import { z } from 'zod';
import { normalizeText } from '../ai/notice.ts';

export const MNEMONIC_PROMPT_VERSION = 'mnemonic-v2';

export const MnemonicChoice = z.object({
  acao: z.enum(['reusar', 'criar', 'nenhum']),
  reusar_id: z.string().describe('Id do mnemônico existente, quando acao = "reusar"; senão vazio.'),
  conceito: z.string().describe('O que o mnemônico ajuda a lembrar, genérico o bastante para servir a outras questões (ex.: "Requisitos do ato administrativo").'),
  mnemonico: z.string().describe('Acrônimo ou frase curta (até 120 caracteres).'),
  itens: z.array(z.object({ chave: z.string(), significado: z.string() })).describe('Cada letra/palavra do mnemônico e o que representa.'),
  explicacao: z.string().describe('Como usar o mnemônico nesta questão, em até 3 frases.'),
});
export type MnemonicChoice = z.infer<typeof MnemonicChoice>;
export const mnemonicJsonSchema = () => z.toJSONSchema(MnemonicChoice, { target: 'draft-7' });

export const conceptKey = (s: string) => normalizeText(s).slice(0, 180);

export function mnemonicPrompt(p: { enunciado: string; alternativas: { letra: string; texto: string }[]; gabarito: string; assunto: string; existing: { id: string; concept: string; mnemonic: string }[]; law: string[] }) {
  return `Você cria mnemônicos para estudantes de concurso. Analise a questão e decida se um mnemônico ajuda a memorizar o que ela cobra.
Questão (assunto: ${p.assunto || '—'}):
${p.enunciado}
${p.alternativas.map((a) => `${a.letra}) ${a.texto}`).join('\n')}
Gabarito oficial: ${p.gabarito}
${p.law.length ? `Trechos oficiais da lei relacionados:\n${p.law.join('\n').slice(0, 6000)}\n` : ''}Mnemônicos já existentes para este assunto:
${p.existing.length ? p.existing.map((m) => `- id=${m.id} · ${m.concept}: ${m.mnemonic}`).join('\n') : '(nenhum)'}
Regras:
- Se algum mnemônico existente cobre o que a questão cobra (inclusive quando a questão trata de só um dos itens dele), use acao "reusar" com o id dele: ver o conjunto ajuda a não confundir os itens.
- Crie um novo só quando a questão cobra algo memorizável (lista, requisitos, elementos, prazos, ordem, classificações) e nenhum existente serve.
- Se a questão é de interpretação, raciocínio ou cálculo, ou se o mnemônico seria forçado, use acao "nenhum".
- O mnemônico precisa estar correto segundo o gabarito e a lei; não invente itens. Em português; pode ser acrônimo ou frase.
- conceito: genérico (serve a outras questões do mesmo tema), sem citar a questão.`;
}

// Mnemônico conhecido entre os candidatos (reuso válido) ou null.
export const pickExisting = (c: MnemonicChoice, ids: string[]) => (c.acao === 'reusar' && ids.includes(c.reusar_id.trim()) ? c.reusar_id.trim() : null);

// ---------- quando mostrar a aba "Mnemônico" (regra gratuita, sem IA) ----------
// 'yes' = já existe mnemônico; 'no' = a IA já avaliou que não cabe; 'maybe' = ainda não avaliada.
export type MnemoStatus = 'yes' | 'no' | 'maybe';
// O que não cabe mnemônico é o tipo de questão (interpretação de texto), não a matéria: Português, Matemática,
// Raciocínio Lógico e Informática têm mnemônicos clássicos (crase, fórmulas, tabela-verdade, atalhos).
const NO_KIND = /de acordo com o texto|segundo o texto|conforme o texto|infere-se|depreende-se|o autor (?:defende|afirma|sugere|argumenta)|ideia (?:central|principal)|sentido do texto|interpreta[çc][ãa]o de texto|compreens[ãa]o de texto/i;
const YES_TEXT = /requisit|element|princ[íi]pi|hip[óo]tes|esp[ée]cie|modalidad|prazo|\bdias?\b|classific|compet[êe]n|exceto|características|\bfases?\b|\betapas?\b|\bordem\b|legitimad|\brol\b|caben|cabe |\bart(?:igo)?s?\.?\s*\d|\blei\b|san[çc][õo]es|penas?\b|recursos?\b|efeitos|formas? de|tipos? de|são (?:eles|elas)|seguintes/i;
// Sinais por matéria (no assunto ou no texto da questão).
const YES_PT = /crase|acentua|acento|reg[êe]ncia|concord[âa]ncia|coloca[çc][ãa]o pronominal|pr[óo]clise|[êe]nclise|mes[óo]clise|porqu[eê]s?\b|ortografi|h[íi]fen|pontua|v[íi]rgula|vozes? verba|tempos? verba|modos? verba|conjun[çc]|pronomes?|plural|figuras? de linguagem|fun[çc][õo]es da linguagem|tipos? de sujeito|predicado|ora[çc][õo]es (?:coordenad|subordinad)/i;
const YES_MAT = /juros|montante|\bárea\b|volume|per[íi]metro|progress[ãa]o|combinat|permuta[çc]|arranjo|probabilid|pot[êe]ncia|radicia|bh[áa]skara|equa[çc][ãa]o do 2|trigonom|\bseno\b|cosseno|\bmmc\b|\bmdc\b|divisibilidade|porcentagem|regra de tr[êe]s|raz[ãa]o e propor/i;
const YES_RL = /tabela.verdade|conectiv|condicional|bicondicional|\bse\b.{1,60}\bent[ãa]o\b|nega[çc][ãa]o|equival|contrapositiv|de morgan|silogism|quantificador|\btodos?\b|\balgum\b|\bnenhum\b|tautolog|contradi[çc][ãa]o|conting[êe]ncia/i;
const YES_INFO = /atalho|ctrl\s*\+|tecla|protocolo|\bportas?\b|camadas?|extens[ãa]o de arquivo|backup|v[íi]rus|malware|phishing|firewall/i;
export function mayHaveMnemonic(q: { enunciado: string; alternativas: { texto: string }[]; materia?: string; assunto?: string; mnemo?: MnemoStatus }) {
  if (q.mnemo === 'yes') return true;
  if (q.mnemo === 'no') return false;
  const text = [q.assunto ?? '', q.enunciado, ...q.alternativas.map((a) => a.texto)].join(' ').replace(/<[^>]+>/g, ' ');
  if (NO_KIND.test(text)) return false;
  // Alternativa que enumera itens ("cônjuge, ascendente, descendente ou irmão") também é lista memorizável.
  const enumerates = q.alternativas.some((a) => (a.texto.replace(/<[^>]+>/g, ' ').match(/,/g) ?? []).length >= 2);
  return [YES_TEXT, YES_PT, YES_MAT, YES_RL, YES_INFO].some((re) => re.test(text)) || enumerates;
}
