// Banco de questões no servidor: formato público (sem gabarito), cache, correção com registro da tentativa,
// caderno de erros (revisão em 1, 7 e 30 dias) e flashcards. Usado por "questions" e "practice".
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { QuestClient, type QuestQuestion } from '../../../shared/qbank/client.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { dominantFormat, mapSession, mapSubject, newestPage, pickBoard, QMAP_PROMPT_VERSION, QUESTION_FORMATS, usefulNarrowing, type Incidence, type MapDeps, type SessionFilter } from '../../../shared/qbank/map.ts';

export const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export function publicQuestion(q: QuestQuestion) {
  const p = q.provas?.[0];
  return {
    qid: q.id, enunciado: q.enunciado, tipo: q.tipo, dificuldade: q.dificuldade,
    alternativas: (q.alternativas ?? []).map((a) => ({ letra: a.letra, texto: a.texto, imagens: a.imagens ?? [] })),
    textos: q.textos_associados ?? [], anexos: q.anexos ?? [],
    prova: p ? { banca: p.banca, ano: p.ano, orgao: p.orgao, cargo: p.cargo } : null,
    materia: q.classificacao?.materia ?? '', assunto: q.classificacao?.assunto ?? '',
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
// API, usa estas: lotes buscados adiantados e amostras das apostilas ficavam pagos e nunca apareciam. Primeiro as da
// banca (`preferBanca`), depois as provas mais recentes.
export interface CacheFilter { materia: string; assunto?: string; dificuldades?: string[]; banca?: string; preferBanca?: string; tipo?: string; ano?: string; orgao?: string; cargo?: string }
export async function fromCache(admin: SupabaseClient, f: CacheFilter, want: number, isNew: (qid: string) => boolean): Promise<PublicQuestion[]> {
  if (want <= 0 || !f.materia) return [];
  let q = admin.from('qbank_questions').select('qid, payload').eq('materia', f.materia);
  if (f.assunto) q = q.eq('assunto', f.assunto);
  if (f.dificuldades?.length) q = q.in('payload->>dificuldade', f.dificuldades);
  if (f.banca) q = q.eq('payload->prova->>banca', f.banca);
  if (f.tipo) q = q.ilike('payload->>tipo', f.tipo);
  if (f.ano) q = q.eq('payload->prova->>ano', f.ano);
  if (f.orgao) q = q.ilike('payload->prova->>orgao', `%${f.orgao}%`);
  if (f.cargo) q = q.ilike('payload->prova->>cargo', `%${f.cargo}%`);
  const { data, error } = await q.limit(300);
  if (error) return [];
  const board = normalizeText(f.preferBanca ?? '');
  return (data ?? []).map((r) => r.payload as PublicQuestion).filter((p) => isNew(p.qid))
    .sort((a, b) => Number(!!board && normalizeText(b.prova?.banca ?? '') === board) - Number(!!board && normalizeText(a.prova?.banca ?? '') === board) || (b.prova?.ano ?? 0) - (a.prova?.ano ?? 0))
    .slice(0, want);
}

// Questões novas para o estudante, das provas mais recentes para as mais antigas, com uma posição guardada por escopo e filtro.
// O prefixo separa estas posições dos cursores antigos, que apontavam para ids.
export async function takeNewest(admin: SupabaseClient, quest: QuestClient, ownerId: string, scope: string, key: string, params: Record<string, string>, want: number, isNew: (q: QuestQuestion) => boolean) {
  const out: QuestQuestion[] = [], filterKey = `n:${key}`;
  const { data: cur } = await admin.from('qbank_cursors').select('after_id, exhausted').eq('owner_id', ownerId).eq('scope', scope).eq('filter_key', filterKey).maybeSingle();
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
  return out;
}

// Dependências do mapeamento (Quest API + Gemini + cache de assuntos), acumulando o consumo da IA.
export function mapDeps(admin: SupabaseClient, quest: QuestClient, usage: GeminiUsage): MapDeps {
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  return {
    materias: (q) => quest.materias(q),
    assuntosOf: async (materia) => {
      const { data } = await admin.from('qbank_assunto_lists').select('assuntos, fetched_at').eq('materia', materia).maybeSingle();
      if (data && Date.now() - new Date(data.fetched_at).getTime() < 30 * 864e5) return data.assuntos as string[];
      const list = await quest.assuntos(materia);
      await admin.from('qbank_assunto_lists').upsert({ materia, assuntos: list, fetched_at: new Date().toISOString() });
      return list;
    },
    ai: async (schema, jsonSchema, prompt) => {
      const r = await generateJson({ apiKey, model, schema, jsonSchema, parts: [{ text: prompt }] });
      usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens; usage.thinkingTokens += r.usage.thinkingTokens;
      return r.data;
    },
  };
}

// Matéria da disciplina (uma vez) e banca do edital. Os dados só são lidos se ainda não houver mapeamento.
export async function ensureSubjectMap(admin: SupabaseClient, quest: QuestClient, deps: MapDeps, ownerId: string, subjectId: string, load: () => Promise<{ name: string; board: string; topics: string[]; organization: string }>) {
  const { data: sm } = await admin.from('qbank_subject_maps').select('materia, banca, banca_tipo').eq('subject_id', subjectId).maybeSingle();
  if (sm) return sm as { materia: string | null; banca: string; banca_tipo: string | null };
  const s = await load();
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

// Cargo e escolaridade que valem a pena na busca desta disciplina (usefulNarrowing), medidos uma vez: 3 buscas, ~4 s.
// Muda o cargo ou a escolaridade do edital, mede de novo. Se a medição falhar, busca com os dois, como antes.
export async function ensureNarrowing(admin: SupabaseClient, quest: QuestClient, subjectId: string, materia: string | null, role: string, level: string) {
  if (!materia || (!role && !level)) return { role, level };
  const { data } = await admin.from('qbank_subject_maps').select('narrowing').eq('subject_id', subjectId).maybeSingle();
  const n = data?.narrowing as { role: string; level: string; useRole: boolean; useLevel: boolean } | null;
  if (n && n.role === role && n.level === level) return { role: n.useRole ? role : '', level: n.useLevel ? level : '' };
  try {
    const total = await quest.usableTotal({ materia });
    const useRole = !!role && usefulNarrowing(total, await quest.usableTotal({ materia, cargo: role }));
    const useLevel = !!level && usefulNarrowing(total, await quest.usableTotal({ materia, nivel_escolaridade: level }));
    await admin.from('qbank_subject_maps').update({ narrowing: { role, level, useRole, useLevel } }).eq('subject_id', subjectId);
    return { role: useRole ? role : '', level: useLevel ? level : '' };
  } catch { return { role, level }; }
}

// Assuntos da sessão (uma vez por sessão e versão do prompt). Mapa de versão antiga é refeito na próxima abertura; a
// incidência (3 créditos por assunto) só é medida de novo se os assuntos mudaram.
export async function ensureSessionMap(admin: SupabaseClient, deps: MapDeps, ownerId: string, sessionId: string, materia: string | null, load: () => Promise<{ subject: string; title: string; keyword: string; topics: string[]; organization: string }>) {
  const { data: m } = await admin.from('qbank_session_maps').select('materia, assuntos, how, incidence, prompt_version').eq('session_id', sessionId).maybeSingle();
  if (m && m.prompt_version === QMAP_PROMPT_VERSION) return m as SessionFilter & { incidence: Incidence[] | null };
  const filter = await mapSession(deps, materia, await load());
  const same = !!m && m.materia === filter.materia && [...((m.assuntos ?? []) as string[])].sort().join('|') === [...filter.assuntos].sort().join('|');
  const incidence = same ? (m!.incidence as Incidence[] | null) : null;
  await admin.from('qbank_session_maps').upsert({ session_id: sessionId, owner_id: ownerId, materia: filter.materia, assuntos: filter.assuntos, how: filter.how, incidence, prompt_version: QMAP_PROMPT_VERSION });
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
