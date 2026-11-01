-- Plano sem prazo: com a prova já realizada, a revisão de teoria segue os intervalos normais, sem véspera para antecipar.
create or replace function public.theory_review_due(p_plan uuid, p_days int) returns date
language sql stable security definer set search_path = '' as $$
  select case
    when n.exam_date is null or t.today > n.exam_date then t.today + p_days
    when t.today >= n.exam_date - 1 then null
    else least(t.today + p_days, n.exam_date - 1)
  end
  from public.study_plans p
  join public.notices n on n.id = p.notice_id
  cross join (select (now() at time zone 'America/Sao_Paulo')::date as today) t
  where p.id = p_plan;
$$;
