-- Trava da geração de questões inéditas por tema: a geração roda em segundo plano depois da resposta, e o pedido seguinte
-- (o app já pede a próxima questão) espera por ela em vez de gerar outro lote igual. Só a Edge Function (service role) usa.
create table public.qbank_generation_locks (
  theme text primary key,
  started_at timestamptz not null default now()
);
alter table public.qbank_generation_locks enable row level security;
