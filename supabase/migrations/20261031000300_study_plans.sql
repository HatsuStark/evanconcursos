-- E3 · Planos de estudo versionados: plano por edital, versões (respostas do questionário + estratégia),
-- sessões pedagógicas ligadas aos tópicos do edital e tarefas datadas.
-- Refazer o cronograma cria uma versão nova: tarefas futuras não feitas da versão anterior ficam
-- "substituídas" (superseded_in_version); tarefas concluídas e passadas nunca são apagadas.

create table public.study_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  notice_id uuid not null,
  name text not null default '' check (char_length(name) <= 160),
  status text not null default 'active' check (status in ('active', 'archived')),
  active_version_id uuid,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (notice_id, owner_id) references public.notices (id, owner_id) on delete cascade
);
create unique index study_plans_one_active on public.study_plans (notice_id) where status = 'active';

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  plan_id uuid not null,
  number int not null check (number > 0),
  reason text not null default 'initial' check (reason in ('initial', 'regenerate')),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),      -- respostas do questionário
  strategy jsonb not null default '{}' check (jsonb_typeof(strategy) = 'object'),
  summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
  generator_version text not null default '',
  prompt_version text not null default '',
  created_at timestamptz not null default now(),
  unique (plan_id, number),
  unique (id, owner_id),
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade
);
alter table public.study_plans add foreign key (active_version_id, owner_id)
  references public.plan_versions (id, owner_id) on delete set null (active_version_id);

-- Unidade pedagógica: uma sessão de estudo de uma matéria, cobrindo um ou mais tópicos do edital.
create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  plan_version_id uuid not null,
  subject_id uuid not null,
  position int not null,
  title text not null check (char_length(title) between 1 and 300),
  keyword text not null default '' check (char_length(keyword) <= 120),
  topic_ids uuid[] not null default '{}',
  unique (id, owner_id),
  foreign key (plan_version_id, owner_id) references public.plan_versions (id, owner_id) on delete cascade,
  foreign key (subject_id, owner_id) references public.notice_subjects (id, owner_id) on delete cascade
);
create index study_sessions_version_idx on public.study_sessions (plan_version_id, subject_id, position);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  plan_id uuid not null,
  date date not null,
  position int not null default 0,
  minutes int not null default 0 check (minutes between 0 and 1440),
  kind text not null check (kind in ('theory', 'consolidation', 'final_review', 'weekly_review', 'simulado', 'eve', 'exam')),
  subject_id uuid,
  session_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  keyword text not null default '' check (char_length(keyword) <= 120),
  goal_questions int not null default 0 check (goal_questions between 0 and 1000),
  created_in_version uuid not null,
  superseded_in_version uuid,
  done_at timestamptz,
  unique (id, owner_id),
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade,
  foreign key (subject_id, owner_id) references public.notice_subjects (id, owner_id) on delete set null (subject_id),
  foreign key (session_id, owner_id) references public.study_sessions (id, owner_id) on delete set null (session_id),
  foreign key (created_in_version, owner_id) references public.plan_versions (id, owner_id) on delete cascade,
  foreign key (superseded_in_version, owner_id) references public.plan_versions (id, owner_id) on delete set null (superseded_in_version)
);
create index tasks_plan_date_idx on public.tasks (plan_id, date, position) where superseded_in_version is null;

-- ---------- RLS ----------
alter table public.study_plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.study_sessions enable row level security;
alter table public.tasks enable row level security;

