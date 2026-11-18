// Aprender por Questões: motor da aula guiada por perguntas e da revisão espaçada dos conceitos. Tudo aqui é puro (sem
// banco nem IA): a Edge Function "tutor" gera a aula; a tela usa estas regras para ordenar as perguntas, adaptar a
// sequência às respostas, medir o domínio de cada conceito e agendar as revisões.
//
// Separação das metas: as respostas daqui nunca entram em question_attempts. Não contam na meta diária de questões
// reais, no percentual de acerto por banca nem nos simulados; o progresso fica em tutor_sessions e tutor_concepts.

export type Etapa = 'diagnostico' | 'construcao' | 'reforco' | 'aplicacao' | 'fixacao' | 'final' | 'revisao';
export type Formato = 'multipla' | 'certo_errado' | 'lacuna' | 'curta' | 'ordenacao';
export type Estilo = 'conceito' | 'situacao' | 'erro' | 'comparacao' | 'aplicacao';

export interface TutorConcept {
  id: string;            // c1, c2… (estável dentro da aula)
  nome: string;
  essencial: string;     // a ideia em 1–2 frases (base das revisões futuras)
  explicacao: string;    // explicação breve, mostrada a pedido ou depois de errar
  outro_jeito: string;   // analogia ou exemplo: "Explicar de outro jeito"
  base: string;          // dispositivo legal fornecido (ex.: "CF, art. 37") ou ''
}

export interface TutorQuestion {
  id: string;
  etapa: Etapa;
  conceito: string;      // id do conceito
  estilo: Estilo;
  formato: Formato;
  enunciado: string;
  alternativas: string[]; // múltipla: as opções; ordenação: os itens NA ORDEM CORRETA; demais: []
  gabarito: string;       // múltipla: letra; certo/errado: C ou E; lacuna/curta: resposta esperada; ordenação: ''
  aceitas: string[];      // lacuna/curta: outras formas aceitas da resposta
  dica: string;
  explicacao: string;
  erros: string[];        // múltipla: por que cada alternativa está errada ('' na correta)
  distratores?: string[]; // lacuna/curta: respostas erradas plausíveis, para responder escolhendo (aulas antigas não têm)
}

// Exemplo resolvido mostrado antes da aplicação: um caso resolvido passo a passo. As perguntas dos passos formam o
// roteiro que o estudante reaproveita na primeira situação-problema (depois, o apoio sai).
export interface WorkedExample { conceito: string; caso: string; passos: { pergunta: string; resposta: string }[]; conclusao: string }

export interface TutorLesson { titulo: string; conceitos: TutorConcept[]; questoes: TutorQuestion[]; exemplo?: WorkedExample | null; parcial?: boolean }

// Uma resposta. `hint`: pediu dica; `explained`: viu a explicação (ou o cartão do modo iniciante) antes de responder;
// `unknown`: "Não sei"; `selfGraded`: o próprio estudante conferiu a resposta escrita (a correção automática falhou).
export interface AnswerLog {
  qid: string; conceito: string; etapa: Etapa; correct: boolean;
  hint: boolean; explained: boolean; unknown: boolean; selfGraded?: boolean;
  response: string; at: string;
}

export interface TutorState {
  v: 1;
  queue: string[];     // próximas perguntas, a primeira é a atual
  logs: AnswerLog[];
  skipped: string[];   // tiradas da sequência (conceito já dominado no diagnóstico)
  reported: string[];  // reportadas pelo estudante: saem da aula e não contam
  known: string[];     // conceitos que o estudante já dominava (aulas anteriores ou diagnóstico)
  novice?: boolean;    // modo iniciante: o diagnóstico mostrou que o tema é novo; cada conceito abre com um cartão de ensino
  taught?: string[];   // conceitos cujo cartão de ensino já foi mostrado
  exampleSeen?: boolean; // o exemplo resolvido da aplicação já foi mostrado
}

