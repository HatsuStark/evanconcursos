import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestClient } from './client.ts';

const reply = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe('QuestClient.questao', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('busca pelo id com gabarito e conta os créditos', async () => {
    reply(200, { data: { id: '1700999322', gabarito: 'C' } });
    const c = new QuestClient('k', 0);
    expect((await c.questao('1700999322'))?.id).toBe('1700999322');
    expect(c.credits).toBe(6);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe('/v2/questoes/1700999322');
    expect(url.searchParams.get('include_gabarito')).toBe('true');
  });

  it('id inexistente vira null, sem gastar créditos', async () => {
    reply(404, { message: 'Questão não encontrada.' });
    const c = new QuestClient('k', 0);
    expect(await c.questao('1')).toBeNull();
    expect(c.credits).toBe(0);
  });

  it('outras falhas continuam sendo erro', async () => {
    reply(500, { message: 'falhou' });
    await expect(new QuestClient('k', 0).questao('1')).rejects.toThrow('500');
  });
});

describe('limite de requisições', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('no 429, espera o Retry-After e tenta de novo', async () => {
    vi.useFakeTimers();
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { items: ['Crase'] } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const p = new QuestClient('k', 0).assuntosMatching('Língua Portuguesa', 'crase');
    await vi.advanceTimersByTimeAsync(1900);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toEqual(['Crase']);
    const url = new URL(String(f.mock.calls[1]![0]));
    expect([url.pathname, url.searchParams.get('q')]).toEqual(['/v2/filtros/assuntos', 'crase']);
  });
});
