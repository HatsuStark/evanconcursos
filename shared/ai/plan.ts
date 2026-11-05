// Planejamento pedagógico: respostas do questionário, schemas e prompts da IA (estratégia e sessões por
// matéria) e a correção determinística das sessões, que garante contagem exata e cobertura de todos os tópicos.
import { z } from 'zod';
import { topicKeyword } from '../domain/scheduler.ts';
import { isNextPart } from '../domain/parts.ts';
import { citedArticleCount, mergeLawRefs, rangesLabel, type ArticleRange, type LawRef } from '../legal/refs.ts';

// plan-v4: a IA devolve até n sessões, sem repetir assunto para completar; o app distribui os dias que sobram pelo
// tamanho do texto e pela cobrança (allocateSessions).
// plan-v5: cada sessão traz também a lei e os artigos (campo laws), gravados na sessão para a lei seca, a apostila e as
// questões não dependerem de reler o título.
// plan-v6: a IA avalia o esforço de cada sessão (days, 1 a 3) pelo volume e pela dificuldade, e o app usa isso para dar
// os dias das sessões sem lei (antes contava tópicos: um tópico com 30 subitens pesava igual a "Crase."). A estratégia
// recebe o tamanho do conteúdo de cada matéria, não só o número de tópicos.
export const PLAN_PROMPT_VERSION = 'plan-v6';

// ---------- questionário ----------
export const PlanInputs = z.object({
  hours: z.array(z.number().min(0).max(16)).length(7),       // segunda..domingo
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weeklyReview: z.boolean(),
  profile: z.string().max(1500),
  levels: z.record(z.string(), z.number().int().min(0).max(3)), // subjectId → 0 iniciante … 3 avançado
});
export type PlanInputs = z.infer<typeof PlanInputs>;
export const LEVEL_NAMES = ['Iniciante', 'Básico', 'Intermediário', 'Avançado'] as const;

// ---------- etapa 1: estratégia ----------
export const PlanStrategy = z.object({
  advice: z.array(z.string().trim().max(300)).max(8).describe('Até 6 orientações práticas para este candidato.'),
  subjects: z.array(z.object({
    ref: z.string().describe('Código da matéria, exatamente como recebido (S1, S2...).'),
    weight: z.number().int().min(1).max(5).describe('Prioridade de tempo de estudo, 1 a 5.'),
    focus: z.string().trim().max(300).describe('Em que focar nesta matéria, em uma frase.'),
  })),
});
export type PlanStrategy = z.infer<typeof PlanStrategy>;
export const strategyJsonSchema = () => z.toJSONSchema(PlanStrategy, { target: 'draft-7' });

// chars: tamanho do conteúdo programático da matéria (soma do texto dos tópicos).
export interface StrategySubject { ref: string; name: string; core: boolean; questions: number; weight: number; level: number; topics: number; chars?: number }
// Cargo com as atribuições do edital: sem elas, a IA deduz pelo nome e pode confundir com outro cargo do mesmo edital.
export const roleContext = (role: string, duties = '', otherRoles: string[] = []) => [
  duties.trim() ? `Atribuições do cargo (edital): ${duties.trim().slice(0, 1500)}` : '',
  otherRoles.length ? `O edital tem outros cargos (${otherRoles.slice(0, 12).join('; ')}): não use atribuições nem conteúdos deles para ${role || 'este cargo'}.` : '',
].filter(Boolean).join('\n');

