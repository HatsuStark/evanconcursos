// Teste do mapeamento de apostila com a IA real, usando um PDF local e sessões reais do cronograma.
// Uso: node --experimental-strip-types evals/material-run.ts <arquivo.pdf> [n-sessões=12]
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { extractText } from 'unpdf';
import { costUsd, generateJson } from '../shared/ai/gemini.ts';
import { hasText, MaterialMap, materialJsonSchema, materialPrompt, pageIndex, validateMap } from '../shared/ai/material.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const { rows: sessions } = await db.query(`select ss.title, s.name subject from public.study_sessions ss join public.notice_subjects s on s.id = ss.subject_id join public.study_plans p on p.active_version_id = ss.plan_version_id where s.name ~* $2 order by s.name, ss.position limit $1`, [Number(process.argv[3] ?? 12), process.argv[4] ?? "."]);
await db.end();
const { totalPages, text } = await extractText(new Uint8Array(readFileSync(process.argv[2]!)), { mergePages: false });
console.log(`${totalPages} páginas · tem texto: ${hasText(text as string[])}`);
const coded = sessions.map((s, i) => ({ code: `S${i + 1}`, subject: s.subject, title: s.title }));
const r = await generateJson({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL || 'gemini-3.8-flash', schema: MaterialMap, jsonSchema: materialJsonSchema(), temperature: 0.1,
  parts: [{ text: materialPrompt(coded, pageIndex(text as string[]), totalPages) }] });
const v = validateMap(r.data, new Set(coded.map((c) => c.code)), totalPages);
console.log(`${v.length}/${coded.length} sessões mapeadas · ${Math.round(r.latencyMs / 1000)}s · US$ ${costUsd(r.usage, { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 }).toFixed(4)}`);
for (const m of v) {
  const c = coded.find((x) => x.code === m.code)!;
  console.log(`  ${c.subject} · ${c.title.slice(0, 60)} → p. ${m.from}–${m.to}: "${(text as string[])[m.from - 1]!.replace(/\s+/g, ' ').slice(0, 90)}"`);
}
