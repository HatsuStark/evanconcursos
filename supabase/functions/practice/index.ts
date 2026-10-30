// Edge Function "practice": prática fora do cronograma.
//   {action:'filters', kind:'geral'|'materias'|'assuntos'|'bancas', q?, materia?} → listas de filtros (gratuitas)
//   {action:'search', filters:{materia, assunto?, banca?, ano?, dificuldade?, orgao?, cargo?, tipo?, onlyNew?}, count}
//   {action:'review', count}           → questões do caderno de erros que vencem hoje (do cache, sem créditos)
//   {action:'simulado_create', kind:'concurso'|'custom', planId?, taskId?, size?, subjects?, banca?, tipo?, timed, minutes?}
//   {action:'simulado_get', id} · {action:'simulado_finish', id}
// Questões livres e simulados entram no histórico com contexto próprio (desempenho separado do cronograma).
import type { GeminiUsage } from '../../../shared/ai/gemini.ts';
import { normalizeText } from '../../../shared/ai/notice.ts';
import { QuestClient, type QuestQuestion } from '../../../shared/qbank/client.ts';
import { mapSubject, QMAP_PROMPT_VERSION } from '../../../shared/qbank/map.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { cacheQuestions, mapDeps, publicQuestion, recordAnswer, type PublicQuestion } from '../_shared/qbank.ts';

