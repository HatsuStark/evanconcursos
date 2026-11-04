import { describe, expect, it } from 'vitest';
import { arrangeBatch, generatedPrompt, generatedTheme, guideDigest, themeKind, toPublic, GENERATED_BANCA, GENERATED_PROMPT_VERSION } from './generated.ts';
import { prunedAssuntos, rejectedIds, relevancePrompt } from './relevance.ts';

const session = { subject: 'Direito Processual Penal', title: 'Prazos Processuais e Atos em Geral: contagem contínua e suspensão (arts. 792, 798 e 798-A do CPP)', keyword: 'prazos processuais' };

describe('triagem de relevância', () => {
  it('o prompt traz o tema, as alternativas sem HTML e é rigoroso na dúvida', () => {
    const p = relevancePrompt(session, [{ id: '1', assunto: 'Prazos', enunciado: '<p>Assinale a <b>correta</b>.</p>', alternativas: ['<p>No procedimento ordinário…</p>'] }]);
    expect(p).toMatch(/Tema da sessão: Prazos Processuais/);
    expect(p).toMatch(/A\) No procedimento ordinário…/);
    expect(p).not.toMatch(/<b>/);
    expect(p).toMatch(/Na dúvida, false/);
  });
  it('descarta só os ids pedidos e marcados fora do tema', () => {
    const bad = rejectedIds({ avaliacoes: [
      { id: '1', treina_o_tema: false, motivo: 'procedimento ordinário' }, { id: '2', treina_o_tema: true, motivo: 'contagem' }, { id: '9', treina_o_tema: false, motivo: 'outro lote' },
    ] }, ['1', '2', '3']);
    expect([...bad.keys()]).toEqual(['1']);
  });
});

describe('questões inéditas da IA', () => {
  const base = { qid: 'ia-1', materia: 'Direito Processual Penal', assunto: 'Prazos', theme: generatedTheme('Direito Processual Penal', session.title), year: 2026 };
  it('múltipla escolha: tira a letra do texto, valida o gabarito e marca como inédita', () => {
    const r = toPublic({ enunciado: 'Sobre a contagem dos prazos no processo penal, é correto afirmar:', alternativas: ['A) um', 'B) dois', 'três', 'quatro', 'cinco'], gabarito: 'c', fundamento: '' }, { ...base, format: 'multipla escolha' })!;
    expect(r.gabarito).toBe('C');
    expect(r.payload.alternativas.map((a) => a.texto)).toEqual(['um', 'dois', 'três', 'quatro', 'cinco']);
    expect(r.payload.prova.banca).toBe(GENERATED_BANCA);
    expect(r.payload.ia_tema).toBe(base.theme);
  });
  it('certo ou errado e gabarito inválido', () => {
    expect(toPublic({ enunciado: 'Os prazos processuais penais correm em cartório e são contínuos.', alternativas: [], gabarito: 'C', fundamento: '' }, { ...base, format: 'certo e errado' })!.payload.tipo).toBe('certo e errado');
    expect(toPublic({ enunciado: 'Sobre a contagem dos prazos no processo penal:', alternativas: ['a', 'b', 'c', 'd', 'e'], gabarito: 'Z', fundamento: '' }, { ...base, format: 'multipla escolha' })).toBeNull();
  });
  it('o prompt prende ao tema, às fontes e evita repetir questões já criadas', () => {
    const p = generatedPrompt({ banca: 'VUNESP', cargo: 'Escrevente', ...session, law: [{ ref: 'CPP, art. 798', text: 'Todos os prazos…' }], format: 'multipla escolha', n: 3, avoid: ['Questão antiga'] });
    expect(p).toMatch(/cobre SOMENTE este tema/);
    expect(p).toMatch(/\[CPP, art. 798\]/);
    expect(p).toMatch(/não repita/);
    expect(p).toMatch(/5 alternativas/);
  });
  it('média a difícil: caso concreto, distrator quase verdadeiro e questões reais como modelo', () => {
    const p = generatedPrompt({ banca: 'VUNESP', cargo: '', ...session, law: [], format: 'multipla escolha', n: 3, avoid: [],
      examples: [{ enunciado: '<p>Tício foi intimado numa sexta-feira…</p>', alternativas: ['segunda', 'terça'], gabarito: 'A', banca: 'VUNESP' }] });
    expect(p).toMatch(/caso concreto/);
    expect(p).toMatch(/troca um único detalhe/);
    expect(p).toMatch(/Proibido distrator absurdo/);
    expect(p).toMatch(/Exemplo 1 \(VUNESP\):\nTício foi intimado numa sexta-feira…\nA\) segunda\nB\) terça\nGabarito: A/);
  });
  it('marca a versão do prompt para não reaproveitar questões antigas', () => {
    const r = toPublic({ enunciado: 'Sobre a contagem dos prazos no processo penal, é correto afirmar:', alternativas: ['um', 'dois', 'três', 'quatro', 'cinco'], gabarito: 'A', fundamento: 'CPP, art. 798' }, { ...base, format: 'multipla escolha' })!;
    expect(r.payload.ia_versao).toBe(GENERATED_PROMPT_VERSION);
    expect(r.payload.ia_fontes).toBe(0);
    expect(toPublic({ enunciado: 'Sobre a contagem dos prazos no processo penal, é correto afirmar:', alternativas: ['um', 'dois', 'três', 'quatro', 'cinco'], gabarito: 'A', fundamento: '' }, { ...base, format: 'multipla escolha', sources: 7 })!.payload.ia_fontes).toBe(7);
  });
});

