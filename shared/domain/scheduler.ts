// Scheduler: distribui matérias e conteúdos no calendário de forma determinística (mesma entrada, mesmo resultado), como
// um especialista em concursos montaria. Datas, horas, revisões e simulados nunca vêm da IA.
// - Dia com 2 ou 3 blocos de 1 h a 1h30, de matérias diferentes, alternando específica e básica.
// - Teoria sempre com questões no fim do bloco, com meta que cresce ao longo do plano; blocos de reforço (questões dos
//   pontos fracos) desde a 3ª semana; na reta final, pente-fino do que já foi estudado e revisão final, sem teoria nova.
// - Simulado diagnóstico na 2ª semana e depois a cada 2 ou 3 semanas; na reta final, um por semana.
// - Proporções pelo prazo: com pouco tempo, menos teoria nova e mais questões e revisão.
// - Tempo de cada matéria pelos pontos em jogo (questões × peso), pela distância até a meta (nível) e pela prioridade da IA.
// - Lei seca diária em concurso de legislação: releitura dos artigos das sessões estudadas (no dia seguinte e uma semana depois).
// - Semana leve a cada 5 e dia curto (menos de 1 h) só com questões e revisão.
// - Revisão semanal num bloco de até 1h30 no último dia de estudo da semana; simulado no maior dia.
import { parseYmd, ymd } from './dates.ts';

export const LEVELS = ['Iniciante', 'Básico', 'Intermediário', 'Avançado'] as const;
export const DEFAULT_HOURS = [2, 2, 2, 2, 2, 3, 2];
// Marca de tarefa de reforço: o assunto é decidido na hora pelo desempenho (assunto mais fraco).
export const WEAK_MARK = '*fracos*';
// Meta de questões do bloco de teoria pela fase do plano (`progress`: 0 no início da teoria, 1 no começo da reta final).
// A parte de questões cresce como num plano de especialista: no 1º terço, amostra do tema (1 a cada 12 min, de 5 a 10;
// cerca de 60% teoria e 40% questões, com a correção); no 2º, 1 a cada 5 min (de 10 a 20; o inverso); no último, 1 a
// cada 3 min (de 15 a 30). Sem `progress`, vale a primeira fase.
const GOAL_PHASES = [{ every: 12, min: 5, max: 10 }, { every: 5, min: 10, max: 20 }, { every: 3, min: 15, max: 30 }];
export const theoryGoal = (minutes: number, progress = 0) => {
  const p = GOAL_PHASES[progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2]!;
  return Math.min(p.max, Math.max(p.min, Math.round(minutes / p.every)));
};
// Questões por hora nos blocos de reforço e de revisão final.
const REINFORCE_PER_HOUR = 15;

export interface SubjectInput { name: string; core: boolean }
// openEnded: plano sem prazo. examDate é só o fim da primeira volta, e o calendário não tem reta final nem simulados.
export interface ScheduleInput { startDate: string; examDate: string; subjects: SubjectInput[]; openEnded?: boolean }
// weight: prioridade da IA (1–5); level: nível do candidato (0 iniciante … 3 avançado); topics: o que cada bloco de teoria
// cobre, em ordem; topicCount: tópicos do edital (mínimo de blocos); questions/stake: questões na prova e peso no edital;
// minPct: nota mínima do bloco da prova (eliminatória); lawItems: quais itens de `topics` citam lei (para a lei seca);
// incidence: 1 a 3 por item, quanto a banca cobra (os mais cobrados são relidos mais vezes).
export interface SubjectConfig {
  weight: number; level: number; topics: string[];
  topicCount?: number; questions?: number; stake?: number; minPct?: number; lawItems?: boolean[]; incidence?: number[];
}
// lawReading: reservar a lei seca diária (concurso com muita legislação).
export interface ScheduleConfig { hours: number[]; weeklyReview: boolean; lawReading?: boolean; subjects: Record<string, SubjectConfig> }

