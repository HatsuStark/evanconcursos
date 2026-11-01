import { describe, expect, it } from 'vitest';
import { rankMaterias, resolveMateria } from './materias.ts';

describe('rankMaterias', () => {
  const api = ['Alfabeto português', 'Literatura portuguesa', 'Língua Portuguesa', 'Situação dos portugueses'];
  it('"Português", com ou sem acento, leva primeiro à matéria', () => {
    expect(rankMaterias('Português', api)[0]).toBe('Língua Portuguesa');
    expect(rankMaterias('portugues', api)[0]).toBe('Língua Portuguesa');
    expect(rankMaterias('PORTUGUÊS', [])[0]).toBe('Língua Portuguesa');
  });
  it('não repete a matéria e mantém os assuntos da API depois dela', () => {
    expect(rankMaterias('portugues', api)).toEqual(['Língua Portuguesa', 'Alfabeto português', 'Literatura portuguesa', 'Situação dos portugueses']);
  });
  it('a matéria principal vem antes de assuntos soltos da API', () => {
    expect(rankMaterias('administrativo', ['Atos Administrativos', 'Fatos Administrativos', 'Direito Administrativo'])[0]).toBe('Direito Administrativo');
    expect(rankMaterias('constitucional', ['Constitucionalismo e Neoconstitucionalismo'])[0]).toBe('Direito Constitucional');
  });
  it('aceita abreviações e sinônimos', () => {
    expect(rankMaterias('proc penal', [])).toEqual(['Direito Processual Penal']);
    expect(rankMaterias('dir adm', [])[0]).toBe('Direito Administrativo');
    expect(rankMaterias('rlm', [])[0]).toBe('Raciocínio Lógico');
    expect(rankMaterias('ingles', [])[0]).toBe('Língua Inglesa');
    expect(rankMaterias('cpc', [])[0]).toBe('Direito Processual Civil - CPC 2015');
    expect(rankMaterias('proc civi', [])).toEqual(['Direito Processual Civil - CPC 2015']);
  });
  it('não oferece matéria quase vazia e mantém as demais versões', () => {
    const civil = ['Direito Processual Civil', 'Direito Processual Civil - CPC 1973', 'Direito Processual Civil - CPC 2015'];
    expect(rankMaterias('Direito Processual Civil', civil)).toEqual(['Direito Processual Civil - CPC 2015', 'Direito Processual Civil - CPC 1973']);
    expect(rankMaterias('atualidades', ['Atualidades', 'Atualidades e Conhecimentos Gerais', 'Atualidades do Mercado Financeiro'])).toEqual(['Atualidades e Conhecimentos Gerais', 'Atualidades do Mercado Financeiro']);
    expect(rankMaterias('empresarial', ['Direito Empresarial', 'Direito Empresarial (Comercial)'])).toEqual(['Direito Empresarial (Comercial)']);
  });
  it('entre assuntos, prefere exato, depois começo do nome, depois o mais curto', () => {
    expect(rankMaterias('crase', ['Uso da crase e regência', 'Crase e pronomes', 'Crase'])).toEqual(['Crase', 'Crase e pronomes', 'Uso da crase e regência']);
  });
  it('respeita o limite e aceita busca vazia', () => {
    expect(rankMaterias('direito', [], 3)).toHaveLength(3);
    expect(rankMaterias('', ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('resolveMateria', () => {
  const options = ['Língua Portuguesa', 'Alfabeto português'];
  it('corrige acento e maiúscula para o nome oficial', () => {
    expect(resolveMateria('lingua portuguesa', options)).toBe('Língua Portuguesa');
  });
  it('sem nome exato, só troca pela primeira opção se pedido', () => {
    expect(resolveMateria('portugues', options)).toBe('portugues');
    expect(resolveMateria('portugues', options, true)).toBe('Língua Portuguesa');
    expect(resolveMateria('xyz', [], true)).toBe('xyz');
  });
  it('troca matéria quase vazia pela versão cheia, mesmo escolhida ou salva antes', () => {
    expect(resolveMateria('direito processual civil', ['Direito Processual Civil'])).toBe('Direito Processual Civil - CPC 2015');
    expect(resolveMateria('Atualidades', [])).toBe('Atualidades e Conhecimentos Gerais');
    expect(resolveMateria('Direito Processual Civil - CPC 1973', ['Direito Processual Civil - CPC 1973'])).toBe('Direito Processual Civil - CPC 1973');
  });
});
