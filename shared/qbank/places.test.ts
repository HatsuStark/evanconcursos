import { describe, expect, it } from 'vitest';
import { mixedPlaces, organSearch, placeFilter, placesIn } from './places.ts';

const ufs = (s: string) => [...placesIn(s).ufs].sort();
const cities = (s: string) => [...placesIn(s).cities];

describe('placesIn', () => {
  it('acha o estado pelo nome, pela sigla do órgão e pela UF depois de traço ou preposição', () => {
    expect(ufs('Normas da Corregedoria-Geral de Justiça do Estado de Minas Gerais')).toEqual(['MG']);
    expect(ufs('Corregedoria Geral da Justiça do Estado do Rio Grande do Sul - CGJ RS')).toEqual(['RS']);
    expect(ufs('Regimento Interno do Tribunal de Justiça do Estado de São Paulo - TJSP')).toEqual(['SP']);
    expect(ufs('Regimento Interno - TCE MG')).toEqual(['MG']);
    expect(ufs('Municípios de SC')).toEqual(['SC']);
    expect(ufs('Estatuto dos Servidores Públicos Civis do Estado de Mato Grosso do Sul- Lei nº 1.102/1990')).toEqual(['MS']);
    expect(ufs('Constituição do Estado do Pará')).toEqual(['PA']);
  });
  it('acha o município', () => {
    expect(cities('Município de Suzano - Legislação Aplicada')).toEqual(['suzano']);
    expect(cities('Lei Orgânica do Município do Recife')).toEqual(['recife']);
    expect(cities('Município de Guarulhos SP - Legislação Aplicada')).toEqual(['guarulhos']);
    expect(cities('Regimento Interno da Câmara Municipal de Odessa - SP')).toEqual(['odessa']);
  });
  it('não vê lugar em temas comuns', () => {
    for (const s of ['Direito Constitucional', 'Estado de Sítio', 'Organização do Estado', 'Distrito Federal', 'Municípios (artigos 29 a 31 da CF)', 'LÍNGUA PORTUGUESA: O QUE SE PEDE', 'Para entender crase', 'Regimento Interno do Senado Federal - SF']) {
      expect(ufs(s)).toEqual([]);
      expect(cities(s)).toEqual([]);
    }
  });
});

describe('placeFilter', () => {
  it('no TJSP, recusa normas e estatutos de outros estados e aceita os de São Paulo', () => {
    const fits = placeFilter('Tribunal de Justiça do Estado de São Paulo | Normas da Corregedoria');
    expect(fits('Normas da Corregedoria-Geral de Justiça do Estado de Minas Gerais')).toBe(false);
    expect(fits('Corregedoria Geral da Justiça do Estado do Rio de Janeiro - CGJ RJ')).toBe(false);
    expect(fits('Corregedoria Geral da Justiça de São Paulo - CGJ SP - Legislação Aplicada')).toBe(true);
    expect(fits('Estatuto dos Funcionários Públicos do Estado de São Paulo - Lei nº 10.261/1968')).toBe(true);
    expect(fits('Lei Orgânica do Município de São Paulo')).toBe(false);
    expect(fits('Direito Processual Civil - CPC 2015')).toBe(true);
  });
  it('em Suzano, só Suzano; o estado vale se a sessão citar', () => {
    const fits = placeFilter('Prefeitura Municipal de Suzano | Lei Orgânica do município de Suzano');
    expect(fits('Município de Suzano - Legislação Aplicada')).toBe(true);
    expect(fits('Lei Orgânica do Município de Campinas')).toBe(false);
    expect(fits('Constituição do Estado de São Paulo')).toBe(false);
    expect(placeFilter('Prefeitura Municipal de Suzano | Constituição do Estado de São Paulo')('Constituição do Estado de São Paulo')).toBe(true);
  });
  it('categorias que misturam lugares nunca servem', () => {
    expect(mixedPlaces('Conhecimentos Específicos dos Municípios')).toBe(true);
    expect(mixedPlaces('Legislação Estadual, Distrital e Municipal')).toBe(true);
    expect(placeFilter('Prefeitura Municipal de Suzano')('Conhecimentos Específicos dos Estados')).toBe(false);
  });
});

describe('organSearch', () => {
  it('nomeia o órgão como a API', () => {
    expect(organSearch('Tribunal de Justiça do Estado de São Paulo')).toEqual({ queries: ['TJ SP', 'Tribunal de Justiça de São Paulo'], marks: ['tj sp', 'tjsp'] });
    expect(organSearch('Tribunal Regional do Trabalho da 2ª Região').queries[0]).toBe('TRT 2');
    expect(organSearch('Ministério Público do Estado de São Paulo').queries[0]).toBe('MPE SP');
    expect(organSearch('Prefeitura Municipal de Suzano')).toEqual({ queries: [], marks: [] });
  });
});
