// Voz Cadu no próprio aparelho: sem custo por uso e sem enviar o texto a ninguém.
export const localVoiceSupported = () => typeof Worker !== 'undefined' && !!navigator.storage?.getDirectory;

type Reply = { progress: number } | { id: number; blob: Blob } | { id: number; error: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (e: Error) => void }>();
const urls = new Map<string, Promise<string>>();
let onDownload: ((fraction: number) => void) | null = null;

const NETWORK_ERROR = /networkerror|failed to fetch|load failed/i;

// A biblioteca e o ONNX guardam a falha de inicialização: só um worker novo tenta baixar de novo.
function failAll(message: string) {
  worker?.terminate();
  worker = null;
  const waiting = [...pending.values()];
  pending.clear();
  for (const p of waiting) p.reject(new Error(message));
}

function start() {
  const w = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<Reply>) => {
    const m = e.data;
    if ('progress' in m) { onDownload?.(m.progress); return; }
    if ('error' in m) { failAll(m.error); return; }
    const p = pending.get(m.id);
    pending.delete(m.id);
    p?.resolve(m.blob);
  };
  w.onerror = (e) => failAll(e.message || 'Falha ao carregar a voz.');
  return w;
}

function generate(text: string) {
  worker ??= start();
  const w = worker, id = ++nextId;
  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, text });
  });
}

// Oscilação de rede passa sozinha: repete algumas vezes antes de mostrar o erro.
async function generateWithRetry(text: string, retries = 2): Promise<Blob> {
  try {
    return await generate(text);
  } catch (e) {
    if (!NETWORK_ERROR.test((e as Error).message)) throw e;
    if (!retries) throw new Error('falha de conexão ao baixar os arquivos da voz');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return generateWithRetry(text, retries - 1);
  }
}

// Áudio de um trecho. Guarda a promessa: o trecho adiantado não é gerado duas vezes.
export function localPartUrl(text: string, download: (fraction: number) => void) {
  onDownload = download;
  let url = urls.get(text);
  if (!url) {
    url = generateWithRetry(text).then((blob) => URL.createObjectURL(blob));
    urls.set(text, url);
    url.catch(() => urls.delete(text));
  }
  return url;
}

// Libera a memória: o áudio não fica salvo, gerar de novo é rápido e não custa nada.
export function clearLocalAudio() {
  for (const url of urls.values()) url.then((u) => URL.revokeObjectURL(u), () => {});
  urls.clear();
}
