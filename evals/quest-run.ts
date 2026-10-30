// Avaliação da Quest API (banco de questões) para um edital: cobertura por matéria/assunto da banca,
// correspondência de nomes e qualidade de amostras. Gasta poucos créditos (contagens com per_page=1).
// Uso: node --experimental-strip-types evals/quest-run.ts [filtro-do-edital]
import { readdirSync, readFileSync } from 'node:fs';
import { NoticeExtraction, normalizeText } from '../shared/ai/notice.ts';
import { topicKeyword } from '../shared/domain/scheduler.ts';

const root = new URL('./', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('../.env', root), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.QUEST_API_KEY) throw Error('Preencha QUEST_API_KEY no .env');
const API = 'https://api.quest.api.br/v2';
let spent = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Respeita o limite de requisições: ~1 chamada/s e nova tentativa com espera no 429.
async function get<T>(path: string, params: Record<string, string | number | boolean> = {}, attempt = 1): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  await sleep(1100);
  const res = await fetch(url, { headers: { 'X-API-Key': env.QUEST_API_KEY! } });
  if (res.status === 429 && attempt < 4) { await sleep(15000 * attempt); return get<T>(path, params, attempt + 1); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(`${path} → ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return (body as { data: T }).data;
}
type Page<T> = { items: T[]; total?: number };
interface Question {
  id: string; enunciado: string; dificuldade: number; tipo: string; anulada: boolean; gabarito: unknown;
  alternativas: { letra: string; texto: string }[]; provas: { orgao: string; cargo: string; ano: number; banca: string }[];
  classificacao: { materia: string; assunto: string }; anexos: string[];
}
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
async function count(params: Record<string, string | number | boolean>) {
  const r = await get<Page<Question>>('/questoes', { ...params, per_page: 1, include_total: true });
  if (r.items.length) spent += 3;
  return r.total ?? r.items.length;
}

// Edital: a extração mais recente da avaliação de editais.
const files = readdirSync(new URL('results/', root)).filter((f) => f.includes('notice-v2')).sort().reverse();
const filter = process.argv[2] ?? 'escrevente';
let extraction: NoticeExtraction | null = null;
for (const f of files) {
  const r = JSON.parse(readFileSync(new URL(`results/${f}`, root), 'utf8')).report.find((x: { file: string; extraction?: unknown }) => x.file.includes(filter) && x.extraction);
  if (r) { extraction = NoticeExtraction.parse(r.extraction); break; }
}
if (!extraction) throw Error('Edital não encontrado nos resultados da avaliação.');

// A rota de cota da documentação pode não existir em todas as versões; é só informativa.
console.log('cota:', await get('/quota').then((q) => JSON.stringify(q).slice(0, 300), (e: Error) => 'indisponível (' + e.message.slice(0, 60) + ')'));
const bancas = (await get<Page<string>>('/filtros/bancas', { q: extraction.board.split(/[\s/-]/)[0]! })).items;
const banca = bancas.find((b) => normalizeText(b).includes(normalizeText(extraction!.board))) ?? bancas[0];
console.log(`\n${extraction.role} · banca no edital "${extraction.board}" → na API: ${JSON.stringify(bancas.slice(0, 5))} (usando "${banca}")`);
if (!banca) process.exit(1);
console.log(`questões da banca: ${await count({ banca })}`);
for (const orgao of ['TJ-SP', 'TJSP', 'TJ SP', 'Tribunal de Justiça do Estado de São Paulo', 'Tribunal de Justiça']) console.log(`banca + órgão "${orgao}": ${await count({ banca, orgao })}`);
console.log(`banca + cargo "Escrevente": ${await count({ banca, cargo: 'Escrevente' })}`);

// Por matéria: nome correspondente na API, total na banca e cobertura de assuntos da sessão.
let withMateria = 0;
for (const s of extraction.subjects) {
  const q = s.name.replace(/^(noções|nocoes) (de|do|da|dos|das) /i, '').replace(/^língua /i, '');
  const materias = (await get<{ items: string[] }>('/filtros/materias', { q, limit: 8 })).items;
  const materia = materias.find((m) => normalizeText(m) === normalizeText(s.name)) ?? materias[0];
  if (!materia) { console.log(`\n✗ ${s.name}: nenhuma matéria correspondente (busca "${q}")`); continue; }
  withMateria++;
  const total = await count({ banca, materia });
  console.log(`\n${s.name} → "${materia}"${materias.length > 1 ? ` (outras: ${materias.slice(1, 4).join(' | ')})` : ''} · ${total} questões ${banca}`);
  // Assuntos: palavra-chave dos 3 primeiros tópicos do edital.
  for (const t of s.topics.slice(0, 3)) {
    const kw = topicKeyword(t.text.replace(/^[\d.\s-]+/, '')).split(/\s+/).slice(0, 3).join(' ');
    const assuntos = (await get<Page<string>>('/filtros/assuntos', { materia, q: kw, per_page: 5 })).items;
    const n = assuntos[0] ? await count({ banca, materia, assunto: assuntos[0] }) : 0;
    console.log(`   tópico "${kw}" → ${assuntos.length ? `"${assuntos[0]}" (${n} na banca)${assuntos.length > 1 ? ` · outros: ${assuntos.slice(1, 3).join(' | ')}` : ''}` : 'sem assunto correspondente'}`);
  }
}

// Amostra com gabarito para conferir campos e qualidade.
const sample = await get<Page<Question>>('/questoes', { banca, materia: (await get<{ items: string[] }>('/filtros/materias', { q: 'Direito Processual Penal', limit: 1 })).items[0] ?? '', per_page: 2, include_gabarito: true, include_total: false });
spent += sample.items.length * 6;
for (const q of sample.items) {
  console.log(`\n--- ${q.id} · ${q.classificacao.materia} / ${q.classificacao.assunto} · ${q.provas.map((p) => `${p.banca} ${p.ano} ${p.orgao} – ${p.cargo}`).join('; ')} · dificuldade ${q.dificuldade} · ${q.tipo}${q.anulada ? ' · ANULADA' : ''}`);
  console.log(plain(q.enunciado).slice(0, 400));
  for (const a of q.alternativas) console.log(`  ${a.letra}) ${plain(a.texto).slice(0, 140)}`);
  console.log(`  gabarito: ${JSON.stringify(q.gabarito)} · anexos: ${q.anexos.length}`);
}
console.log(`\n${withMateria}/${extraction.subjects.length} matérias com correspondência · créditos gastos ≈ ${spent}`);
