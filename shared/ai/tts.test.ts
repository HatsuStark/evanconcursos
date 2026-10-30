import { describe, expect, it } from 'vitest';
import { GeminiError } from './gemini.ts';
import { generateSpeech, wavToMp3, wavToSamples } from './tts.ts';

// WAV de teste, com um bloco extra antes do áudio (o bloco de áudio não está sempre na mesma posição).
function wav(samples: number[], sampleRate = 24000) {
  const b = new Uint8Array(12 + 24 + 12 + 8 + samples.length * 2), v = new DataView(b.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => { b[at + i] = c.charCodeAt(0); });
  put(0, 'RIFF'); v.setUint32(4, b.length - 8, true); put(8, 'WAVE');
  put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  put(36, 'LIST'); v.setUint32(40, 4, true);
  put(48, 'data'); v.setUint32(52, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(56 + i * 2, s, true));
  return b;
}

describe('áudio das vozes de IA', () => {
  it('lê as amostras do WAV', () => {
    const { samples, sampleRate } = wavToSamples(wav([0, 16384, -32768], 16000));
    expect(sampleRate).toBe(16000);
    expect([...samples]).toEqual([0, 0.5, -1]);
  });
  it('recusa o que não é WAV', () => {
    expect(() => wavToSamples(new Uint8Array(20))).toThrow('não é WAV');
  });
  it('comprime para MP3 e calcula a duração', async () => {
    const samples = Array.from({ length: 24000 }, (_, i) => Math.round(Math.sin(i / 10) * 10000));
    const source = wav(samples);
    const { mp3, seconds } = await wavToMp3(source);
    expect(seconds).toBe(1);
    expect(mp3.length).toBeGreaterThan(0);
    expect(mp3.length).toBeLessThan(source.length / 5);
    // Quadro MP3 começa com 11 bits ligados.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1]! & 0xe0).toBe(0xe0);
  });
  it('monta o pedido e devolve áudio e consumo', async () => {
    let body: Record<string, any> = {};
    const fetchImpl = (async (_: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'audio', data: btoa('abc') }] }],
        usage: { total_input_tokens: 10, total_output_tokens: 25, total_thought_tokens: 0 },
      }));
    }) as typeof fetch;
    const r = await generateSpeech({ apiKey: 'k', model: 'm', voice: 'Charon', style: 'calmo', text: 'Oi', fetchImpl });
    expect(body.generation_config.speech_config).toEqual([{ voice: 'Charon' }]);
    expect(body.input[0].content[0].annotations[0].style).toBe('calmo');
    expect(new TextDecoder().decode(r.wav)).toBe('abc');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 25, thinkingTokens: 0 });
  });
  it('resposta sem áudio é erro, com o consumo registrado', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ steps: [], usage: { total_input_tokens: 5 } }))) as unknown as typeof fetch;
    const err = await generateSpeech({ apiKey: 'k', model: 'm', voice: 'v', style: 's', text: 't', fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(err.usage.inputTokens).toBe(5);
  });
});
