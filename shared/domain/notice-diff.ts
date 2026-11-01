// Compara dois editais do mesmo concurso: o que continua, o que mudou e o que é novo, tópico a tópico e sem IA.
// Na dúvida, o tópico conta como novo: tratar como estudado o que mudou deixaria um buraco no estudo.
import { comparableText, normalizeText } from '../ai/notice.ts';

export interface DiffTopic { id: string; text: string }
export interface DiffSubject { name: string; topics: DiffTopic[] }
export interface DiffNotice { organization: string; role: string; board: string; examDate: string; subjects: DiffSubject[] }

export type TopicStatus = 'same' | 'similar' | 'new';
// `missingNumbers`: artigos e números do tópico novo que o antigo não cita, ou seja, conteúdo a estudar mesmo com texto parecido.
export interface TopicMatch { id: string; subject: string; text: string; status: TopicStatus; matchId: string | null; matchText: string; studied: boolean; missingNumbers: string[] }
export interface NoticeDiff {
  boardChanged: boolean; roleChanged: boolean; organizationChanged: boolean;
  examDate: string; topics: TopicMatch[];
  removed: { id: string; subject: string; text: string }[];
  addedSubjects: string[]; removedSubjects: string[];
  counts: { same: number; similar: number; new: number; removed: number; studied: number };
}

const SAME_ABOVE = 0.85, SIMILAR_ABOVE = 0.6, CONTAINED_ABOVE = 0.8, MIN_CONTAINED_WORDS = 3;

// Numeração do item e nome da matéria em maiúsculas ("3. DIREITO PENAL: …") variam entre edições e não são conteúdo.
const clean = (s: string) => s.replace(/^\s*\d+\s*[.)–-]\s*/, '').replace(/^[^a-záéíóúâêôãõç:]{4,}:\s*/, '');
const words = (s: string) => new Set(comparableText(clean(s)).split(' ').filter(Boolean));
// Número de lei citado, com ou sem ponto: leis diferentes nunca são o mesmo tópico, mesmo com texto parecido.
const lawsOf = (s: string) => new Set([...s.matchAll(/\bLei\b[^\d]{0,30}(\d{1,2})\.?(\d{3})\b/gi)].map((m) => `${m[1]}${m[2]}`));
// Artigos e demais números do texto, sem os das leis: mudar um deles é mudança de conteúdo, ainda que pequena.
const numbersOf = (s: string) => new Set(s.replace(/\bLei\b[^\d]{0,30}\d{1,2}\.?\d{3}(\/\d{2,4})?/gi, ' ').match(/\d+/g) ?? []);

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const sharedCount = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;

export const missingNumbers = (next: string, previous: string) => {
  const old = numbersOf(clean(previous));
  return [...numbersOf(clean(next))].filter((n) => !old.has(n));
};

export function compareTopics(a: string, b: string): { status: TopicStatus; score: number } {
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return { status: 'new', score: 0 };
  const ta = clean(a), tb = clean(b), la = lawsOf(ta), lb = lawsOf(tb);
  if (la.size && lb.size && !sharedCount(la, lb)) return { status: 'new', score: 0 };
  const shared = sharedCount(wa, wb), jaccard = shared / (wa.size + wb.size - shared), contained = shared / wa.size;
  if (jaccard >= SAME_ABOVE && sameSet(numbersOf(ta), numbersOf(tb)) && sameSet(la, lb)) return { status: 'same', score: jaccard };
  if (jaccard >= SIMILAR_ABOVE || (contained >= CONTAINED_ABOVE && wa.size >= MIN_CONTAINED_WORDS)) return { status: 'similar', score: Math.max(jaccard, contained * 0.9) };
  return { status: 'new', score: jaccard };
}

