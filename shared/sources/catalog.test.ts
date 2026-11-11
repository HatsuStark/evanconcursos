import { describe, expect, it } from 'vitest';
import { groupsForSubject, OPEN_SOURCES, sourcesForSubject } from './catalog.ts';

describe('catálogo de fontes abertas', () => {
  it('chaves únicas, cada fonte com grupo e um só formato', () => {
    expect(new Set(OPEN_SOURCES.map((s) => s.key)).size).toBe(OPEN_SOURCES.length);
    for (const s of OPEN_SOURCES) {
      expect(s.subjects.length).toBeGreaterThan(0);
      expect(s.pdf && s.html).toBeFalsy();
    }
  });

  it('matéria do edital nas fontes dos seus grupos', () => {
    expect(sourcesForSubject('Noções de Informática')).toEqual(expect.arrayContaining(['libreoffice-writer', 'maziero-so', 'certbr-cartilha']));
    expect(sourcesForSubject('Sistemas Operacionais')).toEqual(['maziero-so']);
    expect(sourcesForSubject('Língua Portuguesa')).toEqual(['manual-redacao-pr']);
    expect(sourcesForSubject('Direito Constitucional')).toEqual([]);
  });

  it('grupos sem falso positivo dentro de palavras', () => {
    expect(groupsForSubject('Ética no Serviço Público')).toContain('administracao');
    expect(groupsForSubject('Aritmética')).not.toContain('administracao');
    expect(groupsForSubject('AFO')).toContain('afo-contabilidade');
    expect(groupsForSubject('Redação de parágrafos')).not.toContain('afo-contabilidade');
    expect(groupsForSubject('Raciocínio Lógico-Matemático')).toEqual(expect.arrayContaining(['matematica', 'raciocinio-logico']));
  });
});