export function strategyPrompt(p: { role: string; board: string; examDate: string; weeks: number; hours: number; profile: string; notes: string[]; subjects: StrategySubject[]; duties?: string; otherRoles?: string[] }) {
  return `Você é coordenador pedagógico de um cursinho para concursos públicos brasileiros.
Concurso: ${p.role || 'não informado'}${p.board ? `, banca ${p.board}` : ''}. Prova em ${p.examDate || 'data a definir'}.
${roleContext(p.role, p.duties, p.otherRoles)}
Tempo disponível: ${p.weeks} semanas, ${p.hours} horas de estudo no total.
Sobre o candidato: ${p.profile.trim() || 'não informado'}.
Regras do edital: ${p.notes.slice(0, 15).join(' | ') || 'não informadas'}.
Matérias (código | nome | específica? | questões na prova | peso no edital 1–5 | nível do candidato | nº de tópicos | tamanho do conteúdo em caracteres):
${p.subjects.map((s) => `${s.ref} | ${s.name} | ${s.core ? 'sim' : 'não'} | ${s.questions || '?'} | ${s.weight} | ${LEVEL_NAMES[s.level] ?? '?'} | ${s.topics} | ${s.chars ?? '?'}`).join('\n')}
Defina:
- subjects: para cada matéria (mesmo código), weight de 1 a 5 = prioridade de tempo de estudo. Pese o retorno em pontos (questões, peso, matérias eliminatórias) e quanto o candidato precisa evoluir: nível baixo em matéria muito cobrada = prioridade máxima; nível avançado em matéria pouco cobrada = baixa. Matéria com conteúdo extenso precisa de mais tempo: julgue pelo tamanho do conteúdo, não pelo número de tópicos (o edital pode agrupar muitos assuntos num tópico só). focus: em que concentrar o estudo dela.
- advice: até 6 orientações práticas e curtas para este candidato, considerando o tempo e o perfil.`;
}

// ---------- etapa 2: sessões de uma matéria ----------
export const SubjectSessions = z.object({
  sessions: z.array(z.object({
    title: z.string().trim().max(200).describe('Formato "Assunto curto: detalhes (lei e artigos)".'),
    keyword: z.string().trim().max(60).describe('1 a 4 palavras para buscar questões do assunto.'),
    topics: z.array(z.number().int()).describe('Números dos tópicos do edital cobertos pela sessão.'),
    incidence: z.number().int().min(1).max(3).optional().describe('Quanto a banca cobra o assunto: 3 muito, 2 médio, 1 pouco.'),
    days: z.number().int().min(1).max(3).optional().describe('Dias de estudo que a sessão pede pelo volume e pela dificuldade do conteúdo: 1 a 3.'),
    laws: z.array(z.object({
      law: z.string().trim().max(40).describe('Código da lei, exatamente como na lista de leis do prompt.'),
      articles: z.string().trim().max(600).describe('Todos os artigos da sessão, só números: "196, 282, 436-A, 1º a 4º".'),
    })).max(6).optional().describe('Leis da lista citadas na sessão, com os artigos. Vazio se não houver.'),
  })),
});
export type SubjectSessions = z.infer<typeof SubjectSessions>;
export const sessionsJsonSchema = () => z.toJSONSchema(SubjectSessions, { target: 'draft-7' });

