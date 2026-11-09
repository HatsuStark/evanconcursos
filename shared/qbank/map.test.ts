import { describe, expect, it } from 'vitest';
import { theoryGoal } from '../domain/scheduler.ts';
import { assuntoTerms, carreiraPrompt, CARREIRA_MIN, usefulCarreira, dominantFormat, localPlace, materiaQueries, orgaoKeyword, pickBoard, stem, equalIncidence, interleave, inTurn, assuntoPrompt, prefilterAssuntos, mapSession, mapSubject, measureIncidence, newestPage, recentMinYear, usefulNarrowing, planPicks, roleKeyword, searchFilters, type MapDeps } from './map.ts';

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

describe('busca da banca primeiro', () => {
  it('marca os filtros da banca do edital; sem banca, nenhum', () => {
    const f = { materia: 'Direito Processual Civil - CPC 2015', assuntos: ['Competência'], how: '' };
    const withBoard = searchFilters(f, 'VUNESP');
    expect(withBoard.filter((x) => x.board).every((x) => x.params.banca === 'VUNESP')).toBe(true);
    expect(withBoard.filter((x) => !x.board).every((x) => !x.params.banca)).toBe(true);
    expect(withBoard.some((x) => x.board) && withBoard.some((x) => !x.board)).toBe(true);
    expect(searchFilters(f, '').some((x) => x.board)).toBe(false);
  });
});

