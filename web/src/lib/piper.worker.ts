// Gera a voz Faber (Piper) fora da thread da tela. O modelo é baixado uma vez e fica guardado no navegador (OPFS).
import { TtsSession } from '@mintplex-labs/piper-tts-web';

let session: Promise<TtsSession> | null = null;
// Uma geração por vez: o modelo não aceita chamadas simultâneas.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = e.data;
  queue = queue.then(async () => {
    try {
      session ??= TtsSession.create({
        voiceId: 'pt_BR-faber-medium',
        progress: (p) => { if (p.url.endsWith('.onnx') && p.total) self.postMessage({ progress: p.loaded / p.total }); },
      });
      self.postMessage({ id, blob: await (await session).predict(text) });
    } catch (err) {
      session = null;
      self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
