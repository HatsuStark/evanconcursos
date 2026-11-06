// Interpretação do edital: schema da resposta da IA, prompt versionado e verificações determinísticas.
// Usado pela Edge Function notice-extract e pela avaliação (evals/run.ts).
import { z } from 'zod';
import { GeminiError, generateJson, type GeminiUsage } from './gemini.ts';

export const NOTICE_PROMPT_VERSION = 'notice-v10';

// Mesmos valores do filtro nivel_escolaridade da Quest API; vazio se o edital não informar.
export const EDUCATION_LEVELS = ['Fundamental', 'Médio', 'Superior'] as const;

// Campos descritivos: o que passar do limite é cortado, em vez de derrubar a leitura do edital (as atribuições do Professor
// de Ensino Infantil de Canitar passaram de 2.000 caracteres). O limite continua no schema, como orientação para a IA.
const text = (max: number) => z.string().trim().overwrite((s) => s.slice(0, max)).max(max);
// Item do conteúdo programático: cortar perderia conteúdo, então passar do limite é erro, e a nova tentativa divide o item.
const topicText = (max: number) => z.string().trim().max(max);

export const NoticeTopic = z.object({
  text: topicText(2000).min(1).describe('Item do conteúdo programático, transcrito fielmente.'),
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
  roleDuties: text(2000).describe('Atribuições do cargo escolhido como o edital descreve (anexo de atribuições ou descrição do cargo), resumidas se passarem de 1800 caracteres; vazio se não houver.'),
  educationLevel: z.enum(['', ...EDUCATION_LEVELS]).describe('Escolaridade exigida para o cargo escolhido; vazio se o edital não informar.'),
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

// Margem até o limite da função (150 s em segundo plano): a falha precisa ser gravada antes de ela ser encerrada.
export const NOTICE_DEADLINE_MS = 130_000;
const RETRY_MIN_MS = 25_000;
export const NOTICE_THINKING = 'low' as const;

// O filtro RECITATION do Gemini recusa saída parecida demais com um texto conhecido, e a transcrição do edital às vezes
// cai nele. É uma recusa instável: vale outra tentativa, com mais variação e itens quebrados, se ainda houver tempo.
// Tópico acima do limite (conteúdo em parágrafo corrido, como no TRF3, devolvido como um item só) também ganha outra
// tentativa, com o pedido explícito de quebrar os itens.
const isRecitation = (err: unknown) => (err as { finishReason?: string }).finishReason === 'RECITATION';
const isLongTopic = (err: unknown) => err instanceof Error && /topics\.\d+\.text: Too big/.test(err.message);

export async function extractWithRetry<T>(attempt: (o: { temperature: number; retry: boolean; timeoutMs: number }) => Promise<T>, now: () => number = Date.now): Promise<T> {
  const deadline = now() + NOTICE_DEADLINE_MS;
  try {
    return await attempt({ temperature: 0.2, retry: false, timeoutMs: NOTICE_DEADLINE_MS });
  } catch (err) {
    const left = deadline - now();
    if (!(isRecitation(err) || isLongTopic(err)) || left < RETRY_MIN_MS) throw friendlyError(err);
    return await attempt({ temperature: isRecitation(err) ? 0.7 : 0.2, retry: true, timeoutMs: left }).catch((e: unknown) => { throw friendlyError(e); });
  }
}
const friendlyError = (err: unknown) => isRecitation(err)
  ? new Error('A IA recusou transcrever este edital (filtro de texto reproduzido). Tente de novo; se repetir, avise o suporte.', { cause: err })
  : isLongTopic(err)
    ? new Error('A IA não separou os itens do conteúdo programático deste edital (texto em parágrafo corrido). Tente de novo; se repetir, avise o suporte.', { cause: err })
    : err;

// ---------- lista de cargos (antes da leitura completa) ----------
// O candidato escolhe o cargo numa lista tirada do edital, em vez de digitar: com texto livre e "o mais próximo",
// a IA trocava "Agente Escolar" por "Agente de Segurança Escolar" no edital de Suzano.
export const ROLES_PROMPT_VERSION = 'roles-v1';

export const NoticeRole = z.object({
  name: text(160).min(1).describe('Nome do cargo como no edital, com área/especialidade, sem o código.'),
  code: text(20).describe('Código do cargo no edital (ex.: "102"); vazio se não houver.'),
  educationLevel: z.enum(['', ...EDUCATION_LEVELS]).describe('Escolaridade exigida; vazio se o edital não informar.'),
});
export type NoticeRole = z.infer<typeof NoticeRole>;
// Sem limite de itens no schema: o Gemini recusa `maxItems` (400). uniqueRoles corta a lista.
export const NoticeRoles = z.object({ roles: z.array(NoticeRole) });
export const noticeRolesJsonSchema = () => z.toJSONSchema(NoticeRoles, { target: 'draft-7' });

export const rolesPrompt = () => `Você é especialista em editais de concursos públicos brasileiros. Liste todos os cargos/empregos/funções com vagas neste edital, um por entrada, na ordem do edital (normalmente no quadro de cargos e vagas).
- Cada área ou especialidade com prova própria é um cargo separado (ex.: "Técnico Judiciário – Área Administrativa").
- Copie o nome exatamente como no edital; nunca junte nem resuma cargos de nome parecido (ex.: "Agente Escolar" e "Agente de Segurança Escolar" são dois cargos).
- Não repita cargos que aparecem em vários quadros (vagas, provas, atribuições).
- Não invente: se o edital não listar cargos, devolva a lista vazia.`;

// Nomes iguais sem acento/caixa/pontuação contam como o mesmo cargo; o primeiro fica.
export function uniqueRoles(roles: NoticeRole[]): NoticeRole[] {
  const seen = new Set<string>();
  return roles.filter((r) => {
    const k = normalizeText(`${r.code} ${r.name}`);
    if (!normalizeText(r.name) || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 300);
}

// exact: cargo escolhido na lista do edital (nome literal), com os demais cargos para a IA não misturar.
// part: a leitura vai em duas chamadas paralelas (readNotice), porque transcrever o conteúdo de um edital grande numa
// resposta só passa do limite de tempo da função (Receita Federal: 106 s de 130). 'general' traz tudo, com os tópicos só
// das disciplinas básicas; 'specific' traz só os tópicos das específicas. 'all' = uma chamada só.
// 'fill' (com `only`): os tópicos de disciplinas que as duas partes deixaram sem conteúdo (ver fillMissingTopics).
// 'summary' (com `only`): último recurso, os tópicos resumidos em palavras-chave, quando a transcrição literal é recusada
// (RECITATION: o ECA do TJSP, com a lista de convenções internacionais, caía no filtro mesmo com nova tentativa).
export type NoticePart = 'all' | 'general' | 'specific' | 'fill' | 'summary';
export function noticePrompt(roleHint: string, retry = false, exact?: { code?: string; otherRoles?: string[] }, part: NoticePart = 'all', only: string[] = []): string {
  const role = roleHint.trim().slice(0, 160);
  const others = (exact?.otherRoles ?? []).filter((r) => normalizeText(r) !== normalizeText(role)).slice(0, 60);
  const cargo = !role
    ? 'se houver um só cargo, use-o; se houver vários, use o primeiro e liste os demais em otherRoles'
    : exact
      ? `use exatamente o cargo "${role}"${exact.code ? ` (código ${exact.code})` : ''}, escolhido pelo candidato na lista de cargos do edital. Nunca troque por outro cargo de nome parecido ou que contenha estas palavras${others.length ? `; os outros cargos do edital são: ${others.map((o) => `"${o}"`).join(', ')}. Não use a prova, o conteúdo nem as atribuições deles` : ''}`
      : `use o cargo "${role}" (ou o mais próximo dele)`;
  const scope = `- Considere somente a prova e o conteúdo programático do cargo escolhido.${exact && role ? `
- Em quadros e anexos com vários cargos (provas, conteúdo programático, atribuições), use só o trecho cujo título traz este cargo${exact.code ? ` (código ${exact.code})` : ''}; o trecho do cargo vizinho, mesmo logo acima ou abaixo, é de outro cargo.${part === 'specific' ? '' : ` Em role, copie "${role}".`}` : ''}`;
  const subjectsRule = '- subjects: uma entrada por disciplina. Quando um bloco agrupa várias disciplinas, cada disciplina com título próprio no conteúdo programático (inclusive títulos em MAIÚSCULAS como "ENGENHARIA DE SOFTWARE", "BANCOS DE DADOS") é uma entrada separada, com "block" indicando o bloco. Nunca crie uma disciplina com o nome do bloco (ex.: "Conhecimentos Específicos") quando o bloco tem títulos internos.';
  // Tópico definido pelo conteúdo, não pela formatação: regras de corte por pontuação ("uma frase", "um item numerado")
  // acertavam um formato e erravam outro (TRF3 em parágrafo corrido × Receita numerada em 1.1.1).
  const topicsRule = `- topics: o conteúdo programático da disciplina dividido em tópicos de estudo, na ordem do edital. Um tópico é um assunto que se estuda de uma vez: um tema com os seus desdobramentos, ou uma lei com os artigos citados. Decida pelo sentido, não pela formatação: o edital pode vir em lista, em parágrafo corrido ou numerado em níveis (1., 1.1., 1.1.1.), e em qualquer caso:
  - subitens e detalhes do mesmo tema ficam no mesmo tópico: "3. Imposto sobre a Propriedade Territorial Rural. 3.1. Princípios e regras constitucionais aplicáveis ao imposto. 3.2. Competência e sujeito ativo. 3.3. Fato gerador." é um tópico só; "4.3.1. Fato Gerador." nunca é tópico sozinho;
  - temas diferentes ficam em tópicos separados, mesmo na mesma linha ou parágrafo: em "Responsabilidade civil. Direito das coisas: posse; propriedade.", "Responsabilidade civil." é um tópico e "Direito das coisas: posse; propriedade." é outro;
  - tamanho: em geral uma a quatro linhas (até uns 800 caracteres); tema curto e autônomo ("Ortografia.", "Crase.") pode ser tópico sozinho; nunca a disciplina inteira num tópico.
  Copie o texto do edital como está (mesmas palavras, numeração, leis e artigos), decidindo só onde um tópico termina e o próximo começa; não resuma, não reescreva, não acrescente nada e não prefixe com o nome da disciplina. page = página do PDF onde o tópico começa.`;
  const retryRule = retry ? '\n- Em topics, quebre itens longos em entradas menores (cada entrada com no máximo 2000 caracteres), separadas nos pontos finais e, se preciso, nos pontos e vírgulas, e padronize a pontuação, sem mudar o sentido nem omitir leis e artigos.' : '';
  if (part === 'summary') return `Você é especialista em editais de concursos públicos brasileiros. Leia o edital em anexo e liste os tópicos do conteúdo programático destas disciplinas do cargo: ${only.map((n) => `"${n}"`).join(', ')}.
Cargo: ${cargo}.
Regras:
${scope}
- subjects: uma entrada para cada disciplina pedida, com o nome exatamente como na lista acima.
- topics: um tópico por item do conteúdo programático, na ordem do edital, cobrindo todos os itens do primeiro ao último. Cada tópico com as palavras-chave do item (até 25 palavras): o tema, as leis com número e os artigos citados. Não copie frases longas do edital: resuma cada item. page = página do PDF onde o item começa.
- Se o edital não trouxer o conteúdo de uma delas, devolva topics vazio para ela; não invente.`;
  if (part === 'fill') return `Você é especialista em editais de concursos públicos brasileiros. Leia o edital em anexo e transcreva o conteúdo programático completo destas disciplinas do cargo: ${only.map((n) => `"${n}"`).join(', ')}.
Cargo: ${cargo}.
Regras:
${scope}
- subjects: uma entrada para cada disciplina pedida, com o nome exatamente como na lista acima. O conteúdo pode estar num anexo do edital ("Conteúdo programático", "Anexo I"), às vezes sob um título um pouco diferente do nome da disciplina.
${topicsRule}
- Transcreva todos os itens da disciplina, do primeiro ao último, sem parar no meio. Se o edital não trouxer o conteúdo de uma delas, devolva topics vazio para ela; não invente.${retryRule}`;
  if (part === 'specific') return `Você é especialista em editais de concursos públicos brasileiros. Leia o edital em anexo e transcreva o conteúdo programático das disciplinas de conhecimentos específicos do cargo (as próprias do cargo, não as de conhecimentos gerais/básicos).
Cargo: ${cargo}.
Regras:
${scope}
${subjectsRule.replace(', com "block" indicando o bloco', '')} Liste só as disciplinas de conhecimentos específicos, com o nome exatamente como no edital.
${topicsRule}
- Não invente: se o edital não separar conhecimentos específicos, devolva a lista vazia.${retryRule}`;
  return `Você é especialista em editais de concursos públicos brasileiros. Leia o edital em anexo e extraia os dados estruturados.
Cargo: ${cargo}.
Regras:
${scope}
- roleDuties: as atribuições do cargo escolhido, fiéis ao edital (normalmente num anexo "Atribuições dos cargos"), em frases curtas separadas por ponto e vírgula. Se passarem de 1800 caracteres, resuma: mantenha cada tarefa distinta do cargo, com as palavras do edital, e tire só repetições, exemplos e fórmulas genéricas ("e outras atividades correlatas", "cumprir as normas da unidade"). Nunca misture com as de outro cargo, mesmo de nome parecido (ex.: "Agente Escolar" × "Agente de Segurança Escolar"). Vazio se o edital não trouxer.
- educationLevel: escolaridade exigida para o cargo escolhido. Ensino técnico conta como "Médio"; graduação ou pós-graduação, como "Superior".
- examDate: data prevista da prova objetiva. Se o texto remeter ao cronograma, procure a data no cronograma/anexo. Vazio se não houver.
- blocks: os blocos/provas objetivas como o edital define (ex.: "Bloco I – Língua Portuguesa", "P1 – Conhecimentos Gerais"), com o número de questões e a regra mínima de aprovação.
${subjectsRule}
- questions: o número de questões da disciplina quando o edital informar por disciplina; 0 quando só houver o total do bloco.
- core: true para conhecimentos específicos do cargo; false para conhecimentos gerais/básicos.
${topicsRule}${part === 'general' ? '\n- Em topics, transcreva só as disciplinas de conhecimentos gerais/básicos (core = false). As de conhecimentos específicos (core = true) entram em subjects normalmente, com topics vazio: o conteúdo delas é lido à parte.' : ''}
- stages: as etapas do concurso (objetiva, discursiva, títulos, prática, física...).
- notes: regras relevantes para o planejamento (nota mínima, critérios de eliminação, peso das provas, detalhes da discursiva), frases curtas.
- Não invente: se uma informação não estiver no edital, deixe vazio ou 0.${retryRule}`;
}

// ---------- leitura em duas partes ----------
export const NoticeSpecific = z.object({ subjects: z.array(z.object({ name: text(120).min(1), topics: z.array(NoticeTopic) })) });
export type NoticeSpecific = z.infer<typeof NoticeSpecific>;
export const noticeSpecificJsonSchema = () => z.toJSONSchema(NoticeSpecific, { target: 'draft-7' });

// Os tópicos das específicas vão para a disciplina de mesmo nome (ou nome contido) da leitura principal; básica que já
// tem tópicos fica como está. Específica que a leitura principal não listou entra no fim.
export function mergeNoticeParts(main: NoticeExtraction, spec: NoticeSpecific): NoticeExtraction {
  const key = (s: string) => comparableText(s) || normalizeText(s);
  const same = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const used = new Set<number>();
  const subjects = main.subjects.map((s) => {
    const i = spec.subjects.findIndex((x, j) => !used.has(j) && same(key(x.name), key(s.name)));
    if (i < 0) return s;
    used.add(i);
    const topics = spec.subjects[i]!.topics;
    return topics.length && (s.core || !s.topics.length) ? { ...s, topics } : s;
  });
  spec.subjects.forEach((x, j) => {
    if (!used.has(j) && x.topics.length) subjects.push({ name: x.name, block: '', questions: 0, core: true, topics: x.topics });
  });
  return { ...main, subjects };
}

// Disciplinas que as duas partes deixaram sem tópicos ganham os da passada extra ('fill'), pelo nome. A divisão em
// gerais × específicas deixava um vão: no edital de Juiz do TJSP (três blocos de Direito, sem essa divisão), a parte geral
// marcou as 14 disciplinas como específicas e a específica não reconheceu nenhuma; o conteúdo do Anexo I não foi lido.
export function fillMissingTopics(e: NoticeExtraction, fill: NoticeSpecific): NoticeExtraction {
  const key = (s: string) => comparableText(s) || normalizeText(s);
  const same = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  return { ...e, subjects: e.subjects.map((s) => {
    if (s.topics.length) return s;
    const hit = fill.subjects.find((x) => x.topics.length && same(key(x.name), key(s.name)));
    return hit ? { ...s, topics: hit.topics } : s;
  }) };
}
// Disciplinas por chamada da passada extra: cada uma pode ter dezenas de itens (Direito Civil do TJSP: 61).
export const FILL_GROUP = 2;
const FILL_MIN_MS = 25_000;
// A parte específica tem prazo curto: em edital grande (TJSP Juiz, Anexo I de 30 páginas) ela tentava transcrever tudo numa
// resposta só e passava do limite da função. Estourado o prazo, as disciplinas dela vão para a passada extra, em grupos.
const SPECIFIC_MAX_MS = 60_000;

// Leitura completa do edital: as duas partes em paralelo, juntas, com as novas tentativas de extractWithRetry.
export async function readNotice(o: { apiKey: string; model: string; pdfBase64: string; roleHint: string; exact?: { code?: string; otherRoles?: string[] }; fetchImpl?: typeof fetch }) {
  return extractWithRetry(async ({ temperature, retry, timeoutMs }) => {
    const started = Date.now();
    const parts =(t: string) => [{ inline_data: { mime_type: 'application/pdf', data: o.pdfBase64 } }, { text: t }];
    const common = { apiKey: o.apiKey, model: o.model, temperature, timeoutMs, thinkingLevel: NOTICE_THINKING, fetchImpl: o.fetchImpl };
    const [a, b] = await Promise.all([
      generateJson({ ...common, schema: NoticeExtraction, jsonSchema: noticeJsonSchema(), parts: parts(noticePrompt(o.roleHint, retry, o.exact, 'general')) }),
      generateJson({ ...common, timeoutMs: Math.min(SPECIFIC_MAX_MS, timeoutMs), schema: NoticeSpecific, jsonSchema: noticeSpecificJsonSchema(), parts: parts(noticePrompt(o.roleHint, retry, o.exact, 'specific')) })
        .catch((err: unknown) => ({ data: { subjects: [] } as NoticeSpecific, raw: { error: err instanceof Error ? err.message : String(err) }, usage: err instanceof GeminiError && err.usage ? err.usage : { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 } })),
    ]);
    const usage: GeminiUsage = { inputTokens: a.usage.inputTokens + b.usage.inputTokens, outputTokens: a.usage.outputTokens + b.usage.outputTokens, thinkingTokens: a.usage.thinkingTokens + b.usage.thinkingTokens };
    const add = (u: GeminiUsage) => { usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.thinkingTokens += u.thinkingTokens; };
    let data = mergeNoticeParts(a.data, b.data);
    const raw: Record<string, unknown> = { main: a.raw, specific: b.raw };
    // Passada extra para as disciplinas ainda sem tópicos, em chamadas paralelas, enquanto houver tempo:
    // 1) grupos de FILL_GROUP, transcrição literal; 2) uma disciplina por chamada, quebrando itens longos e com mais variação
    // (contra o filtro RECITATION); 3) uma por chamada, tópicos resumidos em palavras-chave (raw.summarized: a conferência
    // avisa que essas vieram resumidas). O que sobrar fica sem tópicos e aparece na conferência.
    const fillLog: unknown[] = [], summarized: string[] = [];
    const rounds = [
      { size: FILL_GROUP, part: 'fill', split: retry, temperature: temperature },
      { size: 1, part: 'fill', split: true, temperature: 0.7 },
      { size: 1, part: 'summary', split: true, temperature: 0.7 },
    ] as const;
    for (const round of rounds) {
      const missing = data.subjects.filter((s) => !s.topics.length).map((s) => s.name);
      const left = timeoutMs - (Date.now() - started);
      if (!missing.length || left < FILL_MIN_MS) break;
      const groups = Array.from({ length: Math.ceil(missing.length / round.size) }, (_, i) => missing.slice(i * round.size, (i + 1) * round.size));
      const fills = await Promise.all(groups.map((names) => generateJson({ ...common, temperature: round.temperature, timeoutMs: left - 3_000, schema: NoticeSpecific, jsonSchema: noticeSpecificJsonSchema(),
        parts: parts(noticePrompt(o.roleHint, round.split, o.exact, round.part, names)) })
        .catch((err: unknown) => ({ error: err instanceof Error ? err.message.slice(0, 300) : String(err), names, usage: err instanceof GeminiError ? err.usage : null }))));
      for (const f of fills) {
        if ('error' in f) { fillLog.push({ error: f.error, names: f.names }); if (f.usage) add(f.usage); continue; }
        const before = new Set(data.subjects.filter((s) => s.topics.length).map((s) => s.name));
        data = fillMissingTopics(data, f.data);
        if (round.part === 'summary') summarized.push(...data.subjects.filter((s) => s.topics.length && !before.has(s.name)).map((s) => s.name));
        add(f.usage);
        fillLog.push(f.raw);
      }
    }
    if (fillLog.length) raw.fill = fillLog;
    if (summarized.length) raw.summarized = summarized;
    return { data, raw, usage, model: a.model, latencyMs: Date.now() - started };
  });
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

// PDF que é só a retificação ("onde se lê… leia-se…"), e não o edital completo: texto curto com as marcas de alteração e
// leitura quase sem conteúdo programático. O app não aplica a retificação a um edital já lido; o candidato envia o edital
// completo, de preferência a versão consolidada.
const AMENDMENT_MARKS = /\bonde se le\b.{0,400}\bleia se\b|\bficam? retificad[oa]s?\b|\bpassam? a vigorar com a seguinte redacao\b|\bretificar? o edital\b|\bedital de retificacao\b/s;
export const AMENDMENT_MAX_CHARS = 30000, AMENDMENT_MAX_TOPICS = 5;
export function looksLikeAmendmentOnly(e: Pick<NoticeExtraction, 'subjects'>, pdfText: string | null) {
  if (!pdfText) return false;
  const t = normalizeText(pdfText);
  const topics = e.subjects.reduce((n, s) => n + s.topics.length, 0);
  return t.length <= AMENDMENT_MAX_CHARS && topics <= AMENDMENT_MAX_TOPICS && AMENDMENT_MARKS.test(t);
}

export function checkNotice(e: NoticeExtraction, pdfText: string | null, today = new Date()): NoticeWarning[] {
  const out: NoticeWarning[] = [];
  if (looksLikeAmendmentOnly(e, pdfText)) out.push({ code: 'amendment_only', message: 'Este PDF parece ser só a retificação de um edital, e não o edital completo. Envie o edital completo, de preferência a versão consolidada, que já inclui a retificação.' });
  if (!e.examDate) out.push({ code: 'exam_date_missing', message: 'O edital não informa a data da prova (ou ela não foi encontrada). Defina a data para gerar o cronograma.' });
  else if (new Date(e.examDate + 'T12:00:00') < today) out.push({ code: 'exam_date_past', message: `A prova (${e.examDate.split('-').reverse().join('/')}) já foi realizada: este edital não está aberto. Você pode continuar, e o plano não terá prazo, adaptando-se ao seu desempenho.` });
  const names = new Set<string>();
  for (const s of e.subjects) {
    const key = normalizeText(s.name);
    if (names.has(key)) out.push({ code: 'subject_duplicate', message: `Disciplina repetida: ${s.name}.`, subject: s.name });
    names.add(key);
    if (!s.topics.length) out.push({ code: 'subject_no_topics', message: `${s.name}: não conseguimos ler os tópicos. Cole os itens do conteúdo programático na matéria, um por linha.`, subject: s.name });
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
