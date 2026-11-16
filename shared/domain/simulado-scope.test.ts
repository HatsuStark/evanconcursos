import { describe, expect, it } from 'vitest';
import { chooseScope, examCoverage, FULL_COVERAGE, studiedCounts, subjectCoverage } from './simulado-scope.ts';

describe('simulado do conteúdo estudado', () => {
  const subjects = [
    { key: 'port', count: 20, total: 10, done: 5 },
    { key: 'const', count: 30, total: 6, done: 6 },
    { key: 'adm', count: 30, total: 8, done: 0 },
  ];

  it('mede a cobertura pelas questões de cada matéria', () => {
    expect(examCoverage(subjects)).toBeCloseTo((20 * 0.5 + 30) / 80);
    expect(examCoverage([])).toBe(0);
    expect(subjectCoverage({ total: 0, done: 3 })).toBe(0);
    expect(subjectCoverage({ total: 4, done: 9 })).toBe(1);
  });

  it('escolhe o escopo pela cobertura, salvo pedido explícito', () => {
    expect(chooseScope(0.3)).toBe('estudado');
    expect(chooseScope(FULL_COVERAGE)).toBe('edital');
    expect(chooseScope(0.1, 'edital')).toBe('edital');
    expect(chooseScope(0.9, 'estudado')).toBe('estudado');
    expect(chooseScope(0.9, 'qualquer')).toBe('edital');
  });

  it('leva a parte da prova já vista e deixa fora matéria não começada', () => {
    const c = studiedCounts(subjects);
    expect(c.get('port')).toBe(10);
    expect(c.get('const')).toBe(30);
    expect(c.has('adm')).toBe(false);
  });

  it('sobe até o mínimo sem passar da prova da matéria', () => {
    const c = studiedCounts([{ key: 'a', count: 10, total: 10, done: 1 }, { key: 'b', count: 10, total: 10, done: 1 }]);
    expect(c.get('a')).toBe(10);
    expect(c.get('b')).toBe(10);
    const d = studiedCounts([{ key: 'a', count: 5, total: 10, done: 1 }]);
    expect(d.get('a')).toBe(5);
  });
});
