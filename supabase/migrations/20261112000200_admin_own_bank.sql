-- Painel do admin: retrato do banco próprio de questões (importado do apiQuestoes, ids "own-…") e de quanto ele é usado.
-- Ler as 55 mil questões leva dezenas de segundos e o banco só muda na importação: o retrato fica numa view
-- materializada, recalculada por scripts/own-questions.ts ao importar ou pelo botão do painel. O uso (respostas dos
-- últimos 30 dias) é calculado na hora. Tudo chamado só pela Edge Function "admin" (chave de serviço).
create materialized view public.admin_own_bank_mv as
  with own as materialized (
    select materia, nullif(assunto, '') as assunto, explanation is not null as explained, fetched_at,
      nullif(payload->'prova'->>'banca', '') as banca, nullif(payload->'prova'->>'ano', '') as ano,
      nullif(payload->>'tipo', '') as tipo, nullif(payload->>'dificuldade', '') as dificuldade,
      concat_ws('|', payload->'prova'->>'banca', payload->'prova'->>'ano', payload->'prova'->>'orgao', payload->'prova'->>'cargo') as prova
    from public.qbank_questions where qid like 'own-%'
  )
  select now() as computed_at, jsonb_build_object(
    'total', (select count(*) from own),
    'quest', (select count(*) from public.qbank_questions where qid not like 'own-%'),
    'materias', (select count(distinct materia) from own),
    'assuntos', (select count(distinct (materia, assunto)) from own where assunto is not null),
    'provas', (select count(distinct prova) from own),
    'semAssunto', (select count(*) from own where assunto is null),
    'explained', (select count(*) from own where explained),
    'lastImport', (select max(fetched_at) from own),
    'byBanca', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(banca, '(sem banca)') as label, count(*) as n from own group by 1 order by 2 desc limit 15) x),
    'byAno', (select coalesce(jsonb_agg(x order by x.label), '[]') from (select ano as label, count(*) as n from own where ano ~ '^(19|20)\d\d$' group by 1) x),
    'byTipo', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select coalesce(tipo, '(sem tipo)') as label, count(*) as n from own group by 1) x),
    'byDificuldade', (select coalesce(jsonb_agg(x order by x.label), '[]') from (select coalesce(dificuldade, '?') as label, count(*) as n from own group by 1) x),
    'byMateria', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
      select materia as label, count(*) as n, count(distinct assunto) as assuntos from own group by materia order by 2 desc limit 30) x)
  ) as data
with data;
revoke all on public.admin_own_bank_mv from public, anon, authenticated;

create function public.admin_refresh_own_bank() returns void
language sql security definer set search_path = '' as $$
  refresh materialized view public.admin_own_bank_mv;
$$;
revoke all on function public.admin_refresh_own_bank() from public, anon, authenticated;
grant execute on function public.admin_refresh_own_bank() to service_role;

-- Retrato guardado (null se nunca calculado) + uso nos últimos 30 dias.
create function public.admin_own_bank() returns jsonb
language sql stable security definer set search_path = '' as $$
  with att as (
    select a.qid, a.correct, a.owner_id, q.materia from public.question_attempts a
    left join public.qbank_questions q on q.qid = a.qid
    where a.created_at > now() - interval '30 days'
  )
  select jsonb_build_object(
    'snapshot', (select data || jsonb_build_object('computedAt', computed_at) from public.admin_own_bank_mv limit 1),
    'use30d', jsonb_build_object(
      'answers', (select count(*) from att),
      'ownAnswers', (select count(*) from att where qid like 'own-%'),
      'ownAccuracy', (select round(avg(case when correct then 1.0 else 0 end), 3) from att where qid like 'own-%'),
      'ownDistinct', (select count(distinct qid) from att where qid like 'own-%'),
      'ownUsers', (select count(distinct owner_id) from att where qid like 'own-%'),
      'byMateria', (select coalesce(jsonb_object_agg(materia, n), '{}') from (select materia, count(*) as n from att where qid like 'own-%' and materia is not null group by materia) x)
    )
  );
$$;
revoke all on function public.admin_own_bank() from public, anon, authenticated;
grant execute on function public.admin_own_bank() to service_role;
