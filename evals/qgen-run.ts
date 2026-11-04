// Questões inéditas da IA para um tema, como a função questions gera (prompt, receita do tipo de tema e embaralhamento).
// Uso: node --experimental-strip-types evals/qgen-run.ts "Matéria" "Título da sessão" ["Cargo"] ["Atribuições"] ["Outro cargo;Outro"]
// Chama o Gemini de verdade (alguns centavos). Sem apostila: mostra o pior caso, só com o tema e as atribuições.
import { readFileSync } from 'node:fs';
import { costUsd, generateJson } from '../shared/ai/gemini.ts';
import { arrangeBatch, GeneratedQuestions, generatedJsonSchema, generatedPrompt, themeKind } from '../shared/qbank/generated.ts';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const [subject = 'Matemática', title = 'Regra de três simples', cargo = '', duties = '', others = ''] = process.argv.slice(2);
const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
console.log(`Tipo do tema: ${themeKind({ subject, title, law: [] })}`);
const r = await generateJson({ apiKey: env.GEMINI_API_KEY!, model, schema: GeneratedQuestions, jsonSchema: generatedJsonSchema(), temperature: 0.5, timeoutMs: 90_000,
  parts: [{ text: generatedPrompt({ banca: 'NOSSO RUMO', cargo, subject, title, keyword: '', law: [], format: 'multipla escolha', n: 4, avoid: [], duties, otherRoles: others.split(';').filter(Boolean) }) }] });
const out = arrangeBatch(r.data.questoes);
console.log(`${r.data.questoes.length} geradas, ${out.length} mantidas · ${(r.latencyMs / 1000).toFixed(0)} s · US$ ${costUsd(r.usage, { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 }).toFixed(4)}\n`);
for (const q of out) console.log(`${q.enunciado}\n${q.alternativas.map((a, i) => `  ${String.fromCharCode(65 + i)}) ${a}`).join('\n')}\n  Gabarito: ${q.gabarito} · ${q.fundamento}\n`);
