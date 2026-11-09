-- Relatos de bug e sugestões enviados pelo balão do app. Gravados só pela Edge Function "feedback" (chave de serviço),
-- que também avisa por e-mail. O usuário não lê nem grava a tabela direto.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  email text,
  kind text not null check (kind in ('bug', 'sugestao', 'outro')),
  message text not null check (char_length(message) between 3 and 4000),
  page text check (char_length(page) <= 500),
  user_agent text check (char_length(user_agent) <= 500),
  emailed boolean not null default false,
  created_at timestamptz not null default now()
);
create index feedback_owner_idx on public.feedback (owner_id, created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
