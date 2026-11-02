-- Edital verticalizado: questão refeita conta uma vez na sessão, pela resposta mais recente.
-- As tentativas continuam todas gravadas, para o histórico e o caderno de erros.
create or replace function public.session_attempt_stats(p_notice uuid)
returns table (session_id uuid, total int, correct int, last_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select l.session_id, count(*)::int, (count(*) filter (where l.correct))::int, max(l.created_at)
  from (
    select distinct on (a.session_id, a.qid) a.session_id, a.correct, a.created_at
    from public.question_attempts a
    join public.study_sessions s on s.id = a.session_id
    join public.notice_subjects n on n.id = s.subject_id
    where n.notice_id = p_notice
    order by a.session_id, a.qid, a.created_at desc
  ) l
  group by l.session_id;
$$;
