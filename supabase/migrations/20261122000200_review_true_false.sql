-- Certo ou errado da revisão da semana: gerado uma vez por revisão curta (study-guide, ação 'tf') e compartilhado entre
-- estudantes, como a própria revisão. Lista vazia = a IA não conseguiu montar um exercício bom; não tenta de novo.
create table public.review_true_false (
  guide_id uuid not null references public.study_guides(id) on delete cascade,
  prompt_version text not null,
  items jsonb not null default '[]',
  model text not null,
  created_at timestamptz not null default now(),
  primary key (guide_id, prompt_version)
);
alter table public.review_true_false enable row level security;
grant select on public.review_true_false to authenticated;
create policy "logged in: read" on public.review_true_false for select to authenticated using (true);