const str = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n);
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0; return h.toString(36); };
// "mínimo de 50% de acertos" → 50.
const minPctOf = (rule: string) => { const m = /(\d{1,3})\s*%/.exec(rule ?? ''); return m ? Math.min(100, Number(m[1])) : /metade/i.test(rule ?? '') ? 50 : 0; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const admin = adminClient(), quest = new QuestClient(Deno.env.get('QUEST_API_KEY') ?? '');
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, started = Date.now();
  const log = (operation: string, status: 'ok' | 'error', error?: string) => logUsage(admin, {
    ownerId: auth.user.id, operation, model: usage.inputTokens ? (Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash') : 'quest-api', promptVersion: QMAP_PROMPT_VERSION,
    usage: usage.inputTokens ? usage : null, latencyMs: Date.now() - started, status, error, credits: quest.credits,
  });

  // Busca `count` questões inéditas para o estudante, girando um cursor por escopo/filtro (não repete entre sessões).
  async function fetchFresh(scope: string, params: Record<string, string>, count: number, seen: Set<string>) {
    const out: QuestQuestion[] = [];
    const key = hash(JSON.stringify(params));
    const { data: cur } = await admin.from('qbank_cursors').select('after_id, exhausted').eq('owner_id', auth.user.id).eq('scope', scope).eq('filter_key', key).maybeSingle();
    if (cur?.exhausted) return out;
    let after = cur?.after_id ?? undefined, exhausted = false;
    for (let round = 0; round < 4 && out.length < count && !exhausted; round++) {
      const r = await quest.questoes(params, Math.min(20, count - out.length), after);
      await cacheQuestions(admin, r.items);
      out.push(...r.items.filter((q) => q.gabarito && !seen.has(q.id) && !out.some((o) => o.id === q.id)));
      after = r.next ?? r.items[r.items.length - 1]?.id ?? after;
      exhausted = !r.hasMore || !r.items.length;
    }
    await admin.from('qbank_cursors').upsert({ owner_id: auth.user.id, scope, filter_key: key, after_id: after ?? null, exhausted, updated_at: new Date().toISOString() });
    return out.slice(0, count);
  }
  const seenQids = async () => new Set(((await admin.from('question_attempts').select('qid').eq('owner_id', auth.user.id).limit(20000)).data ?? []).map((d) => d.qid as string));

  try {
    if (body.action === 'filters') {
      if (body.kind === 'geral') return json(200, { data: await quest.geral() });
      if (body.kind === 'bancas') return json(200, { items: await quest.bancas(str(body.q, 60)) });
      if (body.kind === 'materias') return json(200, { items: await quest.materias(str(body.q, 80), 20) });
      if (body.kind === 'assuntos') {
        const materia = str(body.materia, 200);
        if (!materia) return json(400, { error: 'Escolha a matéria.' });
        const deps = mapDeps(admin, quest, usage);
        const all = await deps.assuntosOf(materia), q = normalizeText(str(body.q, 80));
        return json(200, { items: (q ? all.filter((a) => normalizeText(a).includes(q)) : all).slice(0, 300) });
      }
      return json(400, { error: 'Filtro inválido.' });
    }

    if (body.action === 'search') {
      const f = body.filters ?? {};
      const params: Record<string, string> = {};
      for (const k of ['materia', 'assunto', 'banca', 'ano', 'orgao', 'cargo', 'tipo'] as const) if (str(f[k], 200)) params[k] = str(f[k], 200);
      if (Number(f.dificuldade) >= 1 && Number(f.dificuldade) <= 5) params.dificuldade = String(Number(f.dificuldade));
      if (!params.materia) return json(400, { error: 'Escolha ao menos a matéria.' });
      const count = Math.max(1, Math.min(20, Number(body.count) || 10));
      const seen = f.onlyNew === false ? new Set<string>() : await seenQids();
      const items = await fetchFresh('free', params, count, seen);
      await log('qbank_free', 'ok');
      return json(200, { questions: items.map(publicQuestion), reason: items.length ? null : 'esgotado' });
    }

    if (body.action === 'review') {
      const count = Math.max(1, Math.min(30, Number(body.count) || 10));
      const { data: due } = await admin.from('error_book').select('qid, stage, wrong_count, due_on').eq('owner_id', auth.user.id).eq('resolved', false)
        .lte('due_on', new Date().toISOString().slice(0, 10)).order('due_on').limit(count);
      const qids = (due ?? []).map((d) => d.qid);
      const { data: qs } = qids.length ? await admin.from('qbank_questions').select('qid, payload').in('qid', qids) : { data: [] };
      const byId = new Map((qs ?? []).map((q) => [q.qid, q.payload as PublicQuestion]));
      return json(200, { questions: qids.map((id) => byId.get(id)).filter(Boolean), stages: Object.fromEntries((due ?? []).map((d) => [d.qid, { stage: d.stage, wrong: d.wrong_count }])) });
    }

    if (body.action === 'simulado_create') {
      const tipo = str(body.tipo, 60);
      const blocks: { name: string; minPct: number; subjects: { name: string; materia: string | null; count: number }[] }[] = [];
      let banca = str(body.banca, 80), planId: string | null = null, title = 'Simulado';
      if (body.kind === 'concurso') {
        // Estrutura da prova do edital: blocos (com nota mínima) e questões por disciplina.
        const { data: plan } = await auth.client.from('study_plans').select('id, notice_id').eq('id', str(body.planId, 40)).maybeSingle();
        if (!plan) return json(404, { error: 'Plano não encontrado.' });
        planId = plan.id;
        const { data: notice } = await auth.client.from('notices').select('board, role_name, total_questions, structure').eq('id', plan.notice_id).single();
        const { data: subs } = await auth.client.from('notice_subjects').select('id, name, block, questions, weight, notice_topics(text)').eq('notice_id', plan.notice_id).order('position');
        const deps = mapDeps(admin, quest, usage);
        if (!banca && notice?.board) {
          const bs = await quest.bancas(String(notice.board).split(/[\s/-]/)[0]!);
          banca = bs.find((b) => normalizeText(b) === normalizeText(notice.board)) ?? bs[0] ?? '';
        }
        title = `Simulado ${body.size === 'reduzido' ? 'reduzido' : 'completo'} · ${notice?.role_name ?? ''}`.trim();
        const structure = (notice?.structure ?? {}) as { blocks?: { name: string; questions: number; rule: string }[] };
        const list = (subs ?? []) as { id: string; name: string; block: string; questions: number; weight: number; notice_topics: { text: string }[] }[];
        const groups = structure.blocks?.length ? structure.blocks : [{ name: 'Prova', questions: notice?.total_questions || list.length * 5, rule: '' }];
        const total = groups.reduce((a, g) => a + g.questions, 0) || 1, factor = body.size === 'reduzido' ? Math.min(1, 30 / total) : 1;
        for (const g of groups) {
          const inBlock = list.filter((s) => normalizeText(s.block) === normalizeText(g.name) || (groups.length === 1));
          const fixed = inBlock.reduce((a, s) => a + (s.questions || 0), 0), loose = inBlock.filter((s) => !s.questions);
          const block = { name: g.name, minPct: minPctOf(g.rule), subjects: [] as { name: string; materia: string | null; count: number }[] };
          for (const s of inBlock) {
            const n = s.questions || Math.max(1, Math.round(Math.max(0, g.questions - fixed) / Math.max(1, loose.length)));
            let { data: sm } = await admin.from('qbank_subject_maps').select('materia').eq('subject_id', s.id).maybeSingle();
            if (!sm) {
              const r = await mapSubject(deps, { name: s.name, topics: (s.notice_topics ?? []).map((t) => t.text) });
              sm = { materia: r.materia };
              await admin.from('qbank_subject_maps').upsert({ subject_id: s.id, owner_id: auth.user.id, materia: r.materia, banca, how: r.how, prompt_version: QMAP_PROMPT_VERSION });
            }
            block.subjects.push({ name: s.name, materia: sm.materia, count: Math.max(1, Math.round(n * factor)) });
          }
          if (block.subjects.length) blocks.push(block);
        }
      } else {
        const subjects = (Array.isArray(body.subjects) ? body.subjects : []).slice(0, 20)
          .map((s: Record<string, unknown>) => ({ name: str(s.materia, 200), materia: str(s.materia, 200) || null, assunto: str(s.assunto, 200), count: Math.max(1, Math.min(50, Number(s.count) || 5)) }))
          .filter((s: { materia: string | null }) => s.materia);
        if (!subjects.length) return json(400, { error: 'Escolha ao menos uma matéria.' });
        blocks.push({ name: 'Simulado', minPct: 0, subjects });
        title = str(body.title, 120) || `Simulado personalizado · ${subjects.map((s: { name: string }) => s.name).slice(0, 3).join(', ')}`;
      }
      const totalQ = blocks.reduce((a, b) => a + b.subjects.reduce((x, s) => x + s.count, 0), 0);
      if (totalQ > 120) return json(400, { error: 'Simulado limitado a 120 questões.' });
      // Sorteio: banca primeiro (questões inéditas para o estudante); completa com outras bancas.
      const seen = await seenQids(), chosen: { qid: string; block: string; subject: string }[] = [];
      const missing: string[] = [];
      for (const b of blocks) for (const s of b.subjects) {
        if (!s.materia) { missing.push(s.name); continue; }
        const base: Record<string, string> = { materia: s.materia, ...(tipo ? { tipo } : {}), ...('assunto' in s && (s as { assunto?: string }).assunto ? { assunto: (s as { assunto: string }).assunto } : {}) };
        let got = banca ? await fetchFresh('simulado', { ...base, banca }, s.count, seen) : [];
        if (got.length < s.count) got = [...got, ...(await fetchFresh('simulado', base, s.count - got.length, new Set([...seen, ...got.map((q) => q.id)])))];
        for (const q of got) { seen.add(q.id); chosen.push({ qid: q.id, block: b.name, subject: s.name }); }
        if (got.length < s.count) missing.push(`${s.name} (${got.length}/${s.count})`);
      }
      if (!chosen.length) return json(400, { error: 'Não encontramos questões para montar o simulado.' });
      const minutes = Math.max(5, Math.min(600, Number(body.minutes) || chosen.length * 3));
      const { data: sim, error } = await admin.from('simulados').insert({
        owner_id: auth.user.id, plan_id: planId, task_id: str(body.taskId, 40) || null, title: title.slice(0, 160),
        config: { kind: body.kind === 'concurso' ? 'concurso' : 'custom', blocks: blocks.map((b) => ({ name: b.name, minPct: b.minPct, subjects: b.subjects.map((s) => ({ name: s.name, count: s.count })) })), timed: !!body.timed, minutes, tipo, banca, missing },
        questions: chosen,
      }).select('id').single();
      if (error || !sim) throw new Error(error?.message ?? 'Falha ao criar o simulado.');
      await log('qbank_simulado', 'ok');
      return json(200, { id: sim.id, missing });
    }

    if (body.action === 'simulado_get' || body.action === 'simulado_finish') {
      const { data: sim } = await auth.client.from('simulados').select('*').eq('id', str(body.id, 40)).maybeSingle();
      if (!sim) return json(404, { error: 'Simulado não encontrado.' });
      const qs = (sim.questions ?? []) as { qid: string; block: string; subject: string }[];
      const { data: cache } = await admin.from('qbank_questions').select('qid, payload, gabarito').in('qid', qs.map((q) => q.qid));
      const byId = new Map((cache ?? []).map((c) => [c.qid, c]));

      if (body.action === 'simulado_finish' && sim.status === 'in_progress') {
        const { data: answers } = await auth.client.from('simulado_answers').select('qid, chosen').eq('simulado_id', sim.id);
        const chosenOf = new Map((answers ?? []).map((a) => [a.qid, a.chosen as string]));
        const per = new Map<string, { total: number; correct: number }>(), perSubject = new Map<string, { total: number; correct: number }>();
        let correct = 0;
        for (const q of qs) {
          const ch = chosenOf.get(q.qid) ?? '';
          const ok = ch ? (await recordAnswer(admin, { ownerId: auth.user.id, qid: q.qid, chosen: ch, context: 'simulado', simuladoId: sim.id, planId: sim.plan_id })).correct : false;
          if (ok) correct++;
          for (const [m, k] of [[per, q.block], [perSubject, q.subject]] as const) { const e = m.get(k) ?? { total: 0, correct: 0 }; e.total++; if (ok) e.correct++; m.set(k, e); }
        }
        const cfgBlocks = ((sim.config as { blocks?: { name: string; minPct: number }[] }).blocks ?? []);
        const blocks = [...per].map(([name, e]) => {
          const minPct = cfgBlocks.find((b) => b.name === name)?.minPct ?? 0, pct = Math.round((e.correct / e.total) * 100);
          return { name, ...e, pct, minPct, passed: pct >= minPct };
        });
        const result = {
          total: qs.length, correct, answered: chosenOf.size, pct: Math.round((correct / Math.max(1, qs.length)) * 100),
          blocks, subjects: [...perSubject].map(([name, e]) => ({ name, ...e, pct: Math.round((e.correct / e.total) * 100) })),
          passed: blocks.every((b) => b.passed), seconds: Math.round((Date.now() - new Date(sim.started_at).getTime()) / 1000),
        };
        await admin.from('simulados').update({ status: 'finished', finished_at: new Date().toISOString(), result }).eq('id', sim.id);
        if (sim.task_id) await admin.from('tasks').update({ done_at: new Date().toISOString() }).eq('id', sim.task_id).eq('owner_id', auth.user.id);
        sim.status = 'finished'; sim.result = result;
      }
      const { data: answers } = await auth.client.from('simulado_answers').select('qid, chosen, struck').eq('simulado_id', sim.id);
      const finished = sim.status === 'finished';
      return json(200, {
        simulado: { id: sim.id, title: sim.title, config: sim.config, status: sim.status, started_at: sim.started_at, finished_at: sim.finished_at, result: sim.result, task_id: sim.task_id },
        questions: qs.map((q) => ({ ...q, question: byId.get(q.qid)?.payload ?? null, gabarito: finished ? byId.get(q.qid)?.gabarito ?? null : null })),
        answers: answers ?? [],
      });
    }

    return json(400, { error: 'Ação inválida.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log('qbank_practice', 'error', message).catch(() => {});
    return json(502, { error: 'Não foi possível concluir agora.', detail: message.slice(0, 300) });
  }
});
