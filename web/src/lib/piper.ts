// Voz Faber no próprio aparelho: sem custo por uso e sem enviar o texto a ninguém.
export const localVoiceSupported = () => typeof Worker !== 'undefined' && !!navigator.storage?.getDirectory;

type Reply = { progress: number } | { id: number; blob: Blob } | { id: number; error: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (e: Error) => void }>();
const urls = new Map<string, Promise<string>>();
let onDownload: ((fraction: number) => void) | null = null;

function start() {
  const w = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<Reply>) => {
    const m = e.data;
    if ('progress' in m) { onDownload?.(m.progress); return; }
    const p = pending.get(m.id);
    pending.delete(m.id);
    if ('blob' in m) p?.resolve(m.blob); else p?.reject(new Error(m.error));
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Falha ao carregar a voz.'));
    pending.clear();
    worker = null;
  };
  return w;
}

// Áudio de um trecho. Guarda a promessa: o trecho adiantado não é gerado duas vezes.
export function localPartUrl(text: string, download: (fraction: number) => void) {
  onDownload = download;
  let url = urls.get(text);
  if (!url) {
    worker ??= start();
    const w = worker, id = ++nextId;
    url = new Promise<Blob>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, text });
    }).then((blob) => URL.createObjectURL(blob));
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
