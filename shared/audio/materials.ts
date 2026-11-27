// Materiais da revisão em áudio: apostilas, lei, questões erradas e conceitos viram textos-fonte numerados (M1, M2…)
// com teto de tamanho. Tirar duplicidades e cortar no limite fica aqui, sem IA. A lei vai literal, para a conferência
// poder checar prazos e artigos.
import { MAX_SOURCE_CHARS } from './config.ts';
import type { Material } from './prompts.ts';

type Pair = { pergunta?: string; resposta?: string; pista?: string };
export interface GuideLike {
  titulo?: string; introducao?: string;
  esquema?: { topico: string; itens: string[] }[];
  secoes?: { titulo: string; texto: string; exemplos?: string[] }[];
  quadros?: { titulo: string; colunas: string[]; linhas: string[][] }[];
  legislacao?: { ref: string; comentario: string }[];
  memorizar?: string[]; pegadinhas?: string[]; pontos_banca?: string[]; resumo?: string[];
  mnemonicos?: { alvo: string; mnemonico: string; explicacao: string }[];
  gatilhos?: { pista: string; resposta: string }[];
  perguntas?: Pair[];
}

const list = (label: string, xs: (string | undefined)[] | undefined) => {
  const ok = (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);
  return ok.length ? `${label}:\n${ok.map((x) => `- ${x}`).join('\n')}` : '';
};

// Revisão curta (folha de memorização) e apostila completa viram um texto só; a revisão primeiro (é mais densa).
export function guideText(review: GuideLike | null, full: GuideLike | null): string {
  const r = review ?? {}, f = full ?? {};
  const parts = [
    list('Mapa do tema', (r.esquema ?? f.esquema)?.map((e) => `${e.topico}: ${e.itens.join(', ')}`)),
    list('Para memorizar', [...new Set([...(r.memorizar ?? []), ...(f.memorizar ?? [])])]),
    list('Mnemônicos', (r.mnemonicos ?? f.mnemonicos)?.map((m) => `${m.alvo}: ${m.mnemonico} (${m.explicacao})`)),
    list('Gatilhos de prova', (r.gatilhos ?? f.gatilhos)?.map((g) => `${g.pista} → ${g.resposta}`)),
    list('Pegadinhas', [...new Set([...(r.pegadinhas ?? []), ...(f.pegadinhas ?? [])])]),
    list('Lei comentada', (r.legislacao ?? f.legislacao)?.map((l) => `${l.ref}: ${l.comentario}`)),
    list('Perguntas de recordação', (r.perguntas ?? f.perguntas)?.map((p) => `${p.pergunta} → ${p.resposta}`)),
    list('Resumo', r.resumo ?? f.resumo),
    ...(f.secoes ?? []).map((s) => `${s.titulo}:\n${s.texto}${s.exemplos?.length ? `\nExemplos: ${s.exemplos.join(' | ')}` : ''}`),
    ...(f.quadros ?? []).map((q) => `Quadro "${q.titulo}" (${q.colunas.join(' | ')}):\n${q.linhas.map((l) => l.join(' | ')).join('\n')}`),
  ];
  return parts.filter(Boolean).join('\n\n');
}

export const plainHtml = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export interface ErrorQuestion { qid: string; themeId: string | null; enunciado: string; alternativas: { letra: string; texto: string }[]; gabarito: string; resumo: string; times: number } // times 0: entrou no caderno por acerto com dica
export function questionText(q: ErrorQuestion) {
  const alts = q.alternativas.map((a) => `${a.letra}) ${plainHtml(a.texto)}`).join(' ');
  return `${plainHtml(q.enunciado).slice(0, 900)}${alts ? `\n${alts.slice(0, 900)}` : ''}\nGabarito: ${q.gabarito}${q.resumo ? `\nPor quê: ${q.resumo}` : ''}\n${q.times ? `O aluno errou esta questão ${q.times} ${q.times === 1 ? 'vez' : 'vezes'}.` : 'O aluno só acertou esta questão com dica.'}`;
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Numera, tira duplicadas (mesmo texto) e corta no teto: cada tema recebe uma fatia proporcional ao tempo dele; a lei
// fica com até 40% da fatia do tema, o resto vai para a apostila; questões e conceitos dividem o que sobra.
export function buildMaterials(input: {
  themes: { id: string; title: string; minutes: number; guide: string; law: { ref: string; text: string }[] }[];
  errors: ErrorQuestion[];
  concepts: { themeId: string | null; name: string; essence: string }[];
}, maxChars = MAX_SOURCE_CHARS): Material[] {
  const out: Material[] = [];
  const seen = new Set<string>();
  const add = (m: Omit<Material, 'id'>) => {
    const key = norm(m.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ ...m, id: `M${out.length + 1}` });
  };
  const extra = input.errors.length || input.concepts.length ? 0.2 : 0;
  const themeBudget = maxChars * (1 - extra), totalMin = input.themes.reduce((a, t) => a + t.minutes, 0) || 1;
  for (const t of input.themes) {
    const slice = themeBudget * (t.minutes / totalMin);
    let lawLeft = slice * 0.4;
    const law: string[] = [];
    for (const l of t.law) {
      if (lawLeft <= 200) break;
      const txt = `[${l.ref}] ${l.text}`.slice(0, Math.floor(lawLeft));
      law.push(txt);
      lawLeft -= txt.length;
    }
    const used = slice * 0.4 - lawLeft;
    if (t.guide) add({ themeId: t.id, kind: 'revisao', title: t.title, text: t.guide.slice(0, Math.floor(slice - used)) });
    if (law.length) add({ themeId: t.id, kind: 'lei', title: `Lei seca: ${t.title}`, text: law.join('\n') });
  }
  const per = extra ? (maxChars * extra) / Math.max(1, input.errors.length + input.concepts.length) : 0;
  for (const q of input.errors) add({ themeId: q.themeId, kind: 'questao', title: 'Questão que o aluno errou', text: questionText(q).slice(0, Math.max(400, Math.floor(per))) });
  for (const c of input.concepts) add({ themeId: c.themeId, kind: 'conceito', title: `Conceito com atenção: ${c.name}`, text: `${c.name}: ${c.essence}`.slice(0, Math.max(300, Math.floor(per))) });
  return out;
}
