import { describe, expect, it, vi } from 'vitest';
import { parseDuration, rankVideos, searchYoutube, videoQuery, YoutubeError, type VideoCandidate } from './videos.ts';

const NOW = new Date('2026-10-30T00:00:00Z').getTime();
const video = (over: Partial<VideoCandidate> = {}): VideoCandidate => ({
  id: 'a', title: 'Peculato aula completa', channel: 'Canal', description: '', durationSec: 1800, publishedAt: '2025-01-01T00:00:00Z',
  views: 1000, thumb: 't', embeddable: true, live: false, blockedBR: false, ...over,
});

describe('videoQuery', () => {
  it('usa a parte curta do título, com a matéria', () => {
    const r = videoQuery({ subject: 'Direito Penal', title: 'Peculato: tipos e penas (arts. 312 a 327 do CP) (parte 1 de 2)', topics: [] });
    expect(r.q).toBe('Direito Penal Peculato aula concurso');
    expect(r.key).toBe('direito penal peculato aula concurso');
    expect(r.terms).toEqual(['peculato']);
  });
  it('não repete a matéria e, sem tema próprio, exige os termos da matéria', () => {
    const r = videoQuery({ subject: 'Direito Penal', title: 'Direito Penal: visão geral', topics: [] });
    expect(r.q).toBe('Direito Penal aula concurso');
    expect(r.terms).toEqual(['direito', 'penal']);
  });
  it('título genérico usa o primeiro tópico do edital, sem numeração', () => {
    expect(videoQuery({ subject: 'Português', title: 'Estudo 1 de 3 (parte 1)', topics: ['1.2 Crase; regência'] }).q).toBe('Português Crase aula concurso');
    expect(videoQuery({ subject: 'Português', title: 'Estudo 1 de 3', topics: [] }).q).toBe('Português aula concurso');
  });
  it('mesma busca, mesma chave, com ou sem acento', () => {
    expect(videoQuery({ subject: 'Administração', title: 'Licitação', topics: [] }).key).toBe(videoQuery({ subject: 'administracao', title: 'licitacao', topics: [] }).key);
  });
});

describe('parseDuration', () => {
  it('lê o formato ISO da API', () => {
    expect(parseDuration('PT1H2M3S')).toBe(3723);
    expect(parseDuration('PT15M')).toBe(900);
    expect(parseDuration('P1DT1S')).toBe(86401);
    expect(parseDuration('P0D')).toBe(0);
    expect(parseDuration('invalido')).toBe(0);
  });
});

describe('rankVideos', () => {
  const ids = (vs: { id: string }[]) => vs.map((v) => v.id);
  it('descarta o que não pode ser assistido no app', () => {
    const r = rankVideos([
      video({ id: 'ok' }), video({ id: 'bloqueado', embeddable: false }), video({ id: 'live', live: true }), video({ id: 'brasil', blockedBR: true }),
      video({ id: 'short', durationSec: 60 }), video({ id: 'maratona', durationSec: 7 * 3600 }),
    ], ['peculato'], NOW);
    expect(ids(r)).toEqual(['ok']);
  });
  it('descarta vídeo fora do tema; aceita tema só na descrição e variação da palavra', () => {
    const r = rankVideos([
      video({ id: 'fora', title: 'Aula de crase' }),
      video({ id: 'descricao', title: 'Crimes funcionais', description: 'Peculato e concussão' }),
      video({ id: 'variacao', title: 'Direito processual' }),
    ], ['peculato', 'processo'], NOW);
    expect(ids(r).sort()).toEqual(['descricao', 'variacao']);
  });
  it('prefere tema no título, duração de aula e vídeo recente', () => {
    // Fora do tema, só para a lista ter o tamanho de uma busca real: a posição pesa pouco entre vizinhos.
    const filler = Array.from({ length: 23 }, (_, i) => video({ id: `f${i}`, title: 'crase' }));
    const first = (a: VideoCandidate, b: VideoCandidate) => ids(rankVideos([a, b, ...filler], ['peculato'], NOW))[0];
    expect(first(video({ id: 'descricao', title: 'Crimes', description: 'peculato' }), video({ id: 'titulo' }))).toBe('titulo');
    expect(first(video({ id: 'longo', durationSec: 4 * 3600 }), video({ id: 'ideal' }))).toBe('ideal');
    expect(first(video({ id: 'antigo', publishedAt: '2018-01-01T00:00:00Z' }), video({ id: 'novo' }))).toBe('novo');
  });
  it('no máximo 2 por canal e 6 no total, sem campos internos', () => {
    const r = rankVideos(Array.from({ length: 10 }, (_, i) => video({ id: `v${i}`, channel: i < 4 ? 'Mesmo' : `Canal ${i}` })), ['peculato'], NOW);
    expect(r).toHaveLength(6);
    expect(r.filter((v) => v.channel === 'Mesmo')).toHaveLength(2);
    expect(r[0]).not.toHaveProperty('description');
  });
});

describe('searchYoutube', () => {
  const ok = (items: unknown[]) => new Response(JSON.stringify({ items }));
  it('busca, junta os detalhes e mantém a ordem de relevância', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok([{ id: { videoId: 'b' } }, { id: { videoId: 'a' } }, { id: { videoId: 'sumiu' } }]))
      .mockResolvedValueOnce(ok([
        { id: 'a', snippet: { title: 'A', channelTitle: 'C', publishedAt: '2025-01-01', thumbnails: { medium: { url: 'u' } }, liveBroadcastContent: 'none' }, contentDetails: { duration: 'PT10M' }, statistics: { viewCount: '5' }, status: { embeddable: true } },
        { id: 'b', snippet: { title: 'B', liveBroadcastContent: 'live' }, contentDetails: { duration: 'PT1M', regionRestriction: { blocked: ['BR'] } }, status: { embeddable: false } },
      ]));
    const r = await searchYoutube('chave', 'tema', f as unknown as typeof fetch);
    expect(r.map((v) => v.id)).toEqual(['b', 'a']);
    expect(r[1]).toMatchObject({ title: 'A', channel: 'C', durationSec: 600, views: 5, thumb: 'u', embeddable: true, live: false, blockedBR: false });
    expect(r[0]).toMatchObject({ embeddable: false, live: true, blockedBR: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('sem resultados não gasta a segunda chamada', async () => {
    const f = vi.fn().mockResolvedValueOnce(ok([]));
    expect(await searchYoutube('chave', 'tema', f as unknown as typeof fetch)).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('identifica a cota esgotada e não vaza a chave no erro', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }));
    const e = await searchYoutube('segredo', 'tema', f as unknown as typeof fetch).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(YoutubeError);
    expect((e as YoutubeError).quota).toBe(true);
    expect((e as YoutubeError).message).not.toContain('segredo');
  });
});
