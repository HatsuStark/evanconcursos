// Edge Function "study-guide": apostila da sessão gerada pela IA, baseada só no conteúdo do edital e nos
// artigos oficiais da lei seca. POST {taskId, depth:'completa'|'revisao'} → {guide}.
// Reaproveita apostilas idênticas (mesmo tema, fontes e profundidade) entre sessões e estudantes.
// Não há "gerar de novo" pelo estudante (economia de créditos): uma apostila existente é sempre reaproveitada.
import { generateJson } from '../../../shared/ai/gemini.ts';
import { Guide, GUIDE_PROMPT_VERSION, guideCacheKey, guideJsonSchema, guidePrompt, lawKeys, pickSimilarGuide, sourceRef, topicKeys, unlistedLaws, verifyGuide, type GuideDepth } from '../../../shared/ai/guide.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { findLawRefs, inRanges } from '../../../shared/legal/refs.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';

const MAX_ARTICLES = 25;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const depth: GuideDepth = body.depth === 'revisao' ? 'revisao' : 'completa';
  const admin = adminClient();
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
  const started = Date.now();
  try {
    const { data: task } = await auth.client.from('tasks').select('id, plan_id, subject_id, session_id, title').eq('id', String(body.taskId ?? '')).maybeSingle();
    if (!task?.session_id || !task.subject_id) return json(400, { error: 'A apostila é gerada para tarefas de teoria (com sessão de conteúdo).' });
    const [{ data: session }, { data: subject }] = await Promise.all([
      auth.client.from('study_sessions').select('title, topic_ids').eq('id', task.session_id).single(),
      auth.client.from('notice_subjects').select('name, notice_id').eq('id', task.subject_id).single(),
    ]);
    const { data: notice } = await auth.client.from('notices').select('board, role_name').eq('id', subject!.notice_id).single();
    const { data: tt } = session?.topic_ids?.length ? await auth.client.from('notice_topics').select('id, text').in('id', session.topic_ids) : { data: [] };
    const topics = (tt ?? []).sort((a, b) => session!.topic_ids.indexOf(a.id) - session!.topic_ids.indexOf(b.id)).map((t) => t.text);

    // Fontes legais: artigos citados no título da sessão (ou, sem intervalo ali, nos tópicos do edital).
    let refs = findLawRefs(session!.title, subject!.name).filter((r) => r.ranges.length);
    if (!refs.length) refs = findLawRefs(topics.join('\n'), subject!.name).filter((r) => r.ranges.length);
    const provided: { lawKey: string; label: string; num: number; suffix: string; text: string }[] = [];
    for (const r of refs.slice(0, 4)) {
      const law = lawByKey(r.law);
      if (!law) continue;
      const { data: norm } = await admin.from('legal_norms').select('id').eq('urn', law.urn).maybeSingle();
      if (!norm) continue;
      const { data: arts } = await admin.from('legal_articles').select('label, num, suffix, text').eq('norm_id', norm.id).eq('revoked', false)
        .gte('num', Math.min(...r.ranges.map((x) => x.from))).lte('num', Math.max(...r.ranges.map((x) => x.to))).order('ord').limit(200);
      provided.push(...(arts ?? []).filter((a) => inRanges(r.ranges, a.num, a.suffix)).map((a) => ({ lawKey: r.law, ...a })));
    }
    const law = provided.slice(0, MAX_ARTICLES).map((p) => ({ ref: sourceRef(p.lawKey, p.label), text: p.text.slice(0, 1500) }));
    const input = { depth, banca: notice?.board ?? '', subject: subject!.name, title: session!.title, topics, law };
    const key = guideCacheKey(input);
    const subjectKey = normalizeText(subject!.name), banca = normalizeText(input.banca), tKeys = topicKeys(topics), lKeys = lawKeys(law);

    // 1) Apostila igual (mesmo conteúdo); 2) semelhante (mesma matéria/banca/profundidade, mesmos artigos e
    // tópicos parecidos), de qualquer sessão ou estudante. Só gera com a IA quando não há nenhuma.
    const { data: cached } = await admin.from('study_guides').select('*').eq('cache_key', key).maybeSingle();
    if (cached) return json(200, { guide: cached, cached: true });
    const { data: similar } = await admin.from('study_guides').select('*').eq('subject_key', subjectKey).eq('depth', depth)
      .eq('banca', banca).eq('prompt_version', GUIDE_PROMPT_VERSION).order('created_at', { ascending: false }).limit(60);
    const hit = pickSimilarGuide({ topics: tKeys, law: lKeys }, similar ?? []);
    if (hit >= 0) return json(200, { guide: similar![hit], cached: true, similar: true });
    const r = await generateJson({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, schema: Guide, jsonSchema: guideJsonSchema(), temperature: 0.3,
      parts: [{ text: guidePrompt({ ...input, cargo: notice?.role_name ?? '' }) }] });
    const v = verifyGuide(r.data, provided.slice(0, MAX_ARTICLES), subject!.name);
    const row = {
      cache_key: key, depth, subject_name: subject!.name, subject_key: subjectKey, banca, topic_keys: tKeys, title: session!.title, content: v.guide,
      sources: law.map((l) => l.ref), unlisted_sources: unlistedLaws([session!.title, ...topics].join('\n')), unverified: v.unverified,
      model, prompt_version: GUIDE_PROMPT_VERSION, created_at: new Date().toISOString(),
    };
    const { data: saved, error } = await admin.from('study_guides').upsert(row, { onConflict: 'cache_key' }).select('*').single();
    if (error) throw new Error(error.message);
    await logUsage(admin, { ownerId: auth.user.id, operation: 'study_guide', model, promptVersion: GUIDE_PROMPT_VERSION, usage: r.usage, latencyMs: Date.now() - started, status: 'ok' });
    return json(200, { guide: saved, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, { ownerId: auth.user.id, operation: 'study_guide', model, promptVersion: GUIDE_PROMPT_VERSION, usage: null, latencyMs: Date.now() - started, status: 'error', error: message }).catch(() => {});
    return json(502, { error: 'Não foi possível gerar a apostila agora.', detail: message.slice(0, 300) });
  }
});
