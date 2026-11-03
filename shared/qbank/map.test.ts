import { describe, expect, it } from 'vitest';
import { theoryGoal } from '../domain/scheduler.ts';
import { dominantFormat, localPlace, pickBoard, equalIncidence, interleave, inTurn, assuntoPrompt, prefilterAssuntos, mapSession, mapSubject, measureIncidence, newestPage, planPicks, roleKeyword, searchFilters, type MapDeps } from './map.ts';

const tally = (picks: string[]) => picks.reduce<Record<string, number>>((m, a) => ({ ...m, [a]: (m[a] ?? 0) + 1 }), {});

describe('theoryGoal', () => {
  it('fica entre 5 e 10 questões, qualquer que seja o tempo', () => {
    expect([30, 60, 90, 120, 240].map((m) => theoryGoal(m))).toEqual([5, 5, 8, 10, 10]);
  });
});

describe('planPicks', () => {
  it('passa por todos os assuntos antes de repetir, do mais ao menos cobrado', () => {
    const inc = [{ assunto: 'raro', total: 5 }, { assunto: 'comum', total: 500 }, { assunto: 'médio', total: 50 }];
    expect(planPicks(inc, new Map(), 3)).toEqual(['comum', 'médio', 'raro']);
  });
  it('depois da primeira passada, o mais cobrado recebe mais', () => {
    const inc = [{ assunto: 'comum', total: 300 }, { assunto: 'raro', total: 100 }];
    expect(tally(planPicks(inc, new Map(), 8))).toEqual({ comum: 6, raro: 2 });
  });
  it('assunto ainda sem questão respondida vem primeiro, mesmo sendo o menos cobrado', () => {
    const inc = [{ assunto: 'Comum', total: 300 }, { assunto: 'Raro', total: 10 }];
    expect(planPicks(inc, new Map([['comum', 4]]), 1)).toEqual(['Raro']);
  });
  it('conta o que já foi respondido, sem diferenciar acento e caixa', () => {
    const inc = [{ assunto: 'Prisão', total: 100 }, { assunto: 'Fiança', total: 100 }];
    expect(planPicks(inc, new Map([['prisao', 3], ['fianca', 1]]), 2)).toEqual(['Fiança', 'Fiança']);
  });
  it('assunto sem questões na banca ainda recebe a primeira passada', () => {
    expect(planPicks([{ assunto: 'a', total: 100 }, { assunto: 'b', total: 0 }], new Map(), 2)).toEqual(['a', 'b']);
  });
  it('sem assuntos, não escolhe nada', () => {
    expect(planPicks([], new Map(), 5)).toEqual([]);
  });
});

describe('measureIncidence', () => {
  const filter = { materia: 'Direito Penal', assuntos: ['a', 'b'], how: '' };
  it('mede na banca do edital', async () => {
    const calls: Record<string, string>[] = [];
    const r = await measureIncidence(async (p) => { calls.push(p); return p.assunto === 'a' ? 10 : 0; }, filter, 'FGV');
    expect(r).toEqual([{ assunto: 'a', total: 10 }, { assunto: 'b', total: 0 }]);
    expect(calls.every((c) => c.banca === 'FGV')).toBe(true);
  });
  it('sem nenhuma questão na banca, usa o total das outras', async () => {
    const r = await measureIncidence(async (p) => (p.banca ? 0 : 7), filter, 'FGV');
    expect(r).toEqual([{ assunto: 'a', total: 7 }, { assunto: 'b', total: 7 }]);
  });
  it('Atualidades fica em partes iguais, sem gastar créditos', async () => {
    let calls = 0;
    const r = await measureIncidence(async () => { calls++; return 1; }, { ...filter, materia: 'Atualidades' }, 'FGV');
    expect(r).toEqual(equalIncidence(['a', 'b']));
    expect(calls).toBe(0);
  });
});

