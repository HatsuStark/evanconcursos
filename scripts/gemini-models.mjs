// Lista os modelos do Gemini disponíveis para a sua chave que aceitam generateContent.
// Uso: node scripts/gemini-models.mjs   (lê GEMINI_API_KEY do .env; a chave não é exibida)
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY vazio no .env.');
  process.exit(1);
}

const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
  headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
});
if (!res.ok) {
  console.error(`Erro ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const { models = [] } = await res.json();
for (const m of models.filter((m) => m.supportedGenerationMethods?.includes('generateContent'))) {
  console.log(`${m.name.replace('models/', '').padEnd(40)} ${m.displayName ?? ''}`);
}
console.log(`\nModelo configurado no .env: ${env.GEMINI_MODEL || '(vazio)'}`);
