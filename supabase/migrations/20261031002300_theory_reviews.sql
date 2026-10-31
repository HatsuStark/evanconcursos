-- Revisão de teoria: concluir uma sessão de teoria agenda o tema para voltar em 1, 7 e 30 dias.
-- Um registro por sessão, avançado pelo estudante conforme lembra ou não. Datas no fuso de Brasília.

create table public.theory_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  plan_id uuid not null,
  task_id uuid not null,
  session_id uuid not null,
  stage int not null default 1 check (stage between 1 and 3),
  due_on date not null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  reviews int not null default 0,
  last_result text check (last_result in ('lembrei', 'parcial', 'esqueci')),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, session_id),
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade,
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete cascade,
  foreign key (session_id, owner_id) references public.study_sessions (id, owner_id) on delete cascade
);
create index theory_reviews_due_idx on public.theory_reviews (owner_id, plan_id, status, due_on);
alter table public.theory_reviews enable row level security;
grant select on public.theory_reviews to authenticated;
create policy "own rows: read" on public.theory_reviews for select to authenticated using (owner_id = (select auth.uid()));

-- Data da próxima revisão. Perto da prova, antecipa para a véspera; null quando já não dá tempo.
create function public.theory_review_due(p_plan uuid, p_days int) returns date
language sql stable security definer set search_path = '' as $$
  select case
    when n.exam_date is null then t.today + p_days
    when t.today >= n.exam_date - 1 then null
    else least(t.today + p_days, n.exam_date - 1)
  end
  from public.study_plans p
  join public.notices n on n.id = p.notice_id
  cross join (select (now() at time zone 'America/Sao_Paulo')::date as today) t
  where p.id = p_plan;
$$;
revoke all on function public.theory_review_due(uuid, int) from public, anon, authenticated;

-- Concluir agenda a primeira revisão; desfazer a conclusão apaga a revisão ainda não feita.
create function public.schedule_theory_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_due date;
begin
  if new.done_at is null then
    delete from public.theory_reviews where task_id = new.id and reviews = 0;
    return null;
  end if;
  v_due := public.theory_review_due(new.plan_id, 1);
  if v_due is not null then
    insert into public.theory_reviews (owner_id, plan_id, task_id, session_id, due_on)
    values (new.owner_id, new.plan_id, new.id, new.session_id, v_due)
    on conflict (owner_id, session_id) do nothing;
  end if;
  return null;
end $$;
create trigger tasks_schedule_theory_review after update of done_at on public.tasks
  for each row when (old.done_at is distinct from new.done_at and new.kind = 'theory' and new.session_id is not null)
  execute function public.schedule_theory_review();

-- lembrei: avança (depois da 3ª, encerra). parcial: repete o intervalo da etapa. esqueci: volta para 1 dia.
-- Devolve a data da próxima revisão; null se o tema encerrou.
create function public.theory_review_answer(p_id uuid, p_result text) returns date
language plpgsql security definer set search_path = '' as $$
declare
  v_days int[] := array[1, 7, 30];
  r public.theory_reviews;
  v_stage int;
  v_due date;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if p_result is null or p_result not in ('lembrei', 'parcial', 'esqueci') then raise exception 'Resultado inválido.' using errcode = '22023'; end if;
  select * into r from public.theory_reviews where id = p_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Revisão não encontrada.' using errcode = 'P0002'; end if;
  if r.status <> 'pending' or r.due_on > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Esta revisão ainda não está disponível.' using errcode = 'P0001';
  end if;

  v_stage := case p_result when 'lembrei' then r.stage + 1 when 'parcial' then r.stage else 1 end;
  if v_stage <= 3 then v_due := public.theory_review_due(r.plan_id, v_days[v_stage]); end if;
  update public.theory_reviews set
    stage = least(v_stage, 3), due_on = coalesce(v_due, r.due_on), status = case when v_due is null then 'done' else 'pending' end,
    reviews = r.reviews + 1, last_result = p_result, last_reviewed_at = now()
  where id = p_id;
  return v_due;
end $$;
revoke all on function public.theory_review_answer(uuid, text) from public, anon;
grant execute on function public.theory_review_answer(uuid, text) to authenticated;
