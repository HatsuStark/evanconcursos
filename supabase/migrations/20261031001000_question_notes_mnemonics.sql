-- Questões: anotações pessoais por questão e mnemônicos (gerados pela IA, compartilhados entre questões
-- do mesmo conceito: o mesmo mnemônico serve a várias questões e a todos os estudantes).

create table public.question_notes (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  qid text not null,
  note text not null default '' check (char_length(note) <= 5000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, qid)
);
alter table public.question_notes enable row level security;
grant select, insert, update, delete on public.question_notes to authenticated;
create policy "own rows: read" on public.question_notes for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.question_notes for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.question_notes for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows: delete" on public.question_notes for delete to authenticated using (owner_id = (select auth.uid()));

create table public.mnemonics (
  id uuid primary key default gen_random_uuid(),
  concept text not null check (char_length(concept) between 1 and 200),
  concept_key text not null unique,      -- conceito normalizado (sem acento/caixa) para reaproveitar
  materia text not null default '',
  assunto text not null default '',
  mnemonic text not null check (char_length(mnemonic) between 1 and 300),
  explanation text not null default '',
  items jsonb not null default '[]',      -- [{chave, significado}] (ex.: letra do acrônimo → item)
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
create index mnemonics_assunto_idx on public.mnemonics (materia, assunto);
alter table public.mnemonics enable row level security;
grant select on public.mnemonics to authenticated;
create policy "logged in: read" on public.mnemonics for select to authenticated using (true);

-- Questão → mnemônico (null + checked = a IA avaliou que não cabe mnemônico).
alter table public.qbank_questions
  add column mnemonic_id uuid references public.mnemonics(id) on delete set null,
  add column mnemonic_checked boolean not null default false;
