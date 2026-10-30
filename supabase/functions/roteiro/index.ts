// Edge Function "roteiro": monta com o Gemini um roteiro de estudo para a tarefa do dia
// (resumo, o que ler, pontos mais cobrados, pegadinhas, autoteste e termos de busca de vídeo-aulas).
// Não devolve links: o app monta buscas e links oficiais a partir dos termos.
import { authorize, CORS, generate, json } from '../_shared/gemini.ts';

const list = (description: string) => ({ type: 'ARRAY', items: { type: 'STRING' }, description });
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    resumo: { type: 'STRING', description: 'O essencial do tema em até 4 frases.' },
    leitura: list('O que ler: leis com artigos exatos (ex.: "CPP, arts. 4º a 23") e tópicos de doutrina.'),
    pontos: list('Pontos que mais caem em prova sobre o tema.'),
    pegadinhas: list('Pegadinhas e confusões comuns da banca.'),
    perguntas: list('Perguntas curtas de autoteste, com a resposta após " — ".'),
    buscas: list('Até 3 termos de busca para encontrar boas vídeo-aulas no YouTube.'),
  },
  required: ['resumo', 'leitura', 'pontos', 'pegadinhas', 'perguntas', 'buscas'],
};

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

function prompt(b: { subject: string; text: string; cargo: string; banca: string }) {
  return `Você é professor de cursinho para concursos públicos brasileiros.
Monte um roteiro de estudo para uma sessão de cerca de 2 horas.
Concurso: ${b.cargo || 'não informado'}${b.banca ? `, banca ${b.banca}` : ''}.
Matéria: ${b.subject}.
Tarefa do dia: ${b.text}.
Regras:
- Foque no que a banca costuma cobrar; seja objetivo, frases curtas.
- leitura: até 6 itens, citando lei e artigos exatos quando houver (lei seca primeiro).
- pontos: até 8 itens. pegadinhas: até 5. perguntas: 5 perguntas com resposta após " — ".
- buscas: até 3 termos de busca em português para vídeo-aulas do tema.
- Não inclua links. Se não tiver certeza de um artigo, cite só a lei.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  try {
    const denied = await authorize(req);
    if (denied) return denied;

    const body = await req.json();
    const b = { subject: clip(body.subject, 120), text: clip(body.text, 300), cargo: clip(body.cargo, 120), banca: clip(body.banca, 80) };
    if (!b.subject || !b.text) return json(400, { error: 'Informe a matéria e a tarefa.' });

    const out = await generate([{ text: prompt(b) }], SCHEMA, 0.3);
    if (out.error) return out.error;
    return json(200, { guide: out.data, model: out.model });
  } catch (err) {
    return json(500, { error: 'Erro ao gerar o roteiro.', detail: String(err).slice(0, 300) });
  }
});
