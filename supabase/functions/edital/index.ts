// Edge Function "edital": lê o PDF de um edital com o Gemini e devolve um rascunho de plano
// (órgão, cargo, banca, data da prova, matérias com peso e tópicos de estudo, observações).
// Só usuários logados cujo e-mail está em ALLOWED_EMAILS podem chamar (cada leitura tem custo na API).
// Segredos (supabase secrets): GEMINI_API_KEY, GEMINI_MODEL, ALLOWED_EMAILS.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_PDF_BYTES = 15 * 1024 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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
    // Autenticação: valida o token do usuário e confere a lista de e-mails permitidos.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', key);
    const { data: { user } = { user: null } } = await sb.auth.getUser(token);
    const allowed = (Deno.env.get('ALLOWED_EMAILS') ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!user?.email) return json(401, { error: 'Entre na sua conta para ler editais.' });
    if (!allowed.includes(user.email.toLowerCase())) return json(403, { error: 'Sua conta não tem permissão para ler editais.' });

    const { pdf, cargo = '' } = await req.json();
    if (typeof pdf !== 'string' || !pdf) return json(400, { error: 'Envie o PDF do edital.' });
    if (pdf.length * 0.75 > MAX_PDF_BYTES) return json(413, { error: 'PDF maior que 15 MB.' });

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
    if (!apiKey) return json(500, { error: 'GEMINI_API_KEY não configurada no Supabase.' });

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inline_data: { mime_type: 'application/pdf', data: pdf } },
          { text: prompt(String(cargo).slice(0, 120)) },
        ] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      const hint = res.status === 404 ? ` Modelo "${model}" não encontrado: ajuste GEMINI_MODEL.` : '';
      return json(502, { error: `Falha no Gemini (${res.status}).${hint}`, detail });
    }
    const out = await res.json();
    const text = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    if (!text) return json(502, { error: 'O Gemini não devolveu conteúdo (o PDF pode estar protegido ou ser só imagem).' });
    return json(200, { plan: JSON.parse(text), model });
  } catch (err) {
    return json(500, { error: 'Erro ao ler o edital.', detail: String(err).slice(0, 300) });
  }
});
