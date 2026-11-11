// Banco de questões no servidor: formato público (sem gabarito), cache, correção com registro da tentativa,
// caderno de erros (revisão em 1, 7 e 30 dias) e flashcards. Usado por "questions" e "practice".
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { QuestClient, type QuestQuestion } from '../../../shared/qbank/client.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { genericSubject } from '../../../shared/qbank/materias.ts';
import { OWN_PREFIX } from '../../../shared/qbank/own.ts';
import { CarreiraChoice, carreiraJsonSchema, carreiraPrompt, dominantFormat, ORGAO_MIN, mapSession, usefulCarreira, mapSubject, newestPage, pickBoard, QMAP_PROMPT_VERSION, QUESTION_FORMATS, usefulNarrowing, type Incidence, type MapDeps, type SessionFilter } from '../../../shared/qbank/map.ts';

export const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export function publicQuestion(q: QuestQuestion) {
  const p = q.provas?.[0];
  return {
    qid: q.id, enunciado: q.enunciado, tipo: q.tipo, dificuldade: q.dificuldade,
    alternativas: (q.alternativas ?? []).map((a) => ({ letra: a.letra, texto: a.texto, imagens: a.imagens ?? [] })),
    textos: q.textos_associados ?? [], anexos: q.anexos ?? [],
    prova: p ? { banca: p.banca, ano: p.ano, orgao: p.orgao, cargo: p.cargo } : null,
    materia: q.classificacao?.materia ?? '', assunto: q.classificacao?.assunto ?? '',
    carreiras: q.carreiras ?? [],
  };
}
// warmupOf: questão de aquecimento, da sessão anterior (a resposta conta para ela).
export type PublicQuestion = ReturnType<typeof publicQuestion> & { warmupOf?: string };

export async function cacheQuestions(admin: SupabaseClient, items: QuestQuestion[]) {
  const rows = items.filter((q) => q.gabarito).map((q) => ({
    qid: q.id, materia: q.classificacao?.materia ?? '', assunto: q.classificacao?.assunto ?? '', payload: publicQuestion(q), gabarito: String(q.gabarito),
  }));
  if (rows.length) await admin.from('qbank_questions').upsert(rows, { onConflict: 'qid', ignoreDuplicates: true });
}

// Mensagem ao estudante quando a busca falha: a cota do banco de questões acabar não se resolve tentando de novo.
export const questFailure = (message: string, fallback: string) => (/Quest API .*: 402\b/.test(message)
  ? 'A cota mensal do banco de questões acabou. Questões já respondidas e o caderno de erros continuam disponíveis.'
  : fallback);