describe('corte de assunto ruim', () => {
  const v = (assunto: string, relevant: boolean) => ({ assunto, relevant });
  it('corta com 5 ou mais julgadas e 60% ou mais descartadas', () => {
    const pruned = prunedAssuntos([
      v('Prazos', false), v('Prazos', false), v('Prazos', false), v('Prazos', true), v('PRAZOS', true),
      v('Fluência dos prazos processuais', true), v('Fluência dos prazos processuais', false),
    ]);
    expect([...pruned]).toEqual(['prazos']);
  });
  it('não corta com poucas julgadas nem com descarte abaixo de 60%', () => {
    expect(prunedAssuntos([v('Prazos', false), v('Prazos', false), v('Prazos', false), v('Prazos', false)]).size).toBe(0);
    expect(prunedAssuntos([v('A', false), v('A', false), v('A', true), v('A', true), v('A', true)]).size).toBe(0);
  });
});

describe('questões da IA presas ao cargo', () => {
  it('recebem as atribuições e os outros cargos, e não põem o cargo no trabalho de outro', () => {
    const p = generatedPrompt({ banca: 'NOSSO RUMO', cargo: 'AGENTE ESCOLAR', subject: 'Conhecimentos Específicos', title: 'Acesso ao espaço escolar', keyword: '', law: [], format: 'multipla escolha', n: 3, avoid: [],
      duties: 'Executar atividades de limpeza, conservação e guarda das instalações', otherRoles: ['AGENTE DE SEGURANÇA ESCOLAR'] });
    expect(p).toContain('Atribuições do cargo (edital): Executar atividades de limpeza');
    expect(p).toContain('AGENTE DE SEGURANÇA ESCOLAR');
    expect(p).toContain('Nunca o ponha fazendo o trabalho de outro cargo');
  });
  it('cargo na chave só quando passado', () => {
    expect(generatedTheme('Específicos', 'O espaço escolar', 'Agente Escolar')).not.toBe(generatedTheme('Específicos', 'O espaço escolar', 'Agente de Segurança Escolar'));
    expect(generatedTheme('Português', 'Crase')).toBe('portugues crase');
  });
});

