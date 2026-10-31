-- E5 · Discursivas: enunciados da IA (compartilhados, só o backend lê, porque guardam o gabarito) e treinos do estudante.

create table public.discursive_prompts (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null,
  format text not null check (format in ('questao', 'redacao')),
  banca text not null default '',
  subject_name text not null default '',
  title text not null,
  content jsonb not null,            -- enunciado, espelho e resposta modelo
  sources text[] not null default '{}',
  unverified text[] not null default '{}',
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
create index discursive_prompts_key_idx on public.discursive_prompts (cache_key, created_at);
alter table public.discursive_prompts enable row level security;

-- O treino guarda uma cópia do enunciado; espelho e resposta modelo só entram em `report`, depois da correção.
create table public.discursive_answers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  notice_id uuid not null,
  subject_id uuid,
  session_id uuid,
  prompt_id uuid not null references public.discursive_prompts (id) on delete restrict,
  format text not null check (format in ('questao', 'redacao')),
  title text not null,
  subject_name text not null default '',
  statement text not null,
  support_texts text[] not null default '{}',
  lines_hint int not null default 30,
  attempt int not null default 1 check (attempt >= 1),
  body text not null default '' check (char_length(body) <= 20000),
  seconds int not null default 0 check (seconds between 0 and 86400),
  status text not null default 'draft' check (status in ('draft', 'grading', 'graded', 'failed')),
  points numeric(5, 1),
  max_points numeric(5, 1),
  pct int check (pct between 0 and 100),
  report jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  graded_at timestamptz,
  foreign key (notice_id, owner_id) references public.notices (id, owner_id) on delete cascade,
  foreign key (subject_id, owner_id) references public.notice_subjects (id, owner_id) on delete set null (subject_id),
  foreign key (session_id, owner_id) references public.study_sessions (id, owner_id) on delete set null (session_id)
);
create index discursive_answers_owner_idx on public.discursive_answers (owner_id, notice_id, created_at desc);
create index discursive_answers_prompt_idx on public.discursive_answers (owner_id, prompt_id);
create trigger discursive_answers_touch before update on public.discursive_answers
  for each row execute function public.touch_updated_at();

alter table public.discursive_answers enable row level security;
-- O estudante lê, escreve o rascunho e apaga. Criar, travar e dar nota é do backend.
grant select, delete on public.discursive_answers to authenticated;
grant update (body, seconds) on public.discursive_answers to authenticated;
create policy "own rows: read" on public.discursive_answers for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: edit draft" on public.discursive_answers for update to authenticated
  using (owner_id = (select auth.uid()) and status in ('draft', 'failed')) with check (owner_id = (select auth.uid()));
create policy "own rows: delete" on public.discursive_answers for delete to authenticated using (owner_id = (select auth.uid()));
