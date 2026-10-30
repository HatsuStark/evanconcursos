// Edge Function "plano": a IA arquiteta o plano a partir do edital e das respostas do candidato.
//   step "estrategia": estratégia geral e peso/foco de cada matéria (questões na prova × nível × perfil).
//   step "materia": divide o conteúdo de uma matéria em exatamente n sessões de estudo, na ordem de aprendizado.
// O calendário (datas, horas, revisões e simulados) continua com o gerador determinístico do app.
import { authorize, CORS, generate, json } from '../_shared/gemini.ts';

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const strings = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => clip(x, len)).filter(Boolean);

const STRATEGY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    estrategia: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Até 6 orientações gerais para este candidato.' },
    materias: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Nome da matéria exatamente como recebido.' },
          weight: { type: 'INTEGER', description: 'Prioridade de 1 a 5.' },
          foco: { type: 'STRING', description: 'Em que focar nesta matéria, em uma frase.' },
        },
        required: ['name', 'weight', 'foco'],
      },
    },
  },
  required: ['estrategia', 'materias'],
};

const SUBJECT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sessoes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { titulo: { type: 'STRING', description: 'Formato "Assunto curto: detalhes (lei e artigos)".' } },
        required: ['titulo'],
      },
    },
  },
  required: ['sessoes'],
};

type Subject = { name: string; core: boolean; questions: number; weight: number; level: string; topics: number };

function strategyPrompt(b: Record<string, unknown>, subjects: Subject[]) {
  return `Você é coordenador pedagógico de um cursinho para concursos públicos brasileiros.
Concurso: ${clip(b.cargo, 120) || 'não informado'}${b.banca ? `, banca ${clip(b.banca, 80)}` : ''}. Prova em ${clip(b.examDate, 10) || 'data a definir'}.
Tempo disponível: ${int(b.weeks, 200)} semanas, ${int(b.hours, 5000)} horas no total.
Sobre o candidato: ${clip(b.profile, 1000) || 'não informado'}.
Observações do edital: ${strings(b.notes, 15, 200).join(' | ') || 'nenhuma'}.
Matérias (nome | específica? | questões na prova | peso do edital | nível do candidato | nº de tópicos):
${subjects.map((s) => `${s.name} | ${s.core ? 'sim' : 'não'} | ${s.questions || '?'} | ${s.weight} | ${s.level} | ${s.topics}`).join('\n')}
Defina:
- materias: para cada matéria (mesmo nome), weight de 1 a 5 = prioridade de tempo de estudo. Pese o retorno em pontos (questões na prova, peso, critérios de eliminação) e o quanto o candidato precisa evoluir (nível baixo em matéria muito cobrada = prioridade máxima; nível avançado em matéria pouco cobrada = baixa). foco: em que concentrar o estudo dessa matéria.
- estrategia: até 6 orientações práticas e curtas para este candidato, considerando o tempo e o perfil.`;
}

function subjectPrompt(b: Record<string, unknown>, n: number, topics: string[]) {
  return `Você é professor de cursinho para concursos públicos brasileiros.
Concurso: ${clip(b.cargo, 120) || 'não informado'}${b.banca ? `, banca ${clip(b.banca, 80)}` : ''}.
Sobre o candidato: ${clip(b.profile, 1000) || 'não informado'}. Nível dele em ${clip(b.subject, 120)}: ${clip(b.level, 40) || 'não informado'}.
Questões desta matéria na prova: ${int(b.questions, 300) || 'não informado'}. Foco recomendado: ${clip(b.focus, 300) || 'não informado'}.
Conteúdo programático do edital:
${topics.map((t, i) => `${i + 1}. ${t}`).join('\n') || '(não informado: use o conteúdo usual da matéria para este cargo)'}
Divida a matéria em EXATAMENTE ${n} sessões de estudo de cerca de 2 horas, na ordem ideal de aprendizado (fundamentos antes).
Regras:
- Cubra todo o conteúdo do edital; não inclua nada fora dele.
- Ajuste ao nível: iniciante precisa de mais sessões de base; avançado, de mais tempo nos pontos difíceis e mais cobrados.
- Dê mais sessões aos assuntos que a banca mais cobra; junte assuntos pequenos.
- titulo: até 120 caracteres, no formato "Assunto curto: detalhes", citando lei e artigos quando houver (ex.: "Inquérito policial: natureza, prazos e arquivamento (CPP, arts. 4º a 23)"). O "Assunto curto" é usado como busca de questões: 1 a 4 palavras.
- Não repita títulos; se precisar de mais de uma sessão no mesmo assunto, diferencie os detalhes.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  try {
    const denied = await authorize(req);
    if (denied) return denied;
    const b = await req.json();

    if (b.step === 'estrategia') {
      const subjects: Subject[] = (Array.isArray(b.subjects) ? b.subjects : []).slice(0, 40).map((s: Record<string, unknown>) => ({
        name: clip(s?.name, 60), core: !!s?.core, questions: int(s?.questions, 300), weight: int(s?.weight, 5), level: clip(s?.level, 40), topics: int(s?.topics, 200),
      })).filter((s: Subject) => s.name);
      if (!subjects.length) return json(400, { error: 'Informe as matérias.' });
      const out = await generate([{ text: strategyPrompt(b, subjects) }], STRATEGY_SCHEMA, 0.3);
      if (out.error) return out.error;
      return json(200, { ...out.data, model: out.model });
    }

    if (b.step === 'materia') {
      const n = int(b.n, 80), topics = strings(b.topics, 200, 160);
      if (!clip(b.subject, 120) || n < 1) return json(400, { error: 'Informe a matéria e o número de sessões.' });
      const out = await generate([{ text: subjectPrompt(b, n, topics) }], SUBJECT_SCHEMA, 0.3);
      if (out.error) return out.error;
      return json(200, { ...out.data, model: out.model });
    }

    return json(400, { error: 'Etapa inválida.' });
  } catch (err) {
    return json(500, { error: 'Erro ao montar o plano.', detail: String(err).slice(0, 300) });
  }
});
