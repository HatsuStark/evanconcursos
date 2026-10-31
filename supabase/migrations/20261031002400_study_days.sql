-- Metas semanais e constância: o cronômetro guarda só o total por tarefa, então o tempo de cada dia fica nesta tabela.
-- Datas no fuso de Brasília.

create table public.study_days (
  owner_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  seconds int not null default 0 check (seconds >= 0),
  primary key (owner_id, day)
);
alter table public.study_days enable row level security;
grant select on public.study_days to authenticated;
create policy "own rows: read" on public.study_days for select to authenticated using (owner_id = (select auth.uid()));

-- Soma ao dia o que o cronômetro avançou. Reduzir o tempo da tarefa não desconta.
create function public.log_study_time() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.study_days (owner_id, day, seconds)
  values (new.owner_id, (now() at time zone 'America/Sao_Paulo')::date, new.time_spent_sec - old.time_spent_sec)
  on conflict (owner_id, day) do update set seconds = study_days.seconds + excluded.seconds;
  return null;
end $$;
revoke all on function public.log_study_time() from public, anon, authenticated;
create trigger tasks_log_study_time after update of time_spent_sec on public.tasks
  for each row when (new.time_spent_sec > old.time_spent_sec)
  execute function public.log_study_time();

-- Atividade por dia desde p_from: tempo, questões e discursivas corrigidas do estudante, tarefas concluídas do plano.
create function public.study_activity(p_plan uuid, p_from date)
returns table (day date, seconds int, questions int, tasks_done int, discursives int)
language sql stable security invoker set search_path = '' as $$
  select a.d, sum(a.s)::int, sum(a.q)::int, sum(a.t)::int, sum(a.r)::int
  from (
    select sd.day as d, sd.seconds as s, 0 as q, 0 as t, 0 as r from public.study_days sd where sd.day >= p_from
    union all
    select (qa.created_at at time zone 'America/Sao_Paulo')::date, 0, 1, 0, 0 from public.question_attempts qa
    where qa.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    union all
    select (t.done_at at time zone 'America/Sao_Paulo')::date, 0, 0, 1, 0 from public.tasks t
    where t.plan_id = p_plan and t.done_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    union all
    select (da.graded_at at time zone 'America/Sao_Paulo')::date, 0, 0, 0, 1 from public.discursive_answers da
    where da.graded_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
  ) a
  group by a.d;
$$;
revoke all on function public.study_activity(uuid, date) from public, anon;
grant execute on function public.study_activity(uuid, date) to authenticated;
