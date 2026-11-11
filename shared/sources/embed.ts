// Vetores de significado (embeddings do Gemini) dos trechos das fontes abertas e da busca, para achar o trecho que
// explica o tema mesmo escrito com outras palavras. Roda no Node (scripts/sources-seed.ts e sources-coverage.ts) e no
// Deno (Edge Functions). Trechos e busca precisam do mesmo modelo: open_sources.embed_model guarda o usado na carga.

export const EMBED_DIM = 768, EMBED_BATCH = 100;
export const DEFAULT_EMBED_MODEL = 'gemini-embedding-2';
// Semelhança mínima (cosseno) para um trecho achado só pelo significado entrar na lista de candidatos. Calibrada com
// scripts/sources-coverage.ts (11/11/2026, gemini-embedding-2): o modelo dá 0,68-0,82 até a temas sem trecho bom; acima
// de ~0,75 o trecho é do assunto (RAID → "Sistemas RAID" 0,82), abaixo de 0,72 é vizinho (Modelo OSI → livro de SO 0,69).
export const MIN_SIMILARITY = 0.72;

export type EmbedTask = 'query' | 'document';

// Texto do trecho como vai para o vetor: a seção e o começo do texto (o modelo lê até ~2 mil tokens; o trecho tem menos).
export const chunkEmbedText = (c: { heading: string; text: string }) => `${c.heading ? `${c.heading}\n` : ''}${c.text}`.slice(0, 4000);

// Texto da busca: matéria, tema, palavra-chave e o item do edital (contexto, cortado).
export function queryEmbedText(t: { subject: string; title: string; keyword?: string; topics?: string[] }) {
  const topics = (t.topics ?? []).join(' | ').slice(0, 600);
  return [`${t.subject}: ${t.title}`, t.keyword, topics].filter(Boolean).join('\n');
}

// Formato de vetor do pgvector ("[0.1,0.2,...]").
export const toPgVector = (v: number[]) => `[${v.map((x) => Number(x.toFixed(6))).join(',')}]`;

export async function embedTexts(opts: {
  apiKey: string; model?: string; texts: string[]; task: EmbedTask; timeoutMs?: number; fetchImpl?: typeof fetch;
}): Promise<{ vectors: number[][]; tokens: number }> {
  const model = opts.model || DEFAULT_EMBED_MODEL, vectors: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < opts.texts.length; i += EMBED_BATCH) {
    const batch = opts.texts.slice(i, i + EMBED_BATCH);
    const res = await (opts.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${model}`, content: { parts: [{ text }] }, outputDimensionality: EMBED_DIM,
          taskType: opts.task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        })),
      }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const out = await res.json() as { embeddings?: { values: number[] }[]; usageMetadata?: { promptTokenCount?: number } };
    if (out.embeddings?.length !== batch.length) throw new Error('embeddings: resposta incompleta');
    // Com menos dimensões que o máximo o vetor pode vir sem normalizar; normalizado, o cosseno vira produto interno.
    for (const e of out.embeddings) {
      const n = Math.hypot(...e.values) || 1;
      vectors.push(e.values.map((x) => x / n));
    }
    tokens += out.usageMetadata?.promptTokenCount ?? 0;
  }
  return { vectors, tokens };
}
