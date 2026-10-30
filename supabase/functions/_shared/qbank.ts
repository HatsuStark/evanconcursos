// Banco de questões no servidor: formato público (sem gabarito), cache, correção com registro da tentativa,
// caderno de erros (revisão em 1, 7 e 30 dias) e flashcards. Usado por "questions" e "practice".
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { QuestClient, type QuestQuestion } from '../../../shared/qbank/client.ts';
import type { MapDeps } from '../../../shared/qbank/map.ts';

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
export type PublicQuestion = ReturnType<typeof publicQuestion>;

export async function cacheQuestions(admin: SupabaseClient, items: QuestQuestion[]) {
  const rows = items.filter((q) => q.gabarito).map((q) => ({
    qid: q.id, materia: q.classificacao?.materia ?? '', assunto: q.classificacao?.assunto ?? '', payload: publicQuestion(q), gabarito: String(q.gabarito),
  }));
  if (rows.length) await admin.from('qbank_questions').upsert(rows, { onConflict: 'qid', ignoreDuplicates: true });
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
  await admin.from('flashcards').upsert({ owner_id: ownerId, kind, ref, front: front.slice(0, 2000), back: back.slice(0, 4000), plan_id: planId ?? null }, { onConflict: 'owner_id,kind,ref', ignoreDuplicates: true });
}

// Situação do mnemônico de cada questão (uma consulta por lote): 'yes' já existe, 'no' a IA já disse que não
// cabe, 'maybe' ainda não avaliada. O app só mostra a aba quando faz sentido (sem gastar IA para decidir).
export async function withMnemo(admin: SupabaseClient, qs: PublicQuestion[]) {
  if (!qs.length) return qs;
  const { data } = await admin.from('qbank_questions').select('qid, mnemonic_checked, mnemonic_id').in('qid', qs.map((q) => q.qid));
  const status = new Map((data ?? []).map((r) => [r.qid as string, r.mnemonic_id ? 'yes' : r.mnemonic_checked ? 'no' : 'maybe']));
  return qs.map((q) => ({ ...q, mnemo: status.get(q.qid) ?? 'maybe' }));
}