// Questões já compradas (cache) que servem ao filtro e o estudante ainda não viu: não gastam créditos. Antes de buscar na
// API, usa estas: lotes buscados adiantados e amostras das apostilas ficavam pagos e nunca apareciam.
// O banco próprio (apiQuestoes, qid "own-…") vem antes das da Quest, e a dificuldade não o filtra (a dele é só estimada
// pela IA na classificação): a única preferência nele é a banca (`preferBanca`), depois as provas mais recentes.
// Nas da Quest a dificuldade filtra; primeiro o mesmo órgão, a carreira, a banca e as mais recentes.
export interface CacheFilter { materia: string; assunto?: string; assuntos?: string[]; dificuldades?: string[]; banca?: string; preferBanca?: string; preferOrgao?: string; preferCarreiras?: string[]; tipo?: string; ano?: string; minAno?: number; orgao?: string; cargo?: string; fonte?: 'propria' | 'quest' }
export async function fromCache(admin: SupabaseClient, f: CacheFilter, want: number, isNew: (qid: string) => boolean): Promise<PublicQuestion[]> {
  if (want <= 0 || !f.materia) return [];
  const query = (own: boolean) => {
    let q = admin.from('qbank_questions').select('qid, payload').eq('materia', f.materia);
    if (f.assunto) q = q.eq('assunto', f.assunto);
    else if (f.assuntos?.length) q = q.in('assunto', f.assuntos); // vários assuntos: qualquer um deles (OU)
    if (f.banca) q = q.eq('payload->prova->>banca', f.banca);
    if (f.tipo) q = q.ilike('payload->>tipo', f.tipo);
    if (f.ano) q = q.eq('payload->prova->>ano', f.ano);
    // Ano com 4 dígitos: a comparação como texto vale como número.
    if (f.minAno) q = q.gte('payload->prova->>ano', String(f.minAno));
    if (f.orgao) q = q.ilike('payload->prova->>orgao', `%${f.orgao}%`);
    if (f.cargo) q = q.ilike('payload->prova->>cargo', `%${f.cargo}%`);
    if (own) return q.like('qid', `${OWN_PREFIX}%`);
    if (f.dificuldades?.length) q = q.in('payload->>dificuldade', f.dificuldades);
    return q.not('qid', 'like', `${OWN_PREFIX}%`);
  };
  const board = normalizeText(f.preferBanca ?? ''), organ = normalizeText(f.preferOrgao ?? ''), careers = new Set(f.preferCarreiras ?? []);
  // Nas da Quest: provas do mesmo órgão primeiro, depois as da mesma carreira (só as compradas depois de o cache guardar a
  // carreira), a banca e as mais recentes.
  const sameOrgan = (p: PublicQuestion) => Number(!!organ && normalizeText(p.prova?.orgao ?? '').includes(organ));
  const sameCareer = (p: PublicQuestion) => Number((p.carreiras ?? []).some((c) => careers.has(c)));
  const sameBoard = (p: PublicQuestion) => Number(!!board && normalizeText(p.prova?.banca ?? '') === board);
  const newest = (a: PublicQuestion, b: PublicQuestion) => (b.prova?.ano ?? 0) - (a.prova?.ano ?? 0);
  const out: PublicQuestion[] = [];
  for (const own of [true, false]) {
    if (out.length >= want || f.fonte === (own ? 'quest' : 'propria')) continue;
    const { data, error } = await query(own).limit(300);
    if (error) continue;
    out.push(...(data ?? []).map((r) => r.payload as PublicQuestion).filter((p) => isNew(p.qid))
      .sort(own
        ? (a, b) => sameBoard(b) - sameBoard(a) || newest(a, b)
        : (a, b) => sameOrgan(b) - sameOrgan(a) || sameCareer(b) - sameCareer(a) || sameBoard(b) - sameBoard(a) || newest(a, b))
      .slice(0, want - out.length));
  }
  return out;
}

// Questões novas para o estudante, das provas mais recentes para as mais antigas, com uma posição guardada por escopo e filtro.
// O prefixo separa estas posições dos cursores antigos, que apontavam para ids.
// Posições já lidas do escopo (`loadCursors`), para não ir ao banco por filtro: a sessão testa dezenas deles por pedido.
export type Cursors = Map<string, { after_id: string; exhausted: boolean }>;
export async function loadCursors(admin: SupabaseClient, ownerId: string, scope: string): Promise<Cursors> {
  const { data } = await admin.from('qbank_cursors').select('filter_key, after_id, exhausted').eq('owner_id', ownerId).eq('scope', scope).limit(5000);
  return new Map((data ?? []).map((c) => [c.filter_key as string, { after_id: String(c.after_id), exhausted: !!c.exhausted }]));
}
export const cursorExhausted = (cursors: Cursors, key: string) => !!cursors.get(`n:${key}`)?.exhausted;

