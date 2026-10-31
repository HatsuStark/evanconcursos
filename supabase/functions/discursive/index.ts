// Edge Function "discursive": treino de discursivas. POST {action}:
//   start {noticeId, subjectId?, sessionId?} → cria o treino com um enunciado (reaproveitado ou novo).
//   grade {answerId} → corrige com a IA; a nota sai de uma conta fixa (shared/ai/discursive.ts).
//   rewrite {answerId} → novo rascunho do mesmo enunciado, com o texto anterior (sem IA).
// O espelho e a resposta modelo nunca saem daqui antes da correção.
import { generateJson } from '../../../shared/ai/gemini.ts';
import {
  countWords, DISCURSIVE_PROMPT_VERSION, DiscursiveGrade, discursiveGradeJsonSchema, DiscursivePrompt, discursivePromptJsonSchema, discursivePromptText, discursiveRules,
  gradePromptText, itemScale, MIN_WORDS, pickSession, promptCacheKey, scoreGrade, verifyPrompt,
} from '../../../shared/ai/discursive.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { loadLawSources } from '../_shared/law.ts';

const STUCK_MS = 3 * 60 * 1000; // correção interrompida: libera nova tentativa

type Auth = Exclude<Awaited<ReturnType<typeof requireUser>>, Response>;
type Admin = ReturnType<typeof adminClient>;