describe('matéria quase vazia', () => {
  const deps = (found: string[], pick = ''): MapDeps => ({
    materias: async () => found,
    assuntosOf: async (m) => (m === 'Atualidades' ? ['a', 'b', 'c', 'd', 'e'] : Array.from({ length: 200 }, (_, i) => `${m} ${i}`)),
    ai: (async () => ({ materia: pick, assuntos: ['Atualidades e Conhecimentos Gerais 1'] })) as MapDeps['ai'],
  });
  it('a disciplina fica com a versão cheia, mesmo com o nome igual ao da vazia', async () => {
    const r = await mapSubject(deps(['Atualidades', 'Atualidades do Mercado Financeiro', 'Atualidades e Conhecimentos Gerais']), { name: 'Atualidades', topics: [] });
    expect(r.materia).toBe('Atualidades e Conhecimentos Gerais');
  });
  it('a sessão sem assunto na disciplina também não cai na vazia', async () => {
    const r = await mapSession(deps(['Atualidades'], 'Atualidades e Conhecimentos Gerais'), null, { subject: 'Conhecimentos', title: 'Atualidades', keyword: 'atualidades', topics: [] });
    expect(r.materia).toBe('Atualidades e Conhecimentos Gerais');
    expect(r.assuntos).toEqual(['Atualidades e Conhecimentos Gerais 1']);
  });
});

describe('disciplina com nome que não bate pelas palavras', () => {
  const deps: MapDeps = { materias: async () => ['Alfabeto português'], assuntosOf: async () => ['a', 'b', 'c'], ai: (async () => { throw new Error('não deveria chamar a IA'); }) as MapDeps['ai'] };
  it('"Português" vai para Língua Portuguesa, não para "Alfabeto português"', async () => {
    for (const name of ['Português', 'PORTUGUÊS', 'Noções de Português', 'Português e Redação']) expect((await mapSubject(deps, { name, topics: [] })).materia).toBe('Língua Portuguesa');
  });
  it('raciocínio lógico e inglês têm nome certo sem gastar IA', async () => {
    expect((await mapSubject(deps, { name: 'Raciocínio Lógico-Matemático', topics: [] })).materia).toBe('Raciocínio Lógico');
    expect((await mapSubject(deps, { name: 'Inglês', topics: [] })).materia).toBe('Língua Inglesa');
  });
});

describe('searchFilters', () => {
  const filter = { materia: 'M', assuntos: ['a'], how: '' };
  it('só busca dificuldade média ou maior, em todas as etapas', () => {
    for (const level of ['', 'Superior']) {
      expect(new Set(searchFilters(filter, 'FGV', { level }).map((f) => f.params.dificuldade))).toEqual(new Set(['3', '4', '5']));
      expect(searchFilters(filter, 'FGV', { level }).every((f) => f.params.dificuldade)).toBe(true);
    }
  });
  it('sem escolaridade: banca antes das outras', () => {
    expect(searchFilters(filter, 'FGV').map((f) => f.key)).toEqual(['b:a:d3', 'b:a:d4', 'b:a:d5', '*:a:d3', '*:a:d4', '*:a:d5']);
  });
  it('com escolaridade: solta a banca e depois a escolaridade', () => {
    const steps = [...new Map(searchFilters(filter, 'FGV', { level: 'Médio' }).map((f) => [f.tier, [f.params.nivel_escolaridade, f.params.banca]])).values()];
    expect(steps).toEqual([['Médio', 'FGV'], ['Médio', undefined], [undefined, 'FGV'], [undefined, undefined]]);
  });
  it('mesmo cargo vem antes de tudo', () => {
    const steps = [...new Map(searchFilters(filter, 'FGV', { level: 'Médio', role: 'Oficial de Justiça' }).map((f) => [f.tier, [f.params.cargo, f.params.nivel_escolaridade, f.params.banca]])).values()];
    expect(steps).toEqual([['Oficial de Justiça', undefined, 'FGV'], ['Oficial de Justiça', undefined, undefined], [undefined, 'Médio', 'FGV'], [undefined, 'Médio', undefined], [undefined, undefined, 'FGV'], [undefined, undefined, undefined]]);
  });
  it('o formato da banca vale só nas outras bancas: na própria, vem o que ela cobra', () => {
    for (const f of searchFilters(filter, 'CESPE', { level: 'Superior', role: 'Analista', format: 'certo e errado' })) {
      expect(f.params.tipo).toBe(f.params.banca ? undefined : 'certo e errado');
    }
  });
  it('atualidades: só provas recentes, com os mesmos filtros', () => {
    const r = searchFilters({ materia: 'Atualidades', assuntos: ['a'], how: '' }, 'FGV', { level: 'Superior', format: 'multipla escolha' }, new Date('2026-06-01T12:00:00Z'));
    expect(new Set(r.map((f) => f.params.ano))).toEqual(new Set(['2026', '2025']));
    expect(r.every((f) => !f.params.banca && f.params.dificuldade && f.params.tipo)).toBe(true);
    expect(r[0]!.params.nivel_escolaridade).toBe('Superior');
  });
});