export async function takeNewest(admin: SupabaseClient, quest: QuestClient, ownerId: string, scope: string, key: string, params: Record<string, string>, want: number, isNew: (q: QuestQuestion) => boolean, cursors?: Cursors) {
  const out: QuestQuestion[] = [], filterKey = `n:${key}`;
  const cur = cursors ? cursors.get(filterKey) ?? null
    : (await admin.from('qbank_cursors').select('after_id, exhausted').eq('owner_id', ownerId).eq('scope', scope).eq('filter_key', filterKey).maybeSingle()).data;
  if (cur?.exhausted) return out;
  let position = cur ? Number(cur.after_id) : await quest.usableTotal(params);
  for (let round = 0; round < 4 && out.length < want && position > 0; round++) {
    const { page, perPage } = newestPage(position, want - out.length);
    const items = await quest.questoesPage(params, page, perPage);
    await cacheQuestions(admin, items);
    out.push(...[...items].reverse().filter((q) => q.gabarito && isNew(q) && !out.some((o) => o.id === q.id)));
    position -= perPage;
  }
  await admin.from('qbank_cursors').upsert({ owner_id: ownerId, scope, filter_key: filterKey, after_id: String(position), exhausted: position <= 0, updated_at: new Date().toISOString() });
  cursors?.set(filterKey, { after_id: String(position), exhausted: position <= 0 });
  return out;
}

// Dependências do mapeamento (Quest API + Gemini + cache de assuntos), acumulando o consumo da IA.
export function mapDeps(admin: SupabaseClient, quest: QuestClient, usage: GeminiUsage): MapDeps {
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  return {
    materias: (q) => quest.materias(q),
    assuntosMatching: (materia, q) => quest.assuntosMatching(materia, q),
    assuntosOf: async (materia) => {
      const { data } = await admin.from('qbank_assunto_lists').select('assuntos, fetched_at').eq('materia', materia).maybeSingle();
      if (data && Date.now() - new Date(data.fetched_at).getTime() < 30 * 864e5) return data.assuntos as string[];
      const list = await quest.assuntos(materia);
      await admin.from('qbank_assunto_lists').upsert({ materia, assuntos: list, fetched_at: new Date().toISOString() });
      return list;
    },
    ai: async (schema, jsonSchema, prompt, opts) => {
      const r = await generateJson({ apiKey, model, schema, jsonSchema, parts: [{ text: prompt }], ...(opts?.quick ? { thinkingLevel: 'low' as const } : {}) });
      usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens; usage.thinkingTokens += r.usage.thinkingTokens;
      return r.data;
    },
  };
}

// Matéria da disciplina (uma vez) e banca do edital. Os dados só são lidos se ainda não houver mapeamento.
// Mapa já feito por outro candidato do mesmo edital (notices.doc_key) para a disciplina de mesmo nome: matéria, banca,
// formato da banca e as medições de órgão, cargo, carreira e escolaridade. Sem IA nem créditos; as medições guardam o
// cargo e a escolaridade com que foram feitas, e ensureNarrowing mede de novo se forem outros.
type SubjectMapRow = { materia: string | null; banca: string; banca_tipo: string | null; narrowing: unknown; how: string; prompt_version: string };
async function sharedSubjectMap(admin: SupabaseClient, subjectId: string): Promise<SubjectMapRow | null> {
  const { data: me } = await admin.from('notice_subjects').select('name, notices!inner(doc_key)').eq('id', subjectId).maybeSingle();
  const docKey = (me?.notices as { doc_key?: string | null } | null)?.doc_key;
  if (!me || !docKey) return null;
  const { data } = await admin.from('notice_subjects').select('name, notices!inner(doc_key), qbank_subject_maps!inner(materia, banca, banca_tipo, narrowing, how, prompt_version)')
    .eq('notices.doc_key', docKey).neq('id', subjectId).limit(300);
  const name = normalizeText(String(me.name));
  for (const row of (data ?? []) as { name: string; qbank_subject_maps: SubjectMapRow | SubjectMapRow[] }[]) {
    const m = Array.isArray(row.qbank_subject_maps) ? row.qbank_subject_maps[0] : row.qbank_subject_maps;
    if (m && m.prompt_version === QMAP_PROMPT_VERSION && normalizeText(row.name) === name) return m;
  }
  return null;
}

