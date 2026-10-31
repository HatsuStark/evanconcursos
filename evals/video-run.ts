// Avaliação da busca de vídeos com a API real: mostra a busca, os vídeos escolhidos e o que ficou de fora.
// Gasta 101 unidades da cota diária por execução.
// Uso: node --experimental-strip-types evals/video-run.ts "Direito Penal" "Peculato: tipos e penas"
import { readFileSync } from 'node:fs';
import { rankVideos, searchYoutube, videoQuery } from '../shared/domain/videos.ts';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.YOUTUBE_API_KEY) throw Error('Preencha YOUTUBE_API_KEY no .env');
const [subject = 'Direito Penal', title = 'Peculato: tipos e penas'] = process.argv.slice(2);

const { q, terms } = videoQuery({ subject, title, topics: [] });
console.log(`Busca: ${q}\nTermos exigidos: ${terms.join(', ')}\n`);
const candidates = await searchYoutube(env.YOUTUBE_API_KEY, q);
const picked = rankVideos(candidates, terms);
for (const v of picked) console.log(`✓ ${Math.round(v.durationSec / 60)} min · ${v.views} views · ${v.publishedAt.slice(0, 4)} · ${v.channel} · ${v.title}`);
console.log('');
const ids = new Set(picked.map((v) => v.id));
for (const v of candidates.filter((c) => !ids.has(c.id))) console.log(`  ${Math.round(v.durationSec / 60)} min · ${v.channel} · ${v.title}`);
