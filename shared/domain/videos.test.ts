import { describe, expect, it, vi } from 'vitest';
import { findVideos, parseDuration, rankVideos, searchYoutube, videoQuery, YoutubeError, type VideoCandidate } from './videos.ts';

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
  it('com palavra-chave da sessão, busca por ela e exige os termos dela também', () => {
    const r = videoQuery({ subject: 'Direito Administrativo', title: 'Ingresso e Exercício: Conceito, provimento, posse (Lei 10.261/68)', topics: [], keyword: 'Estatuto SP provimento posse' });
    expect(r.q).toBe('Estatuto SP provimento posse Lei 10.261 aula concurso');
    expect(r.terms).toEqual(['ingresso', 'exercicio', 'estatuto', 'provimento', 'posse']);
    expect(r.law).toBe('10.261');
    expect(r.alt).toBe('Direito Administrativo Ingresso e Exercício Lei 10.261');
    expect(r.phrase).toEqual(['estatuto', 'provimento', 'posse']);
    expect(videoQuery({ subject: 'Direito Penal', title: 'Peculato', topics: [] }).alt).toBe('Direito Penal Peculato videoaula');
    expect(videoQuery({ subject: 'Português', title: 'Estudo 1 de 3', topics: [] }).alt).toBe('');
    expect(videoQuery({ subject: 'X', title: 'Citação', topics: [], lawNames: ['CPP', 'Código de Processo Penal'] }).lawNames).toEqual(['cpp', 'codigo de processo penal']);
    expect(videoQuery({ subject: 'Direito Penal', title: 'Peculato', topics: [] }).law).toBe('');
  });
  it('acha o número da lei com ou sem ponto, e sem confundir com outro número', () => {
    const rank = (description: string) => rankVideos([video({ id: 'outra', title: 'Peculato estatuto de outra cidade' }), video({ id: 'lei', title: 'Peculato', description })], ['peculato'], NOW, '10.261');
    expect(rank('Lei 10261/68')[0]!.id).toBe('lei');
    expect(rank('Lei 10.261/68')[0]!.id).toBe('lei');
    expect(rank('Lei 110.2612')[0]!.id).toBe('outra');
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
      video({ id: 'short', durationSec: 60 }), video({ id: 'tag', title: 'Peculato #shorts', durationSec: 150 }),
    ], ['peculato'], NOW);
    expect(ids(r)).toEqual(['ok']);
  });
  it('sem limite de duração: aula longa e vídeo curto (fora os Shorts) entram', () => {
    expect(ids(rankVideos([video({ id: 'longa', durationSec: 3 * 3600 }), video({ id: 'curto', durationSec: 90, channel: 'B' })], ['peculato'], NOW)).sort()).toEqual(['curto', 'longa']);
  });
  it('descarta vídeo fora do tema; aceita tema só na descrição e variação da palavra', () => {
    const r = rankVideos([
      video({ id: 'fora', title: 'Aula de crase' }),
      video({ id: 'descricao', title: 'Crimes funcionais', description: 'Peculato e concussão' }),
      video({ id: 'variacao', title: 'Direito processual' }),
    ], ['peculato', 'processo'], NOW);
    expect(ids(r).sort()).toEqual(['descricao', 'variacao']);
  });
  it('descrição que cita só um dos vários termos não põe o vídeo no tema', () => {
    const terms = ['ingresso', 'exercicio', 'estatuto', 'provimento', 'posse'];
    const r = rankVideos([
      video({ id: 'principios', title: 'Princípios da Administração Pública', description: 'Resumo com exercícios para concursos' }),
      video({ id: 'titulo', title: 'Provimento e posse no serviço público' }),
      video({ id: 'descricao', title: 'Servidores públicos', description: 'Estatuto: provimento, posse e exercício' }),
    ], terms, NOW);
    expect(ids(r).sort()).toEqual(['descricao', 'titulo']);
  });
  it('prefere o mais perto do tema; duração não pesa; recente desempata', () => {
    // Fora do tema, só para a lista ter o tamanho de uma busca real: a posição pesa pouco entre vizinhos.
    const filler = Array.from({ length: 48 }, (_, i) => video({ id: `f${i}`, title: 'crase' }));
    const first = (a: VideoCandidate, b: VideoCandidate, terms = ['peculato'], opts = {}) => ids(rankVideos([a, b, ...filler], terms, NOW, '', opts))[0];
    expect(first(video({ id: 'descricao', title: 'Crimes', description: 'peculato' }), video({ id: 'titulo' }))).toBe('titulo');
    expect(first(video({ id: 'parcial', title: 'Peculato' }), video({ id: 'completo', title: 'Peculato e concussão' }), ['peculato', 'concussao'])).toBe('completo');
    expect(first(video({ id: 'antigo', publishedAt: '2018-01-01T00:00:00Z' }), video({ id: 'novo' }))).toBe('novo');
    expect(first(video({ id: 'curta', durationSec: 5 * 60, title: 'Peculato e concussão' }), video({ id: 'longa', durationSec: 2 * 3600, title: 'Peculato' }), ['peculato', 'concussao'])).toBe('curta');
  });
  it('frase da palavra-chave inteira no título e lei da sessão citada aproximam do tema', () => {
    const filler = Array.from({ length: 48 }, (_, i) => video({ id: `f${i}`, title: 'crase' }));
    const terms = ['citacao', 'mandado', 'oficial'];
    const r = rankVideos([video({ id: 'solto', title: 'Citação no processo' }), video({ id: 'frase', title: 'Citação por mandado e oficial' }), ...filler], terms, NOW, '', { phrase: ['citacao', 'mandado'] });
    expect(ids(r)[0]).toBe('frase');
    const byLaw = rankVideos([video({ id: 'outra', title: 'Citação' }), video({ id: 'cpp', title: 'Citação', description: 'Aula sobre o CPP' }), ...filler], ['citacao'], NOW, '', { lawNames: ['cpp'] });
    expect(ids(byLaw)[0]).toBe('cpp');
  });
  it('no máximo 2 por canal e 5 no total, sem campos internos', () => {
    const r = rankVideos(Array.from({ length: 10 }, (_, i) => video({ id: `v${i}`, channel: i < 4 ? 'Mesmo' : `Canal ${i}` })), ['peculato'], NOW);
    expect(r).toHaveLength(5);
    expect(r.filter((v) => v.channel === 'Mesmo')).toHaveLength(2);
    expect(r[0]).not.toHaveProperty('description');
  });
});

