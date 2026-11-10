// Edge Function "sources": fontes da sessão nas matérias sem lei. POST {taskId} → 200 {items, sources, books, ai}.
// items: trechos de obras abertas que explicam o tema (texto literal, com página e crédito); books: livros de referência
// sugeridos pela IA e conferidos no Google Books (sem trecho). A IA só roda para quem tem acesso a ela.
import { adminClient, CORS, json, requireUser } from '../_shared/http.ts';
import { topicBooks, topicSources } from '../_shared/sources.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req, { ai: false });
  if (auth instanceof Response) return auth;
  const { taskId } = await req.json().catch(() => ({}));
  if (typeof taskId !== 'string') return json(400, { error: 'Informe a tarefa.' });

  const { data: task } = await auth.client.from('tasks').select('title, session_id, subject_id').eq('id', taskId).maybeSingle();
  if (!task) return json(404, { error: 'Tarefa não encontrada.' });
  const [{ data: session }, { data: subject }] = await Promise.all([
    task.session_id ? auth.client.from('study_sessions').select('title, keyword, topic_ids').eq('id', task.session_id).maybeSingle() : Promise.resolve({ data: null }),
    task.subject_id ? auth.client.from('notice_subjects').select('name').eq('id', task.subject_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: tt } = session?.topic_ids?.length ? await auth.client.from('notice_topics').select('id, text').in('id', session.topic_ids) : { data: [] };
  const topic = { subject: String(subject?.name ?? ''), title: String(session?.title ?? task.title), keyword: String(session?.keyword ?? ''), topics: (tt ?? []).map((t) => t.text as string) };

  // Acesso à IA verificado uma vez só, e só se alguma escolha não estiver em cache.
  let allowed: boolean | null = null;
  const canGenerate = async () => (allowed ??= !(await requireUser(req) instanceof Response));
  const admin = adminClient();
  try {
    const [found, books] = await Promise.all([
      topicSources(admin, auth.user.id, topic, canGenerate),
      topicBooks(admin, auth.user.id, topic, canGenerate).catch((e) => { console.error('livros:', e); return []; }),
    ]);
    return json(200, { ...found, books });
  } catch (e) {
    console.error(e);
    return json(500, { error: 'Não foi possível carregar as fontes.' });
  }
});