describe('dominantFormat', () => {
  it('só escolhe com 60% ou mais', () => {
    expect(dominantFormat({ 'multipla escolha': 581, 'certo e errado': 0 })).toBe('multipla escolha');
    expect(dominantFormat({ 'multipla escolha': 321, 'certo e errado': 701 })).toBe('certo e errado');
    expect(dominantFormat({ 'multipla escolha': 50, 'certo e errado': 50 })).toBe('');
    expect(dominantFormat({ 'multipla escolha': 0, 'certo e errado': 0 })).toBe('');
  });
});

describe('roleKeyword', () => {
  it('fica só com o nome do cargo', () => {
    expect(roleKeyword('Oficial de Justiça')).toBe('Oficial de Justiça');
    expect(roleKeyword('Analista Judiciário - Área Judiciária')).toBe('Analista Judiciário');
    expect(roleKeyword('Técnico (Administrativo)')).toBe('Técnico');
    expect(roleKeyword('')).toBe('');
  });
});

describe('newestPage', () => {
  // Percorre como a busca: cada página precisa terminar na posição atual, sem pular nem repetir.
  const walk = (total: number, want: number) => {
    const out: number[] = [];
    for (let position = total; position > 0;) {
      const { page, perPage } = newestPage(position, want);
      expect(perPage).toBeLessThanOrEqual(want);
      for (let i = page * perPage; i > (page - 1) * perPage; i--) out.push(i);
      position -= perPage;
    }
    return out;
  };
  it('vem da mais nova para a mais antiga, sem pular nenhuma', () => {
    for (const [total, want] of [[1, 5], [7, 3], [10, 5], [13, 4], [100, 20], [97, 1]] as const) {
      expect(walk(total, want)).toEqual(Array.from({ length: total }, (_, i) => total - i));
    }
  });
});