export function sessionsPrompt(p: { role: string; board: string; profile: string; subject: string; level: number; questions: number; focus: string; n: number; minutesPerSession: number; topics: string[]; duties?: string; otherRoles?: string[]; laws?: { key: string; name: string }[] }) {
  return `Você é professor de cursinho para concursos públicos brasileiros.
Concurso: ${p.role || 'não informado'}${p.board ? `, banca ${p.board}` : ''}.
${roleContext(p.role, p.duties, p.otherRoles)}
Sobre o candidato: ${p.profile.trim() || 'não informado'}. Nível dele em ${p.subject}: ${LEVEL_NAMES[p.level] ?? 'não informado'}.
Questões desta matéria na prova: ${p.questions || 'não informado'}. Foco recomendado: ${p.focus || 'não informado'}.
Conteúdo programático do edital (número. tópico):
${p.topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}
Divida a matéria em ATÉ ${p.n} sessões de estudo de cerca de ${Math.round(p.minutesPerSession / 6) / 10} horas (teoria e questões no fim), na ordem ideal de aprendizado (fundamentos antes). Se o conteúdo não pede ${p.n} sessões, devolva menos: o app usa os dias que sobram para dividir os assuntos extensos e aprofundar os mais cobrados.
Regras:
- Ordem de aprendizado: conceitos e definições de que outros assuntos dependem vêm antes deles (ex.: o conceito de funcionário público antes dos crimes funcionais; teoria geral antes das espécies), mesmo que o edital os liste depois.
- Cada tópico do edital deve aparecer em pelo menos uma sessão (campo topics, com os números acima).
- Nunca repita um assunto só para completar o número de sessões. Assunto pouco cobrado ou curto pode ser agrupado com outros numa sessão só.
- Avalie o volume pelo conteúdo, não pelo número de tópicos: um tópico com muitos subitens (ex.: "4. Imposto sobre a Renda… 4.3 pessoas físicas… 4.4 pessoas jurídicas… lucro real, presumido, arbitrado") é mais extenso que vários tópicos curtos. Assunto que não cabe numa sessão e tem partes distintas (subitens, espécies, capítulos, artigos) vira sessões separadas, uma por parte, cada uma com o subtema no título; o mesmo tópico pode aparecer em várias sessões.
- days: quantos dias de estudo (de cerca de ${Math.round(p.minutesPerSession / 6) / 10} horas) a sessão pede pelo volume e pela dificuldade: 1 para o que cabe num dia; 2 ou 3 só para assunto denso que não dá para separar em partes.
- incidence: 3 para assunto muito cobrado, 2 médio, 1 pouco cobrado. Baseie-se no histórico de provas da banca e do cargo.
- Ajuste ao nível: iniciante precisa de mais sessões de base; avançado, de mais tempo nos pontos difíceis e mais cobrados.
- title: até 160 caracteres, formato "Assunto curto: detalhes". Quando houver lei, cite a lei e TODOS os artigos da sessão (ex.: "Normas da CGJ, arts. 1º a 4º, 33, 47 e 49"), sem abreviar com "etc.". Sem repetir títulos.
- keyword: o assunto em 1 a 4 palavras, como se busca em sites de questões (ex.: "inquérito policial").
- laws: para cada lei da lista abaixo que a sessão estuda, o código e TODOS os artigos dela na sessão, os mesmos do título, só os números (sem incisos nem parágrafos: "arts. 196, XX, 282, § 1º" vira "196, 282"; intervalo com "a": "1º a 4º"). Norma fora da lista ou sessão sem artigos de lei: não inclua.
Leis (código | nome):
${(p.laws ?? []).map((l) => `${l.key} | ${l.name}`).join('\n') || 'nenhuma'}
- Não inclua nada fora do conteúdo programático.`;
}

// ---------- correção determinística ----------
// topics: índices 0-based; incidence 1–3; refs: lei e artigos da sessão (gravados em study_sessions.law_refs).
// effort: dias que a IA estimou para a sessão (1 a 3); vale para as sessões sem lei, as de lei são medidas pelo texto.
export interface Session { title: string; keyword: string; topics: number[]; incidence?: number; refs?: LawRef[]; effort?: number }

// Sessões sem IA: os tópicos em ordem, agrupados ou divididos em partes para dar exatamente n.
export function fallbackSessions(topics: string[], n: number): Session[] {
  if (!topics.length) return Array.from({ length: n }, (_, j) => ({ title: `Estudo ${j + 1} de ${n}`, keyword: '', topics: [] }));
  const out: Session[] = [];
  if (n >= topics.length) {
    const base = Math.floor(n / topics.length), extra = n % topics.length;
    topics.forEach((t, i) => {
      const parts = base + (i < extra ? 1 : 0);
      for (let p = 0; p < parts; p++) out.push({ title: (parts > 1 ? `${t} (parte ${p + 1} de ${parts})` : t).slice(0, 200), keyword: topicKeyword(t), topics: [i] });
    });
    return out;
  }
  const base = Math.floor(topics.length / n), extra = topics.length % n;
  let k = 0;
  for (let j = 0; j < n; j++) {
    const size = base + (j < extra ? 1 : 0), idx = Array.from({ length: size }, (_, x) => k + x);
    k += size;
    out.push({ title: idx.map((i) => topics[i]).join('; ').slice(0, 200), keyword: topicKeyword(topics[idx[0]!]!), topics: idx });
  }
  return out;
}