// pente_fino: na reta final, revisão do que já foi estudado (para memorizar, pegadinhas, marcações e flashcards), sem teoria nova.
export type BlockKind = 'theory' | 'consolidation' | 'final_review' | 'pente_fino' | 'lei_seca' | 'weekly_review';
// item: no bloco de teoria, o índice do tópico/sessão da matéria; na lei seca, o da sessão relida; -1 nos demais.
export interface Block { kind: BlockKind; subject: string; minutes: number; item: number; text: string; keyword: string; goal: number }
export type DayKind = '' | 'rest' | 'exam' | 'eve' | 'weekly_review' | 'simulado' | 'study';
export interface ScheduledDay { text: string; hours: number; kind: DayKind; blocks: Block[]; light?: boolean }
export interface Week { title: string; days: ScheduledDay[] }
export interface ScheduleSummary {
  weeks: number; studyDays: number; theory: number; consol: number; final: number; simulados: number; lawReading: number; hours: number;
  perSubject: { name: string; days: number }[];
}
export interface Schedule { weeks: Week[]; startDate: string; config: ScheduleConfig; summary: ScheduleSummary }

// Conteúdo programático colado do edital: separa por linha, ";" ou numeração ("1. ", "2) ", "3 – ").
export function splitTopics(text: string): string[] {
  return String(text || '').split(/\n|;|\s(?=\d+(?:\.\d+)*\s*[.)\-–]\s)/)
    .map((s) => s.replace(/^\s*\d+(?:\.\d+)*\s*[.)\-–]\s*/, '').replace(/^[\s\-–•]+|[\s.]+$/g, ''))
    .filter((s) => s.length > 2).slice(0, 200);
}