do $$
declare t text;
begin
  foreach t in array array['study_plans', 'plan_versions', 'study_sessions', 'tasks'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "own rows: read" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
  end loop;
end $$;
-- O app grava versões pela função create_plan_version (security invoker, transação única), que roda
-- com as permissões do usuário: inserção liberada só nas próprias linhas; FKs compostas impedem
-- apontar para dados de outro usuário. Atualização só nas colunas necessárias.
do $$
declare t text;
begin
  foreach t in array array['study_plans', 'plan_versions', 'study_sessions', 'tasks'] loop
    execute format('grant insert on public.%I to authenticated', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;
grant update (done_at, superseded_in_version) on public.tasks to authenticated;
create policy "own rows: update" on public.tasks for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant update (name, status, active_version_id) on public.study_plans to authenticated;
create policy "own rows: update" on public.study_plans for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- ---------- create_plan_version ----------
-- p_data: {name, from:'AAAA-MM-DD' (hoje do usuário), inputs, strategy, summary, generatorVersion, promptVersion,
--          sessions:[{key, subjectId, position, title, keyword, topicIds[]}],
--          tasks:[{date, position, minutes, kind, subjectId?, sessionKey?, title, keyword, goal}]}
-- Na primeira versão grava todas as tarefas; nas seguintes, só as de `from` em diante, e marca como
-- substituídas as tarefas futuras não feitas da versão anterior.
create or replace function public.create_plan_version(p_notice_id uuid, p_data jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan uuid;
  v_version uuid;
  v_number int;
  v_from date := coalesce(nullif(p_data->>'from', '')::date, current_date);
  v_first boolean;
  v_keys jsonb := '{}';
  v_sid uuid;
  s jsonb;
begin
  if not exists (select 1 from public.notices where id = p_notice_id and status = 'reviewed') then
    raise exception 'Edital não encontrado ou ainda não conferido.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_data->'tasks') is distinct from 'array' or jsonb_array_length(p_data->'tasks') = 0 then
    raise exception 'O cronograma não tem tarefas.' using errcode = '22023';
  end if;
  -- Tópicos citados nas sessões precisam existir e ser do usuário (a RLS limita o que é visível).
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_data->'sessions', '[]')) se, jsonb_array_elements_text(coalesce(se->'topicIds', '[]')) t
    where not exists (select 1 from public.notice_topics nt where nt.id = t::uuid)
  ) then
    raise exception 'Sessão aponta para tópico inexistente.' using errcode = '22023';
  end if;

  select id into v_plan from public.study_plans where notice_id = p_notice_id and status = 'active';
  v_first := v_plan is null;
  if v_first then
    insert into public.study_plans (notice_id, name) values (p_notice_id, left(coalesce(p_data->>'name', ''), 160)) returning id into v_plan;
  end if;
  select coalesce(max(number), 0) + 1 into v_number from public.plan_versions where plan_id = v_plan;
  insert into public.plan_versions (plan_id, number, reason, inputs, strategy, summary, generator_version, prompt_version)
  values (v_plan, v_number, case when v_first then 'initial' else 'regenerate' end, coalesce(p_data->'inputs', '{}'),
          coalesce(p_data->'strategy', '{}'), coalesce(p_data->'summary', '{}'),
          left(coalesce(p_data->>'generatorVersion', ''), 40), left(coalesce(p_data->>'promptVersion', ''), 40))
  returning id into v_version;

  for s in select value from jsonb_array_elements(coalesce(p_data->'sessions', '[]')) loop
    insert into public.study_sessions (plan_version_id, subject_id, position, title, keyword, topic_ids)
    values (v_version, (s->>'subjectId')::uuid, coalesce((s->>'position')::int, 0), left(s->>'title', 300), left(coalesce(s->>'keyword', ''), 120),
            coalesce(array(select jsonb_array_elements_text(s->'topicIds')::uuid), '{}'))
    returning id into v_sid;
    v_keys := v_keys || jsonb_build_object(s->>'key', v_sid);
  end loop;

  if not v_first then
    update public.tasks set superseded_in_version = v_version
    where plan_id = v_plan and superseded_in_version is null and done_at is null and date >= v_from;
  end if;

  insert into public.tasks (plan_id, date, position, minutes, kind, subject_id, session_id, title, keyword, goal_questions, created_in_version)
  select v_plan, (t->>'date')::date, coalesce((t->>'position')::int, 0), coalesce((t->>'minutes')::int, 0), t->>'kind',
         nullif(t->>'subjectId', '')::uuid, (v_keys->>(t->>'sessionKey'))::uuid, left(t->>'title', 300),
         left(coalesce(t->>'keyword', ''), 120), coalesce((t->>'goal')::int, 0), v_version
  from jsonb_array_elements(p_data->'tasks') t
  where v_first or (t->>'date')::date >= v_from;

  update public.study_plans set active_version_id = v_version, name = coalesce(nullif(left(p_data->>'name', 160), ''), name) where id = v_plan;
  return v_version;
end $$;
revoke all on function public.create_plan_version(uuid, jsonb) from public, anon;
grant execute on function public.create_plan_version(uuid, jsonb) to authenticated;

-- O edital com cronograma não pode ter matérias substituídas (as sessões e tarefas apontam para elas).
-- Apagar o edital inteiro continua permitido (na cascata, o edital já não existe).
create or replace function public.guard_notice_with_plan() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.notices where id = old.notice_id)
     and exists (select 1 from public.study_plans where notice_id = old.notice_id) then
    raise exception 'Este edital já tem cronograma; as matérias não podem ser substituídas.' using errcode = '55000';
  end if;
  return old;
end $$;
create trigger notice_subjects_guard before delete on public.notice_subjects
  for each row execute function public.guard_notice_with_plan();
