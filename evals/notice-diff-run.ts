// Mostra a comparação entre dois editais reais do mesmo concurso, para conferir a qualidade à mão. Sem IA na comparação;
// o edital sem leitura guardada é lido uma vez com o Gemini (custo real) e guardado em evals/results/.
// Uso: node --experimental-strip-types evals/notice-diff-run.ts <antigo.pdf> <novo.pdf> [papel]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { costUsd, generateJson, toBase64 } from '../shared/ai/gemini.ts';
import { extractWithRetry, NOTICE_THINKING, NoticeExtraction, noticeJsonSchema, noticePrompt } from '../shared/ai/notice.ts';
import { diffNotices, type DiffNotice } from '../shared/domain/notice-diff.ts';

const root = new URL('./', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('../.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

async function read(pdf: string, role: string): Promise<NoticeExtraction> {
  mkdirSync(new URL('results/', root), { recursive: true });
  const cache = new URL(`results/diff-${basename(pdf, '.pdf')}.json`, root);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const bytes = new Uint8Array(readFileSync(pdf));
  const r = await extractWithRetry(({ temperature, retry, timeoutMs }) => generateJson({
    apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL || 'gemini-3.8-flash', schema: NoticeExtraction, jsonSchema: noticeJsonSchema(), temperature, timeoutMs, thinkingLevel: NOTICE_THINKING,
    parts: [{ inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } }, { text: noticePrompt(role, retry) }],
  }));
  console.log(`leitura de ${basename(pdf)}: US$ ${costUsd(r.usage, { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 }).toFixed(4)}`);
  writeFileSync(cache, JSON.stringify(r.data, null, 1));
  return r.data;
}
const side = (e: NoticeExtraction, tag: string): DiffNotice => ({
  organization: e.organization, role: e.role, board: e.board, examDate: e.examDate,
  subjects: e.subjects.map((s, i) => ({ name: s.name, topics: s.topics.map((t, k) => ({ id: `${tag}-${i}-${k}`, text: t.text })) })),
});

const [oldPdf, newPdf, role = ''] = process.argv.slice(2);
const a = await read(oldPdf!, role), b = await read(newPdf!, role);
const d = diffNotices(side(a, 'a'), side(b, 'b'));
const cut = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n)}…` : s);
console.log(`\n${a.role} (${a.board}, ${a.examDate}) → ${b.role} (${b.board}, ${b.examDate})`);
console.log(`mudou: banca ${d.boardChanged} · cargo ${d.roleChanged} · órgão ${d.organizationChanged}`);
console.log(`matérias novas: ${d.addedSubjects.join(' | ') || '—'}\nmatérias que saíram: ${d.removedSubjects.join(' | ') || '—'}`);
console.log(`tópicos: antigo ${a.subjects.flatMap((s) => s.topics).length} → novo ${d.topics.length} · iguais ${d.counts.same} · parecidos ${d.counts.similar} · novos ${d.counts.new} · saíram ${d.counts.removed}`);
console.log('\n== PARECIDOS (novo ← antigo)');
for (const t of d.topics.filter((x) => x.status === 'similar')) console.log(`[${cut(t.subject, 22)}] ${cut(t.text)}${t.missingNumbers.length ? `\n     números ausentes no antigo: ${t.missingNumbers.join(', ')}` : ''}\n     ← ${cut(t.matchText)}`);
console.log('\n== NOVOS');
for (const t of d.topics.filter((x) => x.status === 'new')) console.log(`[${cut(t.subject, 22)}] ${cut(t.text)}`);
console.log('\n== SAÍRAM');
for (const t of d.removed) console.log(`[${cut(t.subject, 22)}] ${cut(t.text)}`);
