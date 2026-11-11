// O Safari (iPhone, iPad e Mac) ainda não percorre ReadableStream com "for await", e o PDF.js 6 usa isso para extrair o
// texto das páginas (getTextContent): sem isto, enviar a apostila falhava com "undefined is not a function (near
// '...e of t...')". Acrescenta o iterador só quando o navegador não tem.
interface StreamProto {
  getReader(): ReadableStreamDefaultReader<unknown>;
  values?: (opts?: { preventCancel?: boolean }) => AsyncIterableIterator<unknown>;
  [Symbol.asyncIterator]?: unknown;
}

export function installStreamIterator(proto: StreamProto | undefined) {
  if (!proto || typeof proto[Symbol.asyncIterator] === 'function') return;
  const values = function (this: StreamProto, { preventCancel = false } = {}): AsyncIterableIterator<unknown> {
    const reader = this.getReader();
    return {
      async next() {
        const r = await reader.read();
        if (r.done) reader.releaseLock();
        return r as IteratorResult<unknown>;
      },
      // Saída antes do fim (break ou erro no laço): cancela a leitura, como no navegador que já tem o iterador.
      async return(value?: unknown) {
        if (!preventCancel) await reader.cancel(value).catch(() => {});
        reader.releaseLock();
        return { done: true, value };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  };
  if (typeof proto.values !== 'function') proto.values = values;
  proto[Symbol.asyncIterator] = values;
}

installStreamIterator(typeof ReadableStream === 'undefined' ? undefined : (ReadableStream.prototype as unknown as StreamProto));