// Ordem das etapas na aula. Reforço não entra na fila inicial: só aparece depois de um erro.
export const STAGE_ORDER: Etapa[] = ['diagnostico', 'construcao', 'aplicacao', 'fixacao', 'final'];
export const STAGE_LABEL: Record<Etapa, string> = {
  diagnostico: 'Diagnóstico', construcao: 'Construção', reforco: 'Construção', aplicacao: 'Aplicação', fixacao: 'Fixação', final: 'Verificação final', revisao: 'Revisão',
};
// Etapas em que o estudante pode pedir dica ou a explicação antes de responder. Diagnóstico, fixação, verificação final
// e revisão medem o que ele já sabe: só "Não sei".
export const canAskHelp = (e: Etapa) => e === 'construcao' || e === 'reforco' || e === 'aplicacao';

const rank = (e: Etapa) => (e === 'reforco' ? STAGE_ORDER.indexOf('construcao') : STAGE_ORDER.indexOf(e));
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };

// Fixação e verificação final intercaladas: fora da ordem em que os conceitos foram ensinados e sem dois do mesmo
// conceito em sequência, para o estudante ter de reconhecer qual regra se aplica (como na prova). Sempre a mesma ordem
// para a mesma aula.
export function interleave(qs: TutorQuestion[]): TutorQuestion[] {
  const rest = [...qs].sort((a, b) => hash(a.id + a.enunciado) - hash(b.id + b.enunciado));
  const out: TutorQuestion[] = [];
  while (rest.length) {
    const i = rest.findIndex((q) => q.conceito !== out[out.length - 1]?.conceito);
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0]!);
  }
  return out;
}
const MIXED: Etapa[] = ['fixacao', 'final'];
function orderQueue(lesson: TutorLesson, qs: TutorQuestion[]): TutorQuestion[] {
  const pos = new Map(lesson.conceitos.map((c, i) => [c.id, i]));
  const sorted = [...qs].sort((a, b) => rank(a.etapa) - rank(b.etapa) || (a.etapa === 'construcao' ? (pos.get(a.conceito) ?? 99) - (pos.get(b.conceito) ?? 99) : 0));
  return STAGE_ORDER.flatMap((e) => { const inStage = sorted.filter((q) => q.etapa === e); return MIXED.includes(e) ? interleave(inStage) : inStage; });
}

// Acerto que prova domínio: de primeira, sem dica, sem ter visto a explicação e sem conferência própria.
export const isStrong = (l: AnswerLog) => l.correct && !l.hint && !l.explained && !l.unknown && !l.selfGraded;

function inQueue(lesson: TutorLesson, state: Omit<TutorState, 'queue'> & { queue?: string[] }) {
  const used = new Set([...(state.queue ?? []), ...state.logs.map((l) => l.qid), ...state.skipped, ...state.reported]);
  const known = new Set(state.known);
  const fresh = lesson.questoes.filter((q) => q.etapa !== 'reforco' && q.etapa !== 'revisao' && !used.has(q.id));
  const skip = fresh.filter((q) => q.etapa === 'construcao' && known.has(q.conceito)).map((q) => q.id);
  return { add: orderQueue(lesson, fresh.filter((q) => !skip.includes(q.id))).map((q) => q.id), skip };
}

// Começo da aula. `known`: conceitos já dominados (de aulas anteriores do mesmo tema); a construção deles é pulada.
export function initialState(lesson: TutorLesson, known: string[] = []): TutorState {
  const base = { v: 1 as const, logs: [], skipped: [], reported: [], known: [...new Set(known)] };
  const { add, skip } = inQueue(lesson, base);
  return { ...base, queue: add, skipped: skip };
}

// A aula chega em partes (diagnóstico e construção primeiro): as perguntas novas entram depois das que já estão na fila.
export function syncQueue(state: TutorState, lesson: TutorLesson): TutorState {
  const { add, skip } = inQueue(lesson, state);
  if (!add.length && !skip.length) return state;
  return { ...state, queue: [...state.queue, ...add], skipped: [...state.skipped, ...skip] };
}

// Posição do reforço depois de um erro: uma pergunta de folga, para não ser a repetição imediata da mesma ideia.
const REFORCO_GAP = 1;

