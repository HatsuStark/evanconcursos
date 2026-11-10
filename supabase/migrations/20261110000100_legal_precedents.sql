-- Jurisprudência: súmulas e teses oficiais do STF e do STJ, com o texto literal publicado pelos tribunais (decisões
-- judiciais não têm proteção de direito autoral: Lei 9.610/98, art. 8º, IV). Compartilhadas por todos e gravadas só pelo
-- backend (scripts/juris-seed.ts). A IA nunca escreve o texto: só escolhe e comenta itens desta tabela.

create table public.legal_precedents (
  id uuid primary key default gen_random_uuid(),
  court text not null check (court in ('STF', 'STJ')),
  kind text not null check (kind in ('sumula_vinculante', 'sumula', 'repercussao_geral', 'repetitivo', 'iac')),
  number int not null,
  text text not null,
  subject text not null default '',      -- ramo ou assunto informado pelo tribunal
  decided_on date,
  active boolean not null default true,  -- false: cancelada, revogada, superada ou revisada
  source_url text not null,
  fetched_at timestamptz not null default now(),
  classified_at timestamptz,             -- quando a IA ligou o item a artigos (itens sem artigo citado no texto)
  unique (court, kind, number)
);

-- Artigos de lei a que o item se refere. law_key é a chave do registro (shared/legal/registry.ts), como em law_refs.
-- origin: 'referencia' = referência legislativa oficial do tribunal; 'citacao' = artigo citado no próprio texto;
-- 'ia' = classificação pela IA (texto oficial sem artigo citado).
create table public.legal_precedent_links (
  precedent_id uuid not null references public.legal_precedents(id) on delete cascade,
  law_key text not null,
  art_num int not null,
  origin text not null check (origin in ('referencia', 'citacao', 'ia')),
  primary key (precedent_id, law_key, art_num)
);
create index legal_precedent_links_law_idx on public.legal_precedent_links (law_key, art_num);

alter table public.legal_precedents enable row level security;
alter table public.legal_precedent_links enable row level security;

grant select on public.legal_precedents, public.legal_precedent_links to authenticated;
create policy "logged in: read" on public.legal_precedents for select to authenticated using (true);
create policy "logged in: read" on public.legal_precedent_links for select to authenticated using (true);
