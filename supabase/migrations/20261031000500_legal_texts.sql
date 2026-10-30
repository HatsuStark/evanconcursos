-- E4.2 · Lei seca: textos oficiais compilados (normas.leg.br, CC BY 4.0), separados por artigo e
-- compartilhados por todos os usuários (gravados só pelo backend). Marcações e notas são pessoais.

create table public.legal_norms (
  id uuid primary key default gen_random_uuid(),
  urn text not null unique,
  law_key text not null default '',
  name text not null,
  short_name text not null default '',
  source_url text not null,          -- página da norma no normas.leg.br
  content_url text not null,         -- HTML da compilação usada
  version text not null check (version in ('Current', 'Original')), -- Current = compilação atualizada
  license text not null default 'CC BY 4.0',
  articles_count int not null default 0,
  fetched_at timestamptz not null default now()
);

create table public.legal_articles (
  id uuid primary key default gen_random_uuid(),
  norm_id uuid not null references public.legal_norms(id) on delete cascade,
  ord int not null,
  label text not null,
  num int not null,
  suffix text not null default '',
  heading text not null default '',
  text text not null,
  notes text[] not null default '{}',
  revoked boolean not null default false,
  unique (norm_id, label)
);
create index legal_articles_norm_num_idx on public.legal_articles (norm_id, num, suffix);
create index legal_articles_norm_ord_idx on public.legal_articles (norm_id, ord);

-- Marca-texto e anotação do estudante em um artigo.
create table public.legal_marks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  article_id uuid not null references public.legal_articles(id) on delete cascade,
  color text not null default 'yellow' check (color in ('yellow', 'green', 'pink', 'blue')),
  note text not null default '' check (char_length(note) <= 2000),
  updated_at timestamptz not null default now(),
  unique (owner_id, article_id)
);

alter table public.legal_norms enable row level security;
alter table public.legal_articles enable row level security;
alter table public.legal_marks enable row level security;

-- Texto de lei: público para quem está logado; escrita só com a chave de serviço.
grant select on public.legal_norms, public.legal_articles to authenticated;
create policy "logged in: read" on public.legal_norms for select to authenticated using (true);
create policy "logged in: read" on public.legal_articles for select to authenticated using (true);

grant select, insert, update, delete on public.legal_marks to authenticated;
create policy "own rows: read" on public.legal_marks for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.legal_marks for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.legal_marks for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows: delete" on public.legal_marks for delete to authenticated using (owner_id = (select auth.uid()));
