-- Reaproveitamento entre candidatos do mesmo edital (shared/ai/notice-cache.ts).
-- 1) notice_ai_cache: a lista de cargos e a leitura completa (matérias e tópicos) de um edital já lido para o mesmo cargo
--    não voltam à IA. O edital é reconhecido pelo hash do PDF ("pdf:") ou do texto normalizado ("txt:"), calculados no
--    servidor; a mesma leitura fica gravada sob as duas chaves. Só guarda o que a IA leu do PDF (documento público), nunca
--    a conferência do candidato. Versão nova do prompt lê de novo.
-- 2) notice_docs: título e assinatura do texto de cada edital lido, para reconhecer o mesmo edital em outro arquivo.
-- 3) notices.doc_key: o edital compartilhado de cada concurso do candidato, para reaproveitar o que vem depois da leitura
--    (carreira, matéria e assuntos do banco de questões).
create table public.notice_ai_cache (
  kind text not null check (kind in ('roles', 'extract')),
  doc_key text not null check (doc_key ~ '^(pdf|txt):[0-9a-f]{64}$'),
  role_key text not null default '' check (char_length(role_key) <= 400),  -- vazio na lista de cargos
  prompt_version text not null,
  model text not null default '',
  result jsonb not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  primary key (kind, doc_key, role_key, prompt_version)
);
alter table public.notice_ai_cache enable row level security;
revoke all on public.notice_ai_cache from anon, authenticated;

create table public.notice_docs (
  doc_key text primary key check (doc_key ~ '^pdf:[0-9a-f]{64}$'),
  text_key text check (text_key ~ '^txt:[0-9a-f]{64}$'),
  title_key text check (title_key ~ '^ttl:[0-9a-f]{64}$'),
  signature int4[] check (signature is null or cardinality(signature) = 128),
  -- Versão anterior do mesmo concurso (mesmo título, texto diferente: retificação ou republicação). Base do aviso aos
  -- candidatos que montaram o cronograma na versão anterior.
  previous_doc_key text references public.notice_docs (doc_key),
  created_at timestamptz not null default now()
);
create index notice_docs_title on public.notice_docs (title_key);
alter table public.notice_docs enable row level security;
revoke all on public.notice_docs from anon, authenticated;
-- Sem permissões nem políticas nas duas tabelas: só o backend (chave de serviço) lê e grava.

alter table public.notices add column doc_key text check (doc_key ~ '^pdf:[0-9a-f]{64}$');
create index notices_doc_key on public.notices (doc_key) where doc_key is not null;
