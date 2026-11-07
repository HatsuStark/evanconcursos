import { describe, expect, it } from 'vitest';
import { MAX_NOTICE_PAGES, noticeGuard } from './notice-guard.ts';

const lawPages = (n: number) => Array.from({ length: n }, (_, p) =>
  Array.from({ length: 5 }, (_, i) => `Art. ${p * 5 + i + 1}º O servidor ocupante de cargo efetivo fará jus ao benefício.\n§ 1º Texto do parágrafo.`).join('\n'));

describe('noticeGuard', () => {
  it('aceita um edital comum', () => {
    const pages = ['EDITAL Nº 1/2026 – CONCURSO PÚBLICO\nAs inscrições ficam abertas para o cargo de Analista.', 'Quadro de vagas\nCargo | Vagas', 'Conteúdo programático: Lei 8.112/90, art. 5º.'];
    expect(noticeGuard(pages, 3)).toBeNull();
  });

  it('recusa PDF acima do limite de páginas, mesmo sem texto (só imagem)', () => {
    expect(noticeGuard([], MAX_NOTICE_PAGES + 1)).toMatch(/páginas/);
  });

  it('recusa texto demais', () => {
    expect(noticeGuard(['EDITAL ' + 'x'.repeat(1_600_000)], 10)).toMatch(/texto demais/);
  });

  it('recusa o texto de uma lei', () => {
    const pages = ['LEI Nº 8.112, DE 11 DE DEZEMBRO DE 1990\nDispõe sobre o regime jurídico dos servidores.', ...lawPages(20)];
    expect(noticeGuard(pages, pages.length)).toMatch(/texto de uma lei/);
  });

  it('aceita edital que transcreve artigos de lei em anexo', () => {
    const pages = ['EDITAL DE ABERTURA Nº 2/2026\nInscrições de 1º a 30 de março. Vagas para o cargo de Técnico.', ...lawPages(20)];
    expect(noticeGuard(pages, pages.length)).toBeNull();
  });

  it('não confunde artigo citado no meio da frase com o começo de um artigo', () => {
    const pages = ['Regulamento do certame', ...Array.from({ length: 10 }, () => 'Conforme o Art. 37 da Constituição, o candidato deve observar o Art. 5º. '.repeat(10))];
    expect(noticeGuard(pages, pages.length)).toBeNull();
  });
});
