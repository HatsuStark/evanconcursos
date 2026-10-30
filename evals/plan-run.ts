// Avaliação do planejamento pedagógico com a IA real, sobre as extrações da última avaliação de editais.
// Uso: node --experimental-strip-types evals/plan-run.ts [filtro]
// Mede, por matéria: sessões pedidas × devolvidas, cobertura de tópicos antes da correção e correções aplicadas;
// e confere os invariantes do cronograma final (toda sessão agendada, todo tópico coberto).
import { readdirSync, readFileSync } from 'node:fs';
import { costUsd, generateJson } from '../shared/ai/gemini.ts';
import { NoticeExtraction, subjectWeights } from '../shared/ai/notice.ts';
import { buildPlanPayload, theoryPlan, type PlanBase } from '../shared/ai/plan-build.ts';
import { PlanStrategy, repairSessions, sessionsJsonSchema, sessionsPrompt, strategyJsonSchema, strategyPrompt, SubjectSessions, type Session } from '../shared/ai/plan.ts';

const PRICE = { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 };
const root = new URL('./', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('../.env', root), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = env.GEMINI_MODEL || 'gemini-3.8-flash', apiKey = env.GEMINI_API_KEY!;

// Para cada edital, a extração mais recente com notice-v2 (os relatórios podem cobrir só parte dos editais).
const files = readdirSync(new URL('results/', root)).filter((f) => f.includes('notice-v2')).sort().reverse();
if (!files.length) throw Error('Rode antes: node --experimental-strip-types evals/run.ts');
const byFile = new Map<string, { file: string; extraction?: unknown }>();
for (const f of files) for (const r of JSON.parse(readFileSync(new URL(`results/${f}`, root), 'utf8')).report as { file: string; extraction?: unknown }[])
  if (r.extraction && !byFile.has(r.file)) byFile.set(r.file, r);
const report = [...byFile.values()];
const filter = process.argv[2] ?? 'escrevente';

for (const item of report.filter((r) => r.file.includes(filter) && r.extraction)) {
  const e = NoticeExtraction.parse(item.extraction), w = subjectWeights(e);
  const profile = 'Trabalho 8h por dia; formado em Administração; nunca estudei Direito; boa base em Português.';
  const base: PlanBase = {
    examDate: '2027-05-30', totalQuestions: e.totalQuestions, weights: {},
    inputs: { hours: [2, 2, 2, 2, 2, 4, 0], startDate: '2026-11-02', weeklyReview: true, profile, levels: {} },
    subjects: e.subjects.map((s, i) => ({ id: `s${i}`, name: s.name, core: s.core, questions: s.questions, weight: w[i] ?? 2, topics: s.topics.map((t, j) => ({ id: `s${i}t${j}`, text: t.text })) })),
  };
  for (const s of base.subjects) base.inputs.levels[s.id] = /portugu/i.test(s.name) ? 2 : s.core ? 0 : 1;
  let cost = 0;
  console.log(`\n=== ${item.file} · ${base.subjects.length} matérias ===`);

  const pre = theoryPlan(base);
  const st = await generateJson({
    apiKey, model, schema: PlanStrategy, jsonSchema: strategyJsonSchema(),
    parts: [{ text: strategyPrompt({ role: e.role, board: e.board, examDate: base.examDate, weeks: 30, hours: 400, profile, notes: e.notes,
      subjects: base.subjects.map((s, i) => ({ ref: `S${i + 1}`, name: s.name, core: s.core, questions: s.questions, weight: s.weight, level: base.inputs.levels[s.id]!, topics: s.topics.length })) }) }],
  });
  cost += costUsd(st.usage, PRICE);
  base.subjects.forEach((s, i) => { const a = st.data.subjects.find((x) => x.ref === `S${i + 1}`); base.weights[s.id] = a?.weight ?? s.weight; });
  console.log(`estratégia (${Math.round(st.latencyMs / 1000)}s): ${st.data.advice.slice(0, 3).join(' | ')}`);
  console.log('pesos: ' + base.subjects.map((s) => `${s.name} ${s.weight}→${base.weights[s.id]}`).join(', '));
  const counts = theoryPlan(base);
  void pre;

  const sessions: Record<string, Session[]> = {};
  let exact = 0, fullCover = 0;
  await Promise.all(base.subjects.map(async (s) => {
    const n = counts[s.id]!.days, topics = s.topics.map((t) => t.text);
    const r = await generateJson({
      apiKey, model, schema: SubjectSessions, jsonSchema: sessionsJsonSchema(), temperature: 0.3,
      parts: [{ text: sessionsPrompt({ role: e.role, board: e.board, profile, subject: s.name, level: base.inputs.levels[s.id]!, questions: s.questions, focus: st.data.subjects.find((x) => x.ref === `S${base.subjects.indexOf(s) + 1}`)?.focus ?? '', n, minutesPerSession: counts[s.id]!.avgMinutes, topics }) }],
    });
    cost += costUsd(r.usage, PRICE);
    const covered = new Set(r.data.sessions.flatMap((x) => x.topics).filter((t) => t >= 1 && t <= topics.length));
    const fixed = repairSessions(r.data, n, topics);
    sessions[s.id] = fixed.sessions;
    if (r.data.sessions.length === n) exact++;
    if (covered.size === topics.length) fullCover++;
    console.log(`  ${s.name}: ${n} pedidas, ${r.data.sessions.length} vieram · cobertura ${covered.size}/${topics.length} · ${Math.round(r.latencyMs / 1000)}s${fixed.fixes.length ? ' · correções: ' + [...new Set(fixed.fixes)].join(', ') : ''}`);
  }));

  const p = buildPlanPayload(base, sessions);
  const coveredIds = new Set(p.sessions.flatMap((s) => s.topicIds));
  const allTopics = base.subjects.flatMap((s) => s.topics.map((t) => t.id));
  const theory = p.tasks.filter((t) => t.kind === 'theory');
  console.log(`\nresultado: ${exact}/${base.subjects.length} matérias com contagem exata e ${fullCover}/${base.subjects.length} com cobertura total já na resposta da IA`);
  console.log(`cronograma: ${p.tasks.length} tarefas, ${theory.length} de teoria = ${p.sessions.length} sessões; tópicos cobertos ${allTopics.filter((t) => coveredIds.has(t)).length}/${allTopics.length} · custo US$ ${cost.toFixed(4)}`);
  const sample = base.subjects.find((s) => s.core) ?? base.subjects[0]!;
  console.log(`\nexemplo (${sample.name}):\n` + sessions[sample.id]!.slice(0, 8).map((x, i) => `  ${i + 1}. ${x.title} [${x.keyword}] → tópicos ${x.topics.map((t) => t + 1).join(',')}`).join('\n'));
}
