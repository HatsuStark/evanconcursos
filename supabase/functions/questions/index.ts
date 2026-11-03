// Edge Function "questions": questões do banco (Quest API) dentro do app.
//   {action:'next', taskId, count, exclude?} → questões da sessão (sem gabarito), sem repetir as já respondidas; na revisão
//                                            semanal, os erros vencidos do caderno do concurso (exclude: os já mostrados)
//   {action:'answer', qid, chosen, taskId? | context:'free'|'review', timeMs?} → corrige no servidor e registra
//   {action:'explain', qid, taskId?}      → explicação da IA ancorada nos artigos oficiais (cache por questão)
//   {action:'mnemonic', qid, taskId?}     → mnemônico compartilhado (ou nenhum), vira flashcard do estudante
// A chave da Quest API e o gabarito ficam só no servidor. taskId é opcional fora do cronograma.
import { generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { GENERATED_EXAMPLES, GENERATED_MAX, GENERATED_PROMPT_VERSION, GeneratedQuestions, generatedJsonSchema, generatedPrompt, generatedTheme, toPublic } from '../../../shared/qbank/generated.ts';
import { loadLawSources } from '../_shared/law.ts';
import { prunedAssuntos, rejectedIds, RELEVANCE_PROMPT_VERSION, RelevanceVerdicts, relevanceJsonSchema, relevancePrompt } from '../../../shared/qbank/relevance.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { findLawRefs, inRanges, type LawRef } from '../../../shared/legal/refs.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';
import { QuestClient, type QuestQuestion } from '../../../shared/qbank/client.ts';
import {
  equalIncidence, EXPLAIN_PROMPT_VERSION, Explanation, explainPrompt, explanationJsonSchema, inTurn, measureIncidence, planPicks,
  QMAP_PROMPT_VERSION, roleKeyword, searchFilters, SESSION_DIFFICULTIES, type Incidence, type SessionFilter,
} from '../../../shared/qbank/map.ts';
import { conceptKey, MNEMONIC_PROMPT_VERSION, MnemonicChoice, mnemonicJsonSchema, mnemonicPrompt, pickExisting } from '../../../shared/qbank/mnemonic.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { activePlan, ensureBoardFormat, fromCache, ensureSessionMap, ensureSubjectMap, mapDeps, plain, publicQuestion, questFailure, recordAnswer, takeNewest, upsertFlashcard, withMnemo, type PublicQuestion } from '../_shared/qbank.ts';

// Com alguma questão pronta, não faz o estudante esperar por mais; sem nenhuma, desiste antes do limite da função.
const SOFT_LIMIT_MS = 15_000, HARD_LIMIT_MS = 90_000;
// Rodadas de busca por pedido: a 2ª e a 3ª repõem as questões que a triagem de relevância descartou.
const RELEVANCE_ROUNDS = 3;
// Questões inéditas da IA levam até ~55 s (casos concretos, com questões reais de modelo): só começam se ainda houver tempo
// antes do limite da função (150 s): 60 s de busca + 75 s de geração.
const GENERATE_BEFORE_MS = 60_000, GENERATE_TIMEOUT_MS = 75_000;

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
      const context = task ? (task.kind === 'weekly_review' ? 'review' : 'plan') : body.context === 'review' ? 'review' : 'free';
      const r = await recordAnswer(admin, {
        ownerId: auth.user.id, qid: String(body.qid ?? ''), chosen: String(body.chosen ?? ''), context,
        planId: task?.plan_id ?? await activePlan(admin, auth.user.id), taskId: task?.id, sessionId: task?.session_id, subjectId: task?.subject_id,
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
        if (m) await upsertFlashcard(admin, auth.user.id, 'mnemonic', m.id, `Mnemônico: ${m.concept}`, [m.mnemonic, ...(m.items ?? []).map((i) => `${i.chave} = ${i.significado}`)].join('\n'), task?.plan_id ?? await activePlan(admin, auth.user.id));
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
    const count = Math.max(1, Math.min(10, Number(body.count) || 5));

    // Revisão semanal: os erros vencidos do caderno deste concurso, do cache, sem créditos. As sessões não intercalam erros:
    // eles esperam por esta tarefa.
    if (task.kind === 'weekly_review') {
      const exclude = Array.isArray(body.exclude) ? (body.exclude as unknown[]).map(String).slice(0, 500) : [];
      const { data: due } = await admin.from('error_book').select('qid').eq('owner_id', auth.user.id).eq('plan_id', task.plan_id).eq('resolved', false)
        .lte('due_on', new Date().toISOString().slice(0, 10)).order('due_on').limit(exclude.length + count);
      const ids = (due ?? []).map((d) => d.qid as string).filter((id) => !exclude.includes(id)).slice(0, count);
      const { data: rows } = ids.length ? await admin.from('qbank_questions').select('qid, payload').in('qid', ids) : { data: [] };
      const byId = new Map((rows ?? []).map((r) => [r.qid as string, r.payload as PublicQuestion]));
      const questions = await withMnemo(admin, ids.map((id) => byId.get(id)).filter((q): q is PublicQuestion => !!q));
      return json(200, { questions, reason: questions.length ? null : exclude.length ? 'fim-revisao' : 'sem-erros' });
    }
    if (!subject) return json(200, { questions: [], reason: 'sem-materia' });
    const topics = ((subject.notice_topics ?? []) as { text: string; position: number }[]).sort((a, b) => a.position - b.position).map((t) => t.text);

    // Matéria da disciplina (uma vez) e banca do edital.
    const sm = await ensureSubjectMap(admin, quest, deps, auth.user.id, subject.id, async () => {
      const { data: notice } = await auth.client.from('notices').select('board, organization').eq('id', subject.notice_id).single();
      return { name: subject.name, board: String(notice?.board ?? ''), topics, organization: String(notice?.organization ?? '') };
    });

    // Filtro: assuntos da sessão (uma vez por sessão); em dias de reforço, os assuntos em que o estudante mais erra.
    let filter: SessionFilter = { materia: null, assuntos: [], how: '' };
    let incidence: Incidence[] | null = null;
    const scope = task.session_id ?? `subject:${subject.id}`;
    if (task.session_id) {
      const m = await ensureSessionMap(admin, deps, auth.user.id, task.session_id, sm.materia, async () => {
        const { data: ss } = await auth.client.from('study_sessions').select('title, keyword, topic_ids').eq('id', task.session_id).single();
        const { data: tt } = ss?.topic_ids?.length ? await auth.client.from('notice_topics').select('text').in('id', ss.topic_ids) : { data: [] };
        const { data: n } = await auth.client.from('notices').select('organization').eq('id', subject.notice_id).single();
        return { subject: subject.name, title: ss?.title ?? '', keyword: ss?.keyword ?? '', topics: (tt ?? []).map((t) => t.text), organization: String(n?.organization ?? '') };
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
    const { data: notice } = await auth.client.from('notices').select('education_level, role_name').eq('id', subject.notice_id).single();
    const format = await ensureBoardFormat(admin, quest, subject.id, sm);
    const allFilters = searchFilters(filter, sm.banca, { level: String(notice?.education_level ?? ''), role: roleKeyword(String(notice?.role_name ?? '')), format });
    // Sessão sem assunto no banco de questões vai direto para as questões inéditas da IA.
    if (!allFilters.length && !task.session_id) { await log('qbank_fetch', 'ok'); return json(200, { questions: [], reason: 'sem-assunto' }); }

    // Peso de cada assunto: medido uma vez por sessão. Se a medição falhar, divide igual e tenta de novo na próxima busca.
    if (!incidence && allFilters.length) {
      if (task.session_id) {
        try {
          incidence = await measureIncidence((params) => quest.count(params), filter, sm.banca);
          await admin.from('qbank_session_maps').update({ incidence }).eq('session_id', task.session_id);
        } catch { incidence = equalIncidence(filter.assuntos); }
      } else incidence = equalIncidence(filter.assuntos);
    }
    // Assunto sem questão em banca nenhuma ficou fora da medição: nem entra na busca.
    const measured = new Set((incidence ?? []).map((i) => normalizeText(i.assunto)));
    const filters = allFilters.filter((f) => measured.has(normalizeText(f.assunto)));

    // Pula o que o estudante já respondeu; o que ele respondeu nesta sessão define a vez de cada assunto.
    const { data: done } = await admin.from('question_attempts').select('qid, assunto, session_id').eq('owner_id', auth.user.id).eq('subject_id', subject.id).limit(5000);
    // Triagem de relevância da sessão: o que já foi julgado não é julgado de novo, e o que ficou fora do tema nunca volta.
    const judged = new Set<string>(), rejected = new Set<string>(), verdicts: { assunto: string; relevant: boolean }[] = [];
    const { data: sess } = task.session_id ? await auth.client.from('study_sessions').select('title, keyword').eq('id', task.session_id).maybeSingle() : { data: null };
    if (sess) {
      const { data: rel } = await admin.from('qbank_relevance').select('qid, assunto, relevant').eq('session_id', task.session_id);
      for (const r of rel ?? []) { judged.add(r.qid); verdicts.push({ assunto: r.assunto, relevant: r.relevant }); if (!r.relevant) rejected.add(r.qid); }
    }
    // Também as que já estão na tela, ainda sem resposta (o app manda em `exclude`).
    const seen = new Set([...(done ?? []).map((d) => d.qid as string), ...(Array.isArray(body.exclude) ? (body.exclude as unknown[]).map(String).slice(0, 500) : []), ...rejected]);
    const served = new Map<string, number>();
    for (const d of done ?? []) if (task.session_id && d.session_id === task.session_id) served.set(normalizeText(d.assunto), (served.get(normalizeText(d.assunto)) ?? 0) + 1);
    // Uma chamada à IA por lote, com raciocínio baixo. Se falhar, as questões passam: o estudo não para por causa da triagem.
    const screen = async (qs: PublicQuestion[]) => {
      const fresh = sess ? qs.filter((q) => !judged.has(q.qid)) : [];
      if (!fresh.length) return qs;
      try {
        const r = await generateJson({ apiKey, model, schema: RelevanceVerdicts, jsonSchema: relevanceJsonSchema(), thinkingLevel: 'low', timeoutMs: 25_000,
          parts: [{ text: relevancePrompt({ subject: subject.name, title: sess!.title, keyword: sess!.keyword ?? '' },
            fresh.map((q) => ({ id: q.qid, assunto: q.assunto, enunciado: q.enunciado, alternativas: q.alternativas.map((a) => a.texto) }))) }] });
        usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens; usage.thinkingTokens += r.usage.thinkingTokens;
        const bad = rejectedIds(r.data, fresh.map((q) => q.qid));
        await admin.from('qbank_relevance').upsert(fresh.map((q) => ({
          session_id: task.session_id, owner_id: auth.user.id, qid: q.qid, assunto: q.assunto, relevant: !bad.has(q.qid), reason: bad.get(q.qid) ?? '', prompt_version: RELEVANCE_PROMPT_VERSION,
        })));
        for (const q of fresh) { judged.add(q.qid); verdicts.push({ assunto: q.assunto, relevant: !bad.has(q.qid) }); if (bad.has(q.qid)) rejected.add(q.qid); }
        return qs.filter((q) => !bad.has(q.qid));
      } catch (e) {
        console.error('relevance:', e);
        return qs;
      }
    };
    const generated = async (n: number): Promise<PublicQuestion[]> => {
      const theme = generatedTheme(filter.materia ?? subject.name, sess!.title);
      // Só as da versão atual do prompt: as antigas saíam genéricas demais.
      const { data: made } = await admin.from('qbank_questions').select('payload').eq('payload->>ia_tema', theme).eq('payload->>ia_versao', GENERATED_PROMPT_VERSION).limit(200);
      const all = (made ?? []).map((r) => r.payload as PublicQuestion);
      const reuse = all.filter((q) => !seen.has(q.qid)).slice(0, n);
      for (const q of reuse) seen.add(q.qid);
      if (reuse.length >= n) return reuse;
      try {
        const { data: ss } = await auth.client.from('study_sessions').select('topic_ids').eq('id', task.session_id).single();
        const { data: tt } = ss?.topic_ids?.length ? await auth.client.from('notice_topics').select('text').in('id', ss.topic_ids) : { data: [] };
        const { law } = await loadLawSources(admin, { title: sess!.title, topics: (tt ?? []).map((t) => t.text as string), subject: subject.name });
        const { data: nt } = await auth.client.from('notices').select('board, role_name').eq('id', subject.notice_id).single();
        // Modelos de estilo e nível: as questões reais que a triagem aprovou nesta sessão; sem elas, as do cache nos assuntos dela.
        const { data: ok } = await admin.from('qbank_relevance').select('qid').eq('session_id', task.session_id).eq('relevant', true).limit(10);
        const okIds = (ok ?? []).map((r) => r.qid as string).filter((id) => !id.startsWith('ia-'));
        let { data: ex } = okIds.length ? await admin.from('qbank_questions').select('payload, gabarito').in('qid', okIds).limit(GENERATED_EXAMPLES) : { data: [] };
        if (!ex?.length && filter.materia && filter.assuntos.length) {
          ({ data: ex } = await admin.from('qbank_questions').select('payload, gabarito').eq('materia', filter.materia).in('assunto', filter.assuntos).not('qid', 'like', 'ia-%').limit(GENERATED_EXAMPLES));
        }
        const examples = (ex ?? []).map((r) => {
          const q = r.payload as PublicQuestion;
          return { enunciado: q.enunciado, alternativas: /certo/i.test(String(q.tipo ?? '')) ? [] : q.alternativas.map((a) => a.texto), gabarito: String(r.gabarito ?? ''), banca: q.prova?.banca ?? '' };
        });
        // Pelo menos 3 por vez: as que sobram servem ao próximo lote e a outros estudantes.
        const k = Math.min(GENERATED_MAX, Math.max(3, n - reuse.length));
        const r = await generateJson({ apiKey, model, schema: GeneratedQuestions, jsonSchema: generatedJsonSchema(), temperature: 0.5, timeoutMs: GENERATE_TIMEOUT_MS,
          parts: [{ text: generatedPrompt({ banca: String(nt?.board ?? ''), cargo: String(nt?.role_name ?? ''), subject: subject.name, title: sess!.title, keyword: sess!.keyword ?? '',
            law, format, n: k, avoid: all.map((q) => plain(q.enunciado)).slice(-15), examples }) }] });
        usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens; usage.thinkingTokens += r.usage.thinkingTokens;
        const rows = r.data.questoes.map((q) => toPublic(q, {
          qid: `ia-${crypto.randomUUID()}`, format, materia: filter.materia ?? subject.name, assunto: filter.assuntos[0] ?? sess!.title, theme, year: new Date().getFullYear(),
        })).filter((x) => x !== null);
        if (rows.length) await admin.from('qbank_questions').insert(rows.map((x) => ({ qid: x.payload.qid, materia: x.payload.materia, assunto: x.payload.assunto, payload: x.payload, gabarito: x.gabarito })));
        const fresh = rows.map((x) => x.payload as unknown as PublicQuestion).slice(0, n - reuse.length);
        for (const q of fresh) seen.add(q.qid);
        return [...reuse, ...fresh];
      } catch (e) {
        console.error('generated:', e);
        return reuse;
      }
    };
    let timedOut = false;
    const result: PublicQuestion[] = [];
    // Até 3 rodadas: as questões descartadas pela triagem são repostas no mesmo pedido.
    // Assunto que trouxe muito descarte nesta sessão deixa de ser comprado (prunedAssuntos); sem assunto bom, vai para o plano B.
    for (let round = 0; round < RELEVANCE_ROUNDS && result.length < count && !timedOut; round++) {
      const pruned = prunedAssuntos(verdicts);
      const live = filters.filter((f) => !pruned.has(normalizeText(f.assunto)));
      const liveIncidence = (incidence ?? []).filter((i) => !pruned.has(normalizeText(i.assunto)));
      if (!live.length || !liveIncidence.length) break;
      const need = count - result.length;
      const out: QuestQuestion[] = [];
      // Traz até `limit` questões no total, das mais recentes para as mais antigas.
      const take = async (f: (typeof live)[number], limit: number) => {
        if (out.length >= limit) return;
        const elapsed = Date.now() - started;
        if (elapsed > HARD_LIMIT_MS || ((out.length || result.length) && elapsed > SOFT_LIMIT_MS)) { timedOut = true; return; }
        out.push(...await takeNewest(admin, quest, auth.user.id, scope, f.key, f.params, limit - out.length, (q) => !seen.has(q.id) && !out.some((o) => o.id === q.id)));
      };
      // Cada assunto busca a sua parte (banca e, se faltar, outras bancas); o que sobrar vem de qualquer assunto com questões.
      // Primeiro as já compradas e não vistas, sem créditos; a API só completa o que faltar.
      const wanted = new Map<string, number>();
      for (const a of planPicks(liveIncidence, served, need)) wanted.set(a, (wanted.get(a) ?? 0) + 1);
      const cached: PublicQuestion[] = [];
      for (const [assunto, n] of wanted) {
        const got = await fromCache(admin, { materia: filter.materia!, assunto, dificuldades: SESSION_DIFFICULTIES, tipo: format, preferBanca: sm.banca }, n, (id) => !seen.has(id) && !cached.some((c) => c.qid === id));
        cached.push(...got);
        wanted.set(assunto, n - got.length);
      }
      const wantedTotal = need - cached.length;
      // A dificuldade alterna a cada questão e continua de onde parou na sessão.
      let turn = [...served.values()].reduce((a, b) => a + b, 0);
      for (const [assunto, n] of wanted) {
        for (let i = 0; i < n && wantedTotal > 0; i++) {
          const limit = out.length + 1;
          for (const f of inTurn(live.filter((x) => x.assunto === assunto), turn)) await take(f, limit);
          turn++;
        }
      }
      if (wantedTotal > 0) for (const f of inTurn(live, turn)) await take(f, wantedTotal);
      // Dentro do lote, primeiro as questões que caíram em mais provas.
      out.sort((a, b) => (b.provas?.length ?? 0) - (a.provas?.length ?? 0));
      const found = [...cached, ...out.slice(0, wantedTotal).map(publicQuestion)];
      if (!found.length) break;
      for (const q of found) { seen.add(q.qid); served.set(normalizeText(q.assunto), (served.get(normalizeText(q.assunto)) ?? 0) + 1); }
      result.push(...await screen(found));
    }
    // Plano B: sem questão real no tema, questões inéditas da IA, reaproveitadas entre estudantes com o mesmo tema.
    if (sess && result.length < count && Date.now() - started < GENERATE_BEFORE_MS) result.push(...await generated(count - result.length));
    await log('qbank_fetch', 'ok');
    const batch = await withMnemo(admin, result.slice(0, count));
    return json(200, { questions: batch, filter: { materia: filter.materia, assuntos: filter.assuntos, how: filter.how }, reason: batch.length ? null : timedOut ? 'demorou' : 'esgotado-dificeis' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(body.action === 'explain' ? 'qbank_explain' : body.action === 'mnemonic' ? 'qbank_mnemonic' : 'qbank_fetch', 'error', message).catch(() => {});
    return json(502, { error: questFailure(message, 'Não foi possível buscar as questões agora.'), detail: message.slice(0, 300) });
  }
});
