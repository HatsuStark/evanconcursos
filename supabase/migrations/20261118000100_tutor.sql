-- Aprender por Questões: aula guiada por perguntas da IA e revisão espaçada dos conceitos.
-- Separado das questões reais: nada aqui entra em question_attempts, nas metas de questões, no acerto por banca ou nos
-- simulados.
--
-- tutor_lessons: a aula de um tema (roteiro de conceitos e perguntas já conferidas), reaproveitada entre sessões e
--   estudantes com o mesmo tema, fontes e banca. Só a Edge Function "tutor" lê e grava. `blocked`: perguntas
--   reportadas por algum estudante, que deixam de ser servidas até a triagem.
-- tutor_sessions: cada aula ou revisão feita pelo estudante, com o estado salvo a cada resposta (retomada sem perda).
-- tutor_concepts: domínio de cada conceito por estudante e a próxima revisão espaçada.

alter table public.ai_jobs drop constraint if exists ai_jobs_kind_check;
alter table public.ai_jobs add constraint ai_jobs_kind_check check (kind in ('notice_extract', 'plan_design', 'study_guide', 'tutor_lesson'));
create unique index ai_jobs_tutor_running_idx on public.ai_jobs ((input->>'cacheKey'))
  where kind = 'tutor_lesson' and status = 'running';

create table public.tutor_lessons (
  cache_key text primary key,
  subject_key text not null,
  banca text not null default '',
  title text not null,
  topic_keys text[] not null default '{}',
  sources text[] not null default '{}',
  content jsonb not null,
  blocked text[] not null default '{}',
  model text,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
alter table public.tutor_lessons enable row level security;
revoke all on public.tutor_lessons from anon, authenticated;

create table public.tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid references public.study_plans(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('aula', 'revisao')),
  lesson_key text check (char_length(lesson_key) <= 100),
  state jsonb not null default '{}' check (pg_column_size(state) <= 400000),
  status text not null default 'andamento' check (status in ('andamento', 'concluida')),
  answered int not null default 0 check (answered between 0 and 500),
  strong int not null default 0 check (strong between 0 and 500),   -- acertos de primeira, sem ajuda
  duration_s int not null default 0 check (duration_s between 0 and 86400),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index tutor_sessions_task_idx on public.tutor_sessions (owner_id, task_id, started_at desc);
create index tutor_sessions_plan_idx on public.tutor_sessions (owner_id, plan_id, kind, status);
alter table public.tutor_sessions enable row level security;
grant select, insert, update on public.tutor_sessions to authenticated;
create policy "own rows: read" on public.tutor_sessions for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.tutor_sessions for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.tutor_sessions for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create table public.tutor_concepts (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  concept_key text not null check (char_length(concept_key) <= 160),   -- aula:conceito
  plan_id uuid not null references public.study_plans(id) on delete cascade,
  subject_id uuid references public.notice_subjects(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  name text not null check (char_length(name) <= 300),
  essence text not null default '' check (char_length(essence) <= 2000),
  base text not null default '' check (char_length(base) <= 300),
  context jsonb not null default '{}',       -- matéria, banca e tema, para gerar a revisão sem a aula
  level text not null check (level in ('dominado', 'em_progresso', 'atencao')),
  step int not null default 0 check (step between 0 and 10),
  lapses int not null default 0 check (lapses between 0 and 1000),
  reviews int not null default 0 check (reviews between 0 and 1000),
  strong int not null default 0 check (strong between 0 and 10000),
  weak int not null default 0 check (weak between 0 and 10000),
  wrong int not null default 0 check (wrong between 0 and 10000),
  due_on date,                                -- null: sem revisão (passou da véspera da prova)
  recent text[] not null default '{}' check (cardinality(recent) <= 12),   -- enunciados já vistos, para não repetir
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (owner_id, concept_key)
);
create index tutor_concepts_due_idx on public.tutor_concepts (owner_id, plan_id, due_on);
alter table public.tutor_concepts enable row level security;
grant select, insert, update on public.tutor_concepts to authenticated;
create policy "own rows: read" on public.tutor_concepts for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.tutor_concepts for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.tutor_concepts for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
