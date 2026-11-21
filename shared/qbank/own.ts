// Banco próprio (projeto apiQuestoes): provas do PCI transcritas e classificadas na taxonomia da Quest API. Cada prova
// aceita é um JSON; aqui as questões viram linhas de `qbank_questions` no mesmo formato público das da Quest, então
// `fromCache` as serve antes de gastar créditos, e correção, explicação, mnemônico e caderno de erros funcionam iguais.
// Ficam de fora: anuladas, dependentes de imagem (o JSON só tem a descrição), suspeitas de desatualizadas, sem matéria
// classificada, sem gabarito válido e as de interpretação que citam um texto que não veio na transcrição.

export interface OwnExam {
  prova: { banca: string; orgao: string; cargo: string; ano: number; formato: string };
  classificacao?: { banca?: string; carreiras?: string[] };
  textos?: Record<string, string>;
  questoes: {
    numero: number; enunciado: string; alternativas: { letra: string; texto: string }[]; gabarito: string | null;
    anulada: boolean; texto_associado: string | null; depende_visual: boolean;
    classificacao?: { materia: string; assunto: string; dificuldade: number; desatualizada: boolean };
  }[];
}
export interface OwnRow {
  qid: string; materia: string; assunto: string; gabarito: string;
  payload: {
    qid: string; enunciado: string; tipo: string; dificuldade: number;
    alternativas: { letra: string; texto: string; imagens: string[] }[];
    textos: string[]; anexos: string[];
    prova: { banca: string; ano: number; orgao: string; cargo: string };
    materia: string; assunto: string; carreiras: string[]; fonte: 'propria';
  };
}

import { hasMark, missingMark } from '../ai/marks.ts';

export const OWN_PREFIX = 'own-';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Texto da transcrição (parágrafos por linha em branco, destaques em **negrito**) para o HTML que a tela já exibe.
export function ownHtml(text: string) {
  const inline = (s: string) => escape(s).replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>').replace(/\n/g, '<br>');
  return text.trim().split(/\n\s*\n/).map((p) => `<p>${inline(p.trim())}</p>`).join('');
}

// Id estável por prova e número (sem ":" para passar no filtro de id das questões livres). `hash` dá os 16 primeiros hex
// de um SHA-1; vem de fora para o arquivo rodar no Node e no Deno.
export const ownQid = (hash: (s: string) => string, examKey: string, numero: number) => `${OWN_PREFIX}${hash(`${examKey}#${numero}`).slice(0, 16)}`;

// Questão de Português que fala de "o texto", da personagem, do narrador, do autor, de um parágrafo ou da tirinha, sem texto-base
// associado e sem trazer o trecho no próprio enunciado: sem o texto não dá para responder (comum nas provas soltas,
// montadas à mão). Fica só em Português e afins, onde "o texto" quase sempre é o texto-base; em Direito e Informática
// ("texto constitucional", "editor de texto") a regra pegaria questões boas.
// Espaços como \s+: nas da Quest o enunciado vem com as quebras de linha do PDF ("conteúdo do\ntexto").
const READING = /portuguesa|interpreta|literatura|reda[cç][aã]o/i;
const CITES_TEXT = new RegExp([
  String.raw`\b(d|n|pel|a)?o\s+texto\b(?![- \n](oficial|jornalístico|constitucional|legal|normativo|expresso|atual|base|dissertativo|narrativo|descritivo|argumentativo|literário|técnico|científico|da|de|do|a seguir|abaixo|seguinte))`,
  String.raw`\btextos?\s+(I|II|III|1|2|3)\b`, String.raw`\bpersonage(m|ns)\b`, String.raw`\bnarrador`, String.raw`\beu\s+lírico`,
  String.raw`\bparágrafos?\s+(final|inicial|anterior|seguinte|introdutório|conclusivo)`,
  String.raw`\b(primeiro|segundo|terceiro|quarto|quinto|sexto|último|penúltimo|\d+\s*[ºo°])\s+parágrafo`,
  String.raw`\blinhas?\s+\d`, String.raw`\bautora?\b`, String.raw`\bcronista\b`, String.raw`\bpoeta\b`,
  // Tirinha, charge e afins: sem a imagem nem a transcrição, não há o que ler.
  String.raw`\b(d|n|pel)?[ae]ss?[ae]s?\s+tiras?\b`, String.raw`\b(d|n|pel)?as?\s+tiras?\b`, String.raw`\btirinhas?\b`, String.raw`\bcharges?\b`, String.raw`\bcartuns?\b`, String.raw`\bquadrinhos?\b`,
  String.raw`\b(primeiro|segundo|terceiro|quarto|último|penúltimo|\d+\s*[ºo°])\s+quadr(o|inho)`,
  String.raw`\b(d|n|pel)?[oa]s?\s+(poema|crônica|anúncio|propaganda|cartaz|infográfico|editorial|reportagem|notícia|entrevista|pesquisa|gráfico|fábula)\b`,
  String.raw`\b(dados|informações|resultados)\s+(apresentad|divulgad|mostrad)`,
].join('|'), 'i');
// Trecho citado, texto colado depois do comando, ou "leia/a seguir/abaixo" (o texto vem no enunciado); redação oficial.
const INLINE = /[“"«]|\n.{100,}|a seguir|abaixo|seguinte|leia|oficia/i;
// Mesmo com trecho citado, precisam do texto inteiro: o referente de um termo ("“isso” refere-se", "retoma") e o texto
// pelo código do Cebraspe ("texto CB1A1AAA"). Linha citada com o período entre aspas responde sozinha.
const WHOLE = /\b(refere-se|(?<!no que )se refere|retoma|faz referência|remete)\b/i;
const CODED = /\btexto\s+(?=[A-Z]*\d)[A-Z0-9]{5,}\b/;
export const citesMissingText = (enunciado: string, materia: string) =>
  READING.test(materia) && enunciado.length <= 350 && CITES_TEXT.test(enunciado)
  && (!INLINE.test(enunciado) || WHOLE.test(enunciado) || CODED.test(enunciado));

// HTML do payload (o das próprias e o da Quest) para o texto que citesMissingText espera.
const textOf = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/[ \t]+/g, ' ').trim();
// Questão já no formato público que cita um texto que não veio (sem texto associado nem anexo, que pode ser a tirinha).
// Vale para todas as fontes: a Quest às vezes manda `textos_associados` vazio.
export const lacksText = (p: { enunciado: string; textos?: string[]; anexos?: string[]; materia?: string; alternativas?: { texto: string }[] }) =>
  !(p.textos ?? []).some((t) => !onlyCredit(t)) && !p.anexos?.length
  && (citesMissingText(textOf(p.enunciado ?? ''), p.materia ?? '') || altsCiteText(p.alternativas ?? [], p.materia ?? ''));