// Ajusta a resposta da IA: tópicos válidos (1-based → 0-based), todo tópico coberto, exatamente n sessões.
// Devolve também o que foi corrigido, para registro.
// opts.sizes: tamanho da lei de cada sessão da IA (texto oficial); opts.minutes: duração média da sessão.
export function repairSessions(raw: { sessions: (SubjectSessions['sessions'][number] & { refs?: LawRef[] })[] }, n: number, topics: string[], opts: { sizes?: (LawSize[] | null)[]; minutes?: number } = {}): { sessions: Session[]; fixes: string[] } {
  const T = topics.length, fixes: string[] = [];
  const mapped = raw.sessions
    .map((x) => ({ title: x.title.trim(), keyword: x.keyword.trim(), incidence: x.incidence && [1, 2, 3].includes(x.incidence) ? x.incidence : 2, topics: [...new Set(x.topics.filter((t) => Number.isInteger(t) && t >= 1 && t <= T).map((t) => t - 1))], ...(x.refs?.length ? { refs: x.refs } : {}), ...(x.days && Number.isInteger(x.days) ? { effort: Math.min(3, Math.max(1, x.days)) } : {}) }));
  // Os tamanhos acompanham as sessões que ficam.
  const sizes = opts.sizes ? mapped.map((_, i) => opts.sizes![i] ?? null).filter((_, i) => mapped[i]!.title) : null;
  const s: Session[] = mapped.filter((x) => x.title);
  if (s.length !== raw.sessions.length) fixes.push('sessões sem título removidas');
  if (!s.length) return { sessions: fallbackSessions(topics, n), fixes: [...fixes, 'resposta vazia: sessões montadas pelos tópicos'] };

  // Cobertura: tópico esquecido entra na sessão que já tem o tópico anterior mais próximo.
  const covered = new Set(s.flatMap((x) => x.topics));
  for (let t = 0; t < T; t++) {
    if (covered.has(t)) continue;
    let target = -1;
    for (let prev = t - 1; prev >= 0 && target < 0; prev--) target = s.findIndex((x) => x.topics.includes(prev));
    if (target < 0) target = 0; // nenhum anterior coberto: vai para a primeira sessão
    s[target]!.topics.push(t);
    s[target]!.topics.sort((a, b) => a - b);
    covered.add(t);
    fixes.push(`tópico ${t + 1} incluído`);
  }

  // Contagem: os dias da matéria vão para onde há conteúdo e cobrança (allocateSessions).
  const r = allocateSessions(s, sizes ?? s.map(() => null), n, opts.minutes ?? 75);
  return { sessions: r.sessions.map((x) => ({ ...x, keyword: x.keyword || topicKeyword(x.title) })), fixes: [...fixes, ...r.fixes] };
}

// ---------- distribuição dos dias pelo conteúdo ----------
// A matéria tem n dias de teoria (do tempo disponível). Cada sessão começa com um; os que sobram vão primeiro para
// conteúdo que não cabe num dia (lei longa vira partes, cada uma com o seu intervalo de artigos no título, para a lei
// seca, a apostila e as questões focarem nele; sessão de vários tópicos é dividida) e só depois para aprofundamento, nas
// sessões mais cobradas e com mais conteúdo, algumas sessões depois da original (revisão espaçada). Sessão curta nunca
// ganha dia extra. Faltando dias, juntam-se as vizinhas de menor peso.
export const DEEP_PREFIX = 'Aprofundamento: ', PRACTICE_PREFIX = 'Revisão com questões: ';
// Texto de lei que cabe numa sessão: ~150 caracteres por minuto (cerca de 15 artigos por hora, com leitura atenta, esquema e questões).
export const LAW_CHARS_PER_MINUTE = 150;
const DEEP_GAP = 3, MAX_DEEP = 2;

interface Sized<T> { x: T; size: LawSize[] | null; days: number; deep: number }
const liveOf = (z: LawSize[] | null) => (z ?? []).reduce((a, s) => a + s.liveChars, 0);
const liveArticlesOf = (z: LawSize[] | null) => (z ?? []).reduce((a, s) => a + (s.articles ? s.articles.filter((x) => !x.revoked).length : s.liveArticles), 0);
// Sem texto da lei no banco (norma fora do registro, ainda não enviada), o tamanho é estimado pelos artigos citados.
const ARTICLE_CHARS = 600;
const estimatedChars = (title: string) => citedArticleCount(title) * ARTICLE_CHARS;
// Sem lei: os dias que a IA estimou pelo conteúdo (effort); sem estimativa (plano antigo, sessões sem IA), o nº de tópicos.
const loadOf = <T extends Session>(it: Sized<T>, minutes: number) => (it.size ? liveOf(it.size) / (minutes * LAW_CHARS_PER_MINUTE)
  : estimatedChars(it.x.title) ? estimatedChars(it.x.title) / (minutes * LAW_CHARS_PER_MINUTE) : it.x.effort ?? Math.max(1, it.x.topics.length));
