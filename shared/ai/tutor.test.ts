import { describe, expect, it } from 'vitest';
import { LETTERS, type TutorQuestion } from '../domain/tutor.ts';
import { applyVerdicts, cleanQuestions, lessonUsable, shuffleOptions, tutorCacheKey, tutorQuestionsPrompt } from './tutor.ts';

const concepts = [{ id: 'c1', nome: 'Legalidade', essencial: '', explicacao: '', outro_jeito: '', base: '' }];
const q = (id: string, extra: Partial<TutorQuestion> = {}): TutorQuestion => ({
  id, etapa: 'construcao', conceito: 'c1', estilo: 'conceito', formato: 'multipla', enunciado: `Pergunta ${id} sobre um assunto qualquer distinto`,
  alternativas: ['A) um', 'B) dois', 'C) três', 'D) quatro'], gabarito: 'b', aceitas: ['x'], dica: '', explicacao: 'porque sim', erros: ['e1', '', 'e3'], ...extra,
});
const provided = [{ lawKey: 'CF', label: '37', num: 37, suffix: '' }];

describe('cleanQuestions', () => {
  it('corrige a forma: letras nas alternativas, gabarito, erros e aceitas', () => {
    const { kept } = cleanQuestions([q('k1')], { concepts, provided, subject: 'Direito Administrativo' });
    const k = kept[0]!;
    expect([...k.alternativas].sort()).toEqual(['dois', 'quatro', 'três', 'um']);
    expect(k.aceitas).toEqual([]);
    // Embaralhadas: o gabarito e os "erros" acompanham cada alternativa.
    expect(k.alternativas[LETTERS.indexOf(k.gabarito)]).toBe('dois');
    expect(k.erros[k.alternativas.indexOf('um')]).toBe('e1');
    expect(k.erros[k.alternativas.indexOf('dois')]).toBe('');
  });
  it('espalha o gabarito entre as letras', () => {
    const letters = new Set(Array.from({ length: 30 }, (_, i) => shuffleOptions({ id: `q${i}`, enunciado: `e${i}`, alternativas: ['a', 'b', 'c', 'd', 'e'], gabarito: 'B', erros: [] }).gabarito));
    expect(letters.size).toBeGreaterThanOrEqual(4);
  });
  it('descarta estrutura inválida, conceito desconhecido e repetidas', () => {
    const { kept, dropped } = cleanQuestions([
      q('k1'), q('k2', { gabarito: 'F' }), q('k3', { conceito: 'c9' }), q('k4', { enunciado: 'Pergunta k1 sobre um assunto qualquer distinto' }),
      q('k5', { formato: 'lacuna', enunciado: 'Sem espaço', alternativas: [], gabarito: 'x' }),
      q('k6', { formato: 'certo_errado', alternativas: [], gabarito: 'Certo', enunciado: 'Outra afirmação totalmente nova aqui' }),
    ], { concepts, provided, subject: 'Direito Administrativo' });
    expect(kept.map((x) => x.id)).toEqual(['k1', 'k6']);
    expect(kept[1]!.gabarito).toBe('C');
    expect(dropped.map((d) => d.id)).toEqual(['k2', 'k3', 'k4', 'k5']);
  });
  it('descarta pergunta que fala em termo destacado sem marcar', () => {
    const { kept, dropped } = cleanQuestions([
      q('k1', { enunciado: 'No trecho "este e aquele", os pronomes destacados retomam quem?' }),
      q('k2', { enunciado: 'No trecho, os pronomes **este** e **aquele** destacados retomam quem?' }),
    ], { concepts, provided, subject: 'Português' });
    expect(dropped).toMatchObject([{ id: 'k1', motivo: 'destaque sem marcação' }]);
    expect(kept.map((x) => x.id)).toEqual(['k2']);
  });
  it('descarta pergunta que cita artigo fora das fontes', () => {
    const { kept, dropped } = cleanQuestions([q('k1', { explicacao: 'Conforme o art. 5º da CF.' }), q('k2', { enunciado: 'Segundo o art. 37 da CF, algo novo', explicacao: 'CF, art. 37.' })], { concepts, provided, subject: 'Direito Constitucional' });
    expect(dropped[0]).toMatchObject({ id: 'k1' });
    expect(kept.map((x) => x.id)).toEqual(['k2']);
  });
});

describe('aula', () => {
  it('reprovadas pelo revisor saem', () => {
    expect(applyVerdicts([q('a'), q('b')], { avaliacoes: [{ id: 'a', aprovada: false, motivo: 'x' }] }).map((x) => x.id)).toEqual(['b']);
    expect(applyVerdicts([q('a')], null)).toHaveLength(1);
  });
  it('aula sem construção não serve', () => {
    expect(lessonUsable({ conceitos: [...concepts, { ...concepts[0]!, id: 'c2' }], questoes: [q('k1')] })).toBe(false);
    expect(lessonUsable({ conceitos: [...concepts, { ...concepts[0]!, id: 'c2' }], questoes: [q('k1'), q('k2')] })).toBe(true);
  });
  it('chave estável e sensível às fontes', () => {
    const base = { banca: 'FGV', subject: 'Português', title: 'Crase (parte 1 de 2)', topics: ['b', 'a'], law: [] };
    expect(tutorCacheKey(base)).toBe(tutorCacheKey({ ...base, topics: ['a', 'b'], title: 'Crase' }));
    expect(tutorCacheKey(base)).not.toBe(tutorCacheKey({ ...base, law: [{ ref: 'CF, art. 1', text: 'x' }] }));
  });
  it('prompt da prática pede as etapas certas', () => {
    const p = tutorQuestionsPrompt({ banca: 'Cebraspe', cargo: '', subject: 'S', title: 'T', topics: [], law: [], format: 'certo ou errado' }, { titulo: 'T', conceitos: concepts }, 'pratica');
    expect(p).toContain('fixacao');
    expect(p).not.toContain('diagnostico:');
    expect(p).toContain('é o formato da banca');
  });
});