// Palavra-chave curta para o filtro de questões: começo do tópico, sem "Noções de" e afins.
export const topicKeyword = (t: string): string =>
  (t.replace(/^(noções|conceitos|aspectos)\s+(gerais\s+)?(de|do|da|dos|das)\s+/i, '').split(/[,:(;]/)[0] ?? '').trim().slice(0, 50);

export function defaultConfig(input: ScheduleInput): ScheduleConfig {
  return {
    hours: [...DEFAULT_HOURS], weeklyReview: true,
    subjects: Object.fromEntries(input.subjects.map((s) => [s.name, { weight: s.core ? 3 : 2, level: 1, topics: [] }])),
  };
}

const num = (v: unknown, min: number, max: number) => { const n = Number(v); return v != null && Number.isFinite(n) && n >= min && n <= max ? n : undefined; };

export function normalizeConfig(raw: unknown, input: ScheduleInput): ScheduleConfig {
  const base = defaultConfig(input);
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<{ hours: unknown[]; weeklyReview: boolean; lawReading: boolean; subjects: Record<string, Partial<SubjectConfig>> }>;
  const hours = Array.from({ length: 7 }, (_, i) => num(c.hours?.[i], 0, 16) ?? base.hours[i]!);
  const subjects: Record<string, SubjectConfig> = {};
  for (const { name } of input.subjects) {
    const s = c.subjects?.[name] ?? {}, w = Number(s.weight), l = Number(s.level);
    subjects[name] = {
      weight: Number.isInteger(w) && w >= 1 && w <= 5 ? w : base.subjects[name]!.weight,
      level: Number.isInteger(l) && l >= 0 && l <= 3 ? l : 1,
      topics: (Array.isArray(s.topics) ? s.topics : []).map((t) => String(t).trim().slice(0, 160)).filter(Boolean).slice(0, 400),
      topicCount: num(s.topicCount, 0, 400), questions: num(s.questions, 0, 500), stake: num(s.stake, 0, 100), minPct: num(s.minPct, 0, 100),
      lawItems: Array.isArray(s.lawItems) ? s.lawItems.map(Boolean) : undefined,
      incidence: Array.isArray(s.incidence) ? s.incidence.map((x) => num(x, 1, 3) ?? 2) : undefined,
    };
  }
  return { hours, weeklyReview: c.weeklyReview !== false, lawReading: !!c.lawReading, subjects };
}

// Quanto tempo cada matéria merece: pontos em jogo (questões na prova, com retorno decrescente; sem o número, o peso no
// edital), distância até a meta pelo nível declarado, prioridade da IA e nota mínima eliminatória.
const GAP = [1, 0.8, 0.6, 0.45];
export function subjectDemand(s: SubjectConfig) {
  const stake = Math.max(1, s.questions || (s.stake ? s.stake * 2 : 5));
  return Math.pow(stake, 0.75) * (GAP[s.level] ?? 0.8) * (0.6 + 0.2 * s.weight) * (s.minPct ? 1.15 : 1);
}

// Proporções pelo prazo: quanto mais perto da prova, menos teoria nova e mais questões, revisão e simulados.
export function horizonShares(weeks: number, openEnded = false) {
  if (openEnded) return { final: 0, reinforce: 0, simuladoEvery: 0 };
  if (weeks >= 16) return { final: 0.12, reinforce: 0.1, simuladoEvery: 3 };
  if (weeks >= 8) return { final: 0.15, reinforce: 0.15, simuladoEvery: 2 };
  return { final: 0.2, reinforce: 0.25, simuladoEvery: 2 };
}

const BLOCK_MINUTES = 75, MAX_BLOCKS = 3, SHORT_DAY = 60, LAW_MIN_DAY = 90, LIGHT_WEEK_EVERY = 5, LIGHT_FACTOR = 0.7;
// Revisão semanal: 40% do dia, entre 45 min e 1h30; dia com menos de 1h30 fica todo para ela.
const REVIEW_MIN_DAY = 90;
const reviewMinutes = (day: number) => Math.min(90, Math.max(45, Math.round((day * 0.4) / 5) * 5));
// Lei seca: 20 min no dia de até 2h29, 25 min nos maiores.
const lawMinutes = (day: number) => (day >= 150 ? 25 : 20);

// Divide os minutos do dia em blocos de 1 h a 1h30 (múltiplos de 5; a sobra fica no primeiro). `reserve`: minutos tirados
// dos blocos (a lei seca), sem mudar quantos são.
export function splitDay(minutes: number, reserve = 0): number[] {
  const n = Math.min(MAX_BLOCKS, Math.max(1, Math.round(minutes / BLOCK_MINUTES))), rest = minutes - reserve;
  const each = Math.floor(rest / n / 5) * 5, out = Array<number>(n).fill(each);
  out[0]! += rest - each * n;
  return out;
}

// Distribui `total` vagas proporcionalmente aos pesos (maiores restos), com mínimo de 1 por item.
export function apportion(weights: number[], total: number): number[] {
  const n = weights.length;
  if (total < n) throw Error('Há menos dias de estudo do que matérias.');
  const sum = weights.reduce((a, b) => a + b, 0), free = total - n, raw = weights.map((w) => (w / sum) * free);
  const out = raw.map((x) => 1 + Math.floor(x));
  let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((x, i): [number, number] => [x - Math.floor(x), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .forEach(([, i]) => { if (left > 0) { out[i]!++; left--; } });
  return out;
}

// Como `apportion`, mas cada item recebe antes o seu mínimo (`floors`), limitado a 60% do total.
export function apportionWithFloors(weights: number[], floors: number[], total: number): number[] {
  const sum = floors.reduce((a, b) => a + b, 0), cap = Math.floor(total * 0.6);
  const f = sum > cap ? floors.map((x) => Math.max(1, Math.floor((x * cap) / sum))) : floors.map((x) => Math.max(1, x));
  const rest = total - f.reduce((a, b) => a + b, 0) + weights.length;
  if (rest < weights.length) return apportion(weights, total);
  return apportion(weights, rest).map((x, i) => x - 1 + f[i]!);
}

// Intercala as matérias respeitando as contagens (round-robin ponderado suave): espalha cada matéria
// ao longo do período em vez de concentrá-la em blocos.
export function interleave(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0), cur = counts.map(() => 0), seq: number[] = [];
  for (let k = 0; k < total; k++) {
    let best = -1;
    counts.forEach((c, i) => { cur[i]! += c; if (best < 0 || cur[i]! > cur[best]!) best = i; });
    cur[best]! -= total;
    seq.push(best);
  }
  return seq;
}

interface TaskText { text: string; keyword: string; item: number }

// Transforma n blocos de uma matéria em tarefas a partir dos tópicos (agrupa ou divide em partes).
export function subjectTasks(name: string, topics: string[], n: number): TaskText[] {
  if (!topics.length) return Array.from({ length: n }, (_, j) => ({ text: `${name}: estudo ${j + 1} de ${n}`, keyword: '', item: -1 }));
  if (n >= topics.length) {
    const per = apportion(topics.map(() => 1), n), out: TaskText[] = [];
    topics.forEach((t, i) => {
      for (let p = 0; p < per[i]!; p++) out.push({ text: `${name}: ${t}` + (per[i]! > 1 ? ` (parte ${p + 1} de ${per[i]})` : ''), keyword: topicKeyword(t), item: i });
    });
    return out;
  }
  const sizes = apportion(Array<number>(n).fill(1), topics.length), out: TaskText[] = [];
  let k = 0;
  for (const size of sizes) {
    const chunk = topics.slice(k, k + size);
    k += size;
    out.push({ text: `${name}: ${chunk.join('; ')}`.slice(0, 200), keyword: topicKeyword(chunk[0]!), item: k - size });
  }
  return out;
}

interface Slot { date: Date; week: number; hours: number; kind: DayKind; text: string; final: boolean; light: boolean; review: boolean; blocks: Block[] }
interface Pending { slot: Slot; day: number; minutes: number; kind: BlockKind | 'flex' }

export function generateSchedule(input: ScheduleInput, rawConfig: unknown): Schedule {
  const cfg = normalizeConfig(rawConfig, input), start = parseYmd(input.startDate) ?? new Date(), exam = parseYmd(input.examDate);
  if (!exam) throw Error('Informe a data da prova no plano.');
  if (exam <= start) throw Error('A data da prova precisa ser depois do início dos estudos.');
  if (!input.subjects.length) throw Error('O plano não tem matérias.');
  if (!cfg.hours.some((h) => h > 0)) throw Error('Informe horas de estudo em pelo menos um dia da semana.');
  const names = input.subjects.map((s) => s.name), core = new Set(input.subjects.filter((s) => s.core).map((s) => s.name));
  const tooShort = () => Error('Pouco tempo até a prova para cobrir todas as matérias com essas horas.');

  // Calendário de segunda a domingo, da semana do início até a semana da prova.
  const monday = new Date(start);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const slots: Slot[] = [];
  for (const d = new Date(monday); d <= exam || slots.length % 7; d.setDate(d.getDate() + 1)) {
    const wd = (d.getDay() + 6) % 7, inRange = d >= start && d < exam, hours = inRange ? cfg.hours[wd]! : 0;
    const isExam = d.getTime() === exam.getTime() && !input.openEnded;
    slots.push({
      date: new Date(d), week: Math.floor(slots.length / 7), hours, final: false, light: false, review: false, blocks: [],
      kind: isExam ? 'exam' : !inRange ? '' : hours ? 'study' : 'rest', text: isExam ? 'PROVA' : !inRange ? '' : hours ? '' : 'Descanso',
    });
  }
  let study = slots.filter((s) => s.kind === 'study');
  if (study.length < names.length + 1) throw tooShort();
  const firstWeek = study[0]!.week, relWeek = (s: Slot) => s.week - firstWeek;
  const share = horizonShares(study[study.length - 1]!.week - firstWeek + 1, input.openEnded);

  // Véspera: revisão leve. Reta final: os últimos dias de estudo.
  if (!input.openEnded) Object.assign(study.pop()!, { kind: 'eve', text: 'Revisão leve e descanso' });
  const finalN = study.length >= 15 ? Math.round(study.length * share.final) : 0;
  for (const s of study.slice(study.length - finalN)) s.final = true;
  const byWeek = new Map<number, Slot[]>();
  for (const s of study) { if (!byWeek.has(s.week)) byWeek.set(s.week, []); byWeek.get(s.week)!.push(s); }
  // Simulados no maior dia da semana: diagnóstico na 2ª semana, depois a cada 2 ou 3; na reta final, toda semana
  // (menos a da prova).
  const examWeek = slots.find((s) => s.kind === 'exam')?.week;
  if (share.simuladoEvery && study.length >= 20) {
    for (const [w, list] of byWeek) {
      const rel = w - firstWeek, inFinal = list.some((s) => s.final);
      const due = inFinal ? w !== examWeek : rel === 1 || (rel > 1 && (rel - 1) % share.simuladoEvery === 0);
      const free = list.filter((s) => s.kind === 'study');
      if (!due || free.length < 2) continue;
      Object.assign(free.reduce((a, b) => (b.hours > a.hours ? b : a)), { kind: 'simulado', text: 'Simulado completo da banca + correção' });
    }
  }
  // Semana leve a cada 5 (fora da reta final): 70% das horas.
  for (const s of study) if (!s.final && relWeek(s) % LIGHT_WEEK_EVERY === LIGHT_WEEK_EVERY - 1) s.light = true;
  // Revisão semanal no último dia de estudo de cada semana com 4 ou mais dias de estudo: um bloco de até 1h30; dia curto
  // fica todo para ela.
  const dayMinutes = (s: Slot) => Math.round(s.hours * 60 * (s.light ? LIGHT_FACTOR : 1));
  if (cfg.weeklyReview) for (const list of byWeek.values()) {
    const free = list.filter((s) => s.kind === 'study');
    if (list.length < 4 || !free.length) continue;
    const day = free[free.length - 1]!;
    if (dayMinutes(day) < REVIEW_MIN_DAY) Object.assign(day, { kind: 'weekly_review', text: 'Revisão da semana e caderno de erros' });
    else day.review = true;
  }
  study = study.filter((s) => s.kind === 'study');

  // Blocos do dia. Dia curto vira questões e revisão; lei seca reservada nos dias de 1h30 ou mais.
  // Reta final: o primeiro bloco do dia é pente-fino; dia de um bloco só alterna pente-fino e revisão final.
  const blocks: Pending[] = [];
  let finalDay = 0;
  study.forEach((s, day) => {
    const review = s.review ? reviewMinutes(dayMinutes(s)) : 0, minutes = dayMinutes(s) - review;
    if (review) blocks.push({ slot: s, day, minutes: review, kind: 'weekly_review' });
    const law = cfg.lawReading && minutes >= LAW_MIN_DAY ? lawMinutes(minutes) : 0;
    if (law) blocks.push({ slot: s, day, minutes: law, kind: 'lei_seca' });
    if (s.final) {
      const parts = splitDay(minutes, law);
      parts.forEach((m, i) => blocks.push({ slot: s, day, minutes: m, kind: i === 0 && (parts.length > 1 || finalDay % 2 === 0) ? 'pente_fino' : 'final_review' }));
      finalDay++;
    }
    else if (minutes < SHORT_DAY) blocks.push({ slot: s, day, minutes, kind: 'consolidation' });
    else for (const m of splitDay(minutes, law)) blocks.push({ slot: s, day, minutes: m, kind: 'flex' });
  });
  // Reforço espalhado a partir da 3ª semana; o resto é teoria, nunca menos de um bloco por matéria.
  const flex = blocks.filter((b) => b.kind === 'flex'), short = blocks.filter((b) => b.kind === 'consolidation').length;
  const eligible = flex.filter((b) => relWeek(b.slot) >= 2);
  const reinforceN = Math.max(0, Math.min(eligible.length, flex.length - names.length, Math.round((flex.length + short) * share.reinforce) - short));
  for (let k = 0; k < reinforceN; k++) eligible[Math.floor(((k + 0.5) * eligible.length) / reinforceN)]!.kind = 'consolidation';
  for (const b of flex) if (b.kind === 'flex') b.kind = 'theory';
  for (const b of blocks) if (b.kind === 'consolidation' && blocks.filter((x) => x.kind === 'theory').length < names.length) b.kind = 'theory';
  const theoryBlocks = blocks.filter((b) => b.kind === 'theory');
  if (theoryBlocks.length < names.length) throw tooShort();

  // Teoria por matéria: demanda, com o mínimo para cobrir o edital (um bloco a cada 4 tópicos: a sessão junta tópicos pequenos).
  const demand = names.map((n) => subjectDemand(cfg.subjects[n]!));
  const floors = names.map((n) => { const s = cfg.subjects[n]!; return Math.ceil((s.topicCount ?? s.topics.length) / 4); });
  const counts = apportionWithFloors(demand, floors, theoryBlocks.length);
  const queues = names.map((n, i) => subjectTasks(n, cfg.subjects[n]!.topics, counts[i]!));
  // Matéria de cada bloco de teoria: a ordem suave do `interleave`, corrigida trocando blocos com dias próximos para não
  // repetir matéria no dia e para alternar específica e básica. Quando uma matéria domina o plano, a repetição que sobra
  // fica espalhada, e não acumulada no fim. A ordem das sessões de cada matéria não muda (elas entram depois).
  const assign = interleave(counts), groups: number[][] = [];
  theoryBlocks.forEach((b, k) => { if (k && theoryBlocks[k - 1]!.slot === b.slot) groups[groups.length - 1]!.push(k); else groups.push([k]); });
  const subjectsOf = (g: number[], skip = -1) => g.filter((k) => k !== skip).map((k) => assign[k]!);
  const mixed = (list: number[]) => list.length < 2 || new Set(list.map((si) => core.has(names[si]!))).size > 1;
  const SWAP_AHEAD = 10;
  // Troca o bloco x do grupo gi por um bloco de um dos próximos grupos, se `ok` aceitar os dois grupos depois da troca.
  const swapAhead = (gi: number, x: number, ok: (mine: number[], theirs: number[], before: number[]) => boolean) => {
    for (let gj = gi + 1; gj < Math.min(groups.length, gi + 1 + SWAP_AHEAD); gj++) {
      for (const y of groups[gj]!) {
        const mine = [...subjectsOf(groups[gi]!, x), assign[y]!], theirs = [...subjectsOf(groups[gj]!, y), assign[x]!];
        if (!ok(mine, theirs, subjectsOf(groups[gj]!))) continue;
        [assign[x], assign[y]] = [assign[y]!, assign[x]!];
        return true;
      }
    }
    return false;
  };
  const distinct = (l: number[]) => new Set(l).size === l.length;
  groups.forEach((g, gi) => {
    for (const x of g) if (subjectsOf(g).filter((si) => si === assign[x]).length > 1) swapAhead(gi, x, (m, t) => distinct(m) && distinct(t));
    if (!mixed(subjectsOf(g))) for (const x of g) if (swapAhead(gi, x, (m, t, before) => distinct(m) && distinct(t) && mixed(m) && (mixed(t) || !mixed(before)))) break;
  });
  // Fase do bloco para a meta de questões: posição entre os dias de estudo antes da reta final.
  const theoryDays = Math.max(1, study.filter((s) => !s.final).length);
  const out = new Map<Pending, Block>(), usedIn = new Map<Slot, number[]>(), phaseOf = new Map<Block, number>();
  theoryBlocks.forEach((b, k) => {
    const si = assign[k]!, t = queues[si]!.shift()!, phase = b.day / theoryDays;
    usedIn.set(b.slot, [...(usedIn.get(b.slot) ?? []), si]);
    const block: Block = { kind: 'theory', subject: names[si]!, minutes: b.minutes, item: t.item, text: t.text, keyword: t.keyword, goal: theoryGoal(b.minutes, phase) };
    out.set(b, block);
    phaseOf.set(block, phase);
  });
  // Reforço e revisão final: matéria ainda não usada no dia, alternando específica e básica; se a fila só tem matérias já
  // usadas, vale a de maior demanda livre.
  const window = Math.max(2, names.length);
  const pick = (list: number[], slot: Slot) => {
    const used = usedIn.get(slot) ?? [], prev = used[used.length - 1];
    let first = -1, best = -1;
    for (let k = 0; k < list.length; k++) {
      const si = list[k]!;
      if (used.includes(si)) continue;
      if (first < 0) first = k;
      if (k >= window) break;
      if (prev === undefined || core.has(names[si]!) !== core.has(names[prev]!)) { best = k; break; }
    }
    const free = names.map((_, i) => i).filter((i) => !used.includes(i));
    const si = first < 0 && free.length ? free.reduce((a, b) => (demand[b]! > demand[a]! ? b : a)) : list.splice(best >= 0 ? best : Math.max(0, first), 1)[0]!;
    usedIn.set(slot, [...used, si]);
    return si;
  };
  // Reforço, pente-fino e revisão final: matérias pela mesma demanda; o assunto das questões sai do desempenho na hora.
  // O pente-fino é leitura do que já foi estudado, com poucas questões para conferir.
  const TEXT = { consolidation: 'questões dos pontos fracos', pente_fino: 'pente-fino do que já estudou', final_review: 'revisão final dos pontos fracos' };
  for (const kind of ['consolidation', 'pente_fino', 'final_review'] as const) {
    const list = blocks.filter((b) => b.kind === kind);
    if (!list.length) continue;
    const order = interleave(apportion(demand, Math.max(list.length, names.length)));
    for (const b of list) {
      const si = pick(order, b.slot);
      out.set(b, {
        kind, subject: names[si]!, minutes: b.minutes, item: -1, keyword: WEAK_MARK, text: `${names[si]}: ${TEXT[kind]}`,
        goal: kind === 'pente_fino' ? theoryGoal(b.minutes) : Math.round((b.minutes / 60) * REINFORCE_PER_HOUR),
      });
    }
  }
  // Lei seca: relê os artigos de sessões já estudadas, no dia seguinte e uma semana depois (as mais cobradas, também um
  // mês depois). Sem sessão com lei para reler, o tempo volta para o primeiro bloco do dia.
  const due: { day: number; subject: number; item: number }[] = [];
  for (const b of blocks) {
    if (b.kind === 'lei_seca') {
      due.sort((x, y) => x.day - y.day);
      const k = due.findIndex((x) => x.day <= b.day);
      if (k < 0) continue;
      const r = due.splice(k, 1)[0]!, title = cfg.subjects[names[r.subject]!]!.topics[r.item] ?? '';
      out.set(b, { kind: 'lei_seca', subject: names[r.subject]!, minutes: b.minutes, item: r.item, text: `Lei seca: ${title}`, keyword: topicKeyword(title), goal: 0 });
      continue;
    }
    const block = out.get(b);
    if (block?.kind !== 'theory') continue;
    const s = cfg.subjects[block.subject]!;
    if (!s.lawItems?.[block.item]) continue;
    for (const gap of (s.incidence?.[block.item] ?? 2) >= 3 ? [1, 7, 30] : [1, 7]) due.push({ day: b.day + gap, subject: names.indexOf(block.subject), item: block.item });
  }
  for (const b of blocks) if (b.kind === 'weekly_review') out.set(b, { kind: 'weekly_review', subject: '', minutes: b.minutes, item: -1, text: 'Revisão da semana e caderno de erros', keyword: '', goal: 0 });
  for (const b of blocks) {
    const block = out.get(b);
    if (block) { b.slot.blocks.push(block); continue; }
    const other = blocks.find((x) => x.slot === b.slot && out.has(x) && x.kind !== 'weekly_review') ?? blocks.find((x) => x.slot === b.slot && out.has(x));
    if (!other) continue;
    const o = out.get(other)!;
    o.minutes += b.minutes;
    if (o.kind === 'theory') o.goal = theoryGoal(o.minutes, phaseOf.get(o));
  }
  // Lei seca abre o dia (aquecimento), depois a revisão semanal e os outros blocos na ordem.
  const first = (b: Block) => (b.kind === 'lei_seca' ? 2 : b.kind === 'weekly_review' ? 1 : 0);
  for (const s of study) s.blocks.sort((a, b) => first(b) - first(a));

  // Semanas com título pela fase predominante e principais matérias.
  const weeks: Week[] = [];
  for (let w = 0; w * 7 < slots.length; w++) {
    const days = slots.slice(w * 7, w * 7 + 7), all = days.flatMap((d) => d.blocks);
    const theory = all.filter((b) => b.kind === 'theory').length, final = all.filter((b) => b.kind === 'final_review' || b.kind === 'pente_fino').length;
    const subs = [...new Set(all.filter((b) => b.kind === 'theory').map((b) => b.subject))].slice(0, 3);
    const phase = final > theory ? 'Reta final' : theory ? 'Teoria e questões' : 'Semana';
    const title = days.some((d) => d.kind === 'exam') && !subs.length ? 'Semana da prova'
      : `${phase}${days.some((d) => d.light) ? ' (semana leve)' : ''}${subs.length ? ': ' + subs.join(', ') : ''}`;
    weeks.push({ title, days: days.map((d) => ({ text: d.text, hours: d.light ? Math.round(d.hours * LIGHT_FACTOR * 100) / 100 : d.hours, kind: d.kind, blocks: d.blocks, ...(d.light ? { light: true } : {}) })) });
  }
  const allBlocks = slots.flatMap((s) => s.blocks), of = (k: BlockKind) => allBlocks.filter((b) => b.kind === k).length;
  const summary: ScheduleSummary = {
    weeks: weeks.length, studyDays: slots.filter((s) => s.hours > 0).length, theory: of('theory'), consol: of('consolidation'), final: of('final_review'),
    simulados: slots.filter((s) => s.kind === 'simulado').length, lawReading: of('lei_seca'),
    hours: Math.round(weeks.flatMap((w) => w.days).reduce((a, d) => a + d.hours, 0)), perSubject: names.map((n, i) => ({ name: n, days: counts[i]! })),
  };
  return { weeks, startDate: ymd(monday), config: cfg, summary };
}