// Dias que o conteúdo pede: lei, pelo tamanho do texto (no máximo um por artigo); sem lei, a estimativa da IA ou, sem
// ela, até 2 se houver tópicos para dividir.
const contentDays = <T extends Session>(it: Sized<T>, minutes: number) => (it.size
  ? Math.max(1, Math.min(Math.ceil(loadOf(it, minutes)), liveArticlesOf(it.size) || 1))
  : it.x.effort ?? Math.min(2, Math.max(1, it.x.topics.length)));
const weightOf = <T extends Session>(it: Sized<T>, minutes: number) => (it.x.incidence ?? 2) * Math.max(0.5, loadOf(it, minutes));

export function allocateSessions<T extends Session>(list: T[], sizes: (LawSize[] | null)[], n: number, minutes: number): { sessions: T[]; fixes: string[] } {
  const fixes: string[] = [];
  const items: Sized<T>[] = list.map((x, i) => ({ x, size: sizes[i] ?? null, days: 1, deep: 0 }));
  if (!items.length) return { sessions: [], fixes };
  // Dias de menos: junta o par vizinho de menor peso (a primeira leva os artigos da segunda no título).
  while (items.length > n && items.length > 1) {
    let best = 0;
    for (let i = 1; i < items.length - 1; i++) {
      if (weightOf(items[i]!, minutes) + weightOf(items[i + 1]!, minutes) < weightOf(items[best]!, minutes) + weightOf(items[best + 1]!, minutes)) best = i;
    }
    const a = items[best]!, b = items[best + 1]!;
    const extra = (b.size ?? []).filter((z) => z.liveArticles > 0).map((z) => `${z.cite ?? z.short}, ${z.ranges}`).join('; ');
    items.splice(best, 2, {
      x: { ...a.x, title: (extra ? `${a.x.title}; ${extra}` : a.x.title).slice(0, 200), keyword: a.x.keyword || b.x.keyword, incidence: Math.max(a.x.incidence ?? 2, b.x.incidence ?? 2), topics: [...new Set([...a.x.topics, ...b.x.topics])].sort((p, q) => p - q), ...withRefs(a.x.refs, b.x.refs),
        ...(a.x.effort || b.x.effort ? { effort: Math.min(3, (a.x.effort ?? 1) + (b.x.effort ?? 1)) } : {}) },
      size: a.size || b.size ? [...(a.size ?? []), ...(b.size ?? [])] : null, days: 1, deep: 0,
    });
    fixes.push('sessões unidas');
  }
  let spare = n - items.length;
  // 1º o conteúdo que não cabe num dia, do mais cobrado e mais longo por dia.
  while (spare > 0) {
    const open = items.filter((it) => it.days < contentDays(it, minutes));
    if (!open.length) break;
    const pick = open.reduce((m, it) => (weightOf(it, minutes) / it.days > weightOf(m, minutes) / m.days ? it : m));
    pick.days++; spare--;
  }
  // 2º aprofundamento: pela cobrança (incidência ao quadrado) e, menos, pelo tamanho; cada aprofundamento já dado pesa
  // contra (^1,5), até 2 por sessão. Sessão de lei curta e de incidência 1 só entram se não houver outra.
  const deepScore = (it: Sized<T>) => ((it.x.incidence ?? 2) ** 2 * (1 + Math.log2(1 + loadOf(it, minutes)))) / (it.deep + 1) ** 1.5;
  while (spare > 0) {
    const pool = items.filter((it) => (it.x.incidence ?? 2) >= 2 && !(it.size && isShortLaw(it.size)) && it.deep < MAX_DEEP);
    const from = pool.length ? pool : items;
    const pick = from.reduce((m, it) => (deepScore(it) > deepScore(m) ? it : m));
    pick.deep++; spare--;
  }
  // Monta: partes no lugar da sessão; aprofundamentos DEEP_GAP sessões depois.
  const out: T[] = [];
  const later: { at: number; x: T }[] = [];
  for (const it of items) {
    const parts = splitSession(it, it.days);
    if (parts.length > 1) fixes.push(`"${it.x.title}" em ${parts.length} partes`);
    out.push(...parts);
    // Dia de conteúdo que não deu para dividir (pouco artigo ou um tópico só) vira aprofundamento.
    const deep = it.deep + (it.days - parts.length);
    // O 1º aprofunda o assunto; os seguintes revisam com questões, cada vez mais longe da sessão original.
    for (let d = 0; d < deep; d++) later.push({ at: out.length + DEEP_GAP * (d + 1) * (d + 1), x: { ...it.x, title: `${d ? PRACTICE_PREFIX : DEEP_PREFIX}${it.x.title}`.slice(0, 200), incidence: 3 } });
    if (deep) fixes.push(`aprofundamento de "${it.x.title}"`);
  }
  // Aprofundamento nunca entra entre duas partes do mesmo tema: vai para depois da sequência.
  for (const l of later.sort((a, b) => b.at - a.at)) {
    let at = Math.min(l.at, out.length);
    while (at > 0 && at < out.length && isNextPart(out[at - 1]!.title, out[at]!.title)) at++;
    out.splice(at, 0, l.x);
  }
  return { sessions: out, fixes };
}

