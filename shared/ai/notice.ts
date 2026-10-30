// Interpretação do edital: schema da resposta da IA, prompt versionado e verificações determinísticas.
// Usado pela Edge Function notice-extract e pela avaliação (evals/run.ts).
import { z } from 'zod';

export const NOTICE_PROMPT_VERSION = 'notice-v2';

const text = (max: number) => z.string().trim().max(max);

export const NoticeTopic = z.object({
  text: text(2000).min(1).describe('Item do conteúdo programático, transcrito fielmente.'),
  page: z.number().int().min(0).describe('Página do PDF onde o item aparece (0 se não souber).'),
});

export const NoticeSubject = z.object({
  name: text(120).min(1).describe('Nome da disciplina como no edital, sem numeração.'),
  block: text(120).describe('Nome do bloco/prova a que pertence (ex.: "Conhecimentos Gerais"); vazio se não houver blocos.'),
  questions: z.number().int().min(0).max(500).describe('Questões desta disciplina; 0 se o edital só informa o total do bloco.'),
  core: z.boolean().describe('true se for conhecimento específico do cargo.'),
  topics: z.array(NoticeTopic).describe('Itens do conteúdo programático desta disciplina, na ordem do edital.'),
});

export const NoticeBlock = z.object({
  name: text(120).min(1),
  questions: z.number().int().min(0).max(500),
  rule: text(300).describe('Regra de aprovação do bloco (ex.: "mínimo de 50% de acertos"); vazio se não houver.'),
});

export const NoticeStage = z.object({
  kind: z.enum(['objetiva', 'discursiva', 'titulos', 'pratica', 'fisica', 'outra']),
  description: text(300),
});

export const NoticeExtraction = z.object({
  organization: text(160).describe('Órgão (ex.: "Tribunal de Justiça do Estado de São Paulo").'),
  role: text(160).describe('Cargo escolhido, com área/especialidade.'),
  otherRoles: z.array(text(160)).describe('Demais cargos do edital, se houver.'),
  board: text(80).describe('Banca organizadora (ex.: "VUNESP", "FGV", "Cebraspe").'),
  examDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).describe('Data da prova objetiva (AAAA-MM-DD); vazio se o edital não informar.'),
  totalQuestions: z.number().int().min(0).max(1000),
  stages: z.array(NoticeStage),
  blocks: z.array(NoticeBlock),
  subjects: z.array(NoticeSubject).min(1),
  notes: z.array(text(300)).describe('Regras úteis para o planejamento: nota mínima, eliminação, discursiva, títulos.'),
});
export type NoticeExtraction = z.infer<typeof NoticeExtraction>;

// JSON Schema para o `responseJsonSchema` do Gemini (gerado do mesmo schema que valida a resposta).
export const noticeJsonSchema = () => z.toJSONSchema(NoticeExtraction, { target: 'draft-7' });

export function noticePrompt(roleHint: string): string {
  const role = roleHint.trim().slice(0, 160);
  return `Você é especialista em editais de concursos públicos brasileiros. Leia o edital em anexo e extraia os dados estruturados.
Cargo: ${role ? `use o cargo "${role}" (ou o mais próximo dele)` : 'se houver um só cargo, use-o; se houver vários, use o primeiro e liste os demais em otherRoles'}.
Regras:
- Considere somente a prova e o conteúdo programático do cargo escolhido.
- examDate: data prevista da prova objetiva. Se o texto remeter ao cronograma, procure a data no cronograma/anexo. Vazio se não houver.
- blocks: os blocos/provas objetivas como o edital define (ex.: "Bloco I – Língua Portuguesa", "P1 – Conhecimentos Gerais"), com o número de questões e a regra mínima de aprovação.
- subjects: uma entrada por disciplina. Quando um bloco agrupa várias disciplinas, cada disciplina com título próprio no conteúdo programático (inclusive títulos em MAIÚSCULAS como "ENGENHARIA DE SOFTWARE", "BANCOS DE DADOS") é uma entrada separada, com "block" indicando o bloco. Nunca crie uma disciplina com o nome do bloco (ex.: "Conhecimentos Específicos") quando o bloco tem títulos internos.
- questions: o número de questões da disciplina quando o edital informar por disciplina; 0 quando só houver o total do bloco.
- core: true para conhecimentos específicos do cargo; false para conhecimentos gerais/básicos.
- topics: transcreva fielmente cada item do conteúdo programático da disciplina, um item por entrada, na ordem do edital, mantendo leis e artigos citados. Não resuma, não junte disciplinas, não acrescente nada e não prefixe o item com o nome da disciplina. page = página do PDF onde o item aparece.
- stages: as etapas do concurso (objetiva, discursiva, títulos, prática, física...).
- notes: regras relevantes para o planejamento (nota mínima, critérios de eliminação, peso das provas, detalhes da discursiva), frases curtas.
- Não invente: se uma informação não estiver no edital, deixe vazio ou 0.`;
}

