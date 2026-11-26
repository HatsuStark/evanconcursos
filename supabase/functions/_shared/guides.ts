// Apostila de uma tarefa: o que a define (tema, fontes, banca) e a busca da apostila igual ou semelhante já gerada.
// Usado pela study-guide e pela revisão em áudio. `db` lê como o estudante (RLS) ou, no worker, com a chave de serviço;
// os ids vêm sempre de linhas do próprio estudante.
import type { SupabaseClient } from '@supabase/supabase-js';
import { guideCacheKey, guideVersion, lawKeys, MAX_GUIDE_FONTES, MAX_GUIDE_JURIS, pickSimilarGuide, roleSpecific, topicKeys, type GuideDepth, type GuideJuris, type GuideSource } from '../../../shared/ai/guide.ts';
import { hotArticleKeys, type HotInput } from '../../../shared/ai/hot.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';
import { ensureHot, hotLaws } from './hot.ts';
import { topicJuris } from './juris.ts';
import { loadLawSources } from './law.ts';
import { topicSources } from './sources.ts';

// Tudo o que define a apostila de uma tarefa; null se a tarefa não tem sessão de conteúdo.
export async function resolve(db: SupabaseClient, admin: SupabaseClient, ownerId: string, task: { subject_id: string | null; session_id: string | null }, depth: GuideDepth) {
  if (!task.session_id || !task.subject_id) return null;
  const [{ data: session }, { data: subject }] = await Promise.all([
    db.from('study_sessions').select('title, keyword, topic_ids, law_refs').eq('id', task.session_id).single(),
    db.from('notice_subjects').select('name, notice_id').eq('id', task.subject_id).single(),
  ]);
  const { data: notice } = await db.from('notices').select('board, role_name, organization, role_duties, structure, education_level').eq('id', subject!.notice_id).single();
  const { data: tt } = session?.topic_ids?.length ? await db.from('notice_topics').select('id, text').in('id', session.topic_ids) : { data: [] };
  const topics = (tt ?? []).sort((a, b) => session!.topic_ids.indexOf(a.id) - session!.topic_ids.indexOf(b.id)).map((t) => t.text);
  // Mais cobrados (IA, em cache compartilhado): na sessão com mais artigos do que cabem, já escolhem os trechos; em toda
  // apostila, viram destaques no prompt (fora da chave do cache).
  const banca = String(notice?.board ?? '');
  const hotInput = (...a: Parameters<typeof hotLaws>): HotInput => ({ banca, subject: subject!.name, title: session!.title, topics, laws: hotLaws(...a) });
  const { articles, law, extra, omitted, refs, all } = await loadLawSources(admin, { title: session!.title, topics, subject: subject!.name, ownerId, lawRefs: session!.law_refs,
    hot: async (rs, arts, own) => {
      const h = await ensureHot(admin, ownerId, hotInput(rs, arts, own));
      return h ? hotArticleKeys(h, arts, (k) => lawByKey(k, own)?.short ?? k) : [];
    } });
  // Nível superior: as súmulas e teses que mais caem nos artigos da sessão entram como fonte (só as escolhidas pela IA,
  // em cache compartilhado; sem a escolha, a apostila sai só com a lei).
  const juris: GuideJuris[] = notice?.education_level === 'Superior' && law.length
    ? (await topicJuris(admin, ownerId, { banca, subject: subject!.name, title: session!.title, refs }, async () => true).catch((e) => { console.error('jurisprudência:', e); return { items: [] }; }))
      .items.filter((i) => i.hot).slice(0, MAX_GUIDE_JURIS).map((i) => ({ ref: i.label, text: i.text.slice(0, 900), court: i.court, kind: i.kind, number: i.number }))
    : [];
  // Matéria sem lei: trechos de obras abertas que explicam o tema, só os escolhidos pela IA (em cache compartilhado).
  const fontes: GuideSource[] = !law.length
    ? await topicSources(admin, ownerId, { subject: subject!.name, title: session!.title, keyword: String(session?.keyword ?? ''), topics }, async () => true)
      .then((r) => (r.ai ? r.items.slice(0, MAX_GUIDE_FONTES).map((i) => ({ ref: i.ref, text: i.text.slice(0, 1400) })) : []))
      .catch((e) => { console.error('fontes:', e); return []; })
    : [];
  const input = { depth, banca, subject: subject!.name, title: session!.title, topics, law, juris, fontes };
  return {
    extra, input, key: guideCacheKey({ ...input, cargo: String(notice?.role_name ?? '') }), articles, noticeId: subject!.notice_id as string, cargo: (notice?.role_name ?? '') as string,
    duties: String(notice?.role_duties ?? ''), otherRoles: ((notice?.structure as { otherRoles?: string[] } | null)?.otherRoles ?? []) as string[],
    sessionId: task.session_id, subjectId: task.subject_id, keyword: (session?.keyword ?? '') as string,
    organization: String(notice?.organization ?? ''),
    hot: hotInput(refs, all, extra), omitted,
  };
}
export type GuideContext = NonNullable<Awaited<ReturnType<typeof resolve>>>;

// 1) Apostila igual (mesmo conteúdo); 2) semelhante (mesma matéria/banca/profundidade, mesmos artigos,
// tópicos e título parecidos), de qualquer sessão ou estudante. Só gera com a IA quando não há nenhuma.
export async function findGuide(admin: SupabaseClient, { input, key }: GuideContext) {
  const { data: cached } = await admin.from('study_guides').select('*').eq('cache_key', key).maybeSingle();
  if (cached) return cached;
  // Apostila de tema do cargo só serve para o mesmo cargo: aí não vale a de tema parecido.
  if (roleSpecific(input)) return null;
  const { data: similar } = await admin.from('study_guides').select('*').eq('subject_key', normalizeText(input.subject)).eq('depth', input.depth)
    .eq('banca', normalizeText(input.banca)).eq('prompt_version', guideVersion(input.depth)).order('created_at', { ascending: false }).limit(60);
  const hit = pickSimilarGuide({ title: input.title, topics: topicKeys(input.topics), law: lawKeys(input.law, [...input.juris, ...input.fontes]) }, similar ?? []);
  return hit >= 0 ? similar![hit] : null;
}
