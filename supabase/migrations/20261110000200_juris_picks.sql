-- Jurisprudência da sessão: itens vigentes ligados aos artigos dela. p_refs: [{law, from, to}] (from/to nulos = a lei
-- toda). Uma chamada só, sem expandir os intervalos em listas de artigos na URL.
create function public.precedents_for_refs(p_refs jsonb)
returns table (id uuid, court text, kind text, number int, text text, subject text, decided_on date, source_url text, arts jsonb)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.court, p.kind, p.number, p.text, p.subject, p.decided_on, p.source_url,
    jsonb_agg(distinct jsonb_build_object('law', l.law_key, 'art', l.art_num)) as arts
  from jsonb_to_recordset(p_refs) as r(law text, "from" int, "to" int)
  join public.legal_precedent_links l on l.law_key = r.law and (r."from" is null or l.art_num between r."from" and r."to")
  join public.legal_precedents p on p.id = l.precedent_id and p.active
  group by p.id
  limit 400
$$;
grant execute on function public.precedents_for_refs(jsonb) to authenticated;

-- O que mais cai entre os itens de um tema, com uma frase de como a banca cobra (shared/ai/juris.ts). Estimativa da IA
-- sobre o texto oficial; compartilhada entre estudantes (mesmo tema, mesmos itens e banca não voltam à IA).
create table public.juris_picks (
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  prompt_version text not null,
  model text not null default '',
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (cache_key, prompt_version)
);
alter table public.juris_picks enable row level security;
revoke all on public.juris_picks from anon, authenticated;
