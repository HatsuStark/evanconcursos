-- E1 · Base: perfis, editais (arquivos, extrações, matérias, tópicos), jobs e consumo de IA.
-- Todo registro pessoal tem owner_id (dono = usuário autenticado), repetido nas tabelas filhas para
-- políticas RLS simples; FKs compostas (id, owner_id) impedem ligar dados de usuários diferentes.

-- Tabela do app legado (JSON único por usuário): sem uso.
drop table if exists public.study_progress;

create extension if not exists pgtap with schema extensions;

-- ---------- utilitários ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- perfis ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

-- Cria o perfil junto com a conta.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- ---------- editais ----------
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 160),
  organization text not null default '' check (char_length(organization) <= 160),
  role_name text not null default '' check (char_length(role_name) <= 160),   -- cargo
  board text not null default '' check (char_length(board) <= 80),             -- banca
  exam_date date,
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'archived')),
  approved_extraction_id uuid,
  notes jsonb not null default '[]' check (jsonb_typeof(notes) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index notices_owner_idx on public.notices (owner_id);
create trigger notices_touch before update on public.notices
  for each row execute function public.touch_updated_at();

create table public.notice_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  notice_id uuid not null,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  pages int check (pages > 0),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (notice_id, owner_id) references public.notices (id, owner_id) on delete cascade
);
create index notice_files_notice_idx on public.notice_files (notice_id);

-- Cada leitura do edital pela IA: bruto + validado + avisos, com modelo e versão do prompt (auditoria).
create table public.notice_extractions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  notice_id uuid not null,
  file_id uuid,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  model text not null default '',
  prompt_version text not null default '',
  raw jsonb,
  result jsonb,
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, owner_id),
  foreign key (notice_id, owner_id) references public.notices (id, owner_id) on delete cascade,
  foreign key (file_id, owner_id) references public.notice_files (id, owner_id) on delete set null (file_id)
);
create index notice_extractions_notice_idx on public.notice_extractions (notice_id);
alter table public.notices add foreign key (approved_extraction_id, owner_id)
  references public.notice_extractions (id, owner_id) on delete set null (approved_extraction_id);

-- Matérias e tópicos conferidos pelo usuário (a unidade de cobertura do cronograma é o tópico).
create table public.notice_subjects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  notice_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  is_core boolean not null default false,
  questions int not null default 0 check (questions between 0 and 500),
  weight smallint not null default 2 check (weight between 1 and 5),
  position int not null default 0,
  unique (id, owner_id),
  foreign key (notice_id, owner_id) references public.notices (id, owner_id) on delete cascade
);
create index notice_subjects_notice_idx on public.notice_subjects (notice_id, position);

create table public.notice_topics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  subject_id uuid not null,
  text text not null check (char_length(text) between 1 and 500),
  position int not null default 0,
  source_page int check (source_page > 0),
  unique (id, owner_id),
  foreign key (subject_id, owner_id) references public.notice_subjects (id, owner_id) on delete cascade
);
create index notice_topics_subject_idx on public.notice_topics (subject_id, position);

-- ---------- IA: jobs e consumo ----------
-- Escritos só pelo backend (service role); o usuário apenas lê os seus.
create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('notice_extract', 'plan_design', 'study_guide')),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  input jsonb not null default '{}',
  result jsonb,
  error text,
  progress jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index ai_jobs_owner_idx on public.ai_jobs (owner_id, created_at desc);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete set null,
  job_id uuid references public.ai_jobs(id) on delete set null,
  operation text not null,
  model text not null,
  prompt_version text not null default '',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  thinking_tokens int not null default 0,
  cost_usd numeric(12, 6),
  latency_ms int,
  status text not null check (status in ('ok', 'error')),
  error text,
  created_at timestamptz not null default now()
);
create index ai_usage_owner_idx on public.ai_usage (owner_id, created_at desc);

-- Preço por milhão de tokens, com vigência (o custo é calculado no momento da chamada).
create table public.ai_model_prices (
  model text not null,
  effective_from date not null,
  input_per_mtok_usd numeric(10, 4) not null,
  output_per_mtok_usd numeric(10, 4) not null,
  primary key (model, effective_from)
);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.notices enable row level security;
alter table public.notice_files enable row level security;
alter table public.notice_extractions enable row level security;
alter table public.notice_subjects enable row level security;
alter table public.notice_topics enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_model_prices enable row level security; -- sem políticas: só o backend

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select, update on public.profiles to authenticated;
create policy "own profile: read" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Tabelas que o usuário edita (dados conferidos do edital).
do $$
declare t text;
begin
  foreach t in array array['notices', 'notice_files', 'notice_subjects', 'notice_topics'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "own rows: read" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: update" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t);
  end loop;
  -- Tabelas escritas pelo backend: o usuário só lê as suas linhas.
  foreach t in array array['notice_extractions', 'ai_jobs', 'ai_usage'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "own rows: read" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------- Storage: PDFs dos editais (bucket privado) ----------
-- Caminho: {uid}/{notice_id}/{sha256}.pdf. A primeira pasta precisa ser o próprio usuário.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('editais', 'editais', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "editais: read own" on storage.objects for select to authenticated
  using (bucket_id = 'editais' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "editais: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'editais' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "editais: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'editais' and (storage.foldername(name))[1] = (select auth.uid())::text);
