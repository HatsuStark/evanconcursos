// Avaliação da extração de editais contra os gabaritos (evals/gabaritos/*.json).
// Uso: node --experimental-strip-types evals/run.ts [filtro]
// Chama o Gemini de verdade (custo real, registrado no relatório). Rode antes de trocar modelo ou prompt.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { extractText } from 'unpdf';
import { costUsd, toBase64 } from '../shared/ai/gemini.ts';
import { checkNotice, comparableText, NOTICE_PROMPT_VERSION, NoticeExtraction, normalizeText, readNotice, topicInText } from '../shared/ai/notice.ts';
import { readNoticeByLines } from '../shared/ai/notice-lines.ts';
import { evalAi } from './ai.ts';

// Limites de aprovação (ver README: "Qualidade da extração").
export const THRESHOLDS = { fields: 1, subjectRecall: 1, subjectPrecision: 0.95, questionAccuracy: 1, hallucination: 0.02 };

interface Expected {
  board: string; examDate: string; roleKeywords: string[]; totalQuestions: number; essay: boolean; blockQuestions: number[];
  subjects: { name: string; aliases?: string[]; questions?: number }[]; forbiddenSubjects?: string[];
}
interface Gold { pdf: string; roleHint: string; expected: Expected }

const root = new URL('./', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('../.env', root), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const { model, apiKey, price: PRICE } = evalAi(env);
const READER = process.env.READER ?? '';

const strip = (s: string) => normalizeText(s).replace(/^nocoes (de|dos|das) /, '');
const sameSubject = (a: string, b: string) => { const x = strip(a), y = strip(b); return x === y || x.includes(y) || y.includes(x); };
const matches = (got: string, exp: { name: string; aliases?: string[] }) => [exp.name, ...(exp.aliases ?? [])].some((n) => sameSubject(got, n));

function score(e: NoticeExtraction, x: Expected, pdfText: string) {
  const fields = {
    board: normalizeText(e.board).includes(normalizeText(x.board)),
    examDate: e.examDate === x.examDate,
    role: x.roleKeywords.every((k) => normalizeText(e.role).includes(normalizeText(k))),
    totalQuestions: e.totalQuestions === x.totalQuestions,
    essay: e.stages.some((s) => s.kind === 'discursiva') === x.essay,
    blocks: JSON.stringify(e.blocks.map((b) => b.questions).sort((a, b) => a - b)) === JSON.stringify([...x.blockQuestions].sort((a, b) => a - b)),
  };
  const found = x.subjects.filter((s) => e.subjects.some((g) => matches(g.name, s)));
  const extra = e.subjects.filter((g) => !x.subjects.some((s) => matches(g.name, s)));
  const forbidden = e.subjects.filter((g) => (x.forbiddenSubjects ?? []).some((f) => sameSubject(g.name, f)));
  const withQ = x.subjects.filter((s) => s.questions != null);
  const qOk = withQ.filter((s) => e.subjects.find((g) => matches(g.name, s))?.questions === s.questions);
  const hay = comparableText(pdfText), topics = e.subjects.flatMap((s) => s.topics);
  const notFound = topics.filter((t) => !topicInText(t.text, hay));
  return {
    fields,
    fieldScore: Object.values(fields).filter(Boolean).length / Object.keys(fields).length,
    subjectRecall: found.length / x.subjects.length,
    subjectPrecision: (e.subjects.length - extra.length - forbidden.length) / Math.max(1, e.subjects.length),
    questionAccuracy: withQ.length ? qOk.length / withQ.length : 1,
    hallucination: topics.length ? notFound.length / topics.length : 0,
    topics: topics.length,
    missingSubjects: x.subjects.filter((s) => !found.includes(s)).map((s) => s.name),
    extraSubjects: extra.map((s) => s.name),
    forbiddenSubjects: forbidden.map((s) => s.name),
    wrongQuestions: withQ.filter((s) => !qOk.includes(s)).map((s) => `${s.name}: esperado ${s.questions}, veio ${e.subjects.find((g) => matches(g.name, s))?.questions ?? '—'}`),
    topicsNotFound: notFound.slice(0, 5).map((t) => t.text),
  };
}

const filter = process.argv[2] ?? '';
const golds = readdirSync(new URL('gabaritos/', root)).filter((f) => f.endsWith('.json') && f.includes(filter));
const report: Record<string, unknown>[] = [];
let totalCost = 0;
for (const file of golds) {
  const gold = JSON.parse(readFileSync(new URL(`gabaritos/${file}`, root), 'utf8')) as Gold;
  const bytes = new Uint8Array(readFileSync(new URL(`editais/${gold.pdf}`, root)));
  const { text } = await extractText(bytes.slice(), { mergePages: true });
  const { text: pages } = await extractText(bytes.slice(), { mergePages: false });
  process.stdout.write(`${file.replace('.json', '')}: `);
  try {
    // READER=lines: leitura por linhas (a IA aponta, o código copia), com a cobertura medida.
    const r = READER === 'lines'
      ? await readNoticeByLines({ apiKey, model, pdfBase64: toBase64(bytes), pages, roleHint: gold.roleHint })
      : await readNotice({ apiKey, model, pdfBase64: toBase64(bytes), roleHint: gold.roleHint });
    const unc = 'uncovered' in r ? r.uncovered : null;
    const cost = costUsd(r.usage, PRICE);
    totalCost += cost;
    const s = score(r.data, gold.expected, text);
    const warnings = checkNotice(r.data, text, new Date(2000, 0, 1));
    const pass = s.fieldScore >= THRESHOLDS.fields && s.subjectRecall >= THRESHOLDS.subjectRecall && s.subjectPrecision >= THRESHOLDS.subjectPrecision
      && s.questionAccuracy >= THRESHOLDS.questionAccuracy && s.hallucination <= THRESHOLDS.hallucination;
    console.log(`${pass ? 'OK' : 'FALHOU'} · campos ${Math.round(s.fieldScore * 100)}% · matérias ${Math.round(s.subjectRecall * 100)}%/${Math.round(s.subjectPrecision * 100)}% · questões ${Math.round(s.questionAccuracy * 100)}% · tópicos ${s.topics} (${(s.hallucination * 100).toFixed(1)}% fora do PDF) · ${Math.round(r.latencyMs / 1000)}s · US$ ${cost.toFixed(4)}`);
    for (const [k, v] of Object.entries(s.fields)) if (!v) console.log(`   ✗ ${k}: veio ${JSON.stringify(k === 'blocks' ? r.data.blocks.map((b) => b.questions) : k === 'essay' ? r.data.stages.map((x) => x.kind) : (r.data as Record<string, unknown>)[k === 'role' ? 'role' : k])}`);
    for (const k of ['missingSubjects', 'extraSubjects', 'forbiddenSubjects', 'wrongQuestions', 'topicsNotFound'] as const)
      if (s[k].length) console.log(`   ✗ ${k}: ${s[k].join(' | ')}`);
    const raw = r.raw as { fill?: unknown[]; summarized?: string[] };
    console.log(`   tópicos por matéria: ${r.data.subjects.map((x) => x.topics.length).join(', ')} · maior tópico ${Math.max(0, ...r.data.subjects.flatMap((x) => x.topics.map((t) => t.text.length)))} car.${raw.fill ? ` · passada extra: ${raw.fill.length}` : ''}${raw.summarized ? ` · resumidas: ${raw.summarized.join(', ')}` : ''}`);
    if (unc) console.log(`   cobertura: ${unc.length} linha(s) do conteúdo programático fora de toda matéria${unc.length ? `: ${unc.slice(0, 4).map((l) => `p${l.page} "${l.text.slice(0, 50)}"`).join(' | ')}` : ''}`);
    report.push({ file, pass, model, promptVersion: NOTICE_PROMPT_VERSION, usage: r.usage, costUsd: cost, latencyMs: r.latencyMs, score: s, warnings, extraction: r.data });
  } catch (e) {
    console.log(`ERRO · ${(e as Error).message}`);
    report.push({ file, pass: false, error: (e as Error).message });
  }
}
mkdirSync(new URL('results/', root), { recursive: true });
const out = new URL(`results/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${model}-${NOTICE_PROMPT_VERSION}${READER ? '-' + READER : ''}.json`, root);
writeFileSync(out, JSON.stringify({ model, promptVersion: NOTICE_PROMPT_VERSION, thresholds: THRESHOLDS, totalCostUsd: totalCost, report }, null, 2));
const passed = report.filter((r) => r.pass).length;
console.log(`\n${passed}/${report.length} editais aprovados · custo total US$ ${totalCost.toFixed(4)} · relatório: evals/results/${out.pathname.split('/').pop()}`);
process.exit(passed === report.length ? 0 : 1);
