-- Aquecimento fora da meta semanal de questões. A resposta de aquecimento é gravada na tarefa do dia, mas com a sessão
-- de onde a questão veio (a anterior): conta para o desempenho daquela sessão, não para a meta. A mesma regra está em
-- isWarmupAnswer (shared/domain/goals.ts), que tira o aquecimento da meta da tarefa na tela.
create or replace function public.study_activity(p_plan uuid, p_from date)
returns table (day date, seconds int, questions int, tasks_done int, discursives int)
language sql stable security invoker set search_path = '' as $$
  select a.d, sum(a.s)::int, sum(a.q)::int, sum(a.t)::int, sum(a.r)::int
  from (
    select sd.day as d, sd.seconds as s, 0 as q, 0 as t, 0 as r from public.study_days sd where sd.plan_id = p_plan and sd.day >= p_from
    union all
    select (qa.created_at at time zone 'America/Sao_Paulo')::date, 0, 1, 0, 0 from public.question_attempts qa
    left join public.tasks tk on tk.id = qa.task_id
    where qa.plan_id = p_plan and qa.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
      and not (tk.session_id is not null and qa.session_id is not null and qa.session_id <> tk.session_id)
    union all
    select (t.done_at at time zone 'America/Sao_Paulo')::date, 0, 0, 1, 0 from public.tasks t
    where t.plan_id = p_plan and t.done_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    union all
    select (da.graded_at at time zone 'America/Sao_Paulo')::date, 0, 0, 0, 1 from public.discursive_answers da
    where da.notice_id = (select notice_id from public.study_plans where id = p_plan)
      and da.graded_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
  ) a
  group by a.d;
$$;
