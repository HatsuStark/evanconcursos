// Questões no app (Edge Function "questions"): busca da sessão, correção no servidor e explicação da IA.
import { supabase } from './supabase.ts';

export interface Question {
  qid: string; enunciado: string; tipo: string; dificuldade: number;
  alternativas: { letra: string; texto: string; imagens: string[] }[];
  textos: string[]; anexos: string[];
  prova: { banca: string; ano: number; orgao: string; cargo: string } | null;
  materia: string; assunto: string;
  fonte?: 'propria';                // banco próprio (apiQuestoes); sem o campo, Quest API
  mnemo?: 'yes' | 'no' | 'maybe';   // mnemônico já existe, foi descartado ou ainda não avaliado
  warmupOf?: string;                // aquecimento: questão da sessão anterior (a resposta conta para ela)
  prev?: { ok: boolean; at: string; n: number }; // já resolvida: última resposta, quando e quantas vezes
}
export interface Explanation { resumo: string; alternativas: { letra: string; comentario: string }[]; artigos: string[]; dica: string; fontes: string[]; geradoEm: string }
export interface NextResult { questions: Question[]; filter?: { materia: string | null; assuntos: string[]; how: string }; reason: 'sem-materia' | 'sem-assunto' | 'esgotado' | 'esgotado-dificeis' | 'demorou' | 'sem-erros' | 'fim-revisao' | null }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('questions', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return data as T;
}

// exclude: questões já mostradas (a revisão semanal tira delas os próximos erros).
// batch: tamanho previsto do lote quando se pede menos para abrir mais rápido (o aquecimento é dimensionado por ele).
export const nextQuestions = (taskId: string, count = 5, exclude: string[] = [], batch = count) => call<NextResult>({ action: 'next', taskId, count, exclude, batch });
// Resposta corrigida direto no banco (answer_question): uma ida e volta, sem passar pela Edge Function.
// sessionId: questão de aquecimento, que conta para a sessão anterior.
export async function answerQuestion(taskId: string | null, qid: string, chosen: string, context: 'plan' | 'free' | 'review' = 'plan', sessionId?: string) {
  const { data, error } = await supabase.rpc('answer_question', { p_qid: qid, p_chosen: chosen, p_task: taskId, p_context: context, ...(sessionId ? { p_session: sessionId } : {}) });
  if (error) throw new Error(error.message);
  return data as { correct: boolean; gabarito: string };
}
// taskId é opcional fora do cronograma (questões livres, revisão, simulado).
export const explainQuestion = (taskId: string | null, qid: string) => call<{ explanation: Explanation }>({ action: 'explain', ...(taskId ? { taskId } : {}), qid });

// Questões de "certo ou errado" podem vir sem alternativas: o app oferece Certo/Errado.
export const optionsOf = (q: Question) => q.alternativas.length ? q.alternativas : [{ letra: 'C', texto: 'Certo', imagens: [] }, { letra: 'E', texto: 'Errado', imagens: [] }];
export const sameAnswer = (a: string, b: string) => a.trim().slice(0, 1).toUpperCase() === b.trim().slice(0, 1).toUpperCase();

export interface Mnemonic { id: string; concept: string; mnemonic: string; explanation: string; items: { chave: string; significado: string }[] }
// null = a IA avaliou que não cabe mnemônico para esta questão.
export const mnemonicFor = (taskId: string | null, qid: string) => call<{ mnemonic: Mnemonic | null }>({ action: 'mnemonic', ...(taskId ? { taskId } : {}), qid });

// Anotações pessoais por questão (RLS: só o dono lê e grava).
export async function loadNote(qid: string) {
  const { data } = await supabase.from('question_notes').select('note').eq('qid', qid).maybeSingle();
  return (data as { note: string } | null)?.note ?? '';
}
// planId liga a anotação ao concurso, mesmo em questão ainda não respondida (ela sai junto se ele for excluído).
export async function saveNote(qid: string, note: string, planId?: string) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = note.trim()
    ? await supabase.from('question_notes').upsert({ owner_id: u.user?.id, qid, note: note.slice(0, 5000), updated_at: new Date().toISOString(), ...(planId ? { plan_id: planId } : {}) }, { onConflict: 'owner_id,qid' })
    : await supabase.from('question_notes').delete().eq('qid', qid);
  if (error) throw new Error(error.message);
}