// Divide a sessão em até k partes: lei pelos artigos vigentes (partes de tamanho parecido, na ordem, com o intervalo no
// título); sem lei, pelos tópicos. Devolve menos partes se não houver o que dividir.
function splitSession<T extends Session>(it: Sized<T>, k: number): T[] {
  if (k <= 1) return [it.x];
  const head = it.x.title.split(':')[0]!.replace(/\s*\([^)]*\)\s*/g, ' ').trim() || it.x.title;
  const arts = (it.size ?? []).flatMap((z) => (z.articles ?? []).filter((a) => !a.revoked).map((a) => ({ ...a, z })));
  if (arts.length >= 2) {
    const parts = Math.min(k, arts.length), total = arts.reduce((a, x) => a + x.chars, 0);
    const groups: (typeof arts)[] = [];
    let cur: typeof arts = [], acc = 0;
    arts.forEach((a, idx) => {
      cur.push(a); acc += a.chars;
      const left = arts.length - idx - 1, needed = parts - groups.length - 1;
      if (groups.length < parts - 1 && (acc >= (total / parts) * (groups.length + 1) || left === needed)) { groups.push(cur); cur = []; }
    });
    if (cur.length) groups.push(cur);
    return groups.map((g, j) => {
      const byLaw = new Map<string, { z: LawSize; list: typeof g }>();
      for (const a of g) byLaw.set(a.z.law, { z: a.z, list: [...(byLaw.get(a.z.law)?.list ?? []), a] });
      const refs = [...byLaw.values()].map(({ z, list }) => ({ law: z.law, ranges: runs(list), cite: z.cite ?? z.short }));
      const cites = refs.map((r) => `${r.cite}, ${rangesLabel(r)}`).join('; ');
      return { ...it.x, title: `${head} (parte ${j + 1} de ${groups.length}): ${cites}`.slice(0, 200), refs: refs.map(({ law, ranges }) => ({ law, ranges })) };
    });
  }
  if (!it.size && it.x.topics.length >= 2) {
    const parts = Math.min(k, it.x.topics.length), per = Math.ceil(it.x.topics.length / parts);
    const chunks = Array.from({ length: parts }, (_, j) => it.x.topics.slice(j * per, (j + 1) * per)).filter((c) => c.length);
    return chunks.map((c, j) => ({ ...it.x, title: `${it.x.title} (parte ${j + 1} de ${chunks.length})`.slice(0, 200), topics: c }));
  }
  return [it.x];
}

// Artigos em sequência viram um intervalo ("994 a 1.010"); salto de número abre outro.
function runs(list: { num: number; suffix: string }[]): ArticleRange[] {
  const out: ArticleRange[] = [];
  for (const a of list) {
    const last = out[out.length - 1];
    if (last && (a.num === last.to || a.num === last.to + 1)) {
      last.to = a.num;
      if (a.suffix) last.toSuffix = a.suffix; else delete last.toSuffix;
      continue;
    }
    out.push({ from: a.num, to: a.num, ...(a.suffix ? { fromSuffix: a.suffix, toSuffix: a.suffix } : {}) });
  }
  return out;
}

