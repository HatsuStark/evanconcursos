// Chamada ao Claude (Anthropic) com a mesma interface de generateJson: resposta em JSON no formato do schema, validada
// pelo Zod, e consumo no mesmo formato do Gemini. generateJson desvia para cá quando o modelo começa com "claude-".
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import type { z } from 'zod';
import { GeminiError, type GeminiResult, type GeminiUsage } from './gemini.ts';

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

// Teto de saída por chamada: a maior apostila fica bem abaixo disso; o streaming evita o limite de tempo do SDK.
const MAX_TOKENS = 32000;

export async function generateClaudeJson<S extends z.ZodType>(opts: {
  apiKey: string; model: string; parts: Part[]; schema: S; jsonSchema: unknown; thinkingLevel?: 'low' | 'medium' | 'high'; timeoutMs?: number;
}): Promise<GeminiResult<z.infer<S>>> {
  const started = Date.now();
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2 });
  // O helper adapta o schema ao que a API aceita (tira limites de tamanho e número); o Zod confere tudo depois.
  const { type, schema } = jsonSchemaOutputFormat(opts.jsonSchema as { type: 'object' });
  const content: Anthropic.ContentBlockParam[] = opts.parts.map((p) => 'text' in p
    ? { type: 'text', text: p.text }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.inline_data.data } });
  let message: Anthropic.Message;
  try {
    // Sem temperature: os modelos atuais recusam valores fora do padrão. O raciocínio é adaptativo; o esforço segue o
    // nível pedido (o padrão do Haiku 5.5 é medium).
    message = await client.messages.stream({
      model: opts.model, max_tokens: MAX_TOKENS,
      output_config: { format: { type, schema }, effort: opts.thinkingLevel ?? 'medium' },
      messages: [{ role: 'user', content }],
    }, opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined).finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new GeminiError('A IA demorou mais que o limite para responder.', 504);
    if (e instanceof Anthropic.APIError) throw new GeminiError(`Claude respondeu ${e.status ?? '?'}: ${e.message.slice(0, 500)}`, e.status ?? 502);
    throw e;
  }
  const thinking = message.usage.output_tokens_details?.thinking_tokens ?? 0;
  // Mesmo formato do Gemini: a saída sem o raciocínio, que é contado à parte (costUsd soma os dois como saída).
  const usage: GeminiUsage = {
    inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
    outputTokens: Math.max(0, message.usage.output_tokens - thinking),
    thinkingTokens: thinking,
  };
  if (message.stop_reason === 'refusal') throw new GeminiError('O Claude recusou o pedido.', 502, usage, message.stop_details ?? null, 'refusal');
  if (message.stop_reason === 'max_tokens') throw new GeminiError('A resposta do Claude passou do limite de tamanho.', 502, usage, null, 'max_tokens');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  if (!text) throw new GeminiError(`O Claude não devolveu conteúdo (${message.stop_reason ?? 'sem motivo'}).`, 502, usage, null, message.stop_reason ?? '');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new GeminiError('A resposta do Claude não é JSON válido.', 502, usage, text.slice(0, 2000)); }
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) throw new GeminiError(`A resposta do Claude não segue o schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 502, usage, raw);
  return { data: parsed.data, raw, usage, model: opts.model, latencyMs: Date.now() - started };
}