describe('measureIncidence', () => {
  const filter = { materia: 'Direito Penal', assuntos: ['a', 'b'], how: '' };
  it('mede na banca do edital', async () => {
    const calls: Record<string, string>[] = [];
    const r = await measureIncidence(async (p) => { calls.push(p); return p.assunto === 'a' ? 10 : p.banca ? 0 : 7; }, filter, 'FGV');
    expect(r).toEqual([{ assunto: 'a', total: 10 }, { assunto: 'b', total: 0 }]);
    expect(calls.filter((c) => !c.banca).map((c) => c.assunto)).toEqual(['b']);
  });
  it('assunto sem questão em banca nenhuma sai da sessão', async () => {
    const r = await measureIncidence(async (p) => (p.assunto === 'a' ? 10 : 0), filter, 'FGV');
    expect(r).toEqual([{ assunto: 'a', total: 10 }]);
  });
  it('assunto com menos de 5 questões nas outras bancas também sai', async () => {
    expect(await measureIncidence(async (p) => (p.assunto === 'a' ? 10 : p.banca ? 0 : 4), filter, 'FGV')).toEqual([{ assunto: 'a', total: 10 }]);
  });
  it('fica com os 5 primeiros assuntos com questões, na ordem do mapa, e para de medir', async () => {
    const asked: string[] = [];
    const r = await measureIncidence(async (p) => { if (p.banca) asked.push(p.assunto!); return p.assunto === 'x2' ? 0 : 3; },
      { ...filter, assuntos: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'] }, 'FGV');
    expect(r.map((i) => i.assunto)).toEqual(['x1', 'x3', 'x4', 'x5', 'x6']);
    expect(asked).toEqual(['x1', 'x2', 'x3', 'x4', 'x5', 'x6']);
  });
  it('cargo e escolaridade só estreitam a busca quando rendem', () => {
    expect(usefulNarrowing(6173, 178)).toBe(false);   // Oficial de Justiça no CPC: quase todo assunto volta vazio
    expect(usefulNarrowing(6173, 5992)).toBe(false);  // nível superior: 97% da matéria, repete a busca sem filtro
    expect(usefulNarrowing(6173, 2500)).toBe(true);
  });
  it('sem questão em lugar nenhum, não sobra assunto', async () => {
    expect(await measureIncidence(async () => 0, filter, 'FGV')).toEqual([]);
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
    ai: (async () => ({ materia: pick, materias: [pick], assuntos: ['Atualidades e Conhecimentos Gerais 1'] })) as MapDeps['ai'],
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

  it('ano mínimo das provas: só em atualidades', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    expect(recentMinYear('Atualidades e Conhecimentos Gerais', now)).toBe(2025);
    expect(recentMinYear('Direito Penal', now)).toBeUndefined();
    expect(recentMinYear(null, now)).toBeUndefined();
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
    expect(p).toMatch(/nome do próprio tema ou de uma parte dele não é genérico/);
  });
});

describe('disciplina com nome composto (qmap-v7)', () => {
  // A API busca pelo trecho: o nome composto inteiro não acha nada.
  const api: Record<string, string[]> = { Economia: ['Economia', 'Microeconomia', 'Macroeconomia'], 'Finanças públicas': ['Finanças Públicas'], Microeconomia: ['Microeconomia'], públicas: ['Políticas Públicas'] };
  const searched: string[] = [];
  const deps = (pick: string): MapDeps => ({
    materias: async (q) => { searched.push(q); return api[q] ?? []; },
    assuntosOf: async (m) => Array.from({ length: 30 }, (_, i) => `${m} ${i}`),
    ai: (async (_s: unknown, _j: unknown, prompt: string) => (prompt.includes('Escolha a matéria') ? { materia: pick, materias: [pick] } : { assuntos: ['Microeconomia 1', 'Microeconomia 2'] })) as MapDeps['ai'],
  });

  it('busca cada parte do nome', () => {
    expect(materiaQueries('Economia e Finanças públicas')).toEqual(['Economia e Finanças públicas', 'Economia', 'Finanças públicas', 'públicas']);
    expect(materiaQueries('Direito Penal')).toEqual(['Direito Penal', 'Penal']);
  });

  it('as partes viram candidatas da disciplina', async () => {
    let shown = '';
    const d = deps('Economia');
    const r = await mapSubject({ ...d, ai: (async (s: unknown, j: unknown, p: string) => { shown = p; return d.ai(s as never, j, p); }) as MapDeps['ai'] }, { name: 'Economia e Finanças públicas', topics: [] });
    expect(r.materia).toBe('Economia');
    expect(shown).toContain('- Finanças Públicas');
  });

  it('sessão sem matéria da disciplina busca pelas palavras longas do título', async () => {
    searched.length = 0;
    const r = await mapSession(deps('Microeconomia'), null, { subject: 'Economia e Finanças públicas', title: 'Introdução à Microeconomia e Mercados: demanda, oferta e elasticidades', keyword: '', topics: [] });
    expect(searched).toContain('Microeconomia');
    expect(searched).not.toContain('Introdução');
    expect(r).toMatchObject({ materia: 'Microeconomia', how: 'matéria pela sessão' });
  });
});

describe('disciplina de nome genérico (qmap-v8)', () => {
  it('"Conhecimentos Específicos" não casa com "Conhecimentos Específicos das Regiões": a sessão escolhe a matéria', async () => {
    const deps: MapDeps = { materias: async () => ['Conhecimentos Específicos das Regiões'], assuntosOf: async () => ['a'], ai: (async () => ({ materia: '' })) as MapDeps['ai'] };
    expect(await mapSubject(deps, { name: 'Conhecimentos Específicos', topics: ['Higienização e limpeza.'] })).toEqual({ materia: null, how: 'nome genérico: matéria por sessão' });
  });
});

describe('matéria da sessão: comparação e até 2 matérias (qmap-v9)', () => {
  const lists: Record<string, string[]> = {
    'Economia e Finanças': ['Política Fiscal', 'Elasticidades', 'Modelo de Oferta e Demanda'],
    Microeconomia: ['Elasticidades', 'Curva da Demanda', 'Bens Inferiores e Bens de Giffen'],
    Ética: ['Ética Profissional', 'Ética no Serviço Público'],
    'Relações Humanas': ['Competência Interpessoal', 'Trabalho em equipe', 'Relações humanas no trabalho'],
  };
  const deps = (found: Record<string, string[]>, materias: string[], assuntos: Record<string, string[]>): MapDeps => ({
    materias: async (q) => found[q] ?? [],
    assuntosOf: async (m) => lists[m] ?? [],
    ai: (async (_s: unknown, _j: unknown, prompt: string) => {
      if (prompt.includes('uma segunda só quando')) return { materias };
      const m = /no banco de questões: (.+)\)/.exec(prompt)![1]!;
      return { assuntos: assuntos[m] ?? [] };
    }) as MapDeps['ai'],
  });
  const micro = { subject: 'Economia e Finanças públicas', title: 'Microeconomia: demanda, oferta e elasticidades', keyword: 'microeconomia', topics: [] };

  it('a matéria da disciplina fica, a do tema acrescenta, e os assuntos das duas se intercalam', async () => {
    const d = deps({ microeconomia: ['Microeconomia'], Microeconomia: ['Microeconomia'] }, ['Microeconomia', 'Economia e Finanças'],
      { Microeconomia: ['Elasticidades', 'Curva da Demanda'], 'Economia e Finanças': ['Modelo de Oferta e Demanda', 'Elasticidades'] });
    const r = await mapSession(d, 'Economia e Finanças', micro);
    expect(r).toEqual({
      materia: 'Economia e Finanças', assuntos: ['Modelo de Oferta e Demanda', 'Elasticidades', 'Curva da Demanda'], how: 'duas matérias',
      materiaOf: { Elasticidades: 'Microeconomia', 'Curva da Demanda': 'Microeconomia' },
    });
    // A busca e a medição usam a matéria de cada assunto; a chave da principal não muda (as posições salvas continuam valendo).
    const fs = searchFilters(r, '', { difficulties: ['3'] });
    expect(fs.filter((f) => f.key.startsWith('*:')).map((f) => [f.key, f.params.materia])).toEqual([
      ['*:Modelo de Oferta e Demanda:d3', 'Economia e Finanças'], ['*:Microeconomia>Elasticidades:d3', 'Microeconomia'], ['*:Microeconomia>Curva da Demanda:d3', 'Microeconomia'],
    ]);
    const asked: string[] = [];
    await measureIncidence(async (p) => { asked.push(`${p.materia}/${p.assunto}`); return 10; }, r, '');
    expect(asked).toContain('Microeconomia/Curva da Demanda');
  });

  it('sem outra matéria no tema, fica a da disciplina sem chamar a IA de matérias', async () => {
    const d = deps({}, ['Microeconomia'], { 'Economia e Finanças': ['Política Fiscal'] });
    expect(await mapSession(d, 'Economia e Finanças', { ...micro, title: 'Política fiscal', keyword: 'política fiscal' })).toEqual({ materia: 'Economia e Finanças', assuntos: ['Política Fiscal'], how: 'matéria da disciplina' });
  });

  it('tema com partes em matérias diferentes junta as duas', async () => {
    const d = deps({ 'relações interpessoais': [], 'Ética e Relações Interpessoais': [], Interpessoais: [], Relações: ['Relações Humanas'] }, ['Relações Humanas', 'Ética'],
      { 'Relações Humanas': ['Competência Interpessoal'], Ética: ['Ética Profissional'] });
    const r = await mapSession(d, 'Ética', { subject: 'Conhecimentos Específicos', title: 'Ética e Relações Interpessoais: convivência e atendimento', keyword: 'relações interpessoais', topics: [] });
    expect(r.how).toBe('duas matérias');
    expect(r.materia).toBe('Ética');
    expect(r.materiaOf).toEqual({ 'Competência Interpessoal': 'Relações Humanas' });
  });

  it('matéria de um assunto só não concorre: a sessão de crase fica em Língua Portuguesa', async () => {
    const asked: string[] = [];
    const d: MapDeps = {
      materias: async () => ['Crase'], assuntosOf: async (m) => (m === 'Crase' ? ['Emprego do sinal indicativo de crase'] : ['Crase', 'Pontuação', 'Regência']),
      ai: (async (_s: unknown, _j: unknown, p: string) => { asked.push(p.includes('uma segunda só quando') ? 'materias' : 'assuntos'); return { materias: ['Crase'], assuntos: ['Crase'] }; }) as MapDeps['ai'],
    };
    expect(await mapSession(d, 'Língua Portuguesa', { subject: 'Língua Portuguesa', title: 'Crase: casos obrigatórios e proibidos', keyword: 'crase', topics: [] })).toEqual({ materia: 'Língua Portuguesa', assuntos: ['Crase'], how: 'matéria da disciplina' });
    expect(asked).toEqual(['assuntos']);
  });

  it('a IA recusa as candidatas: a matéria da disciplina continua', async () => {
    const d = deps({ microeconomia: ['Dados Abertos'] }, [], { 'Economia e Finanças': ['Elasticidades'] });
    expect((await mapSession(d, 'Economia e Finanças', micro)).materia).toBe('Economia e Finanças');
  });
});

describe('busca parcial de assuntos e plural (qmap-v10)', () => {
  it('singular aproximado no pré-filtro', () => {
    expect(['elasticidades', 'funcoes', 'acoes', 'gerais', 'crase'].map(stem)).toEqual(['elasticidade', 'funcao', 'acao', 'geral', 'crase']);
    const lista = [...Array.from({ length: 200 }, (_, i) => `Assunto ${i}`), 'Elasticidades'];
    expect(prefilterAssuntos(lista, 'Elasticidade preço da demanda', 3)[0]).toBe('Elasticidades');
  });
  it('trechos do tema para a busca: palavras longas, no singular, sem as genéricas', () => {
    expect(assuntoTerms('Introdução à Microeconomia e Mercados: fluxo circular', 'elasticidades')).toEqual(['microeconomia', 'elasticidade', 'mercado']);
    expect(assuntoTerms('Crase: casos obrigatórios', 'crase')).toEqual(['crase']);
  });
  it('lista grande: o que a busca parcial acha entra antes do corte do pré-filtro', async () => {
    // "Acento grave" não tem a palavra do tema: sem a busca da API, o pré-filtro o deixaria fora dos 120.
    const lista = [...Array.from({ length: 300 }, (_, i) => `Tópico ${i}`), 'Acento grave'];
    const shown: string[] = [];
    const d = (matching: boolean): MapDeps => ({
      materias: async () => [], assuntosOf: async () => lista,
      ...(matching ? { assuntosMatching: async (_m: string, q: string) => (q === 'crase' ? ['Acento grave', 'Inexistente'] : []) } : {}),
      ai: (async (_s: unknown, _j: unknown, p: string) => { shown.push(p); return { assuntos: ['Acento grave'] }; }) as MapDeps['ai'],
    });
    const session = { subject: 'Língua Portuguesa', title: 'Crase', keyword: 'crase', topics: [] };
    expect((await mapSession(d(true), 'Língua Portuguesa', session)).assuntos).toEqual(['Acento grave']);
    expect(shown[0]).toContain('- Acento grave');
    await mapSession(d(false), 'Língua Portuguesa', session);
    expect(shown[1]).not.toContain('- Acento grave');
  });
});

describe('provas do mesmo órgão primeiro', () => {
  it('nome do órgão como a API escreve', () => {
    expect(orgaoKeyword('Tribunal de Justiça do Estado de São Paulo')).toBe('TJ SP');
    expect(orgaoKeyword('Prefeitura Municipal de Suzano')).toBe('Prefeitura de Suzano');
    expect(orgaoKeyword('Câmara Municipal de Cotia')).toBe('Câmara de Cotia');
    expect(orgaoKeyword('Receita Federal do Brasil')).toBe('');
  });
  it('o órgão vira a primeira etapa da busca', () => {
    const fs = searchFilters({ materia: 'Direito Penal', assuntos: ['Peculato'], how: '' }, 'VUNESP', { orgao: 'TJ SP', level: 'Médio', difficulties: ['3'] });
    expect(fs[0]!.params).toMatchObject({ orgao: 'TJ SP', banca: 'VUNESP', materia: 'Direito Penal', assunto: 'Peculato' });
    expect(fs.findIndex((f) => f.params.nivel_escolaridade)).toBeGreaterThan(fs.findIndex((f) => f.params.orgao && !f.params.banca));
  });
});

describe('carreira do edital', () => {
  it('etapa entre cargo e escolaridade', () => {
    const fs = searchFilters({ materia: 'Direito Penal', assuntos: ['Peculato'], how: '' }, '', { orgao: 'TJ SP', role: 'Oficial de Justiça', carreiras: ['Tribunais / Justiça Comum', 'Tribunais'], level: 'Médio', difficulties: ['3'] });
    const order = fs.filter((f) => f.key.endsWith('|*:Peculato:d3') || f.key === '*:Peculato:d3').map((f) => f.key.split(':')[0]);
    expect(order).toEqual(['o', 'c', 'k', 'k', 'Médio|*', '*']);
    expect(fs.filter((f) => f.key.startsWith('k:') && f.key.endsWith('|*:Peculato:d3')).map((f) => f.params.carreira)).toEqual(['Tribunais / Justiça Comum', 'Tribunais']);
  });
  it('só estreita quando rende e não é quase toda a matéria', () => {
    expect(usefulCarreira(1000, CARREIRA_MIN - 1)).toBe(false);
    expect(usefulCarreira(1000, 300)).toBe(true);
    expect(usefulCarreira(1000, 950)).toBe(false);
  });
  it('o prompt pede a específica e depois a geral', () => {
    const p = carreiraPrompt({ organization: 'TJSP', role: 'Oficial de Justiça', duties: '', level: 'Médio', candidates: ['Tribunais', 'Fiscal'] });
    expect(p).toMatch(/mais específica.*em seguida, a carreira geral/s);
    expect(p).toContain('- Tribunais\n- Fiscal');
  });
});
