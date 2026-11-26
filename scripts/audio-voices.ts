// Amostras das vozes candidatas da Revisão em áudio, com o mesmo estilo do pipeline, para escolher a masculina e a
// feminina ouvindo. Grava um MP3 por voz na pasta indicada e mede o tempo de cada geração.
// Uso: npx tsx scripts/audio-voices.ts <pasta> [voz1,voz2,...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSpeech, wavToMp3 } from '../shared/ai/tts.ts';
import { NARRATOR_STYLE, TTS_MODEL_DEFAULT } from '../shared/audio/config.ts';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const out = process.argv[2];
if (!out) { console.error('Informe a pasta de saída.'); process.exit(1); }
const voices = (process.argv[3] ?? 'Charon,Orus,Iapetus,Sadaltager,Kore,Sulafat,Achernar,Vindemiatrix').split(',');
const model = env.GEMINI_TTS_MODEL || TTS_MODEL_DEFAULT;

const text = 'Antes de continuarmos, tente lembrar: quais são os cinco elementos do ato administrativo? '
  + 'Pense um pouco. São eles: competência, finalidade, forma, motivo e objeto. Um jeito simples de guardar é a sigla COM FIFOMOB. '
  + 'Agora, atenção a uma confusão comum: motivo não é o mesmo que motivação. Motivo é a situação de fato e de direito que leva ao ato; '
  + 'motivação é a explicação desse motivo, escrita no próprio ato. Segundo o artigo cinquenta da Lei nove mil setecentos e oitenta e quatro, '
  + 'de mil novecentos e noventa e nove, os atos que neguem, limitem ou afetem direitos devem ser motivados.';

mkdirSync(out, { recursive: true });
for (const voice of voices) {
  const t = Date.now();
  try {
    const r = await generateSpeech({ apiKey: env.GEMINI_API_KEY!, model, voice, style: NARRATOR_STYLE, text });
    const { mp3, seconds } = await wavToMp3(r.wav);
    writeFileSync(join(out, `${voice}.mp3`), mp3);
    console.log(`${voice.padEnd(14)} ${seconds.toFixed(1)} s de áudio em ${((Date.now() - t) / 1000).toFixed(1)} s · ${r.usage.inputTokens} in / ${r.usage.outputTokens} out`);
  } catch (e) {
    console.log(`${voice.padEnd(14)} falhou: ${(e as Error).message.slice(0, 200)}`);
  }
}
