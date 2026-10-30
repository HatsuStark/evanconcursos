// Edge Function "plan-design": planejamento pedagógico com IA, em passos curtos e síncronos
// (cada chamada fica bem abaixo do limite de tempo da função):
//   {step:'strategy', noticeId, inputs, weeks, hours} → prioridade (peso 1–5) e foco por matéria + orientações
//   {step:'sessions', noticeId, subjectId, n, minutes, level, focus, profile} → n sessões da matéria, cobrindo todos os tópicos
// O calendário é montado no app pelo scheduler determinístico e gravado por create_plan_version.
import { GeminiError, generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { PLAN_PROMPT_VERSION, PlanInputs, PlanStrategy, repairSessions, sessionsJsonSchema, sessionsPrompt, strategyJsonSchema, strategyPrompt, SubjectSessions } from '../../../shared/ai/plan.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';

const int = (v: unknown, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash', apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  const admin = adminClient();
  const operation = body.step === 'strategy' ? 'plan_strategy' : 'plan_sessions';
  let usage: GeminiUsage | null = null, latencyMs: number | null = null;
  try {
    // Edital e matérias lidos como o usuário: a RLS garante que são dele.
    const { data: notice } = await auth.client.from('notices').select('id, role_name, board, exam_date, notes, status').eq('id', String(body.noticeId ?? '')).maybeSingle();
    if (!notice || notice.status !== 'reviewed') return json(404, { error: 'Edital não encontrado ou ainda não conferido.' });

    if (body.step === 'strategy') {
      const inputs = PlanInputs.safeParse(body.inputs);
      if (!inputs.success) return json(400, { error: 'Respostas do questionário inválidas.' });
      const { data: subs } = await auth.client.from('notice_subjects').select('id, name, is_core, questions, weight, notice_topics(count)').eq('notice_id', notice.id).order('position');
      if (!subs?.length) return json(400, { error: 'Edital sem matérias.' });
      const refs = subs.map((s, i) => ({
        ref: `S${i + 1}`, id: s.id as string, name: s.name as string, core: s.is_core as boolean, questions: s.questions as number, weight: s.weight as number,
        level: inputs.data.levels[s.id as string] ?? 1, topics: (s.notice_topics as unknown as { count: number }[])[0]?.count ?? 0,
      }));
      const r = await generateJson({
        apiKey, model, schema: PlanStrategy, jsonSchema: strategyJsonSchema(),
        parts: [{ text: strategyPrompt({ role: notice.role_name, board: notice.board, examDate: notice.exam_date ?? '', weeks: int(body.weeks, 1, 260), hours: int(body.hours, 1, 20000), profile: inputs.data.profile, notes: notice.notes ?? [], subjects: refs }) }],
      });
      usage = r.usage; latencyMs = r.latencyMs;
      await logUsage(admin, { ownerId: auth.user.id, operation, model, promptVersion: PLAN_PROMPT_VERSION, usage, latencyMs, status: 'ok' });
      // Códigos S1..Sn de volta para ids; matéria sem resposta mantém o peso do edital.
      const subjects = refs.map((s) => {
        const a = r.data.subjects.find((x) => x.ref.trim().toUpperCase() === s.ref);
        return { subjectId: s.id, weight: a?.weight ?? s.weight, focus: a?.focus ?? '' };
      });
      return json(200, { strategy: { advice: r.data.advice.filter(Boolean).slice(0, 6), subjects }, model, promptVersion: PLAN_PROMPT_VERSION });
    }

    if (body.step === 'sessions') {
      const n = int(body.n, 1, 400);
      const { data: subject } = await auth.client.from('notice_subjects').select('id, name, questions, notice_id, notice_topics(text, position)')
        .eq('id', String(body.subjectId ?? '')).eq('notice_id', notice.id).maybeSingle();
      if (!subject) return json(404, { error: 'Matéria não encontrada.' });
      const topics = ((subject.notice_topics ?? []) as { text: string; position: number }[]).sort((a, b) => a.position - b.position).map((t) => t.text);
      const r = await generateJson({
        apiKey, model, schema: SubjectSessions, jsonSchema: sessionsJsonSchema(), temperature: 0.3,
        parts: [{ text: sessionsPrompt({
          role: notice.role_name, board: notice.board, profile: String(body.profile ?? '').slice(0, 1500), subject: subject.name,
          level: int(body.level, 0, 3), questions: subject.questions, focus: String(body.focus ?? '').slice(0, 300), n,
          minutesPerSession: int(body.minutes, 15, 960), topics,
        }) }],
      });
      usage = r.usage; latencyMs = r.latencyMs;
      const { sessions, fixes } = repairSessions(r.data, n, topics);
      await logUsage(admin, { ownerId: auth.user.id, operation, model, promptVersion: PLAN_PROMPT_VERSION, usage, latencyMs, status: 'ok' });
      return json(200, { sessions, fixes });
    }

    return json(400, { error: 'Passo inválido.' });
  } catch (err) {
    if (err instanceof GeminiError) usage = err.usage;
    const message = err instanceof Error ? err.message : String(err);
    await logUsage(admin, { ownerId: auth.user.id, operation, model, promptVersion: PLAN_PROMPT_VERSION, usage, latencyMs, status: 'error', error: message });
    const status = err instanceof GeminiError && err.status === 429 ? 429 : 502;
    return json(status, { error: status === 429 ? 'Limite de uso da IA atingido; tentando de novo.' : 'A IA não respondeu como esperado.', detail: message.slice(0, 300) });
  }
});
