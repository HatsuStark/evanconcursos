// Revisão curta em cartões: transforma a folha de memorização em uma sequência curta de cartões. Os de recordação
// (perguntas, gatilhos, mnemônicos) escondem a resposta; os de leitura (para memorizar, pegadinhas) só passam.
// A memória do aluno (o que já sabe, o que não lembrou, o que já leu) muda a seleção e a ordem da próxima vez.

export type ReviewCardType = 'recall' | 'cue' | 'mnemo' | 'memo' | 'trap';
export interface ReviewCard {
  id: string; type: ReviewCardType;
  front: string;            // pergunta, pista, alvo do mnemônico ou texto de leitura
  back?: string;            // resposta (recordação)
  mnemonic?: string;        // sigla do mnemônico
}
export interface ReviewSheet {
  perguntas?: { pergunta: string; resposta: string }[];
  gatilhos?: { pista: string; resposta: string }[];
  mnemonicos?: { alvo: string; mnemonico: string; explicacao: string }[];
  memorizar?: string[];
  pegadinhas?: string[];
}
export interface ReviewMemory { known: string[]; missed: string[]; seen: string[] }
export const emptyMemory = (): ReviewMemory => ({ known: [], missed: [], seen: [] });

export const MAX_READ_CARDS = 6, MAX_CARDS = 16;
export const asksRecall = (t: ReviewCardType) => t === 'recall' || t === 'cue' || t === 'mnemo';

// Id estável pelo conteúdo: a mesma revisão gera os mesmos ids em qualquer aparelho.
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
const card = (type: ReviewCardType, front: string, extra: Omit<ReviewCard, 'id' | 'type' | 'front'> = {}): ReviewCard =>
  ({ id: `${type}-${hash(front + '|' + (extra.back ?? ''))}`, type, front, ...extra });

// Intercala listas: um de cada por vez, para não emendar vários cartões iguais.
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

export function allReviewCards(s: ReviewSheet): ReviewCard[] {
  const clean = (t?: string) => (t ?? '').trim();
  const cues = (s.gatilhos ?? []).filter((x) => clean(x.pista) && clean(x.resposta)).map((x) => card('cue', clean(x.pista), { back: clean(x.resposta) }));
  const recalls = (s.perguntas ?? []).filter((x) => clean(x.pergunta) && clean(x.resposta)).map((x) => card('recall', clean(x.pergunta), { back: clean(x.resposta) }));
  const mnemos = (s.mnemonicos ?? []).filter((x) => clean(x.mnemonico)).map((x) => card('mnemo', clean(x.alvo), { mnemonic: clean(x.mnemonico), back: clean(x.explicacao) }));
  const memos = (s.memorizar ?? []).map(clean).filter(Boolean).map((t) => card('memo', t));
  const traps = (s.pegadinhas ?? []).map(clean).filter(Boolean).map((t) => card('trap', t));
  return [...interleave([cues, recalls, mnemos]), ...interleave([memos, traps])];
}

// Sequência do dia: sai o que o aluno já sabe; o que ele não lembrou vem primeiro; dos cartões de leitura, os ainda não
// lidos têm preferência. Um cartão de leitura a cada dois de recordação. Se ele já sabe tudo, a revisão volta inteira.
export function buildReviewDeck(s: ReviewSheet, mem: ReviewMemory = emptyMemory()): { cards: ReviewCard[]; restarted: boolean } {
  const all = allReviewCards(s);
  const known = new Set(mem.known), missed = new Set(mem.missed), seen = new Set(mem.seen);
  let asks = all.filter((c) => asksRecall(c.type) && !known.has(c.id));
  const restarted = !asks.length && all.some((c) => asksRecall(c.type));
  if (restarted) asks = all.filter((c) => asksRecall(c.type));
  asks = [...asks.filter((c) => missed.has(c.id)), ...asks.filter((c) => !missed.has(c.id))];
  const reads = all.filter((c) => !asksRecall(c.type));
  const ordered = [...reads.filter((c) => !seen.has(c.id)), ...reads.filter((c) => seen.has(c.id))].slice(0, MAX_READ_CARDS);
  const cards: ReviewCard[] = [];
  let a = 0, r = 0;
  while ((a < asks.length || r < ordered.length) && cards.length < MAX_CARDS) {
    for (let k = 0; k < 2 && a < asks.length && cards.length < MAX_CARDS; k++) cards.push(asks[a++]!);
    if (r < ordered.length && cards.length < MAX_CARDS) cards.push(ordered[r++]!);
  }
  return { cards, restarted };
}

export type CardAnswer = 'know' | 'again' | 'read';
// Atualiza a memória com as respostas do dia. Se a revisão recomeçou (já sabia tudo), zera o "já sei".
export function rememberAnswers(mem: ReviewMemory, answers: Record<string, CardAnswer>, restarted = false): ReviewMemory {
  const known = new Set(restarted ? [] : mem.known), missed = new Set(mem.missed), seen = new Set(mem.seen);
  for (const [id, a] of Object.entries(answers)) {
    if (a === 'know') { known.add(id); missed.delete(id); }
    else if (a === 'again') { missed.add(id); known.delete(id); }
    else seen.add(id);
  }
  return { known: [...known], missed: [...missed], seen: [...seen] };
}

export type ReviewVerdict = 'lembrei' | 'parcial' | 'esqueci';
// Resultado sugerido para a revisão de teoria: 80% ou mais lembrados = bem; metade ou mais = em parte.
export function suggestVerdict(right: number, total: number): ReviewVerdict {
  if (!total) return 'lembrei';
  const p = right / total;
  return p >= 0.8 ? 'lembrei' : p >= 0.5 ? 'parcial' : 'esqueci';
}