export async function ensureSubjectMap(admin: SupabaseClient, quest: QuestClient, deps: MapDeps, ownerId: string, subjectId: string, load: () => Promise<{ name: string; board: string; topics: string[]; organization: string }>) {
  const { data: sm } = await admin.from('qbank_subject_maps').select('materia, banca, banca_tipo, prompt_version').eq('subject_id', subjectId).maybeSingle();
  if (sm && sm.prompt_version === QMAP_PROMPT_VERSION) return sm as { materia: string | null; banca: string; banca_tipo: string | null };
  const shared = await sharedSubjectMap(admin, subjectId).catch(() => null);
  if (shared) {
    await admin.from('qbank_subject_maps').upsert({ subject_id: subjectId, owner_id: ownerId, materia: shared.materia, banca: shared.banca, banca_tipo: shared.banca_tipo, narrowing: shared.narrowing, how: shared.how, prompt_version: QMAP_PROMPT_VERSION });
    return { materia: shared.materia, banca: shared.banca, banca_tipo: shared.banca_tipo };
  }
  // Mapa de versão antiga: refaz o da disciplina que ficou sem matéria ou que tem nome genérico ("Conhecimentos
  // Específicos" casava com "Conhecimentos Específicos das Regiões"); os outros só passam para a versão atual.
  const s = await load();
  if (sm && sm.materia && !genericSubject(s.name)) {
    await admin.from('qbank_subject_maps').update({ prompt_version: QMAP_PROMPT_VERSION }).eq('subject_id', subjectId);
    return sm as { materia: string | null; banca: string; banca_tipo: string | null };
  }
  const banca = s.board ? await pickBoard(s.board, (q) => quest.bancas(q)) : '';
  const r = await mapSubject(deps, { name: s.name, topics: s.topics, organization: s.organization });
  await admin.from('qbank_subject_maps').upsert({ subject_id: subjectId, owner_id: ownerId, materia: r.materia, banca, how: r.how, prompt_version: QMAP_PROMPT_VERSION });
  return { materia: r.materia, banca, banca_tipo: null };
}

// Formato predominante da banca na matéria (uma vez por disciplina, 3 créditos por formato). Se a medição falhar, tenta na próxima busca.
export async function ensureBoardFormat(admin: SupabaseClient, quest: QuestClient, subjectId: string, sm: { materia: string | null; banca: string; banca_tipo: string | null }) {
  if (sm.banca_tipo !== null || !sm.materia || !sm.banca) return sm.banca_tipo ?? '';
  try {
    const counts: Record<string, number> = {};
    for (const tipo of QUESTION_FORMATS) counts[tipo] = await quest.count({ banca: sm.banca, materia: sm.materia, tipo });
    const format = dominantFormat(counts);
    await admin.from('qbank_subject_maps').update({ banca_tipo: format }).eq('subject_id', subjectId);
    return format;
  } catch { return ''; }
}

// Carreiras do edital no banco de questões (a específica e a geral), escolhidas uma vez pela IA, com raciocínio baixo, e
// guardadas no edital. Se a escolha falhar, segue sem carreira e tenta de novo na próxima busca.
export async function ensureCarreiras(admin: SupabaseClient, quest: QuestClient, deps: MapDeps, noticeId: string): Promise<string[]> {
  const { data: n } = await admin.from('notices').select('organization, role_name, role_duties, education_level, qbank_carreiras, doc_key').eq('id', noticeId).maybeSingle();
  if (!n) return [];
  if (Array.isArray(n.qbank_carreiras)) return n.qbank_carreiras as string[];
  // Outro candidato do mesmo edital e do mesmo cargo já teve as carreiras escolhidas: copia, sem IA.
  if (n.doc_key) {
    const { data: same } = await admin.from('notices').select('role_name, qbank_carreiras').eq('doc_key', n.doc_key).neq('id', noticeId).not('qbank_carreiras', 'is', null).limit(50);
    const twin = (same ?? []).find((x) => normalizeText(String(x.role_name ?? '')) === normalizeText(String(n.role_name ?? '')));
    if (twin) {
      await admin.from('notices').update({ qbank_carreiras: twin.qbank_carreiras }).eq('id', noticeId);
      return twin.qbank_carreiras as string[];
    }
  }
  try {
    const candidates = await quest.carreiras();
    if (!candidates.length) return [];
    const r = await deps.ai(CarreiraChoice, carreiraJsonSchema(), carreiraPrompt({ organization: String(n.organization ?? ''), role: String(n.role_name ?? ''), duties: String(n.role_duties ?? ''), level: String(n.education_level ?? ''), candidates }), { quick: true });
    const chosen = [...new Set(r.carreiras.filter((c) => candidates.includes(c)))].slice(0, 2);
    await admin.from('notices').update({ qbank_carreiras: chosen }).eq('id', noticeId);
    return chosen;
  } catch (e) { console.error('carreiras:', e); return []; }
}