// ---------- sessões de lei quase vazia ----------
// O edital às vezes cita artigos revogados ou que só remetem a outro capítulo (ex.: Normas da CGJ, arts. 105 a 110: o 105
// remete ao Capítulo VII e os demais foram revogados em 2023). Uma sessão inteira para isso desperdiça um dia. A medição
// vem do texto oficial (artigos vigentes e revogados dos intervalos citados no título); a sessão curta é juntada à
// vizinha que cita a mesma lei (ou, sem ela, à vizinha mais próxima), e o título leva os artigos das duas para a lei seca,
// a apostila e as questões continuarem cobrindo tudo. Depois, repairSessions divide a maior para manter a contagem.
export interface ArticleSize { label: string; num: number; suffix: string; chars: number; revoked: boolean }
// cite: como citar a lei num título para findLawRefs achá-la de novo ("NSCGJ", "Lei 6.830/80"); articles: os do intervalo.
export interface LawSize { law: string; short: string; cite?: string; ranges: string; liveChars: number; liveArticles: number; revokedArticles: number; articles?: ArticleSize[] }
export const SHORT_LAW_CHARS = 600, MOSTLY_REVOKED_CHARS = 1500;
export function isShortLaw(sizes: LawSize[]) {
  if (!sizes.length) return false;
  const live = sizes.reduce((a, s) => a + s.liveChars, 0), revoked = sizes.reduce((a, s) => a + s.revokedArticles, 0);
  const total = revoked + sizes.reduce((a, s) => a + s.liveArticles, 0);
  return live < SHORT_LAW_CHARS || (revoked * 2 >= total && live < MOSTLY_REVOKED_CHARS);
}
export function mergeShortLawSessions<T extends { title: string; keyword: string; topics: number[]; incidence?: number; refs?: LawRef[] }>(list: T[], sizes: (LawSize[] | null)[]): { sessions: T[]; sizes: (LawSize[] | null)[]; merged: string[] } {
  const s = list.map((x, i) => ({ x, size: sizes[i] ?? null }));
  const merged: string[] = [];
  for (let i = 0; i < s.length && s.length > 1; i++) {
    const cur = s[i]!;
    if (!cur.size || !isShortLaw(cur.size)) continue;
    const laws = new Set(cur.size.map((z) => z.law));
    const shares = (j: number) => !!s[j]?.size?.some((z) => laws.has(z.law)) && !isShortLaw(s[j]!.size!);
    // A mais próxima que cita a mesma lei; sem nenhuma, a vizinha seguinte (ou a anterior, no fim).
    let target = -1;
    for (let d = 1; d < s.length && target < 0; d++) for (const j of [i + d, i - d]) if (target < 0 && j >= 0 && j < s.length && shares(j)) target = j;
    if (target < 0) target = i + 1 < s.length ? i + 1 : i - 1;
    const t = s[target]!;
    // Artigos todos revogados não vão para o título: não há o que ler nem cobrar.
    const extra = cur.size.filter((z) => z.liveArticles > 0).map((z) => `${z.short}, ${z.ranges}`).join('; ');
    t.x = { ...t.x, title: (extra ? `${t.x.title}; ${extra}` : t.x.title).slice(0, 200), topics: [...new Set([...t.x.topics, ...cur.x.topics])].sort((a, b) => a - b), incidence: Math.max(t.x.incidence ?? 2, cur.x.incidence ?? 2), ...withRefs(t.x.refs, cur.x.refs) };
    t.size = [...(t.size ?? []), ...cur.size];
    merged.push(`"${cur.x.title}" juntada a "${t.x.title}"`);
    s.splice(i, 1);
    i--;
  }
  return { sessions: s.map((y) => y.x), sizes: s.map((y) => y.size), merged };
}

// Sessões juntadas levam os artigos das duas; sem artigos em nenhuma, o campo fica de fora.
function withRefs(a?: LawRef[], b?: LawRef[]): { refs?: LawRef[] } {
  const refs = mergeLawRefs(a, b);
  return refs.length ? { refs } : {};
}
