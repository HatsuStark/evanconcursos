// Gera a trilha lo-fi da revisão em áudio com o Lyria (uma vez; o arquivo aprovado vai para web/public/audio).
// Uso: npx tsx scripts/audio-music.ts <arquivo-de-saída-sem-extensão> [modelo]
//      npx tsx scripts/audio-music.ts --encode <trilha.wav> <saída.mp3>   (MP3 estéreo de 24 kHz, a taxa da montagem)
// Custo: cerca de US$ 0,08 por faixa (preço da doc em 2026-11-26). A faixa sai com marca d'água SynthID.
import { readFileSync, writeFileSync } from 'node:fs';
import { createMp3Encoder } from 'wasm-media-encoders';
import { readStereoWav } from '../shared/audio/wav.ts';

if (process.argv[2] === '--encode') {
  const [L, R] = readStereoWav(readFileSync(process.argv[3]!), 24000);
  const enc = await createMp3Encoder();
  enc.configure({ sampleRate: 24000, channels: 2, bitrate: 96 });
  const mp3 = Buffer.concat([enc.encode([L, R]).slice(), enc.finalize().slice()]);
  writeFileSync(process.argv[4]!, mp3);
  console.log(`${process.argv[4]}: ${(mp3.length / 1e6).toFixed(2)} MB, ${(L.length / 24000).toFixed(1)} s`);
  process.exit(0);
}

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const out = process.argv[2];
if (!out) { console.error('Informe o arquivo de saída.'); process.exit(1); }
const model = process.argv[3] ?? 'lyria-3-pro-preview';

const prompt = 'An original, calm instrumental piece in F major at 72 BPM, about 2 minutes long, made to sit quietly under a spoken lesson. '
  + 'Harmony: a slow cycle of Fmaj9, Em7, Dm9 and Bbmaj7, one chord per bar. Instruments: muted warm electric piano playing soft sustained chords, '
  + 'a round fingered bass on the root notes, relaxed laid-back drums with a soft kick, a quiet rim click and gentle shaker, a faint tape hiss. '
  + 'Even dynamics from start to end: no melody line, no solos, no builds, no drops, no breaks, nothing bright or sharp. No vocals, no spoken words. '
  + 'It should loop seamlessly.';

const t = Date.now();
const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY!, 'Api-Revision': '2026-05-20' },
  body: JSON.stringify({ model, input: prompt, response_format: { type: 'audio', mime_type: 'audio/wav' } }),
});
if (!res.ok) { console.error(`Erro ${res.status}: ${(await res.text()).slice(0, 600)}`); process.exit(1); }
const data = await res.json() as { steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string }[] }[]; output_audio?: { data?: string; mime_type?: string } };
const audio = data.output_audio ?? data.steps?.filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).find((c) => c.type === 'audio');
if (!audio?.data) { console.error('Sem áudio na resposta:', JSON.stringify(data).slice(0, 600)); process.exit(1); }
const bytes = Buffer.from(audio.data, 'base64');
const isWav = bytes.subarray(0, 4).toString('ascii') === 'RIFF';
const file = `${out}.${isWav ? 'wav' : 'mp3'}`;
writeFileSync(file, bytes);
console.log(`${file}: ${(bytes.length / 1e6).toFixed(1)} MB (${audio.mime_type ?? (isWav ? 'audio/wav' : 'audio/mpeg')}) em ${((Date.now() - t) / 1000).toFixed(0)} s`);
