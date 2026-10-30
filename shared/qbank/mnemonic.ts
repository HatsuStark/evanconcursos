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
const NO_SUBJECT = /portugu|lingua|matem|racioc|logic|estatist|interpreta|reda[cç]|ingl|espanhol|atualidade/i;
const NO_TEXT = /de acordo com o texto|segundo o texto|no texto|do texto|o autor|trecho|sinônimo|calcule|qual o valor|quantos|probabilidade|porcentagem/i;
const YES_TEXT = /requisit|element|princ[íi]pi|hip[óo]tes|esp[ée]cie|modalidad|prazo|\bdias?\b|classific|compet[êe]n|exceto|características|\bfases?\b|\betapas?\b|\bordem\b|legitimad|\brol\b|caben|cabe |\bart(?:igo)?s?\.?\s*\d|\blei\b|san[çc][õo]es|penas?\b|recursos?\b|efeitos|formas? de|tipos? de|são (?:eles|elas)|seguintes/i;
export function mayHaveMnemonic(q: { enunciado: string; alternativas: { texto: string }[]; materia?: string; assunto?: string; mnemo?: MnemoStatus }) {
  if (q.mnemo === 'yes') return true;
  if (q.mnemo === 'no') return false;
  if (NO_SUBJECT.test(`${q.materia ?? ''} ${q.assunto ?? ''}`)) return false;
  const text = [q.enunciado, ...q.alternativas.map((a) => a.texto)].join(' ').replace(/<[^>]+>/g, ' ');
  if (NO_TEXT.test(text)) return false;
  // Alternativa que enumera itens ("cônjuge, ascendente, descendente ou irmão") também é lista memorizável.
  const enumerates = q.alternativas.some((a) => (a.texto.replace(/<[^>]+>/g, ' ').match(/,/g) ?? []).length >= 2);
  return YES_TEXT.test(text) || enumerates;
}
