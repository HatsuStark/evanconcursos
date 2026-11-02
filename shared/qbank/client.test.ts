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
