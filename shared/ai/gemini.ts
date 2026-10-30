// Chamada ao Gemini com resposta em JSON validada por schema, e cálculo de custo pelo consumo.
// Sem dependências de runtime: roda no Deno (Edge Functions) e no Node (avaliação).
import type { z } from 'zod';

export interface GeminiUsage { inputTokens: number; outputTokens: number; thinkingTokens: number }
export interface GeminiResult<T> { data: T; raw: unknown; usage: GeminiUsage; model: string; latencyMs: number }
export interface ModelPrice { inputPerMtokUsd: number; outputPerMtokUsd: number }

// Sem "parameter properties": o arquivo também roda no Node só removendo tipos (--experimental-strip-types).
export class GeminiError extends Error {
  readonly status: number;
  readonly usage: GeminiUsage | null;
  readonly raw: unknown;
  constructor(message: string, status: number, usage: GeminiUsage | null = null, raw: unknown = null) {
    super(message);
    this.status = status;
    this.usage = usage;
    this.raw = raw;
  }
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export async function generateJson<S extends z.ZodType>(opts: {
  apiKey: string; model: string; parts: Part[]; schema: S; jsonSchema: unknown; temperature?: number; fetchImpl?: typeof fetch;
}): Promise<GeminiResult<z.infer<S>>> {
  const started = Date.now();
  const res = await (opts.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: opts.parts }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: opts.jsonSchema, temperature: opts.temperature ?? 0.2 },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new GeminiError(`Gemini respondeu ${res.status}${res.status === 404 ? ` (modelo "${opts.model}" indisponível)` : ''}: ${detail}`, res.status);
  }
  const out = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const usage: GeminiUsage = {
    inputTokens: out.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: out.usageMetadata?.candidatesTokenCount ?? 0,
    thinkingTokens: out.usageMetadata?.thoughtsTokenCount ?? 0,
  };
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new GeminiError(`O Gemini não devolveu conteúdo (${out.candidates?.[0]?.finishReason ?? 'sem motivo'}).`, 502, usage, out);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new GeminiError('A resposta do Gemini não é JSON válido.', 502, usage, text.slice(0, 2000)); }
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) throw new GeminiError(`A resposta do Gemini não segue o schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 502, usage, raw);
  return { data: parsed.data, raw, usage, model: opts.model, latencyMs: Date.now() - started };
}

// Tokens de raciocínio são cobrados como saída.
export const costUsd = (u: GeminiUsage, p: ModelPrice) =>
  Math.round(((u.inputTokens * p.inputPerMtokUsd + (u.outputTokens + u.thinkingTokens) * p.outputPerMtokUsd) / 1e6) * 1e6) / 1e6;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
