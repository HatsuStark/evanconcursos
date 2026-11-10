-- Fontes abertas (aba Fontes e apostila das matérias sem lei): obras com licença que permite reproduzir trechos com
-- crédito (shared/sources/catalog.ts), divididas em trechos com página e seção. Gravadas só pelo backend
-- (scripts/sources-seed.ts) e lidas por quem está logado.
create table public.open_sources (
  key text primary key,
  title text not null,
  authors text not null default '',
  publisher text not null default '',
  year int,
  license text not null,
  license_url text not null default '',
  commercial_ok boolean not null default false, -- licença sem "NC": pode continuar se o app passar a ser pago
  url text not null,
  note text not null default '',
  chunks_count int not null default 0,
  fetched_at timestamptz not null default now()
);

create table public.open_source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.open_sources(key) on delete cascade,
  ord int not null,
  page_from int not null,
  page_to int not null,
  heading text not null default '',
  text text not null,
  -- Busca em português; o título da seção pesa mais que o texto.
  tsv tsvector generated always as (setweight(to_tsvector('portuguese', heading), 'A') || setweight(to_tsvector('portuguese', text), 'B')) stored,
  unique (source_key, ord)
);
create index open_source_chunks_tsv_idx on public.open_source_chunks using gin (tsv);

alter table public.open_sources enable row level security;
alter table public.open_source_chunks enable row level security;
grant select on public.open_sources, public.open_source_chunks to authenticated;
create policy "logged in: read" on public.open_sources for select to authenticated using (true);
create policy "logged in: read" on public.open_source_chunks for select to authenticated using (true);

-- Trechos que mais casam com o tema, nas fontes da matéria. p_query no formato de busca da web ("a or b or c").
create function public.search_open_chunks(p_query text, p_sources text[], p_limit int default 20)
returns table (id uuid, source_key text, page_from int, page_to int, heading text, text text, rank real)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.source_key, c.page_from, c.page_to, c.heading, c.text, ts_rank_cd(c.tsv, q, 1) as rank
  from public.open_source_chunks c, websearch_to_tsquery('portuguese', p_query) q
  where c.source_key = any(p_sources) and c.tsv @@ q
  order by rank desc
  limit least(greatest(p_limit, 1), 50)
$$;
grant execute on function public.search_open_chunks(text, text[], int) to authenticated;

-- Escolha da IA dos trechos que explicam o tema (shared/ai/sources.ts) e livros de referência conferidos no Google
-- Books, em cache compartilhado (mesmo tema e mesmos trechos não voltam à IA).
create table public.source_picks (
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  prompt_version text not null,
  model text not null default '',
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (cache_key, prompt_version)
);
alter table public.source_picks enable row level security;
revoke all on public.source_picks from anon, authenticated;
