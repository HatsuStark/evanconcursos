-- Triagem de relevância das questões da sessão: o assunto da Quest API é largo (ex.: "Prazos" mistura a contagem dos
-- arts. 798 e 798-A com os prazos do procedimento ordinário). A IA confere cada questão nova contra o tema da sessão, e o
-- veredito fica aqui para não julgar nem mostrar de novo. Só o backend lê e grava.
create table public.qbank_relevance (
  session_id uuid not null,
  owner_id uuid not null,
  qid text not null,
  relevant boolean not null,
  reason text not null default '' check (char_length(reason) <= 300),
  prompt_version text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, qid),
  foreign key (session_id, owner_id) references public.study_sessions (id, owner_id) on delete cascade
);
alter table public.qbank_relevance enable row level security;
