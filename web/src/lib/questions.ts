// Questões no app (Edge Function "questions"): busca da sessão, correção no servidor e explicação da IA.
import { supabase } from './supabase.ts';

export interface Question {
  qid: string; enunciado: string; tipo: string; dificuldade: number;
  alternativas: { letra: string; texto: string; imagens: string[] }[];
  textos: string[]; anexos: string[];
  prova: { banca: string; ano: number; orgao: string; cargo: string } | null;
  materia: string; assunto: string;
}
export interface Explanation { resumo: string; alternativas: { letra: string; comentario: string }[]; artigos: string[]; dica: string; fontes: string[]; geradoEm: string }
export interface NextResult { questions: Question[]; filter?: { materia: string | null; assuntos: string[]; how: string }; reason: 'sem-materia' | 'sem-assunto' | 'esgotado' | null }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('questions', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sem JSON */ }
    throw new Error(msg);
  }
  return data as T;
}

export const nextQuestions = (taskId: string, count = 5) => call<NextResult>({ action: 'next', taskId, count });
export const answerQuestion = (taskId: string, qid: string, chosen: string) => call<{ correct: boolean; gabarito: string }>({ action: 'answer', taskId, qid, chosen });
export const explainQuestion = (taskId: string, qid: string) => call<{ explanation: Explanation }>({ action: 'explain', taskId, qid });

// Questões de "certo ou errado" podem vir sem alternativas: o app oferece Certo/Errado.
export const optionsOf = (q: Question) => q.alternativas.length ? q.alternativas : [{ letra: 'C', texto: 'Certo', imagens: [] }, { letra: 'E', texto: 'Errado', imagens: [] }];
export const sameAnswer = (a: string, b: string) => a.trim().slice(0, 1).toUpperCase() === b.trim().slice(0, 1).toUpperCase();
