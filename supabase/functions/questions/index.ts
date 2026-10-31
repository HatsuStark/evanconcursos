// Edge Function "questions": questões do banco (Quest API) dentro do app.
//   {action:'next', taskId, count}        → questões da sessão (sem gabarito), sem repetir as já respondidas
//   {action:'answer', qid, chosen, taskId? | context:'free'|'review', timeMs?} → corrige no servidor e registra
//   {action:'explain', qid, taskId?}      → explicação da IA ancorada nos artigos oficiais (cache por questão)
//   {action:'mnemonic', qid, taskId?}     → mnemônico compartilhado (ou nenhum), vira flashcard do estudante
// A chave da Quest API e o gabarito ficam só no servidor. taskId é opcional fora do cronograma.
import type { GeminiUsage } from '../../../shared/ai/gemini.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { findLawRefs, inRanges, type LawRef } from '../../../shared/legal/refs.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';
import { QuestClient, type QuestQuestion } from '../../../shared/qbank/client.ts';
import {
  equalIncidence, EXPLAIN_PROMPT_VERSION, Explanation, explainPrompt, explanationJsonSchema, measureIncidence, planPicks,
  QMAP_PROMPT_VERSION, searchFilters, type Incidence, type SessionFilter,
} from '../../../shared/qbank/map.ts';
import { conceptKey, MNEMONIC_PROMPT_VERSION, MnemonicChoice, mnemonicJsonSchema, mnemonicPrompt, pickExisting } from '../../../shared/qbank/mnemonic.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { cacheQuestions, ensureSessionMap, ensureSubjectMap, mapDeps, plain, publicQuestion, recordAnswer, upsertFlashcard, withMnemo, type PublicQuestion } from '../_shared/qbank.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const admin = adminClient();
  const quest = new QuestClient(Deno.env.get('QUEST_API_KEY') ?? '');
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  const started = Date.now();
  const deps = mapDeps(admin, quest, usage);
  const log = (operation: string, status: 'ok' | 'error', error?: string) => logUsage(admin, {
    ownerId: auth.user.id, operation, model: usage.inputTokens ? model : 'quest-api', promptVersion: operation === 'qbank_explain' ? EXPLAIN_PROMPT_VERSION : operation === 'qbank_mnemonic' ? MNEMONIC_PROMPT_VERSION : QMAP_PROMPT_VERSION,
    usage: usage.inputTokens ? usage : null, latencyMs: Date.now() - started, status, error, credits: quest.credits,
  });

  try {
    // Tarefa e matéria lidas como o usuário: a RLS garante que são dele. Fora do cronograma não há tarefa.
    const { data: task } = body.taskId
      ? await auth.client.from('tasks').select('id, plan_id, subject_id, session_id, kind').eq('id', String(body.taskId)).maybeSingle()
      : { data: null };
    if (body.taskId && !task) return json(404, { error: 'Tarefa não encontrada.' });
    const { data: subject } = task?.subject_id
      ? await auth.client.from('notice_subjects').select('id, name, notice_id, notice_topics(text, position)').eq('id', task.subject_id).maybeSingle()
      : { data: null };

    if (body.action === 'answer') {
      const context = task ? 'plan' : body.context === 'review' ? 'review' : 'free';
      const r = await recordAnswer(admin, {
        ownerId: auth.user.id, qid: String(body.qid ?? ''), chosen: String(body.chosen ?? ''), context,
        planId: task?.plan_id, taskId: task?.id, sessionId: task?.session_id, subjectId: task?.subject_id,
      });
      return json(200, r);
    }

    // Trechos oficiais da lei: os citados na questão e os da sessão (só com artigos definidos).
    const lawExcerpts = async (p: PublicQuestion) => {
      let sessionTitle = '';
      if (task?.session_id) sessionTitle = (await auth.client.from('study_sessions').select('title').eq('id', task.session_id).maybeSingle()).data?.title ?? '';
      const text = [plain(p.enunciado), ...p.alternativas.map((a) => plain(a.texto))].join('\n');
      const refs: LawRef[] = [...findLawRefs(text, subject?.name ?? ''), ...findLawRefs(sessionTitle, subject?.name ?? '')].filter((r) => r.ranges.length).slice(0, 4);
      const lei: { ref: string; text: string }[] = [];
      for (const r of refs) {
        const law = lawByKey(r.law);
        if (!law) continue;
        const { data: norm } = await admin.from('legal_norms').select('id').eq('urn', law.urn).maybeSingle();
        if (!norm) continue;
        const { data: arts } = await admin.from('legal_articles').select('label, num, suffix, text').eq('norm_id', norm.id)
          .gte('num', Math.min(...r.ranges.map((x) => x.from))).lte('num', Math.max(...r.ranges.map((x) => x.to))).order('ord').limit(40);
        for (const a of (arts ?? []).filter((a) => inRanges(r.ranges, a.num, a.suffix)).slice(0, 8)) lei.push({ ref: `${law.short}, art. ${a.label}`, text: a.text.slice(0, 1500) });
      }
      return lei;
    };

    if (body.action === 'mnemonic') {
      const qid = String(body.qid ?? '');
      const { data: q } = await admin.from('qbank_questions').select('payload, gabarito, materia, assunto, mnemonic_id, mnemonic_checked').eq('qid', qid).maybeSingle();
      if (!q) return json(404, { error: 'Questão não encontrada.' });
      const fields = 'id, concept, mnemonic, explanation, items';
      const toCard = async (m: { id: string; concept: string; mnemonic: string; items: { chave: string; significado: string }[] } | null) => {
        if (m) await upsertFlashcard(admin, auth.user.id, 'mnemonic', m.id, `Mnemônico: ${m.concept}`, [m.mnemonic, ...(m.items ?? []).map((i) => `${i.chave} = ${i.significado}`)].join('\n'), task?.plan_id);
      };
      if (q.mnemonic_checked) {
        const m = q.mnemonic_id ? (await admin.from('mnemonics').select(fields).eq('id', q.mnemonic_id).maybeSingle()).data : null;
        await toCard(m);
        return json(200, { mnemonic: m, cached: true });
      }
      const p = q.payload as PublicQuestion;
      const { data: existing } = await admin.from('mnemonics').select('id, concept, mnemonic').eq('materia', q.materia).eq('assunto', q.assunto).limit(12);
      const c = await deps.ai(MnemonicChoice, mnemonicJsonSchema(), mnemonicPrompt({
        enunciado: plain(p.enunciado), alternativas: p.alternativas.map((a) => ({ letra: a.letra, texto: plain(a.texto) })), gabarito: q.gabarito,
        assunto: q.assunto, existing: existing ?? [], law: (await lawExcerpts(p)).map((l) => `[${l.ref}] ${l.text}`),
      }));
      let mnemonicId: string | null = pickExisting(c, (existing ?? []).map((m) => m.id));
      if (!mnemonicId && c.acao === 'criar' && c.mnemonico.trim() && c.conceito.trim()) {
        // Mesmo conceito já criado por outra questão: reaproveita (chave normalizada).
        const key = conceptKey(c.conceito);
        const { data: same } = await admin.from('mnemonics').select('id').eq('concept_key', key).maybeSingle();
        mnemonicId = same?.id ?? (await admin.from('mnemonics').insert({
          concept: c.conceito.slice(0, 200), concept_key: key, materia: q.materia, assunto: q.assunto, mnemonic: c.mnemonico.slice(0, 300),
          explanation: c.explicacao.slice(0, 1000), items: c.itens.slice(0, 15), model, prompt_version: MNEMONIC_PROMPT_VERSION,
        }).select('id').single()).data?.id ?? null;
      }
      await admin.from('qbank_questions').update({ mnemonic_id: mnemonicId, mnemonic_checked: true }).eq('qid', qid);
      await log('qbank_mnemonic', 'ok');
      const m = mnemonicId ? (await admin.from('mnemonics').select(fields).eq('id', mnemonicId).single()).data : null;
      await toCard(m);
      return json(200, { mnemonic: m });
    }

    if (body.action === 'explain') {
      const qid = String(body.qid ?? '');
      const { data: q } = await admin.from('qbank_questions').select('payload, gabarito, explanation').eq('qid', qid).maybeSingle();
      if (!q) return json(404, { error: 'Questão não encontrada.' });
      if (q.explanation) return json(200, { explanation: q.explanation, cached: true });
      const p = q.payload as PublicQuestion;
      const lei = await lawExcerpts(p);
      const ex = await deps.ai(Explanation, explanationJsonSchema(), explainPrompt({
        banca: p.prova?.banca ?? '', enunciado: plain(p.enunciado), alternativas: p.alternativas.map((a) => ({ letra: a.letra, texto: plain(a.texto) })),
        gabarito: q.gabarito, textos: p.textos.map(plain), lei,
      }));
      // Só ficam citações que estavam entre os trechos fornecidos.
      const allowed = new Map(lei.map((l) => [normalizeText(l.ref), l.ref]));
      const explanation = { ...ex, artigos: [...new Set(ex.artigos.map((a) => allowed.get(normalizeText(a))).filter((a): a is string => !!a))], fontes: lei.map((l) => l.ref), geradoEm: new Date().toISOString() };
      await admin.from('qbank_questions').update({ explanation, explanation_model: `${model}/${EXPLAIN_PROMPT_VERSION}` }).eq('qid', qid);
      await log('qbank_explain', 'ok');
      return json(200, { explanation });
    }

    if (body.action !== 'next') return json(400, { error: 'Ação inválida.' });
    if (!task) return json(400, { error: 'Informe a tarefa.' });
    if (!subject) return json(200, { questions: [], reason: 'sem-materia' });
    const count = Math.max(1, Math.min(10, Number(body.count) || 5));
    const topics = ((subject.notice_topics ?? []) as { text: string; position: number }[]).sort((a, b) => a.position - b.position).map((t) => t.text);

    // Matéria da disciplina (uma vez) e banca do edital.
    const sm = await ensureSubjectMap(admin, quest, deps, auth.user.id, subject.id, async () => {
      const { data: notice } = await auth.client.from('notices').select('board').eq('id', subject.notice_id).single();
      return { name: subject.name, board: String(notice?.board ?? ''), topics };
    });

    // Filtro: assuntos da sessão (uma vez por sessão); em dias de reforço, os assuntos em que o estudante mais erra.
    let filter: SessionFilter = { materia: null, assuntos: [], how: '' };
    let incidence: Incidence[] | null = null;
    const scope = task.session_id ?? `subject:${subject.id}`;
    if (task.session_id) {
      const m = await ensureSessionMap(admin, deps, auth.user.id, task.session_id, sm.materia, async () => {
        const { data: ss } = await auth.client.from('study_sessions').select('title, keyword, topic_ids').eq('id', task.session_id).single();
        const { data: tt } = ss?.topic_ids?.length ? await auth.client.from('notice_topics').select('text').in('id', ss.topic_ids) : { data: [] };
        return { subject: subject.name, title: ss?.title ?? '', keyword: ss?.keyword ?? '', topics: (tt ?? []).map((t) => t.text) };
      });
      filter = m; incidence = m.incidence;
    } else if (sm.materia) {
      const { data: tries } = await admin.from('question_attempts').select('assunto, correct').eq('owner_id', auth.user.id).eq('subject_id', subject.id).limit(2000);
      const acc = new Map<string, { c: number; t: number }>();
      for (const a of tries ?? []) { const e = acc.get(a.assunto) ?? { c: 0, t: 0 }; e.t++; if (a.correct) e.c++; acc.set(a.assunto, e); }
      let weak = [...acc].filter(([, e]) => e.t >= 3).sort((x, y) => x[1].c / x[1].t - y[1].c / y[1].t).map(([a]) => a).slice(0, 3);
      if (!weak.length) {
        const { data: maps } = await admin.from('qbank_session_maps').select('assuntos').eq('owner_id', auth.user.id).eq('materia', sm.materia).limit(30);
        weak = [...new Set((maps ?? []).flatMap((m) => m.assuntos as string[]))].slice(0, 5);
      }
      filter = { materia: sm.materia, assuntos: weak, how: 'reforço' };
    }
    const filters = searchFilters(filter, sm.banca);
    if (!filters.length) { await log('qbank_fetch', 'ok'); return json(200, { questions: [], reason: 'sem-assunto' }); }

    // Peso de cada assunto: medido uma vez por sessão. Se a medição falhar, divide igual e tenta de novo na próxima busca.
    if (!incidence) {
      if (task.session_id) {
        try {
          incidence = await measureIncidence((params) => quest.count(params), filter, sm.banca);
          await admin.from('qbank_session_maps').update({ incidence }).eq('session_id', task.session_id);
        } catch { incidence = equalIncidence(filter.assuntos); }
      } else incidence = equalIncidence(filter.assuntos);
    }

    // Pula o que o estudante já respondeu; o que ele respondeu nesta sessão define a vez de cada assunto.
    const { data: done } = await admin.from('question_attempts').select('qid, assunto, session_id').eq('owner_id', auth.user.id).eq('subject_id', subject.id).limit(5000);
    const seen = new Set((done ?? []).map((d) => d.qid));
    const served = new Map<string, number>();
    for (const d of done ?? []) if (task.session_id && d.session_id === task.session_id) served.set(normalizeText(d.assunto), (served.get(normalizeText(d.assunto)) ?? 0) + 1);
    const out: QuestQuestion[] = [];
    // Traz até `limit` questões no total, com um cursor por filtro.
    const take = async (f: (typeof filters)[number], limit: number) => {
      if (out.length >= limit) return;
      const { data: cur } = await admin.from('qbank_cursors').select('after_id, exhausted').eq('owner_id', auth.user.id).eq('scope', scope).eq('filter_key', f.key).maybeSingle();
      if (cur?.exhausted) return;
      let after = cur?.after_id ?? undefined, exhausted = false;
      for (let round = 0; round < 3 && out.length < limit && !exhausted; round++) {
        const r = await quest.questoes(f.params, limit - out.length, after);
        const fresh = r.items.filter((q) => q.gabarito && !seen.has(q.id) && !out.some((o) => o.id === q.id));
        await cacheQuestions(admin, r.items);
        out.push(...fresh);
        after = r.next ?? r.items[r.items.length - 1]?.id ?? after;
        exhausted = !r.hasMore || !r.items.length;
      }
      await admin.from('qbank_cursors').upsert({ owner_id: auth.user.id, scope, filter_key: f.key, after_id: after ?? null, exhausted, updated_at: new Date().toISOString() });
    };
    // Cada assunto busca a sua parte (banca e, se faltar, outras bancas); o que sobrar vem de qualquer assunto com questões.
    const wanted = new Map<string, number>();
    for (const a of planPicks(incidence, served, count)) wanted.set(a, (wanted.get(a) ?? 0) + 1);
    for (const [assunto, n] of wanted) {
      const limit = out.length + n;
      for (const f of filters.filter((x) => x.assunto === assunto)) await take(f, limit);
    }
    for (const f of filters) await take(f, count);
    await log('qbank_fetch', 'ok');
    // Dentro do lote, primeiro as questões que caíram em mais provas.
    out.sort((a, b) => (b.provas?.length ?? 0) - (a.provas?.length ?? 0));
    return json(200, { questions: await withMnemo(admin, out.slice(0, count).map(publicQuestion)), filter: { materia: filter.materia, assuntos: filter.assuntos, how: filter.how }, reason: out.length ? null : 'esgotado' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(body.action === 'explain' ? 'qbank_explain' : body.action === 'mnemonic' ? 'qbank_mnemonic' : 'qbank_fetch', 'error', message).catch(() => {});
    return json(502, { error: 'Não foi possível buscar as questões agora.', detail: message.slice(0, 300) });
  }
});
