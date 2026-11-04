// Planejamento pedagógico: respostas do questionário, schemas e prompts da IA (estratégia e sessões por
// matéria) e a correção determinística das sessões, que garante contagem exata e cobertura de todos os tópicos.
import { z } from 'zod';
import { topicKeyword } from '../domain/scheduler.ts';

export const PLAN_PROMPT_VERSION = 'plan-v3';

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

export interface StrategySubject { ref: string; name: string; core: boolean; questions: number; weight: number; level: number; topics: number }
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
Matérias (código | nome | específica? | questões na prova | peso no edital 1–5 | nível do candidato | nº de tópicos):
${p.subjects.map((s) => `${s.ref} | ${s.name} | ${s.core ? 'sim' : 'não'} | ${s.questions || '?'} | ${s.weight} | ${LEVEL_NAMES[s.level] ?? '?'} | ${s.topics}`).join('\n')}
Defina:
- subjects: para cada matéria (mesmo código), weight de 1 a 5 = prioridade de tempo de estudo. Pese o retorno em pontos (questões, peso, matérias eliminatórias) e quanto o candidato precisa evoluir: nível baixo em matéria muito cobrada = prioridade máxima; nível avançado em matéria pouco cobrada = baixa. Matéria com muitos tópicos precisa de mais tempo. focus: em que concentrar o estudo dela.
- advice: até 6 orientações práticas e curtas para este candidato, considerando o tempo e o perfil.`;
}

// ---------- etapa 2: sessões de uma matéria ----------
export const SubjectSessions = z.object({
  sessions: z.array(z.object({
    title: z.string().trim().max(200).describe('Formato "Assunto curto: detalhes (lei e artigos)".'),
    keyword: z.string().trim().max(60).describe('1 a 4 palavras para buscar questões do assunto.'),
    topics: z.array(z.number().int()).describe('Números dos tópicos do edital cobertos pela sessão.'),
    incidence: z.number().int().min(1).max(3).optional().describe('Quanto a banca cobra o assunto: 3 muito, 2 médio, 1 pouco.'),
  })),
});
export type SubjectSessions = z.infer<typeof SubjectSessions>;
export const sessionsJsonSchema = () => z.toJSONSchema(SubjectSessions, { target: 'draft-7' });

export function sessionsPrompt(p: { role: string; board: string; profile: string; subject: string; level: number; questions: number; focus: string; n: number; minutesPerSession: number; topics: string[]; duties?: string; otherRoles?: string[] }) {
  return `Você é professor de cursinho para concursos públicos brasileiros.
