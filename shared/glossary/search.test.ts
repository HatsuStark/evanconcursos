import { describe, expect, it } from 'vitest';
import { findExact, normalizeTerm, searchGlossary, type GlossaryEntry } from './search.ts';
import { GLOSSARY } from './terms.ts';

const E = (term: string, aliases?: string[]): GlossaryEntry => ({ term, area: 'Geral', definition: '-', aliases });
const list = [E('Usucapião'), E('Posse'), E('Autotutela'), E('Autoexecutoriedade'), E('Supremo Tribunal Federal', ['STF']), E('Justo título')];

describe('normalizeTerm', () => {
  it('tira acento, caixa e pontuação', () => expect(normalizeTerm('  Usucapião, Extraordinária! ')).toBe('usucapiao extraordinaria'));
});

describe('searchGlossary', () => {
  it('acha sem acento', () => expect(searchGlossary(list, 'usucapiao')[0]?.term).toBe('Usucapião'));
  it('ordena começo antes de meio', () => expect(searchGlossary(list, 'auto').map((e) => e.term)).toEqual(['Autoexecutoriedade', 'Autotutela']));
  it('acha por sigla', () => expect(searchGlossary(list, 'stf')[0]?.term).toBe('Supremo Tribunal Federal'));
  it('acha por palavra do meio', () => expect(searchGlossary(list, 'titulo')[0]?.term).toBe('Justo título'));
  it('ignora busca de uma letra', () => expect(searchGlossary(list, 'a')).toEqual([]));
});

describe('findExact', () => {
  it('casa termo ou sinônimo', () => {
    expect(findExact(list, 'STF')?.term).toBe('Supremo Tribunal Federal');
    expect(findExact(list, 'pos')).toBeNull();
  });
});

describe('GLOSSARY', () => {
  it('não repete termo nem sinônimo', () => {
    const seen = new Set<string>();
    for (const e of GLOSSARY) for (const n of [e.term, ...(e.aliases ?? [])]) {
      const k = normalizeTerm(n);
      expect(seen.has(k), `repetido: ${n}`).toBe(false);
      seen.add(k);
    }
  });
  it('tem definição curta em todos', () => {
    for (const e of GLOSSARY) expect(e.definition.split(/\s+/).length, e.term).toBeLessThanOrEqual(70);
  });
});
