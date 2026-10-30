-- E4.3 · Questões no app (Quest API): mapeamento edital → banco de questões, cache das questões no servidor
-- (o gabarito nunca vai ao navegador antes da resposta), cursores de paginação e tentativas do estudante.

alter table public.ai_usage add column credits int not null default 0 check (credits >= 0);

-- Matéria da disciplina no banco de questões (por disciplina do edital).
create table public.qbank_subject_maps (
  subject_id uuid primary key,
  owner_id uuid not null,
  materia text,
  banca text not null default '',
  how text not null default '',
  prompt_version text not null default '',
  created_at timestamptz not null default now(),
  foreign key (subject_id, owner_id) references public.notice_subjects (id, owner_id) on delete cascade
);

-- Assuntos da sessão no banco de questões.
create table public.qbank_session_maps (
  session_id uuid primary key,
  owner_id uuid not null,
  materia text,
  assuntos text[] not null default '{}',
  how text not null default '',
  prompt_version text not null default '',
  created_at timestamptz not null default now(),
  foreign key (session_id, owner_id) references public.study_sessions (id, owner_id) on delete cascade
);

-- Listas oficiais de assuntos por matéria (gratuitas na API; cache compartilhado, só no servidor).
create table public.qbank_assunto_lists (
  materia text primary key,
  assuntos text[] not null,
  fetched_at timestamptz not null default now()
);

-- Questões já buscadas (cache no servidor, com gabarito e explicação gerada).
create table public.qbank_questions (
  qid text primary key,
  materia text not null default '',
  assunto text not null default '',
  payload jsonb not null,
  gabarito text not null,
  explanation jsonb,
  explanation_model text,
  fetched_at timestamptz not null default now()
);

-- Paginação por estudante, sessão e filtro (para não repetir questões).
create table public.qbank_cursors (
  owner_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,          -- sessão ou matéria (dias de reforço)
  filter_key text not null,
  after_id text,
  exhausted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, scope, filter_key)
);

create table public.question_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  plan_id uuid not null,
  task_id uuid,
  session_id uuid,
  subject_id uuid,
  qid text not null,
  materia text not null default '',
  assunto text not null default '',
  chosen text not null,
  correct boolean not null,
  created_at timestamptz not null default now(),
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade,
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete set null (task_id),
  foreign key (session_id, owner_id) references public.study_sessions (id, owner_id) on delete set null (session_id),
  foreign key (subject_id, owner_id) references public.notice_subjects (id, owner_id) on delete set null (subject_id)
);
create index question_attempts_owner_idx on public.question_attempts (owner_id, subject_id, created_at desc);
create index question_attempts_task_idx on public.question_attempts (task_id);

alter table public.qbank_subject_maps enable row level security;
alter table public.qbank_session_maps enable row level security;
alter table public.qbank_assunto_lists enable row level security;
alter table public.qbank_questions enable row level security;
alter table public.qbank_cursors enable row level security;
alter table public.question_attempts enable row level security;

-- O estudante lê os próprios mapeamentos e tentativas; tudo é gravado pelo backend (gabarito protegido).
grant select on public.qbank_subject_maps, public.qbank_session_maps, public.question_attempts to authenticated;
create policy "own rows: read" on public.qbank_subject_maps for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: read" on public.qbank_session_maps for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: read" on public.question_attempts for select to authenticated using (owner_id = (select auth.uid()));