// Alternativas que localizam trechos no texto ("... (6º parágrafo)", "(l. 12)"): o enunciado pode nem falar do texto.
const LOCATES = /\(\s*(\d+\s*[ºo°]|primeiro|segundo|terceiro|quarto|quinto|último|penúltimo)\s+parágrafo\s*\)|\(\s*(l|ls|linhas?)\.?\s*\d/i;
export const altsCiteText = (alts: { texto: string }[], materia: string) => READING.test(materia) && alts.some((a) => LOCATES.test(textOf(a.texto ?? '')));

// Texto associado que é só a fonte ("(Quino. Disponível em: www…)"): a tirinha ou o gráfico era imagem e se perdeu na
// transcrição. Sem os parênteses e os endereços, sobra pouco ou nada.
export const onlyCredit = (html: string) =>
  textOf(html).replace(/\([^)]*\)/g, ' ').replace(/(https?:\/\/|www\.)\S+/gi, ' ').replace(/\bDispon[íi]vel em:?/gi, ' ').replace(/[\s.,;:–-]+/g, ' ').trim().length < 25;

// Comando fala em termo destacado/sublinhado e nada vem marcado (nem no enunciado, nem nas alternativas, nem no texto, sem
// anexo): a transcrição do PCI perde o negrito e a Quest às vezes também; sem saber qual é o termo, não dá para responder.
export const lacksMark = (p: { enunciado: string; alternativas?: { texto: string }[]; textos?: string[]; anexos?: string[] }) =>
  missingMark(p.enunciado ?? '') && !p.anexos?.length
  && !(p.alternativas ?? []).some((a) => hasMark(a.texto)) && !(p.textos ?? []).some(hasMark);

// `dropped`: ids das descartadas por falta de texto ou de destaque, para o importador tirar do banco as que entraram antes da regra.
export function ownRows(exam: OwnExam, qidOf: (numero: number) => string): { rows: OwnRow[]; skipped: Record<string, number>; dropped: string[] } {
  const skipped: Record<string, number> = {};
  const dropped: string[] = [];
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const banca = exam.classificacao?.banca || exam.prova.banca;
  const rows: OwnRow[] = [];
  for (const q of exam.questoes) {
    const c = q.classificacao;
    const letras = q.alternativas.map((a) => a.letra.toUpperCase());
    const gabarito = (q.gabarito ?? '').trim().toUpperCase();
    const ce = !q.alternativas.length;
    if (q.anulada) { skip('anulada'); continue; }
    if (q.depende_visual) { skip('imagem'); continue; }
    if (!c?.materia) { skip('sem matéria'); continue; }
    if (c.desatualizada) { skip('desatualizada'); continue; }
    if (ce ? !['C', 'E'].includes(gabarito) : !letras.includes(gabarito)) { skip('gabarito'); continue; }
    const qid = qidOf(q.numero);
    const textos = (q.texto_associado ?? '').split(/[,;\s]+/).filter(Boolean).map((k) => exam.textos?.[k]).filter((t): t is string => !!t).map(ownHtml);
    if (!textos.some((t) => !onlyCredit(t)) && citesMissingText(q.enunciado, c.materia)) { skip('sem texto'); dropped.push(qid); continue; }
    const row: OwnRow = {
      qid, materia: c.materia, assunto: c.assunto ?? '', gabarito,
      payload: {
        qid, enunciado: ownHtml(q.enunciado), tipo: ce ? 'certo e errado' : 'multipla escolha',
        dificuldade: Math.max(1, Math.min(5, Math.round(c.dificuldade || 3))),
        alternativas: q.alternativas.map((a) => ({ letra: a.letra.toUpperCase(), texto: ownHtml(a.texto), imagens: [] })),
        textos, anexos: [],
        prova: { banca, ano: exam.prova.ano, orgao: exam.prova.orgao, cargo: exam.prova.cargo },
        materia: c.materia, assunto: c.assunto ?? '', carreiras: exam.classificacao?.carreiras ?? [], fonte: 'propria',
      },
    };
    if (lacksText(row.payload)) { skip('sem texto'); dropped.push(qid); continue; }
    if (lacksMark(row.payload)) { skip('sem destaque'); dropped.push(qid); continue; }
    rows.push(row);
  }
  return { rows, skipped, dropped };
}
