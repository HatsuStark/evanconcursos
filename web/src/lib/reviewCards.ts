// Revisão em cartões: memória do estudante por tarefa (o que já sabe, o que não lembrou, o que já leu) e registro de cada
// revisão feita, no banco. O localStorage fica como reserva (sem rede) e para a memória gravada antes do banco.
import { emptyMemory, type ReviewMemory } from '../../../shared/domain/review-cards.ts';
import { supabase } from './supabase.ts';

const LOCAL_KEY = (taskId: string) => `review-cards:${taskId}`;
const MAX_IDS = 300;

function readLocal(taskId: string): ReviewMemory | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY(taskId)) ?? 'null');
    if (v && Array.isArray(v.known) && Array.isArray(v.missed) && Array.isArray(v.seen)) return v;
  } catch { /* armazenamento bloqueado ou valor inválido */ }
  return null;
}
function writeLocal(taskId: string, m: ReviewMemory) {
  try { localStorage.setItem(LOCAL_KEY(taskId), JSON.stringify(m)); } catch { /* armazenamento bloqueado */ }
}

export async function loadReviewMemory(taskId: string): Promise<ReviewMemory> {
  const { data, error } = await supabase.from('review_card_memory').select('known, missed, seen').eq('task_id', taskId).maybeSingle();
  if (error) return readLocal(taskId) ?? emptyMemory();
  return (data as ReviewMemory | null) ?? readLocal(taskId) ?? emptyMemory();
}

export async function saveReviewMemory(taskId: string, m: ReviewMemory) {
  const cut = (l: string[]) => l.slice(-MAX_IDS);
  const row = { known: cut(m.known), missed: cut(m.missed), seen: cut(m.seen) };
  writeLocal(taskId, row);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('review_card_memory').upsert({ owner_id: user.id, task_id: taskId, ...row, updated_at: new Date().toISOString() });
}

// Registro da revisão: criado no primeiro cartão respondido e atualizado a cada resposta, para saber até onde o
// estudante foi quando não termina. Falha de rede não atrapalha a revisão.
export interface ReviewProgress { cards: number; recallCards: number; answered: number; remembered: number; missed: number; durationS: number; completed: boolean }
export function reviewSessionTracker(taskId: string) {
  let id: Promise<string | null> | null = null;
  let last: Promise<unknown> = Promise.resolve();
  const fields = (p: ReviewProgress) => ({
    cards: p.cards, recall_cards: p.recallCards, answered: p.answered, remembered: p.remembered, missed: p.missed,
    duration_s: Math.min(86400, Math.round(p.durationS)), completed: p.completed, updated_at: new Date().toISOString(),
  });
  return (p: ReviewProgress) => {
    if (!id) {
      id = (async () => {
        const { data } = await supabase.from('review_card_sessions').insert({ task_id: taskId, ...fields(p) }).select('id').single();
        return (data?.id as string | undefined) ?? null;
      })().catch(() => null);
      return;
    }
    const got = id;
    last = last.then(async () => {
      const sid = await got;
      if (sid) await supabase.from('review_card_sessions').update(fields(p)).eq('id', sid);
    }).catch(() => {});
  };
}
