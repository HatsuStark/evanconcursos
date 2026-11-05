-- Normas citadas no edital fora do registro passam a ser buscadas sozinhas na montagem do cronograma: federais no
-- normas.leg.br (data pelo índice do Senado), estaduais no acervo github.com/ctresb/leis. A norma achada fica em
-- legal_norms sem dono (owner_id nulo) e com match_pattern: vale para todos, como as do registro.
-- Aqui fica o resultado de cada busca, para não repetir a que falhou a cada montagem (refeita depois de 30 dias).
create table public.legal_lookups (
  key text primary key,            -- "federal:lei-9613-1998", "sp:lei-10261-1968"
  norm_id uuid references public.legal_norms(id) on delete set null,
  found boolean not null,
  detail text not null default '' check (char_length(detail) <= 500),
  checked_at timestamptz not null default now()
);
alter table public.legal_lookups enable row level security;
-- Sem permissões nem políticas: só o backend (chave de serviço) lê e grava.
