import { describe, expect, it } from 'vitest';
import { chunkEmbedText, embedTexts, queryEmbedText, toPgVector } from './embed.ts';

describe('vetores de significado', () => {
  it('texto da busca e do trecho', () => {
    expect(queryEmbedText({ subject: 'Informática', title: 'Mala direta', keyword: 'Writer', topics: ['Editores de texto'] })).toBe('Informática: Mala direta\nWriter\nEditores de texto');
    expect(queryEmbedText({ subject: 'Informática', title: 'Planilhas' })).toBe('Informática: Planilhas');
    expect(chunkEmbedText({ heading: 'Fórmulas', text: 'Texto' })).toBe('Fórmulas\nTexto');
    expect(chunkEmbedText({ heading: '', text: 'Texto' })).toBe('Texto');
  });

  it('formato do pgvector', () => {
    expect(toPgVector([0.1234567, -1, 0])).toBe('[0.123457,-1,0]');
  });

  it('lotes de 100, vetores normalizados e tipo de tarefa', async () => {
    const bodies: { requests: { taskType: string; outputDimensionality: number }[] }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      return new Response(JSON.stringify({ embeddings: body.requests.map(() => ({ values: [3, 4] })), usageMetadata: { promptTokenCount: body.requests.length } }));
    }) as typeof fetch;
    const r = await embedTexts({ apiKey: 'k', texts: Array.from({ length: 150 }, (_, i) => `t${i}`), task: 'document', fetchImpl });
    expect(bodies.map((b) => b.requests.length)).toEqual([100, 50]);
    expect(bodies[0]!.requests[0]).toMatchObject({ taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 });
    expect(r.vectors[0]).toEqual([0.6, 0.8]);
    expect(r.tokens).toBe(150);
  });

  it('erro da API vira exceção com o status', async () => {
    const fetchImpl = (async () => new Response('cota', { status: 429 })) as unknown as typeof fetch;
    await expect(embedTexts({ apiKey: 'k', texts: ['a'], task: 'query', fetchImpl })).rejects.toThrow('embeddings 429');
  });
});
