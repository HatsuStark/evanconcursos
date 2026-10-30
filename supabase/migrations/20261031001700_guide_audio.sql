-- Áudio da apostila nas vozes de IA: gerado uma vez por texto e voz, reaproveitado entre sessões e estudantes.
-- Sem dados pessoais. Só o backend lê e grava: o app recebe um link temporário da função guide-voice.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guide-audio', 'guide-audio', false, 10485760, array['audio/mpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.guide_audio (
  cache_key text primary key,        -- sha256 de modelo, versão do prompt, voz e texto
  voice text not null,
  model text not null,
  prompt_version text not null,
  storage_path text not null,
  seconds numeric(8, 2) not null,
  size_bytes int not null,
  created_at timestamptz not null default now()
);
alter table public.guide_audio enable row level security;

insert into public.ai_model_prices (model, effective_from, input_per_mtok_usd, output_per_mtok_usd) values
  ('gemini-3.8-flash-lite-tts', '2026-01-01', 0.50, 6.00),
  ('gemini-3.8-flash-lite-tts', '2027-01-01', 1.00, 12.00),
  ('gemini-3.8-flash-tts', '2026-01-01', 0.50, 9.00),
  ('gemini-3.8-flash-tts', '2027-01-01', 1.00, 18.00)
on conflict do nothing;
