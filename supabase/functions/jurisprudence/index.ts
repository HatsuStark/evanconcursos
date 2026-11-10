// Edge Function "jurisprudence": súmulas e teses oficiais (STF e STJ) ligadas aos artigos da sessão, com as que mais
// caem em prova primeiro e uma frase de como a banca cobra cada uma (IA, em cache compartilhado). POST {taskId} → 200 {items, ai}.
// Ver os itens é livre; a escolha da IA só roda para quem tem acesso à IA. Sem ele (ou se a IA falhar), a lista vem
// completa, sem destaques.
import { findLawRefs, resolveSessionRefs } from '../../../shared/legal/refs.ts';
import { adminClient, CORS, json, requireUser } from '../_shared/http.ts';
import { topicJuris } from '../_shared/juris.ts';
import { ownLaws } from '../_shared/legal.ts';

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
    task.session_id ? auth.client.from('study_sessions').select('title, topic_ids, law_refs').eq('id', task.session_id).maybeSingle() : Promise.resolve({ data: null }),
    task.subject_id ? auth.client.from('notice_subjects').select('name, notice_id').eq('id', task.subject_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: notice } = subject ? await auth.client.from('notices').select('board').eq('id', subject.notice_id).maybeSingle() : { data: null };
  const { data: tt } = session?.topic_ids?.length ? await auth.client.from('notice_topics').select('id, text').in('id', session.topic_ids) : { data: [] };
  const topics = (tt ?? []).map((t) => t.text as string);
  const title = String(session?.title ?? task.title), subjectName = String(subject?.name ?? '');

  // Mesmos artigos da aba Lei seca (web/src/lib/legal.ts): os gravados na sessão; sem eles, os citados no título.
  const admin = adminClient();
  const extra = await ownLaws(admin, auth.user.id);
  let refs = resolveSessionRefs(session?.law_refs, title, topics, subjectName, extra);
  if (!refs.length) refs = findLawRefs(title, subjectName, extra);
  try {
    const r = await topicJuris(admin, auth.user.id, { banca: String(notice?.board ?? ''), subject: subjectName, title, refs }, async () => !(await requireUser(req) instanceof Response));
    return json(200, r);
  } catch (e) {
    console.error(e);
    return json(500, { error: 'Não foi possível carregar a jurisprudência.' });
  }
});
