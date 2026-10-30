// Voz do Gemini (texto → WAV) e compressão para MP3: o WAV ocupa dez vezes mais no armazenamento.
import { createMp3Encoder } from 'wasm-media-encoders';
import { GeminiError, type GeminiUsage } from './gemini.ts';

export async function generateSpeech(opts: { apiKey: string; model: string; voice: string; style: string; text: string; fetchImpl?: typeof fetch }) {
  const res = await (opts.fetchImpl ?? fetch)('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      model: opts.model,
      input: [{ type: 'user_input', content: [{ type: 'text', text: opts.text, annotations: [{ type: 'speech_metadata', style: opts.style }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: opts.voice }] },
    }),
  });
  if (!res.ok) throw new GeminiError(`Gemini respondeu ${res.status}: ${(await res.text()).slice(0, 500)}`, res.status);
  const out = await res.json() as {
    steps?: { type?: string; content?: { type?: string; data?: string }[] }[];
    usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
  };
  const usage: GeminiUsage = { inputTokens: out.usage?.total_input_tokens ?? 0, outputTokens: out.usage?.total_output_tokens ?? 0, thinkingTokens: out.usage?.total_thought_tokens ?? 0 };
  const data = out.steps?.filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).filter((c) => c.type === 'audio').at(-1)?.data;
  if (!data) throw new GeminiError('O Gemini não devolveu áudio.', 502, usage);
  return { wav: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), usage };
}

// Lê um WAV PCM 16 bits mono percorrendo os blocos do arquivo: o de áudio não está sempre na mesma posição.
export function wavToSamples(wav: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(wav[at]!, wav[at + 1]!, wav[at + 2]!, wav[at + 3]!);
  if (wav.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Áudio recebido não é WAV.');
  let sampleRate = 24000;
  for (let at = 12; at + 8 <= wav.length;) {
    const size = view.getUint32(at + 4, true), start = at + 8;
    if (tag(at) === 'fmt ') sampleRate = view.getUint32(start + 4, true);
    if (tag(at) === 'data') {
      const count = Math.floor(Math.min(size, wav.length - start) / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(start + i * 2, true) / 32768;
      return { samples, sampleRate };
    }
    at = start + size + (size % 2);
  }
  throw new Error('WAV sem áudio.');
}

// Voz mono a 40 kbps: cerca de 2,5 MB por apostila completa.
export async function wavToMp3(wav: Uint8Array) {
  const { samples, sampleRate } = wavToSamples(wav);
  const encoder = await createMp3Encoder();
  encoder.configure({ sampleRate, channels: 1, bitrate: 40 });
  // O encoder reaproveita o buffer devolvido: copia antes da próxima chamada.
  const body = encoder.encode([samples]).slice(), tail = encoder.finalize().slice();
  const mp3 = new Uint8Array(body.length + tail.length);
  mp3.set(body); mp3.set(tail, body.length);
  return { mp3, seconds: samples.length / sampleRate };
}
