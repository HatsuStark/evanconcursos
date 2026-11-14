// Apaga do cache as questões inéditas da IA (qid "ia-…") feitas com versões antigas do prompt (lendo token e projeto do .env).
// Uso: node scripts/clear-ai-questions.mjs            → só mostra quanto há (nada é apagado)
//      node scripts/clear-ai-questions.mjs run        → apaga as de versões antigas que nenhum estudante usou
//      node scripts/clear-ai-questions.mjs run all    → o mesmo, incluindo as da versão atual (todas voltam a ser geradas)
// Ficam as que algum estudante já respondeu, anotou, comentou ou recebeu em simulado, e as do caderno de erros: fazem parte do
// histórico dele e continuam aparecendo só na revisão dele. Nenhuma delas é servida como questão nova (fromCache as ignora).
// Junto saem os vereditos de triagem (qbank_relevance) das questões apagadas.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const missing = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Preencha no .env: ${missing.join(', ')}`);
  process.exit(1);
}
// A versão atual vem do código, para o script não ficar para trás quando o prompt mudar.
const VERSION = /GENERATED_PROMPT_VERSION = '([a-z0-9-]+)'/.exec(readFileSync(new URL('../shared/qbank/generated.ts', import.meta.url), 'utf8'))?.[1];
if (!VERSION) throw new Error('Versão do prompt não encontrada em shared/qbank/generated.ts.');
const run = process.argv[2] === 'run', all = process.argv[3] === 'all';

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` }, body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${body.message ?? body.msg ?? body.error ?? 'falha na chamada'}`);
  return body;
}

// Em uso: respondida, no caderno de erros, anotada, comentada ou em simulado (respostas e lista de questões).
const USED = `(
  select qid from public.question_attempts where qid like 'ia-%'
  union select qid from public.error_book where qid like 'ia-%'
  union select qid from public.question_notes where qid like 'ia-%'
  union select qid from public.question_comments where qid like 'ia-%'
  union select qid from public.simulado_answers where qid like 'ia-%'
  union select x->>'qid' from public.simulados s, jsonb_array_elements(s.questions) x where x->>'qid' like 'ia-%'
)`;
const OLD = `coalesce(payload->>'ia_versao', '') <> '${VERSION}'`;
const TARGET = `qid like 'ia-%' and ${all ? 'true' : OLD} and qid not in ${USED}`;

const [c] = await sql(`select
  (select count(*) from public.qbank_questions where qid like 'ia-%')::int as total,
  (select count(*) from public.qbank_questions where qid like 'ia-%' and ${OLD})::int as antigas,
  (select count(*) from public.qbank_questions where qid like 'ia-%' and qid in ${USED})::int as em_uso,
  (select count(*) from public.qbank_questions where ${TARGET})::int as a_apagar`);
const versions = await sql(`select coalesce(payload->>'ia_versao', '(sem versão)') as versao, count(*)::int as n from public.qbank_questions where qid like 'ia-%' group by 1 order by 1`);
console.log(`Versão atual do prompt: ${VERSION}`);
console.log(`Questões da IA no cache: ${c.total} (${versions.map((v) => `${v.versao}: ${v.n}`).join(' · ') || 'nenhuma'})`);
console.log(`De versões antigas: ${c.antigas} · em uso por estudantes (ficam): ${c.em_uso} · a apagar${all ? ' (todas as versões)' : ''}: ${c.a_apagar}`);
if (!run) {
  console.log('Nada foi apagado. Para apagar: node scripts/clear-ai-questions.mjs run   (ou "run all" para incluir a versão atual)');
  process.exit(0);
}
await sql(`begin;
  delete from public.qbank_relevance where qid in (select qid from public.qbank_questions where ${TARGET});
  delete from public.qbank_questions where ${TARGET};
commit;`);
const [after] = await sql(`select count(*)::int as total from public.qbank_questions where qid like 'ia-%'`);
console.log(`Apagadas: ${c.total - after.total}. Restam ${after.total} questões da IA no cache.`);