// Órgão, cargo, carreiras e escolaridade que valem a pena na busca desta disciplina, medidos uma vez: até 6 buscas (3
// créditos cada). O órgão entra com ORGAO_MIN questões na matéria; cada carreira do edital, se rende (usefulCarreira), na
// ordem dela (a específica, que pode ter poucas questões, e depois a geral); cargo e escolaridade, pelo usefulNarrowing. Muda algum deles no edital,
// mede de novo. Se a medição falhar, busca com cargo e escolaridade, como antes, sem órgão nem carreira.
export async function ensureNarrowing(admin: SupabaseClient, quest: QuestClient, subjectId: string, materia: string | null, role: string, level: string, orgao = '', carreiras: string[] = []) {
  if (!materia || (!role && !level && !orgao && !carreiras.length)) return { role, level, orgao: '', carreiras: [] as string[] };
  const careers = carreiras.join('|');
  const { data } = await admin.from('qbank_subject_maps').select('narrowing').eq('subject_id', subjectId).maybeSingle();
  const n = data?.narrowing as { role: string; level: string; orgao?: string; careers?: string; useRole: boolean; useLevel: boolean; useOrgao?: boolean; useCareers?: string[] } | null;
  if (n && n.role === role && n.level === level && (n.orgao ?? '') === orgao && (n.careers ?? '') === careers) {
    return { role: n.useRole ? role : '', level: n.useLevel ? level : '', orgao: n.useOrgao ? orgao : '', carreiras: n.useCareers ?? [] };
  }
  try {
    const total = await quest.usableTotal({ materia });
    const useRole = !!role && usefulNarrowing(total, await quest.usableTotal({ materia, cargo: role }));
    const useLevel = !!level && usefulNarrowing(total, await quest.usableTotal({ materia, nivel_escolaridade: level }));
    const useOrgao = !!orgao && (await quest.usableTotal({ materia, orgao })) >= ORGAO_MIN;
    const useCareers: string[] = [];
    for (const c of carreiras) if (usefulCarreira(total, await quest.usableTotal({ materia, carreira: c }))) useCareers.push(c);
    await admin.from('qbank_subject_maps').update({ narrowing: { role, level, orgao, careers, useRole, useLevel, useOrgao, useCareers } }).eq('subject_id', subjectId);
    return { role: useRole ? role : '', level: useLevel ? level : '', orgao: useOrgao ? orgao : '', carreiras: useCareers };
  } catch { return { role, level, orgao: '', carreiras: [] as string[] }; }
}

// Assuntos da sessão (uma vez por sessão e versão do prompt). Mapa de versão antiga é refeito na próxima abertura; a
// incidência (3 créditos por assunto) só é medida de novo se os assuntos mudaram.
export async function ensureSessionMap(admin: SupabaseClient, deps: MapDeps, ownerId: string, sessionId: string, materia: string | null, load: () => Promise<{ subject: string; title: string; keyword: string; topics: string[]; organization: string }>) {
  const { data: m } = await admin.from('qbank_session_maps').select('materia, assuntos, how, incidence, prompt_version, materia_of').eq('session_id', sessionId).maybeSingle();
  if (m && m.prompt_version === QMAP_PROMPT_VERSION) return { ...m, materiaOf: m.materia_of } as SessionFilter & { incidence: Incidence[] | null };
  const filter = await mapSession(deps, materia, await load());
  const key = (f: { materia: string | null; assuntos: string[]; materiaOf?: Record<string, string> | null }) => `${f.materia}|${f.assuntos.map((a) => `${f.materiaOf?.[a] ?? ''}>${a}`).sort().join('|')}`;
  const same = !!m && key({ materia: m.materia, assuntos: m.assuntos ?? [], materiaOf: m.materia_of }) === key(filter);
  const incidence = same ? (m!.incidence as Incidence[] | null) : null;
  await admin.from('qbank_session_maps').upsert({ session_id: sessionId, owner_id: ownerId, materia: filter.materia, assuntos: filter.assuntos, materia_of: filter.materiaOf ?? null, how: filter.how, incidence, prompt_version: QMAP_PROMPT_VERSION });
  return { ...filter, incidence };
}