describe('qgen-v3: receita por tipo de tema e alternativas embaralhadas', () => {
  const base = { banca: 'NOSSO RUMO', cargo: 'AGENTE ESCOLAR', keyword: '', format: 'multipla escolha', n: 3, avoid: [] };
  it('tipo do tema', () => {
    expect(themeKind({ subject: 'Direito Penal', title: 'Peculato', law: [{ ref: 'CP, art. 312', text: '…' }] })).toBe('lei');
    expect(themeKind({ subject: 'Matemática', title: 'Regra de três simples', law: [] })).toBe('calculo');
    expect(themeKind({ subject: 'Língua Portuguesa', title: 'Classes de palavras', law: [] })).toBe('lingua');
    expect(themeKind({ subject: 'Conhecimentos Específicos', title: 'Higienização e limpeza das instalações', law: [] })).toBe('pratica');
  });
  it('tema prático não pede incisos e usa a apostila como base', () => {
    const p = generatedPrompt({ ...base, subject: 'Conhecimentos Específicos', title: 'EPIs usados na função', law: [], guide: 'Luvas nitrílicas: produtos químicos.' });
    expect(p).toContain('situação do dia a dia do cargo');
    expect(p).not.toContain('incisos');
    expect(p).toContain('Apostila que o estudante leu nesta sessão');
    expect(p).toContain('Luvas nitrílicas');
  });
  it('lei mantém a receita dos dispositivos; cálculo pede a conta', () => {
    expect(generatedPrompt({ ...base, subject: 'Direito Penal', title: 'Peculato', law: [{ ref: 'CP, art. 312', text: '…' }] })).toContain('incisos');
    expect(generatedPrompt({ ...base, subject: 'Matemática', title: 'Porcentagem', law: [] })).toContain('erro típico');
  });
  it('apostila vira texto corrido com seções, quadros, memorizar e pegadinhas', () => {
    const d = guideDigest({ secoes: [{ titulo: 'Limpeza', texto: 'Do mais limpo para o mais sujo.', exemplos: ['Pia antes do vaso'] }], quadros: [{ titulo: 'Produtos', colunas: ['Uso', 'Produto'], linhas: [['Piso', 'Detergente']] }], memorizar: ['Nunca misturar cloro e amônia'], pegadinhas: ['Água sanitária não limpa, desinfeta'] });
    for (const t of ['Do mais limpo', 'Pia antes do vaso', 'Piso / Detergente', 'cloro e amônia', 'não limpa, desinfeta']) expect(d).toContain(t);
  });
  const q = (alts: string[], gab = 'A') => ({ enunciado: 'Enunciado longo o bastante', alternativas: alts, gabarito: gab, fundamento: '' });
  const five = (i: number) => ['certa resposta aqui', 'distrator um aqui', 'distrator dois aqui', 'distrator três aqui', 'distrator quatro aqui'].map((t, j) => `${t} ${i}${j}`);
  it('espalha a correta pelas letras e mantém o gabarito apontando para ela', () => {
    let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = arrangeBatch([0, 1, 2, 3, 4].map((i) => q(five(i))), rand);
    expect(new Set(out.map((x) => x.gabarito)).size).toBe(5);
    for (const [i, x] of out.entries()) expect(x.alternativas[x.gabarito.charCodeAt(0) - 65]).toBe(`certa resposta aqui ${i}0`);
  });
  it('tira a questão cuja correta é bem mais longa; não embaralha alternativa que cita outra', () => {
    expect(arrangeBatch([q(['a resposta certa traz todos os detalhes possíveis e mais um pouco', 'curta um', 'curta dois', 'curta três', 'curta quatro'])])).toEqual([]);
    const ref = q(['Somente I', 'Somente II', 'I e II', 'Todas as anteriores', 'Nenhuma'], 'C');
    expect(arrangeBatch([ref])[0]).toMatchObject({ alternativas: ref.alternativas, gabarito: 'C' });
    expect(arrangeBatch([{ ...q([], 'C') }])[0]!.gabarito).toBe('C');
  });
});
