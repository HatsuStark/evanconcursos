// Avaliação da parte prática da Aula guiada (aplicação, desafio, fixação e verificação final) com o prompt atual, sobre o
// roteiro de aulas reais já guardadas (tutor_lessons), sem refazer o roteiro. Mostra o que passou na limpeza e o desafio e
// a verificação final por extenso, para conferir à mão se ficaram no nível das questões difíceis da banca.
// Uso: node --experimental-strip-types evals/tutor-run.ts [n-aulas=1]   (TITLE_LIKE=%crase% filtra o tema)
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { costUsd, generateJson } from '../shared/ai/gemini.ts';
import { cleanQuestions, TUTOR_PROMPT_VERSION, TutorPractice, tutorPracticeJsonSchema, tutorQuestionsPrompt, type TutorInput } from '../shared/ai/tutor.ts';
import type { TutorQuestion } from '../shared/domain/tutor.ts';
import { evalAi } from './ai.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const n = Number(process.argv[2] ?? 1);
const { model, apiKey, price } = evalAi(env);
console.log(`prompt: ${TUTOR_PROMPT_VERSION}`);

// Aulas sem lei (os artigos não ficam guardados com a aula, e a conferência das citações precisaria deles).
const { rows } = await db.query(`select title, subject_key, banca, content from public.tutor_lessons where cardinality(sources) = 0 and ($2::text is null or title ilike $2)
  order by created_at desc limit $1`, [n, process.env.TITLE_LIKE ?? null]);
let total = 0;
for (const l of rows) {
  const input: TutorInput = { banca: l.banca, cargo: '', subject: l.subject_key, title: l.title, topics: [], law: [], format: '' };
  const roteiro = { titulo: l.content.titulo, conceitos: l.content.conceitos };
  const t0 = Date.now();
  const r = await generateJson({ apiKey, model, schema: TutorPractice, jsonSchema: tutorPracticeJsonSchema(), temperature: 0.4, thinkingLevel: 'low', parts: [{ text: tutorQuestionsPrompt(input, roteiro, 'pratica') }] });
  const { kept, dropped } = cleanQuestions(r.data.questoes as TutorQuestion[], { provided: [], subject: l.subject_key, concepts: roteiro.conceitos });
  const cost = costUsd(r.usage, price); total += cost;
  const by = (e: string) => kept.filter((q) => q.etapa === e);
  console.log(`\n### ${l.subject_key} — ${l.title} (banca ${l.banca || '—'})`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s · US$ ${cost.toFixed(4)} · aplicação ${by('aplicacao').length}, desafio ${by('desafio').length}, fixação ${by('fixacao').length}, final ${by('final').length} · descartadas: ${dropped.map((d) => `${d.id} (${d.motivo})`).join('; ') || 'nenhuma'}`);
  for (const q of [...by('desafio'), ...by('final')]) {
    console.log(`\n[${q.id} · ${q.etapa} · ${q.formato} · ${q.estilo}] ${q.enunciado}`);
    q.alternativas.forEach((a, i) => console.log(`   ${String.fromCharCode(65 + i)}) ${a}`));
    console.log(`   gabarito: ${q.gabarito}${q.distratores?.length ? ` · distratores: ${q.distratores.join('; ')}` : ''}`);
  }
}
console.log(`\ncusto total: US$ ${total.toFixed(4)}`);
await db.end();
