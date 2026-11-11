import { describe, expect, it } from 'vitest';
import { HEADING_MARK } from './chunk.ts';
import { crawlSite, decodeEntities, htmlToPage, licenseLink, pageLinks } from './html.ts';

describe('entidades', () => {
  it('nomeadas, numéricas e acentos do HTML antigo', () => {
    expect(decodeEntities('A&ccedil;&atilde;o &amp; &#233; &#xE9; &Aacute;rvore&nbsp;&mdash; &foo;')).toBe('Ação & é é Árvore — &foo;');
  });
});

describe('página HTML em texto', () => {
  const body = 'Texto do parágrafo com conteúdo suficiente para contar como principal. '.repeat(4);
  const html = `<html><head><title>Permissões &ndash; Guia</title><style>p{}</style></head><body>
    <nav><a href="/x">Menu</a></nav><header>Topo do site</header>
    <main><h2 id="p">Permiss&otilde;es <a href="#p">¶</a></h2><p>${body}</p>
      <ul><li>Leitura</li><li>Escrita</li></ul><script>var x = 1;</script>
      <p>Fórmula <script type="math/tex">x^2 + 1</script> e <math alttext="y=2"><mi>y</mi></math>.</p></main>
    <footer>Rodapé</footer></body></html>`;

  it('título da página, títulos marcados, listas e fórmulas; sem menu, topo, rodapé e script', () => {
    const p = htmlToPage(html);
    expect(p.title).toBe('Permissões – Guia');
    const lines = p.text.split('\n');
    expect(lines[0]).toBe(`${HEADING_MARK}Permissões`);
    expect(lines).toContain('• Leitura');
    expect(p.text).toContain(String.raw`Fórmula \(x^2 + 1\) e \(y=2\) .`);
    expect(p.text).not.toMatch(/Menu|Topo|Rodapé|var x/);
  });

  it('sem <main>, usa o <body>', () => {
    expect(htmlToPage('<body><h1>Título</h1><p>Um</p></body>').text).toBe(`${HEADING_MARK}Título\nUm`);
  });
});

describe('links e ordem de leitura', () => {
  it('links absolutos da obra, sem âncora e sem repetir', () => {
    const html = '<a href="cap1.html#a">1</a><a href="cap1.html">1 de novo</a><a href="https://outro.com/x">fora</a><a href="#topo">topo</a><a href="cap2.html">2</a>';
    expect(pageLinks(html, 'https://site.org/livro/index.html', /site\.org\/livro\//)).toEqual(['https://site.org/livro/cap1.html', 'https://site.org/livro/cap2.html']);
  });

  it('cada página logo depois da que a citou primeiro, até o limite', async () => {
    const site: Record<string, string> = {
      'https://s.org/i': '<a href="/c1">c1</a><a href="/c2">c2</a>',
      'https://s.org/c1': '<a href="/c1s1">s1</a><a href="/c2">c2</a>',
      'https://s.org/c1s1': '',
      'https://s.org/c2': '<a href="/i">índice</a>',
    };
    const fetchPage = async (u: string) => site[u] ?? null;
    expect((await crawlSite('https://s.org/i', /s\.org/, 10, fetchPage)).map((p) => p.url)).toEqual(['https://s.org/i', 'https://s.org/c1', 'https://s.org/c1s1', 'https://s.org/c2']);
    expect(await crawlSite('https://s.org/i', /s\.org/, 2, fetchPage)).toHaveLength(2);
  });

  it('link da licença Creative Commons', () => {
    expect(licenseLink('<a rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/">CC</a>')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(licenseLink('<a href="https://creativecommons.org/">CC</a>')).toBeNull();
  });
});
