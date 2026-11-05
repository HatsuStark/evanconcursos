-- Leituras do edital compartilhadas entre candidatos (shared/ai/notice-cache.ts): a lista de cargos e a leitura completa
-- (matérias e tópicos) de um edital já lido para o mesmo cargo não voltam à IA. O edital é reconhecido pelo hash do PDF
-- ("pdf:") ou do texto normalizado ("txt:"), calculados no servidor. A mesma leitura fica gravada sob as duas chaves.
-- Só guarda o que a IA leu do PDF (documento público), nunca a conferência do candidato. Versão nova do prompt lê de novo.
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
-- Sem permissões nem políticas: só o backend (chave de serviço) lê e grava.
revoke all on public.notice_ai_cache from anon, authenticated;
