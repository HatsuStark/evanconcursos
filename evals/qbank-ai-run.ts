// Explicação, mnemônico e triagem de relevância sobre questões já guardadas no banco (não gasta créditos da Quest API).
// Uso: MODEL=claude-haiku-5-5 node --experimental-strip-types evals/qbank-ai-run.ts [n-questões=6]
// A relevância é comparada com os vereditos gravados em qbank_relevance (feitos pelo modelo em produção).
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { costUsd, generateJson, type GeminiUsage } from '../shared/ai/gemini.ts';
import { Explanation, explainPrompt, explanationJsonSchema } from '../shared/qbank/map.ts';
import { MnemonicChoice, mnemonicJsonSchema, mnemonicPrompt } from '../shared/qbank/mnemonic.ts';
import { RelevanceVerdicts, relevanceJsonSchema, relevancePrompt, rejectedIds } from '../shared/qbank/relevance.ts';
import { evalAi } from './ai.ts';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const { model, apiKey, price } = evalAi(env);
const url = new URL(readFileSync(new URL('supabase/.temp/pooler-url', root), 'utf8').trim()); url.password = encodeURIComponent(env.SUPABASE_DB_PASSWORD!);
const db = new pg.Client({ connectionString: url.href, ssl: { rejectUnauthorized: false } }); await db.connect();
const n = Number(process.argv[2] ?? 6);
const plain = (h: string) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
let usd = 0;
const spend = (u: GeminiUsage) => { usd += costUsd(u, price); };
type Q = { qid: string; payload: { enunciado: string; alternativas: { letra: string; texto: string }[]; textos?: string[]; prova?: { banca?: string } }; gabarito: string; assunto: string };

// Mesmas questões nos dois modelos: ordem fixa por qid.
const { rows: qs } = await db.query<Q>(`select qid, payload, gabarito, assunto from public.qbank_questions
  where qid not like 'ia-%' and gabarito is not null and gabarito <> '' order by md5(qid) limit $1`, [n]);

for (const q of qs) {
  const alternativas = q.payload.alternativas.map((a) => ({ letra: a.letra, texto: plain(a.texto) }));
  const enunciado = plain(q.payload.enunciado);
  const [ex, mn] = await Promise.all([
    generateJson({ apiKey, model, schema: Explanation, jsonSchema: explanationJsonSchema(), parts: [{ text: explainPrompt({ banca: q.payload.prova?.banca ?? '', enunciado, alternativas, gabarito: q.gabarito, textos: (q.payload.textos ?? []).map(plain), lei: [] }) }] }),
    generateJson({ apiKey, model, schema: MnemonicChoice, jsonSchema: mnemonicJsonSchema(), temperature: 0.3, parts: [{ text: mnemonicPrompt({ enunciado, alternativas, gabarito: q.gabarito, assunto: q.assunto, existing: [], law: [] }) }] }),
  ]);
  spend(ex.usage); spend(mn.usage);
  // A explicação precisa tratar como certa a alternativa do gabarito.
  const right = ex.data.alternativas.find((a) => a.letra.trim().toUpperCase().startsWith(q.gabarito.trim().toUpperCase()));
  const saysRight = !!right && /\b(correta|certa|verdadeira|gabarito|está certo|correto)\b/i.test(right.comentario) && !/\b(incorreta|errada|falsa)\b/i.test(right.comentario);
  console.log(`\n■ ${q.assunto} · gabarito ${q.gabarito} · explicação ${(ex.latencyMs / 1000).toFixed(0)}s ${saysRight ? 'coerente' : 'CONFERIR'}`);
  console.log(`  enunciado: ${enunciado.slice(0, 160)}`);
  console.log(`  resumo: ${ex.data.resumo.slice(0, 320)}`);
  console.log(`  alternativa ${q.gabarito}: ${right?.comentario.slice(0, 200) ?? '(faltou)'}`);
  console.log(`  dica: ${ex.data.dica.slice(0, 160)}`);
  console.log(`  mnemônico: ${mn.data.acao}${mn.data.acao === 'criar' ? ` · ${mn.data.conceito} → ${mn.data.mnemonico} (${mn.data.itens.map((i) => `${i.chave}=${i.significado}`).join(', ')})` : ''}`);
}

// Triagem: sessões com vereditos gravados, até 10 questões cada.
const { rows: sessions } = await db.query(`select r.session_id, s.title, s.keyword, ns.name subject, count(*) n
  from public.qbank_relevance r join public.study_sessions s on s.id = r.session_id join public.notice_subjects ns on ns.id = s.subject_id
  where r.qid not like 'ia-%' group by 1, 2, 3, 4 having count(*) >= 6 and count(*) filter (where not r.relevant) >= 1 order by md5(r.session_id::text) limit 3`);
let agree = 0, total = 0;
for (const s of sessions) {
  const { rows } = await db.query(`select r.qid, r.relevant, q.payload, q.assunto from public.qbank_relevance r join public.qbank_questions q on q.qid = r.qid
    where r.session_id = $1 order by r.relevant, md5(r.qid) limit 10`, [s.session_id]);
  const judged = rows.map((r) => ({ id: r.qid, assunto: r.assunto, enunciado: r.payload.enunciado, alternativas: r.payload.alternativas.map((a: { texto: string }) => a.texto) }));
  const r = await generateJson({ apiKey, model, schema: RelevanceVerdicts, jsonSchema: relevanceJsonSchema(), thinkingLevel: 'low', parts: [{ text: relevancePrompt({ subject: s.subject, title: s.title, keyword: s.keyword ?? '' }, judged) }] });
  spend(r.usage);
  const bad = rejectedIds(r.data, judged.map((j) => j.id));
  const same = rows.filter((x) => x.relevant === !bad.has(x.qid)).length;
  agree += same; total += rows.length;
  console.log(`\n■ triagem: ${s.subject} · ${s.title} · ${(r.latencyMs / 1000).toFixed(0)}s · concorda com o gravado em ${same}/${rows.length}`);
  for (const x of rows.filter((x) => x.relevant === bad.has(x.qid))) console.log(`  diverge ${x.qid}: gravado ${x.relevant ? 'relevante' : 'fora'}, agora ${bad.has(x.qid) ? `fora (${bad.get(x.qid)})` : 'relevante'} · ${x.assunto}`);
}
console.log(`\ntriagem: ${agree}/${total} iguais ao gravado · custo US$ ${usd.toFixed(4)}`);
await db.end();
