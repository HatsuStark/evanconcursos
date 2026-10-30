// Edge Function "edital": lê o PDF de um edital com o Gemini e devolve um rascunho de plano
// (órgão, cargo, banca, data da prova, matérias com peso e tópicos de estudo, observações).
// Só usuários logados cujo e-mail está em ALLOWED_EMAILS podem chamar (cada leitura tem custo na API).
import { authorize, CORS, generate, json } from '../_shared/gemini.ts';

const MAX_PDF_BYTES = 15 * 1024 * 1024;

// Formato de resposta exigido do Gemini (JSON estruturado).
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    orgao: { type: 'STRING' },
    cargo: { type: 'STRING' },
    banca: { type: 'STRING' },
    examDate: { type: 'STRING', description: 'Data da prova objetiva no formato AAAA-MM-DD, ou vazio se não informada.' },
    notes: { type: 'ARRAY', items: { type: 'STRING' } },
    subjects: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          core: { type: 'BOOLEAN' },
          questions: { type: 'INTEGER' },
          weight: { type: 'INTEGER' },
          topics: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['name', 'core', 'weight', 'topics'],
      },
    },
  },
  required: ['cargo', 'banca', 'examDate', 'subjects', 'notes'],
};

function prompt(cargo: string) {
  return `Você é um especialista em concursos públicos brasileiros. Leia o edital em anexo e extraia os dados para montar um plano de estudos${cargo ? ` para o cargo "${cargo}"` : ''}.
Regras:
- Se o edital tiver vários cargos, use somente o conteúdo programático e a prova ${cargo ? `do cargo "${cargo}"` : 'do cargo principal'}.
- subjects: uma entrada por disciplina cobrada na prova objetiva, na ordem do edital, com nomes curtos (ex.: "Direito Processual Penal").
- core: true para conhecimentos específicos; false para conhecimentos gerais/básicos.
- questions: número de questões da disciplina na prova (0 se o edital não informar).
- weight: importância de 1 a 5, proporcional ao número de questões ou peso da disciplina (a mais cobrada = 5).
- topics: divida o conteúdo programático em unidades de estudo de cerca de 2 horas cada, na ordem do edital, frases curtas (até 120 caracteres), mantendo leis e artigos citados. Junte itens muito pequenos e divida itens muito grandes.
- examDate: data da prova objetiva (AAAA-MM-DD); vazio se não houver.
- notes: observações úteis para o planejamento (nota mínima, peso das etapas, prova discursiva, critérios de eliminação, data de inscrição), frases curtas.
Não invente nada que não esteja no edital.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  try {
    const denied = await authorize(req);
    if (denied) return denied;

    const { pdf, cargo = '' } = await req.json();
    if (typeof pdf !== 'string' || !pdf) return json(400, { error: 'Envie o PDF do edital.' });
    if (pdf.length * 0.75 > MAX_PDF_BYTES) return json(413, { error: 'PDF maior que 15 MB.' });

    const out = await generate([
      { inline_data: { mime_type: 'application/pdf', data: pdf } },
      { text: prompt(String(cargo).slice(0, 120)) },
    ], SCHEMA, 0.2);
    if (out.error) return out.error;
    return json(200, { plan: out.data, model: out.model });
  } catch (err) {
    return json(500, { error: 'Erro ao ler o edital.', detail: String(err).slice(0, 300) });
  }
});
