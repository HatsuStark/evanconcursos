// Avaliação dos mnemônicos com questões reais (Quest API) e a IA: cria quando cabe, recusa quando forçado,
// reaproveita entre questões do mesmo assunto. Uso: node --experimental-strip-types evals/mnemonic-run.ts
import { readFileSync } from 'node:fs';
import { costUsd, generateJson } from '../shared/ai/gemini.ts';
import { QuestClient } from '../shared/qbank/client.ts';
import { MnemonicChoice, mnemonicJsonSchema, mnemonicPrompt, pickExisting } from '../shared/qbank/mnemonic.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const quest = new QuestClient(env.QUEST_API_KEY!);
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
let usd = 0;
const cases: [string, string, number][] = [
  ['Direito Administrativo', 'Formas de provimento', 2],        // lista memorizável: espera criar e depois reusar
  ['Língua Portuguesa', 'Interpretação de textos', 1],          // interpretação: espera "nenhum"
  ['Direito Processual Penal', 'Sujeitos do processo', 1],
];
for (const [materia, assunto, n] of cases) {
  const { items } = await quest.questoes({ banca: 'VUNESP', materia, assunto }, n);
  const existing: { id: string; concept: string; mnemonic: string }[] = [];
  for (const q of items) {
    const r = await generateJson({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL || 'gemini-3.8-flash', schema: MnemonicChoice, jsonSchema: mnemonicJsonSchema(), temperature: 0.3,
      parts: [{ text: mnemonicPrompt({ enunciado: plain(q.enunciado), alternativas: q.alternativas.map((a) => ({ letra: a.letra, texto: plain(a.texto) })), gabarito: String(q.gabarito), assunto, existing, law: [] }) }] });
    usd += costUsd(r.usage, { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 });
    const reused = pickExisting(r.data, existing.map((e) => e.id));
    console.log(`\n■ ${materia} / ${assunto} · ${plain(q.enunciado).slice(0, 110)}…\n  → ${r.data.acao}${reused ? ` (reuso válido de ${reused})` : ''}${r.data.acao !== 'nenhum' ? `: "${r.data.mnemonico}" — ${r.data.conceito}` : ''}`);
    if (r.data.acao !== 'nenhum') console.log(`    ${r.data.itens.map((i) => `${i.chave} = ${i.significado}`).join(' · ').slice(0, 300)}`);
    if (r.data.acao === 'criar') existing.push({ id: `m${existing.length + 1}`, concept: r.data.conceito, mnemonic: r.data.mnemonico });
  }
}
console.log(`\ncréditos ≈ ${quest.credits} · Gemini US$ ${usd.toFixed(4)}`);
