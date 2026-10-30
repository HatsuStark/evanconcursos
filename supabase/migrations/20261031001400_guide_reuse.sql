-- Reaproveitamento de apostilas pelo conteúdo (não pelo título da sessão): guarda as chaves usadas na
-- busca por apostila igual ou semelhante (mesma matéria, banca e profundidade; mesmos artigos/tópicos).
alter table public.study_guides
  add column subject_key text not null default '',
  add column banca text not null default '',
  add column topic_keys text[] not null default '{}';
create index study_guides_reuse_idx on public.study_guides (subject_key, depth, banca, prompt_version);