describe('interleave', () => {
  it('alterna as listas, mesmo com tamanhos diferentes', () => {
    expect(interleave([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
    expect(interleave([])).toEqual([]);
  });
});

describe('inTurn', () => {
  const filters = searchFilters({ materia: 'M', assuntos: ['a'], how: '' }, 'FGV');
  it('alterna a dificuldade a cada vez, sem sair da etapa', () => {
    expect([0, 1, 2, 3, 4].map((turn) => inTurn(filters, turn)[0]!.params.dificuldade)).toEqual(['3', '4', '5', '3', '4']);
    expect(inTurn(filters, 1).map((f) => f.tier)).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

describe('pickBoard', () => {
  const api: Record<string, string[]> = {
    Instituto: ['Instituto JK', 'Instituto AOCP'], nosso: ['NOSSO RUMO'], rumo: ['NOSSO RUMO'], fgv: ['FGV'], FGV: ['FGV'], fcc: ['FCC'],
    VUNESP: ['VUNESP'], Cebraspe: ['CESPE CEBRASPE'], 'Instituto AOCP': ['Instituto AOCP'],
  };
  const search = async (q: string) => api[q] ?? [];
  it('acha a banca pelo nome sem a palavra genérica, nunca a primeira de "Instituto"', async () => {
    expect(await pickBoard('Instituto Nosso Rumo', search)).toBe('NOSSO RUMO');
    expect(await pickBoard('Instituto AOCP', search)).toBe('Instituto AOCP');
  });
  it('acha pela sigla e pelo nome contido', async () => {
    expect(await pickBoard('Fundação Getulio Vargas', search)).toBe('FGV');
    expect(await pickBoard('Fundação Carlos Chagas', search)).toBe('FCC');
    expect(await pickBoard('Cebraspe', search)).toBe('CESPE CEBRASPE');
    expect(await pickBoard('VUNESP', search)).toBe('VUNESP');
  });
  it('sem correspondência, fica sem banca', async () => {
    expect(await pickBoard('Instituto Desconhecido', search)).toBe('');
  });
});

describe('sessão do município do edital', () => {
  it('lê o município do órgão', () => {
    expect(localPlace('Prefeitura Municipal de Suzano')).toBe('Suzano');
    expect(localPlace('Câmara Municipal de Mogi das Cruzes/SP')).toBe('Mogi das Cruzes');
    expect(localPlace('Prefeitura de São José dos Campos - SP')).toBe('São José dos Campos');
    expect(localPlace('Tribunal de Justiça do Estado de São Paulo')).toBe('');
  });
  const deps = (found: string[], pick: string): MapDeps => ({
    materias: async () => found,
    assuntosOf: async () => ['Lei Orgânica', 'Estatuto'],
    ai: (async () => ({ materia: pick, assuntos: ['Lei Orgânica'] })) as MapDeps['ai'],
  });
  const session = { subject: 'Conhecimentos Específicos', title: 'Lei Orgânica de Suzano', keyword: 'Lei Orgânica Suzano', topics: [], organization: 'Prefeitura Municipal de Suzano' };
  it('usa só a matéria do município, nunca a genérica de municípios', async () => {
    const r = await mapSession(deps(['Município de Suzano - Legislação Aplicada', 'Conhecimentos Específicos dos Municípios'], 'Município de Suzano - Legislação Aplicada'), 'Conhecimentos Específicos dos Estados', session);
    expect(r).toEqual({ materia: 'Município de Suzano - Legislação Aplicada', assuntos: ['Lei Orgânica', 'Estatuto'], how: 'matéria do município' });
  });
  it('sem matéria do município, a sessão fica sem questões', async () => {
    const r = await mapSession(deps(['Conhecimentos Específicos dos Municípios'], 'Conhecimentos Específicos dos Municípios'), 'Conhecimentos Específicos dos Estados', session);
    expect(r.materia).toBeNull();
  });
  it('sessão que não fala do município segue a regra comum', async () => {
    const r = await mapSession(deps([], ''), 'Pedagogia', { ...session, title: 'ECA na escola', keyword: 'ECA' });
    expect(r.how).toBe('matéria da disciplina');
  });
});

describe('sessão do órgão do edital', () => {
  const asked: string[] = [];
  const deps: MapDeps = {
    materias: async (q) => { asked.push(q); return q === 'TJ SP' ? ['Legislação Aplicada - TJ SP'] : q === 'Corregedoria' ? ['Normas da Corregedoria-Geral de Justiça do Estado de Minas Gerais', 'Corregedoria Geral da Justiça de São Paulo - CGJ SP - Legislação Aplicada'] : []; },
    assuntosOf: async (m) => (m === 'Legislação Especial' ? ['Lei de Drogas'] : ['Legislação dos Órgãos']),
    ai: (async (_s: unknown, _j: unknown, prompt: string) => ({ materia: prompt.includes('Minas Gerais') ? 'Normas da Corregedoria-Geral de Justiça do Estado de Minas Gerais' : 'Corregedoria Geral da Justiça de São Paulo - CGJ SP - Legislação Aplicada', assuntos: [] })) as MapDeps['ai'],
  };
  it('"Normas TJSP" usa as matérias do TJ SP e da corregedoria de SP, nunca a de outro estado', async () => {
    const r = await mapSession(deps, 'Legislação Especial', { subject: 'Legislação Especial', title: 'Normas TJSP - Disposições Gerais', keyword: 'Normas Corregedoria TJSP', topics: [], organization: 'Tribunal de Justiça do Estado de São Paulo' });
    expect(r).toEqual({ materia: 'Corregedoria Geral da Justiça de São Paulo - CGJ SP - Legislação Aplicada', assuntos: ['Legislação dos Órgãos'], how: 'matéria do órgão' });
    expect(asked).toContain('TJ SP');
  });
});

describe('tema da sessão como foco (qmap-v4)', () => {
  const item = 'Classes de palavras: emprego e sentido que imprimem às relações que estabelecem: substantivo, adjetivo, artigo, numeral, pronome, verbo, advérbio, preposição e conjunção.';
  it('pré-filtro: palavras do tema pesam mais que as do item do edital', () => {
    const lista = ['Pronomes', 'Conjunções', 'Verbos', ...Array.from({ length: 200 }, (_, i) => `Assunto ${i}`), 'Substantivos', 'Adjetivos'];
    const out = prefilterAssuntos(lista, 'Substantivos e Adjetivos: flexão substantivos adjetivos', 4, item);
    expect(out.slice(0, 2).sort()).toEqual(['Adjetivos', 'Substantivos']);
  });
  it('o prompt põe o tema como foco, o item do edital como contexto e evita o assunto genérico', () => {
    const p = assuntoPrompt({ subject: 'Língua Portuguesa', materia: 'Língua Portuguesa', title: 'Substantivos e Adjetivos: flexão de gênero e número', keyword: 'substantivo e adjetivo', topics: [item], assuntos: ['Substantivos'] });
    expect(p).toMatch(/Tema da sessão \(o foco\): Substantivos e Adjetivos/);
    expect(p).toMatch(/só contexto/);
    expect(p).toMatch(/Evite assunto genérico/);
  });
});
