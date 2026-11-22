// Avaliação do certo ou errado da revisão da semana (tf-v1) em revisões curtas reais do banco: quantas sobram depois da
// limpeza, proporção de erradas, custo e as assertivas, para conferir à mão se só usam fatos da revisão.
// Uso: node --experimental-strip-types evals/tf-run.ts [n-revisões=3]
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { costUsd, generateJson } from '../shared/ai/gemini.ts';
import { cleanTrueFalse, TrueFalse, trueFalseJsonSchema, trueFalsePrompt, type TfSheet } from '../shared/ai/true-false.ts';
import { evalAi } from './ai.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const n = Number(process.argv[2] ?? 3);
const { model, apiKey, price } = evalAi(env);

const { rows } = await db.query(`select subject_name, title, banca, content from public.study_guides where depth = 'revisao' and jsonb_array_length(coalesce(content->'pegadinhas', '[]')) > 0 order by random() limit $1`, [n]);
let total = 0;
for (const g of rows) {
  const t0 = Date.now();
  const r = await generateJson({ apiKey, model, schema: TrueFalse, jsonSchema: trueFalseJsonSchema(), temperature: 0.4, thinkingLevel: 'low',
    parts: [{ text: trueFalsePrompt({ subject: g.subject_name, title: g.title, banca: g.banca ?? '' }, g.content as TfSheet) }] });
  const items = cleanTrueFalse(r.data.itens), cost = costUsd(r.usage, price);
  total += cost;
  console.log(`\n### ${g.subject_name} — ${g.title}`);
  console.log(`${r.data.itens.length} → ${items.length} após limpeza · ${items.filter((x) => !x.certo).length} erradas · ${((Date.now() - t0) / 1000).toFixed(1)} s · US$ ${cost.toFixed(4)}`);
  console.log('pegadinhas da revisão:', (g.content.pegadinhas ?? []).join(' | '));
  for (const it of items) console.log(`[${it.certo ? 'C' : 'E'}] ${it.afirmacao}\n     ↳ ${it.explicacao}`);
}
console.log(`\ncusto total: US$ ${total.toFixed(4)}`);
await db.end();
