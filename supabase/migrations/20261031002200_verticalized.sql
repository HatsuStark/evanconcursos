-- Edital verticalizado: questões por sessão do concurso, somadas no banco (a lista de tentativas pode ser longa).
-- security invoker: a RLS de question_attempts vale, cada estudante soma só as próprias.
create function public.session_attempt_stats(p_notice uuid)
returns table (session_id uuid, total int, correct int, last_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select a.session_id, count(*)::int, (count(*) filter (where a.correct))::int, max(a.created_at)
  from public.question_attempts a
  join public.study_sessions s on s.id = a.session_id
  join public.notice_subjects n on n.id = s.subject_id
  where n.notice_id = p_notice
  group by a.session_id;
$$;
revoke all on function public.session_attempt_stats(uuid) from public, anon;
grant execute on function public.session_attempt_stats(uuid) to authenticated;