// Registra a resposta da pergunta atual e adapta a sequência:
// - acerto forte no diagnóstico: o conceito já é conhecido e a construção dele sai da fila;
// - erro na construção, aplicação ou fixação: entra o reforço do conceito (nova formulação), se ainda não foi usado.
export function applyAnswer(state: TutorState, lesson: TutorLesson, log: AnswerLog): TutorState {
  let queue = state.queue.filter((id) => id !== log.qid);
  const skipped = [...state.skipped], known = [...state.known];
  if (log.etapa === 'diagnostico' && isStrong(log)) {
    const drop = lesson.questoes.filter((q) => q.etapa === 'construcao' && q.conceito === log.conceito && queue.includes(q.id)).map((q) => q.id);
    queue = queue.filter((id) => !drop.includes(id));
    skipped.push(...drop);
    if (!known.includes(log.conceito)) known.push(log.conceito);
  }
  if (!log.correct && (log.etapa === 'construcao' || log.etapa === 'aplicacao' || log.etapa === 'fixacao')) {
    const used = new Set([...queue, ...state.logs.map((l) => l.qid), log.qid, ...state.reported]);
    const reforco = lesson.questoes.find((q) => q.etapa === 'reforco' && q.conceito === log.conceito && !used.has(q.id));
    if (reforco) queue.splice(Math.min(REFORCO_GAP, queue.length), 0, reforco.id);
  }
  const logs = [...state.logs, log];
  // Fim do diagnóstico: tema novo para o estudante liga o modo iniciante.
  const novice = state.novice ?? (log.etapa === 'diagnostico' && !queue.some((id) => lesson.questoes.find((q) => q.id === id)?.etapa === 'diagnostico') ? isNovice(logs) : undefined);
  return { ...state, queue, skipped, known, logs, ...(novice !== undefined ? { novice } : {}) };
}

// Tema novo: no diagnóstico, menos da metade de acertos fortes (dica e "Não sei" não contam).
export function isNovice(logs: AnswerLog[]) {
  const diag = logs.filter((l) => l.etapa === 'diagnostico');
  return diag.length > 0 && diag.filter(isStrong).length * 2 < diag.length;
}

// Modo iniciante: o cartão de ensino aparece antes da primeira pergunta de construção (ou reforço) de cada conceito.
export const needsTeaching = (state: TutorState, q: TutorQuestion) =>
  !!state.novice && (q.etapa === 'construcao' || q.etapa === 'reforco') && !(state.taught ?? []).includes(q.conceito);
export const markTaught = (state: TutorState, conceito: string): TutorState => ({ ...state, taught: [...new Set([...(state.taught ?? []), conceito])] });

// Exemplo resolvido: aparece uma vez, antes da primeira pergunta de aplicação.
export const needsExample = (state: TutorState, lesson: TutorLesson, q: TutorQuestion) => q.etapa === 'aplicacao' && !!lesson.exemplo?.passos.length && !state.exampleSeen;
// Apoio que vai saindo: a primeira situação-problema depois do exemplo oferece o roteiro (as perguntas dos passos, sem as
// respostas); as seguintes, não.
export const offersRoadmap = (state: TutorState, lesson: TutorLesson, q: TutorQuestion) =>
  q.etapa === 'aplicacao' && !!lesson.exemplo?.passos.length && !state.logs.some((l) => l.etapa === 'aplicacao' && l.qid !== q.id);

// Pergunta reportada: sai da fila e as respostas dela deixam de contar.
export function reportQuestion(state: TutorState, qid: string): TutorState {
  return { ...state, queue: state.queue.filter((id) => id !== qid), logs: state.logs.filter((l) => l.qid !== qid), reported: [...new Set([...state.reported, qid])] };
}

