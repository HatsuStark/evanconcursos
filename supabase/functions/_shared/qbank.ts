// Banco de questões no servidor: formato público (sem gabarito), cache, correção com registro da tentativa,
// caderno de erros (revisão em 1, 7 e 30 dias) e flashcards. Usado por "questions" e "practice".
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { QuestClient, type QuestQuestion } from '../../../shared/qbank/client.ts';
import type { MapDeps } from '../../../shared/qbank/map.ts';

export const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const normAnswer = (s: string) => normalizeText(String(s)).slice(0, 1); // "A", "c" (Certo), "e" (Errado)

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

const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const REVIEW_DAYS = [1, 7, 30];

export type Context = 'plan' | 'free' | 'review' | 'simulado';
export interface AnswerInput {
  ownerId: string; qid: string; chosen: string; context: Context; timeMs?: number | null;
  planId?: string | null; taskId?: string | null; sessionId?: string | null; subjectId?: string | null; simuladoId?: string | null;
}

// Corrige, grava a tentativa e atualiza caderno de erros e flashcards.
export async function recordAnswer(admin: SupabaseClient, a: AnswerInput) {
  const { data: q } = await admin.from('qbank_questions').select('payload, gabarito, materia, assunto, explanation').eq('qid', a.qid).maybeSingle();
  if (!q) throw new Error('Questão não encontrada.');
  const chosen = a.chosen.slice(0, 20), correct = !!chosen && normAnswer(chosen) === normAnswer(q.gabarito);
  const { error } = await admin.from('question_attempts').insert({
    owner_id: a.ownerId, plan_id: a.planId ?? null, task_id: a.taskId ?? null, session_id: a.sessionId ?? null, subject_id: a.subjectId ?? null,
    qid: a.qid, materia: q.materia, assunto: q.assunto, chosen, correct, context: a.context, simulado_id: a.simuladoId ?? null,
    time_ms: a.timeMs != null ? Math.max(0, Math.min(3_600_000, Math.round(a.timeMs))) : null,
  });
  if (error) throw new Error(error.message);

  // Caderno de erros: errou → volta amanhã (etapa 0). Na revisão, acerto avança (7 e 30 dias) e, após a última, sai.
  const { data: eb } = await admin.from('error_book').select('stage, wrong_count, resolved').eq('owner_id', a.ownerId).eq('qid', a.qid).maybeSingle();
  if (!correct) {
    await admin.from('error_book').upsert({ owner_id: a.ownerId, qid: a.qid, materia: q.materia, assunto: q.assunto, stage: 0, due_on: addDays(REVIEW_DAYS[0]!), wrong_count: (eb?.wrong_count ?? 0) + 1, resolved: false, updated_at: new Date().toISOString() });
    await upsertFlashcard(admin, a.ownerId, 'question', a.qid, questionFront(q.payload as PublicQuestion), questionBack(q.payload as PublicQuestion, q.gabarito, q.explanation as { resumo?: string } | null));
  } else if (eb && !eb.resolved && a.context === 'review') {
    const stage = eb.stage + 1;
    await admin.from('error_book').update(stage >= REVIEW_DAYS.length
      ? { stage: REVIEW_DAYS.length, resolved: true, updated_at: new Date().toISOString() }
      : { stage, due_on: addDays(REVIEW_DAYS[stage]!), updated_at: new Date().toISOString() }).eq('owner_id', a.ownerId).eq('qid', a.qid);
  }
  return { correct, gabarito: q.gabarito };
}

const questionFront = (p: PublicQuestion) =>
  [plain(p.enunciado).slice(0, 900), ...p.alternativas.map((x) => `${x.letra}) ${plain(x.texto).slice(0, 160)}`)].join('\n').slice(0, 2000);
const questionBack = (p: PublicQuestion, gabarito: string, ex: { resumo?: string } | null) => {
  const alt = p.alternativas.find((x) => normAnswer(x.letra) === normAnswer(gabarito));
  return [`Resposta: ${gabarito}${alt ? ` — ${plain(alt.texto).slice(0, 300)}` : ''}`, ex?.resumo ?? ''].filter(Boolean).join('\n\n').slice(0, 4000);
};

export async function upsertFlashcard(admin: SupabaseClient, ownerId: string, kind: 'mnemonic' | 'question', ref: string, front: string, back: string) {
  await admin.from('flashcards').upsert({ owner_id: ownerId, kind, ref, front: front.slice(0, 2000), back: back.slice(0, 4000) }, { onConflict: 'owner_id,kind,ref', ignoreDuplicates: true });
}
