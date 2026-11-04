// Lista de cargos do edital e leitura do cargo escolhido nela (o fluxo da tela Novo concurso).
// Uso: node --experimental-strip-types evals/roles-run.ts <edital.pdf> "<trecho do nome do cargo>"
// Chama o Gemini de verdade. Mostra a lista, o cargo lido, as atribuições e os tópicos de cada disciplina específica.
import { readFileSync } from 'node:fs';
import { extractText } from 'unpdf';
import { costUsd, generateJson, toBase64 } from '../shared/ai/gemini.ts';
import { NOTICE_THINKING, NoticeExtraction, noticeJsonSchema, noticePrompt, NoticeRoles, noticeRolesJsonSchema, normalizeText, rolesPrompt, uniqueRoles } from '../shared/ai/notice.ts';

const [pdfPath, wanted = ''] = process.argv.slice(2);
if (!pdfPath) throw new Error('Informe o PDF do edital.');
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = env.GEMINI_MODEL || 'gemini-3.8-flash', apiKey = env.GEMINI_API_KEY!;
const PRICE = { inputPerMtokUsd: 0.75, outputPerMtokUsd: 3.75 };

const bytes = new Uint8Array(readFileSync(pdfPath));
const text = (await extractText(bytes.slice(), { mergePages: true })).text;
const doc = text.trim().length > 2000 ? { text: `EDITAL:\n${text}` } : { inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } };
const lr = await generateJson({ apiKey, model, schema: NoticeRoles, jsonSchema: noticeRolesJsonSchema(), temperature: 0, timeoutMs: 60_000, thinkingLevel: 'low', parts: [doc, { text: rolesPrompt() }] });
const roles = uniqueRoles(lr.data.roles);
console.log(`Cargos (${roles.length}) em ${(lr.latencyMs / 1000).toFixed(1)} s, US$ ${costUsd(lr.usage, PRICE).toFixed(4)}:`);
for (const r of roles) console.log(`  ${r.code.padEnd(5)} ${r.name} ${r.educationLevel ? `(${r.educationLevel})` : ''}`);

const chosen = roles.find((r) => normalizeText(r.name) === normalizeText(wanted)) ?? roles.find((r) => normalizeText(r.name).includes(normalizeText(wanted)));
if (!wanted || !chosen) process.exit(0);
const others = roles.filter((r) => r !== chosen).map((r) => r.name);
console.log(`\nLendo "${chosen.name}" (${chosen.code})…`);
const r = await generateJson({ apiKey, model, schema: NoticeExtraction, jsonSchema: noticeJsonSchema(), temperature: 0.2, timeoutMs: 130_000, thinkingLevel: NOTICE_THINKING,
  parts: [{ inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } }, { text: noticePrompt(chosen.name, false, { code: chosen.code, otherRoles: others }) }] });
const e = r.data;
console.log(`role: ${e.role} | ${(r.latencyMs / 1000).toFixed(0)} s, US$ ${costUsd(r.usage, PRICE).toFixed(4)}`);
console.log(`roleDuties: ${e.roleDuties}`);
for (const s of e.subjects) console.log(`\n[${s.core ? 'específica' : 'geral'}] ${s.name} (${s.questions}): ${s.topics.map((t) => t.text).join(' | ')}`);
