-- E4.1 · Modo estudo: tempo estudado por tarefa, registro de questões e filtros de questões salvos.

-- Tempo efetivo de estudo (cronômetro do modo estudo), em segundos.
alter table public.tasks add column time_spent_sec int not null default 0 check (time_spent_sec between 0 and 86400);
grant update (time_spent_sec) on public.tasks to authenticated;

-- Baterias de questões resolvidas (em sites externos), registradas pelo estudante.
create table public.question_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  plan_id uuid not null,
  task_id uuid,
  subject_id uuid,
  session_id uuid,
  topic text not null default '' check (char_length(topic) <= 200),
  correct int not null check (correct >= 0),
  total int not null check (total between 1 and 1000),
  source text not null default 'qconcursos' check (source in ('qconcursos', 'tecconcursos', 'outro')),
  created_at timestamptz not null default now(),
  check (correct <= total),
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade,
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete set null (task_id),
  foreign key (subject_id, owner_id) references public.notice_subjects (id, owner_id) on delete set null (subject_id),
  foreign key (session_id, owner_id) references public.study_sessions (id, owner_id) on delete set null (session_id)
);
create index question_logs_plan_idx on public.question_logs (plan_id, created_at desc);
create index question_logs_task_idx on public.question_logs (task_id);

-- Filtro salvo no site de questões: por matéria, ou o filtro base do concurso (subject_id nulo).
create table public.question_filters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  plan_id uuid not null,
  subject_id uuid,
  provider text not null default 'qconcursos' check (provider in ('qconcursos', 'tecconcursos')),
  url text not null check (char_length(url) <= 2000 and url ~ '^https://(www\.)?(qconcursos|tecconcursos)\.com(\.br)?/'),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade,
  foreign key (subject_id, owner_id) references public.notice_subjects (id, owner_id) on delete cascade
);
create unique index question_filters_unique on public.question_filters (plan_id, provider, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'));

alter table public.question_logs enable row level security;
alter table public.question_filters enable row level security;
do $$
declare t text;
begin
  foreach t in array array['question_logs', 'question_filters'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "own rows: read" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: update" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t);
  end loop;
end $$;
