-- Mais cobrados de um tema, segundo a IA (shared/ai/hot.ts): assuntos e artigos que a banca costuma explorar. Estimativa
-- da IA, não medição; a apostila dá mais espaço a eles e avisa o candidato para ler a lei completa. Compartilhado entre
-- estudantes: o mesmo tema (matéria, título, artigos) na mesma banca não volta à IA. Versão nova do prompt pesquisa de novo.
create table public.hot_topics (
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  prompt_version text not null,
  model text not null default '',
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (cache_key, prompt_version)
);
alter table public.hot_topics enable row level security;
revoke all on public.hot_topics from anon, authenticated;
