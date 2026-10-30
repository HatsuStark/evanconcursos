// Edge Function "roteiro": monta com o Gemini roteiros de estudo para até 7 tarefas do cronograma
// (resumo, o que ler, pontos mais cobrados, pegadinhas, autoteste e termos de busca de vídeo-aulas).
// Não devolve links: o app monta buscas e links oficiais a partir dos termos.
import { authorize, CORS, generate, json } from '../_shared/gemini.ts';

const MAX_TASKS = 7;
const list = (description: string) => ({ type: 'ARRAY', items: { type: 'STRING' }, description });
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    guides: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'O id da tarefa, exatamente como recebido.' },
          resumo: { type: 'STRING', description: 'O essencial do tema em até 4 frases.' },
          leitura: list('O que ler: leis com artigos exatos (ex.: "CPP, arts. 4º a 23") e tópicos de doutrina.'),
          pontos: list('Pontos que mais caem em prova sobre o tema.'),
          pegadinhas: list('Pegadinhas e confusões comuns da banca.'),
          perguntas: list('Perguntas curtas de autoteste, com a resposta após " — ".'),
          buscas: list('Até 3 termos de busca para encontrar boas vídeo-aulas no YouTube.'),
        },
        required: ['id', 'resumo', 'leitura', 'pontos', 'pegadinhas', 'perguntas', 'buscas'],
      },
    },
  },
  required: ['guides'],
};

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
type Task = { id: string; subject: string; text: string; level: string };

function prompt(tasks: Task[], cargo: string, banca: string, profile: string) {
  return `Você é professor de cursinho para concursos públicos brasileiros.
Monte um roteiro de estudo para cada tarefa abaixo (cada uma é uma sessão de cerca de 2 horas).
Concurso: ${cargo || 'não informado'}${banca ? `, banca ${banca}` : ''}.
Sobre o candidato: ${profile || 'não informado'}.
Tarefas (id | matéria | nível do candidato na matéria | tarefa do dia):
${tasks.map((t) => `${t.id} | ${t.subject} | ${t.level || 'não informado'} | ${t.text}`).join('\n')}
Regras:
- Um item em guides por tarefa, com o mesmo id.
- Ajuste a profundidade ao nível: iniciante começa pelos conceitos; avançado vai direto aos detalhes e exceções.
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
    const tasks: Task[] = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, MAX_TASKS)
      .map((t: Record<string, unknown>) => ({ id: clip(t?.id, 60), subject: clip(t?.subject, 120), text: clip(t?.text, 300), level: clip(t?.level, 40) }))
      .filter((t: Task) => t.id && t.subject && t.text);
    if (!tasks.length) return json(400, { error: 'Informe as tarefas (matéria e texto).' });

    const out = await generate([{ text: prompt(tasks, clip(body.cargo, 120), clip(body.banca, 80), clip(body.profile, 1000)) }], SCHEMA, 0.3);
    if (out.error) return out.error;
    const ids = new Set(tasks.map((t) => t.id));
    const guides = (Array.isArray(out.data?.guides) ? out.data.guides : []).filter((g: { id?: string }) => ids.has(String(g?.id)));
    return json(200, { guides, model: out.model });
  } catch (err) {
    return json(500, { error: 'Erro ao gerar o roteiro.', detail: String(err).slice(0, 300) });
  }
});
