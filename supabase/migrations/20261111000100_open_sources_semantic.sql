-- Fontes abertas: busca pelo significado (vetores do Gemini, shared/sources/embed.ts) junto com a busca por palavras, e
-- obras publicadas como site (cada trecho guarda o link da página de onde veio).
create extension if not exists vector with schema extensions;

alter table public.open_sources
  add column embed_model text not null default '',   -- modelo dos vetores dos trechos; a busca só os usa com o mesmo modelo
  add column format text not null default 'pdf' check (format in ('pdf', 'html'));

alter table public.open_source_chunks
  add column href text not null default '',           -- página do site (fontes em HTML); vazio nas fontes em PDF
  add column embedding extensions.vector(768);
-- Sem índice vetorial: são poucos milhares de trechos, e a busca exata filtrada pelas fontes da matéria é rápida. Com
-- índice aproximado (HNSW) o filtro por fonte vem depois e pode cortar resultados.

-- Busca híbrida: os mais bem colocados por palavras e por significado, combinados pela posição em cada lista (RRF).
-- p_embedding nulo = só palavras. Trecho achado só pelo significado precisa de semelhança >= p_min_sim.
-- sim: semelhança (cosseno) com a busca, nula sem vetor.
create function public.search_open_chunks_hybrid(p_query text, p_embedding extensions.vector(768), p_sources text[], p_limit int default 20, p_min_sim real default 0.6)
returns table (id uuid, source_key text, page_from int, page_to int, heading text, text text, href text, rank real, sim real)
language sql stable security invoker set search_path = '' as $$
  with q as (select websearch_to_tsquery('portuguese', coalesce(p_query, '')) as q),
  words as (
    select c.id, row_number() over (order by ts_rank_cd(c.tsv, q.q, 1) desc) as r
    from public.open_source_chunks c, q
    where c.source_key = any(p_sources) and c.tsv @@ q.q
    order by ts_rank_cd(c.tsv, q.q, 1) desc
    limit 50
  ),
  near as (
    select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_embedding) as r,
      (1 - (c.embedding operator(extensions.<=>) p_embedding))::real as sim
    from public.open_source_chunks c
    where p_embedding is not null and c.embedding is not null and c.source_key = any(p_sources)
    order by c.embedding operator(extensions.<=>) p_embedding
    limit 50
  )
  select c.id, c.source_key, c.page_from, c.page_to, c.heading, c.text, c.href,
    (coalesce(1.0 / (60 + w.r), 0) + coalesce(1.0 / (60 + n.r), 0))::real as rank, n.sim
  from public.open_source_chunks c
  left join words w on w.id = c.id
  left join near n on n.id = c.id
  where w.id is not null or (n.id is not null and n.sim >= p_min_sim)
  order by rank desc
  limit least(greatest(p_limit, 1), 50)
$$;
grant execute on function public.search_open_chunks_hybrid(text, extensions.vector, text[], int, real) to authenticated;
