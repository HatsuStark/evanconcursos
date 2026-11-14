-- Avisos de mudança no cronograma feitas pelo app (não pelo estudante): ex.: artigos do edital que tinham ficado fora
-- das sessões e foram incluídos (scripts/plan-coverage.ts). O estudante lê no Início e no Cronograma e dispensa.
-- items: [{ subject, session, date, added }] (matéria, sessão alterada, dia da teoria, o que entrou).
create table public.plan_notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  plan_id uuid not null,
  kind text not null check (kind in ('coverage')),
  title text not null check (char_length(title) between 1 and 300),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade
);
create index plan_notices_owner_idx on public.plan_notices (owner_id, plan_id) where seen_at is null;
alter table public.plan_notices enable row level security;
grant select on public.plan_notices to authenticated;
grant update (seen_at) on public.plan_notices to authenticated;
create policy "own rows: read" on public.plan_notices for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: dismiss" on public.plan_notices for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