export function progress(state: TutorState) {
  const done = state.logs.length, total = done + state.queue.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// ---------- Domínio de cada conceito ----------

export type Level = 'dominado' | 'em_progresso' | 'atencao';
export const LEVEL_LABEL: Record<Level, string> = { dominado: 'Dominado', em_progresso: 'Em construção', atencao: 'Precisa de atenção' };

const late = (e: Etapa) => e === 'fixacao' || e === 'final' || e === 'revisao';

// Domínio a partir das respostas da aula. Acertar depois de ver a explicação ou com dica não prova domínio:
// - atenção: errou na verificação final, ou errou duas vezes sem dois acertos fortes;
// - dominado: acerto forte na fixação ou na verificação final, sem erro nelas, e mais acertos fortes que erros;
// - em construção: o resto. null se o conceito não apareceu na aula.
export function conceptLevel(logs: AnswerLog[]): Level | null {
  if (!logs.length) return null;
  const strong = logs.filter(isStrong).length, wrong = logs.filter((l) => !l.correct).length;
  const strongLate = logs.some((l) => late(l.etapa) && isStrong(l)), wrongLate = logs.some((l) => late(l.etapa) && !l.correct);
  if (logs.some((l) => l.etapa === 'final' && !l.correct) || (wrong >= 2 && strong < 2)) return 'atencao';
  if (strongLate && !wrongLate && strong > wrong) return 'dominado';
  return 'em_progresso';
}

export interface ConceptOutcome { id: string; nome: string; level: Level; strong: number; weak: number; wrong: number }

// Resumo da aula, na ordem dos conceitos. Conceito pulado por já ser conhecido (sem nenhuma resposta) fica de fora.
export function summarize(lesson: TutorLesson, state: TutorState): ConceptOutcome[] {
  return lesson.conceitos.flatMap((c) => {
    const logs = state.logs.filter((l) => l.conceito === c.id);
    const level = conceptLevel(logs);
    if (!level) return [];
    return [{ id: c.id, nome: c.nome, level, strong: logs.filter(isStrong).length, weak: logs.filter((l) => l.correct && !isStrong(l)).length, wrong: logs.filter((l) => !l.correct).length }];
  });
}

// ---------- Revisão espaçada ----------

// Intervalos (dias) de cada etapa da revisão: começa em 1, 3, 7 e 14 e segue espaçando conforme o estudante lembra.
export const REVIEW_STEPS = [1, 3, 7, 14, 30, 60];
// Conceito esquecido duas vezes ou mais volta com intervalos mais curtos.
const HARD_LAPSES = 2, HARD_FACTOR = 0.6;

export interface ConceptMemory { level: Level; step: number; lapses: number; reviews: number; due_on: string | null }

export function addDays(ymdStr: string, days: number): string {
  const [y, m, d] = ymdStr.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

const intervalFor = (step: number, lapses: number) => {
  const base = REVIEW_STEPS[Math.min(step, REVIEW_STEPS.length - 1)]!;
  return Math.max(1, Math.round(base * (lapses >= HARD_LAPSES ? HARD_FACTOR : 1)));
};

// Perto da prova, a revisão vai no máximo para a véspera; depois dela, não há mais revisão (null).
function capDue(due: string, today: string, examDate: string | null | undefined): string | null {
  if (!examDate) return due;
  const eve = addDays(examDate, -1);
  if (today >= eve) return null;
  return due > eve ? eve : due;
}

// Depois de uma aula: conceito novo começa na etapa do domínio mostrado (dominado já salta para 3 dias). Conceito já
// conhecido que piorou volta para o começo; que segue dominado mantém a etapa em que estava.
export function scheduleAfterLesson(prev: ConceptMemory | null, level: Level, today: string, examDate?: string | null): ConceptMemory {
  const lapses = prev?.lapses ?? 0;
  const step = level === 'dominado' ? Math.max(prev?.step ?? 0, 1) : 0;
  const worse = !!prev && level !== 'dominado' && prev.level === 'dominado';
  const memory = { level, step, lapses: lapses + (worse ? 1 : 0), reviews: prev?.reviews ?? 0 };
  return { ...memory, due_on: capDue(addDays(today, intervalFor(step, memory.lapses)), today, examDate) };
}

// Resultado de uma revisão: forte (acertou sem ajuda) avança; fraco (acertou com ajuda ou conferindo sozinho) repete o
// intervalo; erro volta para 1 dia e conta como esquecimento.
export type ReviewOutcome = 'forte' | 'fraco' | 'erro';
export const reviewOutcome = (l: AnswerLog): ReviewOutcome => (isStrong(l) ? 'forte' : l.correct ? 'fraco' : 'erro');

export function scheduleAfterReview(prev: ConceptMemory, outcome: ReviewOutcome, today: string, examDate?: string | null): ConceptMemory {
  const step = outcome === 'forte' ? Math.min(prev.step + 1, REVIEW_STEPS.length - 1) : outcome === 'fraco' ? prev.step : 0;
  const lapses = prev.lapses + (outcome === 'erro' ? 1 : 0);
  const level: Level = outcome === 'erro' ? 'atencao' : outcome === 'forte' ? (step >= 2 || prev.level === 'dominado' ? 'dominado' : 'em_progresso') : 'em_progresso';
  return { level, step, lapses, reviews: prev.reviews + 1, due_on: capDue(addDays(today, intervalFor(step, lapses)), today, examDate) };
}

// Conceitos que vencem hoje, os mais urgentes primeiro (atenção, depois os mais atrasados). Sessão curta: no máximo
// `max`, para a revisão não pesar no dia.
export const REVIEW_SESSION_MAX = 8;
export function dueConcepts<T extends { due_on: string | null; level: Level; lapses: number }>(rows: T[], today: string, max = REVIEW_SESSION_MAX): T[] {
  const w = (l: Level) => (l === 'atencao' ? 0 : l === 'em_progresso' ? 1 : 2);
  return rows.filter((r) => r.due_on && r.due_on <= today)
    .sort((a, b) => w(a.level) - w(b.level) || a.due_on!.localeCompare(b.due_on!) || b.lapses - a.lapses).slice(0, max);
}

// ---------- Correção ----------

export const normalizeAnswer = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9%§º°]+/g, ' ').replace(/\b(o|a|os|as|um|uma|de|do|da|dos|das)\b/g, ' ').replace(/\s+/g, ' ').trim();

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

