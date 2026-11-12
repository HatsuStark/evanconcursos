-- Painel do admin: números gerais de uso e custo. Chamada só pela Edge Function "admin" (chave de serviço), que confere
-- ADMIN_EMAILS antes. Dias no horário de Brasília.
-- Atividade = qualquer ação registrada: questão respondida, tarefa concluída, chamada de IA, revisão em cartões,
-- simulado, discursiva ou vídeo assistido. O último login não serve (a sessão fica aberta por semanas).
create function public.admin_overview(p_days int default 30) returns jsonb
language sql stable security definer set search_path = '' as $$
  with params as (
    select (now() at time zone 'America/Sao_Paulo')::date as today, greatest(1, least(coalesce(p_days, 30), 90)) as days
  ),
  activity as (
    select owner_id, created_at as at from public.question_attempts
    union all select owner_id, done_at from public.tasks where done_at is not null
    union all select owner_id, created_at from public.ai_usage where owner_id is not null
    union all select owner_id, started_at from public.review_card_sessions
    union all select owner_id, started_at from public.simulados
    union all select owner_id, created_at from public.discursive_answers
    union all select owner_id, watched_at from public.video_watches
  ),
  act as (
    select owner_id, (at at time zone 'America/Sao_Paulo')::date as d from activity, params
    where at >= (params.today - params.days)::timestamp at time zone 'America/Sao_Paulo'
  ),
  since as (select (today - days + 1)::timestamp at time zone 'America/Sao_Paulo' as t, today, days from params),
  series as (select generate_series(today - days + 1, today, interval '1 day')::date as d from params),
  daily as (
    select s.d,
      (select count(distinct owner_id) from act where act.d = s.d) as active,
      (select count(*) from public.question_attempts q where (q.created_at at time zone 'America/Sao_Paulo')::date = s.d) as questions,
      (select coalesce(sum(cost_usd), 0) from public.ai_usage a where (a.created_at at time zone 'America/Sao_Paulo')::date = s.d) as usd
    from series s
  )
  select jsonb_build_object(
    'days', (select days from params),
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users u where u.banned_until is null or u.banned_until < now()),
      'blocked', (select count(*) from auth.users u where u.banned_until > now()),
      'new7d', (select count(*) from auth.users u, params where u.created_at >= (params.today - 6)::timestamp at time zone 'America/Sao_Paulo'),
      'active1d', (select count(distinct owner_id) from act, params where act.d = params.today),
      'active7d', (select count(distinct owner_id) from act, params where act.d > params.today - 7),
      'active30d', (select count(distinct owner_id) from act, params where act.d > params.today - 30),
      'inactive7d', (select count(*) from auth.users u where (u.banned_until is null or u.banned_until < now())
        and not exists (select 1 from act, params where act.owner_id = u.id and act.d > params.today - 7))
    ),
    'usage', jsonb_build_object(
      'questions', (select count(*) from public.question_attempts, since where created_at >= since.t),
      'accuracy', (select round(avg(case when correct then 1.0 else 0 end), 3) from public.question_attempts, since where created_at >= since.t),
      'tasksDone', (select count(*) from public.tasks, since where done_at >= since.t),
      'studyHours', (select round(coalesce(sum(time_spent_sec), 0) / 3600.0, 1) from public.tasks, since where done_at >= since.t),
      'guides', (select count(*) from public.ai_usage, since where operation = 'study_guide' and status = 'ok' and created_at >= since.t),
      'simulados', (select count(*) from public.simulados, since where finished_at >= since.t),
      'discursivas', (select count(*) from public.discursive_answers, since where created_at >= since.t),
      'reviews', (select count(*) from public.review_card_sessions, since where started_at >= since.t),
      'reviewsDone', (select count(*) from public.review_card_sessions, since where started_at >= since.t and completed),
      'reviewRecall', (select round(sum(remembered)::numeric / nullif(sum(recall_cards), 0), 3) from public.review_card_sessions, since where started_at >= since.t and completed),
      'reviewMinutes', (select round(avg(duration_s) / 60.0, 1) from public.review_card_sessions, since where started_at >= since.t and completed)
    ),
    'cost', jsonb_build_object(
      'today', (select coalesce(round(sum(cost_usd), 4), 0) from public.ai_usage, params where created_at >= params.today::timestamp at time zone 'America/Sao_Paulo'),
      'period', (select coalesce(round(sum(cost_usd), 4), 0) from public.ai_usage, since where created_at >= since.t),
      'credits', (select coalesce(sum(credits), 0) from public.ai_usage, since where created_at >= since.t),
      'perActiveUser', (select round(coalesce(sum(cost_usd), 0) / nullif((select count(distinct owner_id) from act, since where act.d >= since.today - since.days + 1), 0), 4) from public.ai_usage, since where created_at >= since.t),
      'byOperation', (select coalesce(jsonb_agg(x order by x.usd desc), '[]') from (
        select operation, count(*) as calls, count(*) filter (where status = 'error') as errors, round(coalesce(sum(cost_usd), 0), 4) as usd, coalesce(sum(credits), 0) as credits
        from public.ai_usage, since where created_at >= since.t group by operation) x)
    ),
    'daily', (select jsonb_agg(jsonb_build_object('d', d, 'active', active, 'questions', questions, 'usd', round(usd, 4)) order by d) from daily)
  );
$$;
revoke all on function public.admin_overview(int) from public, anon, authenticated;
grant execute on function public.admin_overview(int) to service_role;
