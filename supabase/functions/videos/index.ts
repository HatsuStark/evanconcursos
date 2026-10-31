// Edge Function "videos": vídeo-aulas da sessão pela YouTube Data API. POST {taskId} → {status, videos}.
// A cota da API é pequena: a mesma busca é reaproveitada entre sessões e estudantes por até 30 dias.
// status: ok | no_key (sem YOUTUBE_API_KEY) | quota (cota do dia esgotada) | error. Fora do ok, a tela oferece o link de busca.
import { CACHE_DAYS, rankVideos, searchYoutube, videoQuery, YoutubeError } from '../../../shared/domain/videos.ts';
import { adminClient, CORS, json, requireUser } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const { data: task } = await auth.client.from('tasks').select('session_id, subject_id').eq('id', String(body.taskId ?? '')).maybeSingle();
  if (!task?.session_id || !task.subject_id) return json(400, { error: 'Os vídeos são buscados para tarefas de teoria (com sessão de conteúdo).' });
  const [{ data: session }, { data: subject }] = await Promise.all([
    auth.client.from('study_sessions').select('title, topic_ids').eq('id', task.session_id).single(),
    auth.client.from('notice_subjects').select('name').eq('id', task.subject_id).single(),
  ]);
  const { data: tt } = session?.topic_ids?.length ? await auth.client.from('notice_topics').select('id, text').in('id', session.topic_ids) : { data: [] };
  const topics = (tt ?? []).sort((a, b) => session!.topic_ids.indexOf(a.id) - session!.topic_ids.indexOf(b.id)).map((t) => t.text);
  const { q, key, terms } = videoQuery({ subject: subject!.name, title: session!.title, topics });

  const admin = adminClient();
  const cutoff = new Date(Date.now() - CACHE_DAYS * 864e5).toISOString();
  const { data: hit } = await admin.from('video_searches').select('videos').eq('query_key', key).gte('fetched_at', cutoff).maybeSingle();
  if (hit) return json(200, { status: 'ok', videos: hit.videos });

  const apiKey = Deno.env.get('YOUTUBE_API_KEY');
  if (!apiKey) return json(200, { status: 'no_key', videos: [] });
  try {
    const videos = rankVideos(await searchYoutube(apiKey, q), terms);
    await admin.from('video_searches').upsert({ query_key: key, query: q, videos, fetched_at: new Date().toISOString() });
    await admin.from('video_searches').delete().lt('fetched_at', cutoff);
    return json(200, { status: 'ok', videos });
  } catch (e) {
    console.error('videos:', (e as Error).message);
    return json(200, { status: e instanceof YoutubeError && e.quota ? 'quota' : 'error', videos: [] });
  }
});
