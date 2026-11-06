import { describe, expect, it } from 'vitest';
import { MIN_TEXT_CHARS, noticeDocKeys, noticeRoleKey, noticeTitleKey, SAME_TEXT_SIMILARITY, sha256Hex, signatureSimilarity, textSignature, worthSharing } from './notice-cache.ts';

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

describe('mesmo edital em outro arquivo: título e assinatura do texto', () => {
  const head = 'INEPAM\nPROCESSO SELETIVO Nº 001/2026\nEDITAL DE ABERTURA DAS INSCRIÇÕES\nA Prefeitura Municipal de Canitar, estado de São Paulo, representada pelo Prefeito Municipal, torna público que se encontram abertas as inscrições. ';
  const body = Array.from({ length: 400 }, (_, i) => `Item ${i}: candidato deverá observar a regra ${i * 7} do capítulo ${i % 13} sobre inscrição e prova.`).join(' ');
  const text = head + body;

  it('o título ignora o cabeçalho do arquivo e as quebras de linha', async () => {
    const other = 'Página 1 de 63\n' + head.replace(/\n/g, '  ') + body;
    expect(await noticeTitleKey(text)).toMatch(/^ttl:[0-9a-f]{64}$/);
    expect(await noticeTitleKey(other)).toBe(await noticeTitleKey(text));
    expect(await noticeTitleKey('Prefeitura de Canitar. Concurso público.')).toBeNull();
  });

  it('o mesmo texto extraído de outro jeito tem a assinatura praticamente igual', () => {
    // Outras quebras de linha e espaços, e um cabeçalho de página no meio.
    const mid = text.indexOf('Item 200');
    const copy = `${text.slice(0, mid)} Página 31 de 63 ${text.slice(mid)}`.replace(/\. /g, '.\n').replace(/ /g, '  ');
    const a = textSignature(text)!, b = textSignature(copy)!;
    expect(a).toHaveLength(128);
    expect(signatureSimilarity(a, b)).toBeGreaterThanOrEqual(SAME_TEXT_SIMILARITY);
  });

  it('retificação que muda parte do texto fica abaixo do limite; outro edital, bem abaixo', () => {
    const rect = text.replace(/regra (\d*5) /g, 'regra $1 retificada ');
    const other = Array.from({ length: 400 }, (_, i) => `Artigo ${i}: o servidor público municipal tem direito ao adicional ${i}.`).join(' ');
    const sim = signatureSimilarity(textSignature(text)!, textSignature(rect)!);
    expect(sim).toBeLessThan(SAME_TEXT_SIMILARITY);
    expect(sim).toBeGreaterThan(0.5);
    expect(signatureSimilarity(textSignature(text)!, textSignature(other)!)).toBeLessThan(0.1);
  });

  it('texto curto demais não tem assinatura', () => {
    expect(textSignature('edital curto')).toBeNull();
  });
});