Concurso: ${p.role || 'não informado'}${p.board ? `, banca ${p.board}` : ''}.
${roleContext(p.role, p.duties, p.otherRoles)}
Sobre o candidato: ${p.profile.trim() || 'não informado'}. Nível dele em ${p.subject}: ${LEVEL_NAMES[p.level] ?? 'não informado'}.
Questões desta matéria na prova: ${p.questions || 'não informado'}. Foco recomendado: ${p.focus || 'não informado'}.
Conteúdo programático do edital (número. tópico):
${p.topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}
Divida a matéria em EXATAMENTE ${p.n} sessões de estudo de cerca de ${Math.round(p.minutesPerSession / 6) / 10} horas (teoria e questões no fim), na ordem ideal de aprendizado (fundamentos antes).
Regras:
- Ordem de aprendizado: conceitos e definições de que outros assuntos dependem vêm antes deles (ex.: o conceito de funcionário público antes dos crimes funcionais; teoria geral antes das espécies), mesmo que o edital os liste depois.
- Cada tópico do edital deve aparecer em pelo menos uma sessão (campo topics, com os números acima).
- Distribua as sessões pela incidência${p.board ? ` na banca ${p.board}` : ''}: assunto que a banca mais cobra ganha mais sessões (repita o número do tópico); assunto pouco cobrado pode ser agrupado com outros numa sessão só.
- incidence: 3 para assunto muito cobrado, 2 médio, 1 pouco cobrado. Baseie-se no histórico de provas da banca e do cargo.
- Ajuste ao nível: iniciante precisa de mais sessões de base; avançado, de mais tempo nos pontos difíceis e mais cobrados.
- title: até 120 caracteres, formato "Assunto curto: detalhes", citando lei e artigos quando houver. Sem repetir títulos.
- keyword: o assunto em 1 a 4 palavras, como se busca em sites de questões (ex.: "inquérito policial").
- Não inclua nada fora do conteúdo programático.`;
}

// ---------- correção determinística ----------
export interface Session { title: string; keyword: string; topics: number[]; incidence?: number } // topics: índices 0-based; incidence 1–3

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
export function repairSessions(raw: SubjectSessions, n: number, topics: string[]): { sessions: Session[]; fixes: string[] } {
  const T = topics.length, fixes: string[] = [];
  let s: Session[] = raw.sessions
    .map((x) => ({ title: x.title.trim(), keyword: x.keyword.trim(), incidence: x.incidence && [1, 2, 3].includes(x.incidence) ? x.incidence : 2, topics: [...new Set(x.topics.filter((t) => Number.isInteger(t) && t >= 1 && t <= T).map((t) => t - 1))] }))
    .filter((x) => x.title);
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

  // Contagem: junta vizinhas com menos tópicos ou divide a maior até dar n.
  while (s.length > n) {
    let best = 0;
    for (let i = 1; i < s.length - 1; i++) if (s[i]!.topics.length + s[i + 1]!.topics.length < s[best]!.topics.length + s[best + 1]!.topics.length) best = i;
    const a = s[best]!, b = s[best + 1]!;
    s.splice(best, 2, { title: a.title, keyword: a.keyword || b.keyword, incidence: Math.max(a.incidence ?? 2, b.incidence ?? 2), topics: [...new Set([...a.topics, ...b.topics])].sort((x, y) => x - y) });
    fixes.push('sessões unidas');
  }
  while (s.length < n) {
    let big = 0;
    s.forEach((x, i) => { if (x.topics.length > s[big]!.topics.length) big = i; });
    const x = s[big]!;
    if (x.topics.length >= 2) {
      const half = Math.ceil(x.topics.length / 2);
      s.splice(big, 1, { ...x, title: `${x.title} (parte 1)`.slice(0, 200), topics: x.topics.slice(0, half) },
        { ...x, title: `${x.title} (parte 2)`.slice(0, 200), topics: x.topics.slice(half) });
    } else {
      // Só sessões de um tópico: o próximo dia aprofunda e pratica o mesmo assunto.
      const longest = s.reduce((m, y, i) => ((topics[y.topics[0] ?? -1]?.length ?? 0) > (topics[s[m]!.topics[0] ?? -1]?.length ?? 0) ? i : m), 0);
      const y = s[longest]!;
      s.splice(longest + 1, 0, { ...y, title: `${y.title.replace(/ \(aprofundamento\)$/, '')} (aprofundamento)`.slice(0, 200) });
    }
    fixes.push('sessão dividida');
  }
  s = s.map((x) => ({ ...x, keyword: x.keyword || topicKeyword(x.title) }));
  return { sessions: s, fixes };
}

// ---------- sessões de lei quase vazia ----------
// O edital às vezes cita artigos revogados ou que só remetem a outro capítulo (ex.: Normas da CGJ, arts. 105 a 110: o 105
// remete ao Capítulo VII e os demais foram revogados em 2023). Uma sessão inteira para isso desperdiça um dia. A medição
// vem do texto oficial (artigos vigentes e revogados dos intervalos citados no título); a sessão curta é juntada à
// vizinha que cita a mesma lei (ou, sem ela, à vizinha mais próxima), e o título leva os artigos das duas para a lei seca,
// a apostila e as questões continuarem cobrindo tudo. Depois, repairSessions divide a maior para manter a contagem.
export interface LawSize { law: string; short: string; ranges: string; liveChars: number; liveArticles: number; revokedArticles: number }
export const SHORT_LAW_CHARS = 600, MOSTLY_REVOKED_CHARS = 1500;
export function isShortLaw(sizes: LawSize[]) {
  if (!sizes.length) return false;
  const live = sizes.reduce((a, s) => a + s.liveChars, 0), revoked = sizes.reduce((a, s) => a + s.revokedArticles, 0);
  const total = revoked + sizes.reduce((a, s) => a + s.liveArticles, 0);
  return live < SHORT_LAW_CHARS || (revoked * 2 >= total && live < MOSTLY_REVOKED_CHARS);
}
export function mergeShortLawSessions<T extends { title: string; keyword: string; topics: number[]; incidence?: number }>(list: T[], sizes: (LawSize[] | null)[]): { sessions: T[]; merged: string[] } {
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
    t.x = { ...t.x, title: (extra ? `${t.x.title}; ${extra}` : t.x.title).slice(0, 200), topics: [...new Set([...t.x.topics, ...cur.x.topics])].sort((a, b) => a - b), incidence: Math.max(t.x.incidence ?? 2, cur.x.incidence ?? 2) };
    t.size = [...(t.size ?? []), ...cur.size];
    merged.push(`"${cur.x.title}" juntada a "${t.x.title}"`);
    s.splice(i, 1);
    i--;
  }
  return { sessions: s.map((y) => y.x), merged };
}
