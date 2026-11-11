import { describe, expect, it } from 'vitest';
import { installStreamIterator } from './stream-iterator.ts';

// Stream como no Safari: tem getReader, mas não o iterador assíncrono.
class SafariStream {
  inner: ReadableStream<number>;
  constructor(items: number[]) {
    this.inner = new ReadableStream({ start(c) { for (const i of items) c.enqueue(i); c.close(); } });
  }
  getReader() { return this.inner.getReader(); }
}

describe('iterador de ReadableStream (Safari)', () => {
  installStreamIterator(SafariStream.prototype as never);

  it('for await percorre o stream inteiro', async () => {
    const got: number[] = [];
    for await (const v of new SafariStream([1, 2, 3]) as unknown as AsyncIterable<number>) got.push(v);
    expect(got).toEqual([1, 2, 3]);
  });

  it('break no meio cancela a leitura e solta o stream', async () => {
    const s = new SafariStream([1, 2, 3]);
    for await (const v of s as unknown as AsyncIterable<number>) if (v === 1) break;
    expect(s.inner.locked).toBe(false);
  });

  it('não troca o iterador de quem já tem', () => {
    const own = async function* () { /* nativo */ };
    const proto = { getReader: () => { throw new Error('não usar'); }, [Symbol.asyncIterator]: own };
    installStreamIterator(proto as never);
    expect(proto[Symbol.asyncIterator]).toBe(own);
  });
});
