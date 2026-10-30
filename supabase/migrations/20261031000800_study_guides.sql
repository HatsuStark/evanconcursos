-- E4.4 · Apostilas da IA: cache compartilhado por tema + fontes (sem dados pessoais), gravado pelo backend.
create table public.study_guides (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  depth text not null check (depth in ('completa', 'revisao')),
  subject_name text not null,
  title text not null,
  content jsonb not null,
  sources text[] not null default '{}',          -- artigos fornecidos à IA ("CP, art. 312")
  unlisted_sources text[] not null default '{}', -- fontes citadas sem texto oficial integrado
  unverified text[] not null default '{}',       -- citações no texto fora das fontes
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
alter table public.study_guides enable row level security;
grant select on public.study_guides to authenticated;
create policy "logged in: read" on public.study_guides for select to authenticated using (true);