describe('findVideos', () => {
  const page = (...items: { id: string; min: number; channel: string }[]) => [
    new Response(JSON.stringify({ items: items.map((v) => ({ id: { videoId: v.id } })) })),
    new Response(JSON.stringify({ items: items.map((v) => ({
      id: v.id, snippet: { title: 'Peculato', channelTitle: v.channel, publishedAt: '2025-01-01', liveBroadcastContent: 'none' },
      contentDetails: { duration: `PT${v.min}M` }, statistics: { viewCount: '5' }, status: { embeddable: true },
    })) })),
  ];
  const queue = (...responses: Response[]) => responses.reduce((f, r) => f.mockResolvedValueOnce(r), vi.fn());
  it('com vídeos suficientes, não gasta a segunda busca', async () => {
    const f = queue(...page({ id: 'a', min: 10, channel: 'A' }, { id: 'b', min: 90, channel: 'B' }, { id: 'c', min: 20, channel: 'C' }));
    expect((await findVideos('k', 'q', ['peculato'], f as unknown as typeof fetch, NOW, '', { alt: 'outra' })).map((v) => v.id).sort()).toEqual(['a', 'b', 'c']);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('faltando vídeos, busca o tema dito de outro jeito e junta sem repetir', async () => {
    const f = queue(...page({ id: 'a', min: 15, channel: 'A' }, { id: 'longo', min: 90, channel: 'B' }), ...page({ id: 'a', min: 15, channel: 'A' }, { id: 'c', min: 18, channel: 'C' }));
    expect((await findVideos('k', 'q', ['peculato'], f as unknown as typeof fetch, NOW, '', { alt: 'Direito Penal Peculato' })).map((v) => v.id).sort()).toEqual(['a', 'c', 'longo']);
    expect(String(f.mock.calls[2]![0])).toContain('q=Direito+Penal+Peculato');
  });
  it('sem busca alternativa, devolve o que achou', async () => {
    const f = queue(...page({ id: 'a', min: 90, channel: 'B' }));
    expect((await findVideos('k', 'q', ['peculato'], f as unknown as typeof fetch, NOW)).map((v) => v.id)).toEqual(['a']);
    expect(f).toHaveBeenCalledTimes(2);
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
