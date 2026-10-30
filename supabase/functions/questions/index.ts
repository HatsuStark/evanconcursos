// Edge Function "questions": questões do banco (Quest API) dentro do app.
//   {action:'next', taskId, count}     → questões da sessão (sem gabarito), sem repetir as já respondidas
//   {action:'answer', taskId, qid, chosen} → corrige no servidor e grava a tentativa
//   {action:'explain', taskId, qid}    → explicação da IA ancorada nos artigos oficiais (cache por questão)
// A chave da Quest API e o gabarito ficam só no servidor.
import { generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { findLawRefs, inRanges, type LawRef } from '../../../shared/legal/refs.ts';
import { lawByKey } from '../../../shared/legal/registry.ts';
import { QuestClient, type QuestQuestion } from '../../../shared/qbank/client.ts';
import {
  EXPLAIN_PROMPT_VERSION, Explanation, explainPrompt, explanationJsonSchema, mapSession, mapSubject,
  QMAP_PROMPT_VERSION, searchFilters, type MapDeps, type SessionFilter,
} from '../../../shared/qbank/map.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';

const ASSUNTOS_MAX_AGE_MS = 30 * 864e5;
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const normAnswer = (s: string) => normalizeText(String(s)).slice(0, 1); // "A", "c" (Certo), "e" (Errado)

function publicQuestion(q: QuestQuestion) {
  const p = q.provas?.[0];
  return {
    qid: q.id, enunciado: q.enunciado, tipo: q.tipo, dificuldade: q.dificuldade,
    alternativas: (q.alternativas ?? []).map((a) => ({ letra: a.letra, texto: a.texto, imagens: a.imagens ?? [] })),
    textos: q.textos_associados ?? [], anexos: q.anexos ?? [],
    prova: p ? { banca: p.banca, ano: p.ano, orgao: p.orgao, cargo: p.cargo } : null,
    materia: q.classificacao?.materia ?? '', assunto: q.classificacao?.assunto ?? '',
  };
}

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
  const deps: MapDeps = {
    materias: (q) => quest.materias(q),
    assuntosOf: async (materia) => {
      const { data } = await admin.from('qbank_assunto_lists').select('assuntos, fetched_at').eq('materia', materia).maybeSingle();
      if (data && Date.now() - new Date(data.fetched_at).getTime() < ASSUNTOS_MAX_AGE_MS) return data.assuntos as string[];
      const list = await quest.assuntos(materia);
      await admin.from('qbank_assunto_lists').upsert({ materia, assuntos: list, fetched_at: new Date().toISOString() });
      return list;
    },
    ai: async (schema, jsonSchema, prompt) => {
      const r = await generateJson({ apiKey, model, schema, jsonSchema, parts: [{ text: prompt }] });
      usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens; usage.thinkingTokens += r.usage.thinkingTokens;
      return r.data;
    },
  };
  const log = (operation: string, status: 'ok' | 'error', error?: string) => logUsage(admin, {
    ownerId: auth.user.id, operation, model: usage.inputTokens ? model : 'quest-api', promptVersion: operation === 'qbank_explain' ? EXPLAIN_PROMPT_VERSION : QMAP_PROMPT_VERSION,
    usage: usage.inputTokens ? usage : null, latencyMs: Date.now() - started, status, error, credits: quest.credits,
  });

  try {
    // Tarefa e matéria lidas como o usuário: a RLS garante que são dele.
    const { data: task } = await auth.client.from('tasks').select('id, plan_id, subject_id, session_id, kind').eq('id', String(body.taskId ?? '')).maybeSingle();
    if (!task) return json(404, { error: 'Tarefa não encontrada.' });
    const { data: subject } = task.subject_id
      ? await auth.client.from('notice_subjects').select('id, name, notice_id, notice_topics(text, position)').eq('id', task.subject_id).maybeSingle()
      : { data: null };

    if (body.action === 'answer') {
      const { data: q } = await admin.from('qbank_questions').select('gabarito, materia, assunto').eq('qid', String(body.qid ?? '')).maybeSingle();
      if (!q) return json(404, { error: 'Questão não encontrada.' });
      const chosen = String(body.chosen ?? '').slice(0, 20);
      const correct = normAnswer(chosen) === normAnswer(q.gabarito);
      const { error } = await admin.from('question_attempts').insert({
        owner_id: auth.user.id, plan_id: task.plan_id, task_id: task.id, session_id: task.session_id, subject_id: task.subject_id,
        qid: String(body.qid), materia: q.materia, assunto: q.assunto, chosen, correct,
      });
      if (error) throw new Error(error.message);
      return json(200, { correct, gabarito: q.gabarito });
    }

    if (body.action === 'explain') {
      const qid = String(body.qid ?? '');
      const { data: q } = await admin.from('qbank_questions').select('payload, gabarito, explanation').eq('qid', qid).maybeSingle();
      if (!q) return json(404, { error: 'Questão não encontrada.' });
      if (q.explanation) return json(200, { explanation: q.explanation, cached: true });
      const p = q.payload as ReturnType<typeof publicQuestion>;
      // Leis: as citadas na questão e as da sessão (com artigos); só trechos com intervalo definido.
      let sessionTitle = '';
      if (task.session_id) sessionTitle = (await auth.client.from('study_sessions').select('title').eq('id', task.session_id).maybeSingle()).data?.title ?? '';
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
    if (!subject) return json(200, { questions: [], reason: 'sem-materia' });
    const count = Math.max(1, Math.min(10, Number(body.count) || 5));
    const topics = ((subject.notice_topics ?? []) as { text: string; position: number }[]).sort((a, b) => a.position - b.position).map((t) => t.text);

    // Matéria da disciplina (uma vez) e banca do edital.
    let { data: sm } = await admin.from('qbank_subject_maps').select('materia, banca').eq('subject_id', subject.id).maybeSingle();
    if (!sm) {
      const { data: notice } = await auth.client.from('notices').select('board').eq('id', subject.notice_id).single();
      const bancas = notice?.board ? await quest.bancas(String(notice.board).split(/[\s/-]/)[0]!) : [];
      const banca = bancas.find((b) => normalizeText(b) === normalizeText(notice?.board ?? '')) ?? bancas[0] ?? '';
      const r = await mapSubject(deps, { name: subject.name, topics });
      sm = { materia: r.materia, banca };
      await admin.from('qbank_subject_maps').upsert({ subject_id: subject.id, owner_id: auth.user.id, materia: r.materia, banca, how: r.how, prompt_version: QMAP_PROMPT_VERSION });
    }

    // Filtro: assuntos da sessão (uma vez por sessão); em dias de reforço, os assuntos em que o estudante mais erra.
    let filter: SessionFilter = { materia: null, assuntos: [], how: '' };
    const scope = task.session_id ?? `subject:${subject.id}`;
    if (task.session_id) {
      const { data: m } = await admin.from('qbank_session_maps').select('materia, assuntos, how').eq('session_id', task.session_id).maybeSingle();
      if (m) filter = m as SessionFilter;
      else {
        const { data: ss } = await auth.client.from('study_sessions').select('title, keyword, topic_ids').eq('id', task.session_id).single();
        const { data: tt } = ss?.topic_ids?.length ? await auth.client.from('notice_topics').select('text').in('id', ss.topic_ids) : { data: [] };
        filter = await mapSession(deps, sm.materia, { subject: subject.name, title: ss?.title ?? '', keyword: ss?.keyword ?? '', topics: (tt ?? []).map((t) => t.text) });
        await admin.from('qbank_session_maps').upsert({ session_id: task.session_id, owner_id: auth.user.id, materia: filter.materia, assuntos: filter.assuntos, how: filter.how, prompt_version: QMAP_PROMPT_VERSION });
      }
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

    // Busca na ordem dos filtros, pulando o que o estudante já respondeu; cursor por filtro.
    const { data: done } = await admin.from('question_attempts').select('qid').eq('owner_id', auth.user.id).eq('subject_id', subject.id).limit(5000);
    const seen = new Set((done ?? []).map((d) => d.qid));
    const out: QuestQuestion[] = [];
    for (const f of filters) {
      if (out.length >= count) break;
      const { data: cur } = await admin.from('qbank_cursors').select('after_id, exhausted').eq('owner_id', auth.user.id).eq('scope', scope).eq('filter_key', f.key).maybeSingle();
      if (cur?.exhausted) continue;
      let after = cur?.after_id ?? undefined, exhausted = false;
      for (let round = 0; round < 3 && out.length < count && !exhausted; round++) {
        const r = await quest.questoes(f.params, count - out.length, after);
        const fresh = r.items.filter((q) => q.gabarito && !seen.has(q.id) && !out.some((o) => o.id === q.id));
        if (r.items.length) {
          await admin.from('qbank_questions').upsert(r.items.filter((q) => q.gabarito).map((q) => ({
            qid: q.id, materia: q.classificacao?.materia ?? '', assunto: q.classificacao?.assunto ?? '', payload: publicQuestion(q), gabarito: String(q.gabarito),
          })), { onConflict: 'qid', ignoreDuplicates: true });
        }
        out.push(...fresh);
        after = r.next ?? r.items[r.items.length - 1]?.id ?? after;
        exhausted = !r.hasMore || !r.items.length;
      }
      await admin.from('qbank_cursors').upsert({ owner_id: auth.user.id, scope, filter_key: f.key, after_id: after ?? null, exhausted, updated_at: new Date().toISOString() });
    }
    await log('qbank_fetch', 'ok');
    return json(200, { questions: out.slice(0, count).map(publicQuestion), filter: { materia: filter.materia, assuntos: filter.assuntos, how: filter.how }, reason: out.length ? null : 'esgotado' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(body.action === 'explain' ? 'qbank_explain' : 'qbank_fetch', 'error', message).catch(() => {});
    return json(502, { error: 'Não foi possível buscar as questões agora.', detail: message.slice(0, 300) });
  }
});