// Resposta escrita que confere com o gabarito ou uma das formas aceitas, tolerando acentos, artigos e um erro de
// digitação (dois nas respostas longas). Sem conferência aqui, a correção vai para a IA.
export function matchesText(answer: string, q: Pick<TutorQuestion, 'gabarito' | 'aceitas'>) {
  const a = normalizeAnswer(answer);
  if (!a) return false;
  return [q.gabarito, ...q.aceitas].map(normalizeAnswer).filter(Boolean).some((e) => a === e || editDistance(a, e) <= (e.length >= 10 ? 2 : e.length >= 5 ? 1 : 0));
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// Correção das perguntas fechadas. Texto livre devolve null (vai para matchesText e, se preciso, para a IA).
export function checkClosed(q: TutorQuestion, response: string): boolean | null {
  if (q.formato === 'multipla') return response.trim().toUpperCase() === q.gabarito.trim().toUpperCase();
  if (q.formato === 'certo_errado') return response.trim().toUpperCase().charAt(0) === q.gabarito.trim().toUpperCase().charAt(0);
  if (q.formato === 'ordenacao') return response === q.alternativas.map((_, i) => i).join(',');
  return null;
}

// Ordenação: os itens vêm na ordem certa; a tela mostra embaralhados (sempre do mesmo jeito para a mesma pergunta, e
// nunca já na ordem certa). Devolve os índices originais na ordem de exibição.
export function shuffledOrder(id: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  if (n > 1 && idx.every((v, i) => v === i)) idx.push(idx.shift()!);
  return idx;
}

// Lacuna e resposta curta respondidas sem digitar: a resposta certa e até 3 erradas plausíveis, embaralhadas sempre do
// mesmo jeito. As erradas vêm da própria pergunta; faltando (aulas antigas), das respostas de outras perguntas de
// lacuna/curta da aula, as de tamanho mais parecido. Menos de 2 opções: a tela volta para a digitação.
export function answerOptions(q: TutorQuestion, pool: TutorQuestion[] = [], n = 4): string[] {
  const seen = new Set([q.gabarito, ...q.aceitas].map(normalizeAnswer).filter(Boolean));
  const wrong: string[] = [];
  const add = (s: string) => {
    const k = normalizeAnswer(s);
    if (!k || seen.has(k) || wrong.length >= n - 1) return;
    seen.add(k); wrong.push(s.trim());
  };
  (q.distratores ?? []).forEach(add);
  pool.filter((o) => o.id !== q.id && (o.formato === 'lacuna' || o.formato === 'curta'))
    .sort((a, b) => Math.abs(a.gabarito.length - q.gabarito.length) - Math.abs(b.gabarito.length - q.gabarito.length))
    .forEach((o) => add(o.gabarito));
  const opts = [q.gabarito.trim(), ...wrong];
  return opts.length < 2 ? opts : shuffledOrder(q.id, opts.length).map((i) => opts[i]!);
}
