import { describe, expect, it } from 'vitest';
import { MIN_TEXT_CHARS, noticeDocKeys, noticeRoleKey, sha256Hex, worthSharing } from './notice-cache.ts';

describe('cache da leitura do edital', () => {
  const body = 'Conteúdo programático: Direito Administrativo, atos administrativos. '.repeat(60);

  it('hash conhecido', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('mesmo texto com espaços, quebras e acentos diferentes gera a mesma chave de texto', async () => {
    const a = await noticeDocKeys(new Uint8Array([1, 2, 3]), body);
    const b = await noticeDocKeys(new Uint8Array([9, 9, 9]), body.replace(/ /g, '  \n').replace(/ú/g, 'u'));
    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).toMatch(/^txt:[0-9a-f]{64}$/);
    expect(a[1]).toBe(b[1]);
  });

  it('texto curto (PDF só com imagem) fica só com o hash do arquivo', async () => {
    const keys = await noticeDocKeys(new Uint8Array([1]), 'x'.repeat(MIN_TEXT_CHARS - 1));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^pdf:[0-9a-f]{64}$/);
  });

  it('texto retificado gera outra chave', async () => {
    const [, a] = await noticeDocKeys(new Uint8Array([1]), body);
    const [, b] = await noticeDocKeys(new Uint8Array([1]), body + ' Retificação nº 1.');
    expect(a).not.toBe(b);
  });

  it('cargo: escolhido na lista e digitado não se misturam; caixa e acento não importam', () => {
    expect(noticeRoleKey('Técnico Judiciário', { code: '101' })).toBe(noticeRoleKey('TECNICO  judiciario', { code: '101' }));
    expect(noticeRoleKey('Técnico Judiciário', { code: '101' })).not.toBe(noticeRoleKey('Técnico Judiciário'));
    expect(noticeRoleKey('Técnico Judiciário', { code: '101' })).not.toBe(noticeRoleKey('Técnico Judiciário', { code: '102' }));
  });

  it('só compartilha leitura com matérias e tópicos', () => {
    expect(worthSharing({ subjects: [] })).toBe(false);
    expect(worthSharing({ subjects: [{ topics: [] }] } as never)).toBe(false);
    expect(worthSharing({ subjects: [{ topics: [{ text: 'a', page: 1 }] }] } as never)).toBe(true);
  });
});