async function start(auth: Auth, admin: Admin, model: string, body: Record<string, unknown>) {
  const noticeId = String(body.noticeId ?? '');
  const { data: notice } = await auth.client.from('notices').select('id, board, role_name, notes, structure').eq('id', noticeId).maybeSingle();
  if (!notice) return json(404, { error: 'Concurso não encontrado.' });
  const rules = discursiveRules(notice.structure?.stages, notice.notes);
  if (!rules) return json(400, { error: 'O edital deste concurso não tem prova discursiva.' });
  const scale = itemScale(rules), base = { notice_id: notice.id, owner_id: auth.user.id, format: rules.format, max_points: scale.max };

  let subject: { id: string; name: string } | null = null, session: { id: string; title: string; topic_ids: string[] } | null = null;
  let topics: string[] = [], law: { ref: string; text: string }[] = [], articles: Awaited<ReturnType<typeof loadLawSources>>['articles'] = [];

  if (rules.format === 'questao') {
    const { data: plan } = await auth.client.from('study_plans').select('id, active_version_id').eq('notice_id', notice.id).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!plan?.active_version_id) return json(400, { error: 'Monte o cronograma primeiro: os temas vêm das sessões dele.' });
    const { data: subs } = await auth.client.from('notice_subjects').select('id, name, is_core').eq('notice_id', notice.id);
    const eligible = (subs ?? []).filter((s) => !rules.specificOnly || s.is_core);
    const ids = (eligible.length ? eligible : subs ?? []).filter((s) => !body.subjectId || s.id === body.subjectId).map((s) => s.id);
    const { data: sessions } = await auth.client.from('study_sessions').select('id, subject_id, title, topic_ids').eq('plan_version_id', plan.active_version_id).in('subject_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    const { data: done } = await auth.client.from('tasks').select('session_id').eq('plan_id', plan.id).not('done_at', 'is', null).not('session_id', 'is', null);
    const { data: past } = await auth.client.from('discursive_answers').select('session_id').eq('notice_id', notice.id).not('session_id', 'is', null);
    const doneSet = new Set((done ?? []).map((t) => t.session_id));
    const options = (sessions ?? []).filter((s) => !body.sessionId || s.id === body.sessionId)
      .map((s) => ({ ...s, subjectId: s.subject_id, done: doneSet.has(s.id), answers: (past ?? []).filter((a) => a.session_id === s.id).length }));
    const picked = pickSession(options);
    if (!picked) return json(400, { error: 'Não há sessão de estudo para esta matéria.' });
    session = picked;
    subject = (subs ?? []).find((s) => s.id === picked.subject_id) ?? null;
    const { data: tt } = picked.topic_ids.length ? await auth.client.from('notice_topics').select('id, text').in('id', picked.topic_ids) : { data: [] };
    topics = (tt ?? []).map((t) => t.text);
    ({ law, articles } = await loadLawSources(admin, { title: picked.title, topics, subject: subject?.name ?? '' }));
  }

  const input = { format: rules.format, banca: notice.board ?? '', subject: subject?.name ?? '', topics, law };
  const key = promptCacheKey(input);
  const [{ data: existing }, { data: answered }] = await Promise.all([
    admin.from('discursive_prompts').select('id, title, content, subject_name').eq('cache_key', key).order('created_at'),
    admin.from('discursive_answers').select('prompt_id').eq('owner_id', auth.user.id),
  ]);
  const seen = new Set((answered ?? []).map((a) => a.prompt_id));
  let prompt = (existing ?? []).find((p) => !seen.has(p.id));

  if (!prompt) {
    const started = Date.now();
    try {
      const r = await generateJson({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, schema: DiscursivePrompt, jsonSchema: discursivePromptJsonSchema(), temperature: 0.6,
        parts: [{ text: discursivePromptText({ ...input, cargo: notice.role_name ?? '', title: session?.title ?? '', avoid: (existing ?? []).map((p) => p.title) }) }] });
      const v = verifyPrompt(r.data, articles, subject?.name ?? '');
      const { data: saved, error } = await admin.from('discursive_prompts').insert({
        cache_key: key, format: rules.format, banca: input.banca, subject_name: input.subject, title: v.prompt.titulo.slice(0, 200), content: v.prompt,
        sources: law.map((l) => l.ref), unverified: v.unverified, model, prompt_version: DISCURSIVE_PROMPT_VERSION,
      }).select('id, title, content, subject_name').single();
      if (error) throw new Error(error.message);
      prompt = saved;
      await logUsage(admin, { ownerId: auth.user.id, operation: 'discursive_prompt', model, promptVersion: DISCURSIVE_PROMPT_VERSION, usage: r.usage, latencyMs: Date.now() - started, status: 'ok' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logUsage(admin, { ownerId: auth.user.id, operation: 'discursive_prompt', model, promptVersion: DISCURSIVE_PROMPT_VERSION, usage: null, latencyMs: Date.now() - started, status: 'error', error: message }).catch(() => {});
      return json(502, { error: 'Não foi possível criar o enunciado agora.', detail: message.slice(0, 300) });
    }
  }

  const c = prompt!.content as DiscursivePrompt;
  const { data: row, error } = await admin.from('discursive_answers').insert({
    ...base, subject_id: subject?.id ?? null, session_id: session?.id ?? null, prompt_id: prompt!.id, title: prompt!.title, subject_name: subject?.name ?? '',
    statement: c.enunciado, support_texts: c.textos_apoio, lines_hint: c.linhas,
  }).select('id').single();
  if (error) return json(500, { error: error.message });
  return json(200, { id: row.id });
}

async function grade(auth: Auth, admin: Admin, model: string, answerId: string) {
  const { data: answer } = await auth.client.from('discursive_answers').select('*').eq('id', answerId).maybeSingle();
  if (!answer) return json(404, { error: 'Treino não encontrado.' });
  if (answer.status === 'graded') return json(200, { id: answer.id });
  if (countWords(answer.body) < MIN_WORDS) return json(400, { error: `Escreva ao menos ${MIN_WORDS} palavras antes de corrigir.` });
  const { data: same } = await auth.client.from('discursive_answers').select('id').eq('prompt_id', answer.prompt_id).eq('status', 'graded').eq('body', answer.body).limit(1);
  if (same?.length) return json(409, { error: 'Este texto já foi corrigido. Mude a resposta antes de corrigir de novo.' });

  // Trava antes de chamar a IA: dois cliques não geram duas cobranças.
  const stuck = new Date(Date.now() - STUCK_MS).toISOString();
  const { data: locked } = await admin.from('discursive_answers').update({ status: 'grading' }).eq('id', answer.id).eq('owner_id', auth.user.id)
    .or(`status.in.(draft,failed),and(status.eq.grading,updated_at.lt.${stuck})`).select('id');
  if (!locked?.length) return json(409, { error: 'A correção já está em andamento.' });

  const started = Date.now();
  try {
    const { data: promptRow } = await admin.from('discursive_prompts').select('content, banca, unverified').eq('id', answer.prompt_id).single();
    const prompt = promptRow!.content as DiscursivePrompt;
    let articles: Awaited<ReturnType<typeof loadLawSources>>['articles'] = [], law: { ref: string; text: string }[] = [];
    if (answer.session_id) {
      const { data: s } = await auth.client.from('study_sessions').select('title, topic_ids').eq('id', answer.session_id).maybeSingle();
      const { data: tt } = s?.topic_ids?.length ? await auth.client.from('notice_topics').select('text').in('id', s.topic_ids) : { data: [] };
      if (s) ({ articles, law } = await loadLawSources(admin, { title: s.title, topics: (tt ?? []).map((t) => t.text), subject: answer.subject_name }));
    }
    const statement = [answer.statement, ...answer.support_texts].join('\n\n');
    const r = await generateJson({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '', model, schema: DiscursiveGrade, jsonSchema: discursiveGradeJsonSchema(), temperature: 0.1,
      parts: [{ text: gradePromptText({ format: answer.format, banca: promptRow!.banca, statement, prompt, law, body: answer.body }) }] });
    const scored = scoreGrade(r.data, { format: answer.format, prompt, body: answer.body, maxPoints: Number(answer.max_points) || 10, law: articles, subject: answer.subject_name });
    // Citações sem fonte da resposta modelo também entram no aviso da tela.
    const report = { ...scored.report, unverified: [...new Set([...scored.report.unverified, ...promptRow!.unverified])] };
    const { error } = await admin.from('discursive_answers').update({ status: 'graded', points: scored.points, pct: scored.pct, report, graded_at: new Date().toISOString() }).eq('id', answer.id);
    if (error) throw new Error(error.message);
    await logUsage(admin, { ownerId: auth.user.id, operation: 'discursive_grade', model, promptVersion: DISCURSIVE_PROMPT_VERSION, usage: r.usage, latencyMs: Date.now() - started, status: 'ok' });
    return json(200, { id: answer.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from('discursive_answers').update({ status: 'failed' }).eq('id', answer.id);
    await logUsage(admin, { ownerId: auth.user.id, operation: 'discursive_grade', model, promptVersion: DISCURSIVE_PROMPT_VERSION, usage: null, latencyMs: Date.now() - started, status: 'error', error: message }).catch(() => {});
    return json(502, { error: 'Não foi possível corrigir agora. Seu texto está salvo; tente de novo.', detail: message.slice(0, 300) });
  }
}

async function rewrite(auth: Auth, admin: Admin, answerId: string) {
  const { data: a } = await auth.client.from('discursive_answers').select('*').eq('id', answerId).maybeSingle();
  if (!a) return json(404, { error: 'Treino não encontrado.' });
  const { data: row, error } = await admin.from('discursive_answers').insert({
    owner_id: a.owner_id, notice_id: a.notice_id, subject_id: a.subject_id, session_id: a.session_id, prompt_id: a.prompt_id, format: a.format, title: a.title, subject_name: a.subject_name,
    statement: a.statement, support_texts: a.support_texts, lines_hint: a.lines_hint, max_points: a.max_points, attempt: a.attempt + 1, body: a.body,
  }).select('id').single();
  if (error) return json(500, { error: error.message });
  return json(200, { id: row.id });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const admin = adminClient();
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
  if (body.action === 'start') return start(auth, admin, model, body);
  if (body.action === 'grade') return grade(auth, admin, model, String(body.answerId ?? ''));
  if (body.action === 'rewrite') return rewrite(auth, admin, String(body.answerId ?? ''));
  return json(400, { error: 'Ação desconhecida.' });
});