// Tópicos já estudados: um tópico longo pode cobrir várias sessões, e só conta quando todas estão concluídas.
export function studiedTopics(sessions: { topicIds: string[]; done: boolean }[]) {
  const pending = new Set(sessions.filter((s) => !s.done).flatMap((s) => s.topicIds));
  return new Set(sessions.filter((s) => s.done).flatMap((s) => s.topicIds).filter((id) => !pending.has(id)));
}

const subjectKey = (s: string) => normalizeText(s).replace(/^(nocoes|conhecimentos) (basicos |basicas )?(de|dos|das|do|da|em) /, '').trim();
const sameSubject = (a: string, b: string) => { const x = subjectKey(a), y = subjectKey(b); return x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x))); };

// Matéria antiga → matéria nova, pelo nome: é o que leva o desempenho de um plano para o outro.
export function subjectEquivalence(previous: { id: string; name: string }[], next: { id: string; name: string }[]) {
  const norm = (s: string) => normalizeText(s);
  return Object.fromEntries(previous.flatMap((p) => {
    const hit = next.find((n) => norm(n.name) === norm(p.name)) ?? next.find((n) => sameSubject(n.name, p.name));
    return hit ? [[p.id, hit.id]] : [];
  }));
}

// `studied`: tópicos do edital antigo já cobertos por sessões concluídas.
export function diffNotices(previous: DiffNotice, next: DiffNotice, studied: Set<string> = new Set()): NoticeDiff {
  const old = previous.subjects.flatMap((s) => s.topics.map((t) => ({ ...t, subject: s.name })));
  const matchedOld = new Set<string>();
  const topics: TopicMatch[] = next.subjects.flatMap((s) => s.topics.map((t) => {
    // A mesma matéria tem preferência. Fora dela o texto precisa ser quase todo igual: matérias mudam de nome e de divisão,
    // mas um trecho contido num tópico longo de outra matéria costuma ser coincidência.
    let best: { status: TopicStatus; score: number; old: (typeof old)[number] } | null = null;
    for (const o of old) {
      const c = compareTopics(t.text, o.text), same = sameSubject(s.name, o.subject);
      if (c.status === 'new' || (!same && c.score < SIMILAR_ABOVE)) continue;
      // Entre tópicos antigos parecidos, vale o que já cita os mesmos artigos.
      const total = numbersOf(clean(t.text)).size, missing = missingNumbers(t.text, o.text).length;
      const score = c.score + (same ? 0.05 : 0) + (c.status === 'same' ? 1 : 0) - (total ? (0.5 * missing) / total : 0);
      if (!best || score > best.score) best = { status: c.status, score, old: o };
    }
    if (best) matchedOld.add(best.old.id);
    const absent = best ? missingNumbers(t.text, best.old.text) : [];
    return {
      id: t.id, subject: s.name, text: t.text, status: best?.status ?? 'new', matchId: best?.old.id ?? null, matchText: best?.old.text ?? '',
      // Com artigos que o edital antigo não citava, ainda há o que estudar.
      studied: !!best && studied.has(best.old.id) && !absent.length, missingNumbers: absent,
    };
  }));
  const removed = old.filter((o) => !matchedOld.has(o.id)).map((o) => ({ id: o.id, subject: o.subject, text: o.text }));
  const count = (st: TopicStatus) => topics.filter((t) => t.status === st).length;
  return {
    boardChanged: normalizeText(previous.board) !== normalizeText(next.board),
    roleChanged: normalizeText(previous.role) !== normalizeText(next.role),
    organizationChanged: normalizeText(previous.organization) !== normalizeText(next.organization),
    examDate: next.examDate, topics, removed,
    addedSubjects: next.subjects.filter((s) => !previous.subjects.some((p) => sameSubject(p.name, s.name))).map((s) => s.name),
    removedSubjects: previous.subjects.filter((s) => !next.subjects.some((n) => sameSubject(n.name, s.name))).map((s) => s.name),
    counts: { same: count('same'), similar: count('similar'), new: count('new'), removed: removed.length, studied: topics.filter((t) => t.studied).length },
  };
}