export type Context = 'plan' | 'free' | 'review' | 'simulado';
export interface AnswerInput {
  ownerId: string; qid: string; chosen: string; context: Context;
  planId?: string | null; taskId?: string | null; sessionId?: string | null; subjectId?: string | null; simuladoId?: string | null;
}

// Corrige e registra pela função do banco (mesma regra do app: tentativa, caderno de erros e flashcard).
export async function recordAnswer(admin: SupabaseClient, a: AnswerInput) {
  const { data, error } = await admin.rpc('record_answer_for', {
    p_owner: a.ownerId, p_qid: a.qid, p_chosen: a.chosen, p_context: a.context, p_plan: a.planId ?? null, p_task: a.taskId ?? null,
    p_session: a.sessionId ?? null, p_subject: a.subjectId ?? null, p_simulado: a.simuladoId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { correct: boolean; gabarito: string };
}

export async function upsertFlashcard(admin: SupabaseClient, ownerId: string, kind: 'mnemonic' | 'question', ref: string, front: string, back: string, planId?: string | null) {
  await admin.from('flashcards').upsert({ owner_id: ownerId, kind, ref, front: front.slice(0, 2000), back: back.slice(0, 4000), plan_id: planId ?? null }, { onConflict: 'owner_id,plan_id,kind,ref', ignoreDuplicates: true });
}

// Plano do concurso ativo do estudante (escolhido na aba Concursos; sem escolha, o mais recente). Null sem plano.
export async function activePlan(admin: SupabaseClient, ownerId: string): Promise<string | null> {
  const { data, error } = await admin.rpc('active_plan_for', { p_owner: ownerId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// Situação de cada questão no lote (duas consultas):
// - mnemo: 'yes' o mnemônico já existe, 'no' a IA já disse que não cabe, 'maybe' ainda não avaliada. O app só mostra a
//   aba quando faz sentido (sem gastar IA para decidir).
// - prev: o que o estudante já fez nela, em qualquer concurso (última resposta, quando e quantas vezes), para o selo
//   "Resolvi certo/errado". Sem tentativa, não vem.
export async function withStatus(admin: SupabaseClient, ownerId: string, qs: PublicQuestion[]) {
  if (!qs.length) return qs;
  const ids = qs.map((q) => q.qid);
  const [{ data }, { data: tries }] = await Promise.all([
    admin.from('qbank_questions').select('qid, mnemonic_checked, mnemonic_id').in('qid', ids),
    admin.from('question_attempts').select('qid, correct, created_at').eq('owner_id', ownerId).in('qid', ids).order('created_at', { ascending: false }).limit(2000),
  ]);
  const status = new Map((data ?? []).map((r) => [r.qid as string, r.mnemonic_id ? 'yes' : r.mnemonic_checked ? 'no' : 'maybe']));
  const prev = new Map<string, { ok: boolean; at: string; n: number }>();
  for (const t of tries ?? []) {
    const p = prev.get(t.qid);
    if (p) p.n++;
    else prev.set(t.qid, { ok: !!t.correct, at: String(t.created_at), n: 1 });
  }
  return qs.map((q) => ({ ...q, mnemo: status.get(q.qid) ?? 'maybe', ...(prev.has(q.qid) ? { prev: prev.get(q.qid) } : {}) }));
}