// ---------- verificações determinísticas ----------
export interface NoticeWarning { code: string; message: string; subject?: string }

export const normalizeText = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Texto comparável: sem acentos, pontuação e palavras curtas ("e", "de", numeração), que variam na extração.
export const comparableText = (s: string) => normalizeText(s).split(' ').filter((w) => w.length > 2).join(' ');

// Um tópico "existe no PDF" se a maioria das suas sequências de 3 palavras aparece no texto do PDF.
// O haystack deve vir de comparableText(textoDoPdf). Tolera quebras de linha; rejeita texto inventado.
export function topicInText(topic: string, haystack: string): boolean {
  const words = comparableText(topic).split(' ').filter(Boolean);
  if (words.length < 3) return haystack.includes(words.join(' '));
  const windows: string[] = [];
  for (let i = 0; i + 3 <= words.length; i += 3) windows.push(words.slice(i, i + 3).join(' '));
  const hits = windows.filter((w) => haystack.includes(w)).length;
  return hits / windows.length >= 0.6;
}

export function checkNotice(e: NoticeExtraction, pdfText: string | null, today = new Date()): NoticeWarning[] {
  const out: NoticeWarning[] = [];
  if (!e.examDate) out.push({ code: 'exam_date_missing', message: 'O edital não informa a data da prova (ou ela não foi encontrada). Defina a data para gerar o cronograma.' });
  else if (new Date(e.examDate + 'T12:00:00') < today) out.push({ code: 'exam_date_past', message: `A data da prova (${e.examDate.split('-').reverse().join('/')}) já passou.` });
  const names = new Set<string>();
  for (const s of e.subjects) {
    const key = normalizeText(s.name);
    if (names.has(key)) out.push({ code: 'subject_duplicate', message: `Disciplina repetida: ${s.name}.`, subject: s.name });
    names.add(key);
    if (!s.topics.length) out.push({ code: 'subject_no_topics', message: `${s.name}: sem conteúdo programático.`, subject: s.name });
  }
  // Questões: por bloco (quando o bloco detalha por disciplina) e no total.
  for (const b of e.blocks) {
    const subs = e.subjects.filter((s) => normalizeText(s.block) === normalizeText(b.name));
    const sum = subs.reduce((a, s) => a + s.questions, 0);
    if (subs.length && subs.every((s) => s.questions > 0) && sum !== b.questions)
      out.push({ code: 'block_sum', message: `${b.name}: as disciplinas somam ${sum} questões, mas o bloco tem ${b.questions}.` });
  }
  const blocksTotal = e.blocks.reduce((a, b) => a + b.questions, 0);
  if (e.totalQuestions && e.blocks.length && blocksTotal !== e.totalQuestions)
    out.push({ code: 'total_sum', message: `Os blocos somam ${blocksTotal} questões, mas a prova tem ${e.totalQuestions}.` });
  if (pdfText) {
    const hay = comparableText(pdfText);
    for (const s of e.subjects) {
      const missing = s.topics.filter((t) => !topicInText(t.text, hay));
      if (missing.length) out.push({ code: 'topic_not_found', message: `${s.name}: ${missing.length} tópico(s) não encontrados no texto do PDF. Confira.`, subject: s.name });
    }
  }
  return out;
}

// Peso 1–5 pelo número de questões (da disciplina, ou do bloco dividido entre suas disciplinas).
export function subjectWeights(e: NoticeExtraction): number[] {
  const est = e.subjects.map((s) => {
    if (s.questions) return s.questions;
    const block = e.blocks.find((b) => normalizeText(b.name) === normalizeText(s.block));
    const peers = e.subjects.filter((x) => normalizeText(x.block) === normalizeText(s.block) && !x.questions).length || 1;
    const rest = block ? block.questions - e.subjects.filter((x) => normalizeText(x.block) === normalizeText(s.block)).reduce((a, x) => a + x.questions, 0) : 0;
    return Math.max(0, rest) / peers;
  });
  const max = Math.max(...est, 0);
  return est.map((q) => (max ? Math.max(1, Math.min(5, Math.round((q / max) * 5))) : 2));
}
