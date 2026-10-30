-- Prática além do cronograma: questões livres (histórico separado), caderno de erros com revisão
-- espaçada (1, 7 e 30 dias), flashcards (Leitner) e simulados (do concurso ou personalizados).

-- Tentativas ganham contexto: cronograma, livre, revisão de erros ou simulado. Livre/simulado podem não ter plano.
alter table public.question_attempts
  add column context text not null default 'plan' check (context in ('plan', 'free', 'review', 'simulado')),
  add column simulado_id uuid,
  add column time_ms int check (time_ms >= 0),
  alter column plan_id drop not null;
create index question_attempts_context_idx on public.question_attempts (owner_id, context, created_at desc);

-- Caderno de erros: questão errada volta em 1 dia; acertos na revisão levam a 7 e 30 dias; depois sai.
create table public.error_book (
  owner_id uuid not null references auth.users(id) on delete cascade,
  qid text not null,
  materia text not null default '',
  assunto text not null default '',
  stage int not null default 0 check (stage between 0 and 3),
  due_on date not null,
  wrong_count int not null default 1,
  resolved boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, qid)
);
create index error_book_due_idx on public.error_book (owner_id, resolved, due_on);

-- Flashcards: frente/verso, caixa de Leitner (1–5) e próxima revisão.
create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('mnemonic', 'question')),
  ref text not null,                 -- id do mnemônico ou da questão
  front text not null check (char_length(front) <= 2000),
  back text not null check (char_length(back) <= 4000),
  box int not null default 1 check (box between 1 and 5),
  due_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (owner_id, kind, ref)
);
create index flashcards_due_idx on public.flashcards (owner_id, due_on);

-- Simulados: questões sorteadas pelo backend; respostas guardadas sem correção até a entrega.
create table public.simulados (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid,
  task_id uuid,
  title text not null check (char_length(title) <= 160),
  config jsonb not null,             -- {kind, blocks:[{name, minPct, subjects:[{name, count}]}], timed, minutes, tipo}
  questions jsonb not null default '[]', -- [{qid, block, subject}]
  status text not null default 'in_progress' check (status in ('in_progress', 'finished')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb,
  unique (id, owner_id)
);
create index simulados_owner_idx on public.simulados (owner_id, started_at desc);

create table public.simulado_answers (
  owner_id uuid not null default auth.uid(),
  simulado_id uuid not null,
  qid text not null,
  chosen text not null default '' check (char_length(chosen) <= 20),
  struck text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (simulado_id, qid),
  foreign key (simulado_id, owner_id) references public.simulados (id, owner_id) on delete cascade
);

alter table public.error_book enable row level security;
alter table public.flashcards enable row level security;
alter table public.simulados enable row level security;
alter table public.simulado_answers enable row level security;

-- Caderno de erros e simulados: o estudante lê; quem grava é o backend (correção no servidor).
grant select on public.error_book, public.simulados to authenticated;
create policy "own rows: read" on public.error_book for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: read" on public.simulados for select to authenticated using (owner_id = (select auth.uid()));
-- Flashcards: o estudante revisa (caixa e data) e apaga; os cartões nascem no backend.
grant select, delete on public.flashcards to authenticated;
grant update (box, due_on) on public.flashcards to authenticated;
create policy "own rows: read" on public.flashcards for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: update" on public.flashcards for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows: delete" on public.flashcards for delete to authenticated using (owner_id = (select auth.uid()));
-- Respostas do simulado em andamento: o estudante grava as suas (só enquanto o simulado não foi entregue).
grant select, insert, update, delete on public.simulado_answers to authenticated;
create policy "own rows: read" on public.simulado_answers for select to authenticated using (owner_id = (select auth.uid()));
create policy "own open simulado: write" on public.simulado_answers for insert to authenticated with check (
  owner_id = (select auth.uid()) and exists (select 1 from public.simulados s where s.id = simulado_id and s.status = 'in_progress'));
create policy "own open simulado: update" on public.simulado_answers for update to authenticated using (owner_id = (select auth.uid())) with check (
  owner_id = (select auth.uid()) and exists (select 1 from public.simulados s where s.id = simulado_id and s.status = 'in_progress'));
create policy "own rows: delete" on public.simulado_answers for delete to authenticated using (owner_id = (select auth.uid()));
