-- Dicionário de termos: definições geradas pela IA para termos fora do glossário próprio (shared/glossary/terms.ts).
-- Cache compartilhado entre os estudantes (o mesmo termo não é pago duas vezes). Gravado e lido só pela função
-- "glossary" (chave de serviço); o app não acessa a tabela.
create table public.glossary_ai (
  term_key text not null,        -- termo normalizado: sem acento, minúsculo (shared/glossary/search.ts)
  prompt_version text not null,
  model text not null,
  entry jsonb,                   -- null = a IA não reconheceu o termo
  created_at timestamptz not null default now(),
  primary key (term_key, prompt_version)
);
alter table public.glossary_ai enable row level security;
