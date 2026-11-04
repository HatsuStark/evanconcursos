// Edge Function "plan-design": planejamento pedagógico com IA, em passos curtos e síncronos
// (cada chamada fica bem abaixo do limite de tempo da função):
//   {step:'strategy', noticeId, inputs, weeks, hours} → prioridade (peso 1–5) e foco por matéria + orientações
//   {step:'sessions', noticeId, subjectId, n, minutes, level, focus, profile} → n sessões da matéria, cobrindo todos os tópicos
// O calendário é montado no app pelo scheduler determinístico e gravado por create_plan_version.
import { GeminiError, generateJson, type GeminiUsage } from '../../../shared/ai/gemini.ts';
import { aiLawRefs, findLawRefs, inRanges, type LawRef, mergeLawRefs, rangesLabel, rangesOrFilter, sessionLawRefs } from '../../../shared/legal/refs.ts';
import { LAWS, lawByKey, type LawEntry } from '../../../shared/legal/registry.ts';
import { type LawSize, mergeShortLawSessions, PLAN_PROMPT_VERSION, PlanInputs, PlanStrategy, repairSessions, sessionsJsonSchema, sessionsPrompt, strategyJsonSchema, strategyPrompt, SubjectSessions } from '../../../shared/ai/plan.ts';
import { isOpenEnded } from '../../../shared/domain/rounds.ts';
import { adminClient, CORS, json, logUsage, requireUser } from '../_shared/http.ts';
import { ensureLaw, ownLaws } from '../_shared/legal.ts';

const int = (v: unknown, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

// Tamanho do texto vigente dos artigos da sessão (texto oficial no banco). Sem artigo, ou lei fora do banco, null: a
// sessão fica como a IA montou.
async function lawSize(admin: ReturnType<typeof adminClient>, refs: LawRef[], own: LawEntry[]): Promise<LawSize[] | null> {
  const out: LawSize[] = [];
  for (const ref of refs.slice(0, 4)) {
    const law = lawByKey(ref.law, own);
    if (!law) return null;
    // Lei do registro ainda fora do banco é baixada agora (uma vez para todos), para a sessão poder ser medida.
    const normId = await ensureLaw(admin, law);
    if (!normId) return null;
    const { data: arts } = await admin.from('legal_articles').select('label, num, suffix, text, revoked, ord').eq('norm_id', normId)
      .or(rangesOrFilter(ref.ranges)).order('ord').limit(400);
    const hit = (arts ?? []).filter((a) => inRanges(ref.ranges, a.num, a.suffix));
    if (!hit.length) return null;
    const live = hit.filter((a) => !a.revoked);
    out.push({
      law: ref.law, short: law.short, ranges: rangesLabel(ref), liveChars: live.reduce((n, a) => n + a.text.length, 0), liveArticles: live.length, revokedArticles: hit.length - live.length,
      // No título, a lei precisa ser achada de novo: a sigla, se o registro a reconhece; senão o nome.
      cite: new RegExp(law.match.source, 'i').test(law.short) ? law.short : law.name,
      articles: hit.map((a) => ({ label: a.label, num: a.num, suffix: a.suffix, chars: a.text.length, revoked: a.revoked })),
    });
  }
  return out.length ? out : null;
}

// Artigos da sessão: os que a IA listou no campo laws, mais os que o próprio título cita com número (a lista às vezes
// esquece um). Sem lista da IA, a leitura do título (e do item do edital) de antes. Lista que não acha nenhum artigo no
// banco (número trocado) cede lugar à do título, se esta achar.
async function sessionRefs(admin: ReturnType<typeof adminClient>, x: SubjectSessions['sessions'][number], topics: string[], subject: string, own: LawEntry[]) {
  const fromTitle = sessionLawRefs(x.title, x.topics.map((t) => topics[t - 1] ?? ''), subject, own);
  const ai = aiLawRefs(x.laws, own);
  if (!ai.length) return { refs: fromTitle, size: await lawSize(admin, fromTitle, own) };
  const refs = mergeLawRefs(ai, findLawRefs(x.title, subject, own).filter((r) => r.ranges.length));
  const size = await lawSize(admin, refs, own);
  if (size || !fromTitle.length) return { refs, size };
  const t = await lawSize(admin, fromTitle, own);
  return t ? { refs: fromTitle, size: t } : { refs, size };
}

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
    const { data: notice } = await auth.client.from('notices').select('id, role_name, role_duties, structure, board, exam_date, notes, status').eq('id', String(body.noticeId ?? '')).maybeSingle();
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
        parts: [{ text: strategyPrompt({ role: notice.role_name, board: notice.board, examDate: isOpenEnded(notice.exam_date, new Date().toISOString().slice(0, 10)) ? '' : notice.exam_date ?? '', weeks: int(body.weeks, 1, 260), hours: int(body.hours, 1, 20000), profile: inputs.data.profile, notes: notice.notes ?? [], subjects: refs, duties: notice.role_duties ?? '', otherRoles: notice.structure?.otherRoles ?? [] }) }],
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
      // Leis que a IA pode citar no campo laws: as do registro e as que o estudante enviou em PDF.
      const own = await ownLaws(admin, auth.user.id);
      const r = await generateJson({
        apiKey, model, schema: SubjectSessions, jsonSchema: sessionsJsonSchema(), temperature: 0.3,
        parts: [{ text: sessionsPrompt({
          role: notice.role_name, board: notice.board, profile: String(body.profile ?? '').slice(0, 1500), subject: subject.name,
          level: int(body.level, 0, 3), questions: subject.questions, focus: String(body.focus ?? '').slice(0, 300), n,
          minutesPerSession: int(body.minutes, 15, 960), topics, duties: notice.role_duties ?? '', otherRoles: notice.structure?.otherRoles ?? [],
          laws: [...LAWS, ...own].map((l) => ({ key: l.key, name: l.name })),
        }) }],
      });
      usage = r.usage; latencyMs = r.latencyMs;
      // Sessão de lei quase vazia (artigos revogados ou só remissivos) é juntada à vizinha da mesma lei; repairSessions
      // divide a maior para manter as n sessões.
      const sized = await Promise.all(r.data.sessions.map((x) => sessionRefs(admin, x, topics, subject.name, own)));
      const short = mergeShortLawSessions(r.data.sessions.map((x, i) => ({ ...x, ...(sized[i]!.refs.length ? { refs: sized[i]!.refs } : {}) })), sized.map((z) => z.size));
      const { sessions, fixes } = repairSessions({ ...r.data, sessions: short.sessions }, n, topics, { sizes: short.sizes, minutes: int(body.minutes, 15, 960) });
      fixes.unshift(...short.merged.map((m) => `lei curta: ${m}`));
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
