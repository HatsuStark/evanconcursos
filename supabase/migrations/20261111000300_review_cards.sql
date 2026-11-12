-- Revisão curta em cartões.
-- review_card_memory: por tarefa, os cartões que o estudante já sabe, os que não lembrou e os de leitura já vistos (ids
-- estáveis do conteúdo, de shared/domain/review-cards.ts). Vale em qualquer aparelho.
-- review_card_sessions: cada vez que a revisão é feita (quantos cartões, quantos lembrados, tempo, se chegou ao fim), para
-- medir uso e onde o estudante desiste.
create table public.review_card_memory (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  known text[] not null default '{}' check (cardinality(known) <= 300),
  missed text[] not null default '{}' check (cardinality(missed) <= 300),
  seen text[] not null default '{}' check (cardinality(seen) <= 300),
  updated_at timestamptz not null default now(),
  primary key (owner_id, task_id)
);
alter table public.review_card_memory enable row level security;
grant select, insert, update on public.review_card_memory to authenticated;
create policy "own rows: read" on public.review_card_memory for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.review_card_memory for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.review_card_memory for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create table public.review_card_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  cards int not null check (cards between 0 and 100),          -- cartões no baralho do dia
  recall_cards int not null check (recall_cards between 0 and 100),
  answered int not null default 0 check (answered between 0 and 100),
  remembered int not null default 0 check (remembered between 0 and 100),
  missed int not null default 0 check (missed between 0 and 100),
  duration_s int not null default 0 check (duration_s between 0 and 86400),
  completed boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index review_card_sessions_owner_idx on public.review_card_sessions (owner_id, started_at desc);
create index review_card_sessions_task_idx on public.review_card_sessions (task_id);
alter table public.review_card_sessions enable row level security;
grant select, insert, update on public.review_card_sessions to authenticated;
create policy "own rows: read" on public.review_card_sessions for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.review_card_sessions for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.review_card_sessions for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
