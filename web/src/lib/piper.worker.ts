// Gera a voz Cadu (Piper) fora da thread da tela. O modelo é baixado uma vez e fica guardado no navegador (OPFS).
import { HF_BASE, PATH_MAP, TtsSession } from '@mintplex-labs/piper-tts-web';
import { joinWav } from './wav.ts';

const VOICE_ID = 'pt_BR-cadu-medium', MODEL_FILE = `${VOICE_ID}.onnx`;
const MODEL_URL = import.meta.env.VITE_VOICE_MODEL_URL ?? `https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/cadu/medium/${MODEL_FILE}`;
// Locução mais pausada e com mais variação que o padrão do modelo (0,667 / 1 / 0,8), para lembrar um professor explicando.
const CONFIG = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'pt-br' },
  inference: { noise_scale: 0.8, length_scale: 1.12, noise_w: 1 },
  speaker_id_map: {},
};
const SENTENCE_PAUSE = 0.45;

// A biblioteca só busca vozes em um endereço fixo: aqui o modelo vem de MODEL_URL e a configuração, de CONFIG.
PATH_MAP[VOICE_ID] = MODEL_FILE;
const nativeFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = String(input);
  if (url === `${HF_BASE}/${MODEL_FILE}.json`) return new Response(JSON.stringify(CONFIG));
  if (url !== `${HF_BASE}/${MODEL_FILE}`) return nativeFetch(input, init);
  const res = await nativeFetch(MODEL_URL, init);
  // A biblioteca não confere o status e guardaria a página de erro como se fosse o modelo.
  if (!res.ok) throw new TypeError(`NetworkError: HTTP ${res.status}`);
  return res;
};

// A configuração guardada ficaria velha ao mudar CONFIG; a voz Faber, usada antes, só ocuparia espaço.
async function clearOldFiles() {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('piper', { create: true });
    for (const name of [`${MODEL_FILE}.json`, 'pt_BR-faber-medium.onnx', 'pt_BR-faber-medium.onnx.json']) await dir.removeEntry(name).catch(() => {});
  } catch { /* sem armazenamento: a biblioteca baixa de novo */ }
}

let session: Promise<TtsSession> | null = null;
// Uma geração por vez: o modelo não aceita chamadas simultâneas.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = e.data;
  queue = queue.then(async () => {
    try {
      session ??= clearOldFiles().then(() => TtsSession.create({
        voiceId: VOICE_ID,
        progress: (p) => { if (p.url.endsWith('.onnx') && p.total) self.postMessage({ progress: p.loaded / p.total }); },
      }));
      const voice = await session;
      // Frase por frase: o modelo sozinho quase não pausa entre elas.
      const audio: ArrayBuffer[] = [];
      for (const sentence of text.split(/(?<=[.:!?])\s+/).filter(Boolean)) audio.push(await (await voice.predict(sentence)).arrayBuffer());
      self.postMessage({ id, blob: new Blob([joinWav(audio, SENTENCE_PAUSE)], { type: 'audio/x-wav' }) });
    } catch (err) {
      self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
