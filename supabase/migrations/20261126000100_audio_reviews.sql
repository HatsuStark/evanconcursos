-- Revisão em áudio (dias de revisão semanal): roteiro pedagógico pela IA, narração em blocos pelo Gemini TTS e montagem
-- (pausas, trilha, loudness) no navegador. O servidor guarda só a narração; as versões com e sem música saem dos mesmos
-- blocos. Tudo é escrito pela função audio-review (chave de serviço); o estudante só lê as próprias revisões.

-- Narração por bloco: mesmo texto, voz, estilo e modelo = mesmo arquivo, reaproveitado entre revisões e estudantes.
-- Sem dados pessoais (só o texto narrado do roteiro).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-audio', 'review-audio', false, 10485760, array['audio/mpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.audio_blocks (
  cache_key text primary key,          -- sha256 de modelo, voz, estilo, versão e texto
  voice text not null,
  model text not null,
  pipeline_version text not null,
  storage_path text not null,
  ms int not null check (ms > 0),
  size_bytes int not null,
  created_at timestamptz not null default now()
);
alter table public.audio_blocks enable row level security; -- sem políticas: só o backend

create table public.audio_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  task_id uuid not null,               -- tarefa de revisão semanal
  cache_key text not null,             -- conteúdo, versões, personalização, duração, voz, modelos e pipeline
  duration_min int not null check (duration_min in (10, 20, 30)),
  voice text not null check (voice in ('feminina', 'masculina')),
  status text not null default 'queued' check (status in ('queued', 'planning', 'scripting', 'validating', 'narrating', 'ready', 'failed')),
  attempts int not null default 0,     -- tentativas da etapa atual
  lease_until timestamptz,             -- etapa em andamento até este instante (depois, outro worker retoma)
  error text,
  inputs jsonb,                        -- seleção e materiais usados (ids, versões e motivos; sem dados pessoais)
  plan jsonb,
  script jsonb,
  issues jsonb not null default '[]',  -- o que a conferência apontou e corrigiu
  timeline jsonb,                      -- capítulos e blocos com tempos (ms)
  quiz jsonb,
  quiz_status text not null default 'pending' check (quiz_status in ('pending', 'running', 'done', 'failed')),
  quiz_lease_until timestamptz,
  pipeline_version text not null,
  prompt_version text not null,
  text_model text not null,
  tts_model text not null,
  usage jsonb not null default '{}',   -- tokens de texto e de áudio, chamadas, retentativas, blocos reaproveitados
  cost_usd numeric(10, 4) not null default 0,
  duration_ms int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  -- Escuta e retenção (gravadas pela função, a pedido do estudante).
  position_ms int not null default 0,
  max_position_ms int not null default 0,
  listened_ms int not null default 0,
  completed_at timestamptz,
  music boolean,
  speed numeric(3, 2),
  quiz_answers jsonb,
  quiz_score int,
  quiz_done_at timestamptz,
  unique (owner_id, task_id, cache_key),
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade,
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete cascade
);
create index audio_reviews_task_idx on public.audio_reviews (owner_id, task_id, created_at desc);
alter table public.audio_reviews enable row level security;
grant select on public.audio_reviews to authenticated;
create policy "own rows: read" on public.audio_reviews for select to authenticated using (owner_id = (select auth.uid()));

-- Blocos de narração de cada revisão: a fila do worker. Vários workers pegam blocos diferentes ao mesmo tempo.
create table public.audio_review_blocks (
  review_id uuid not null references public.audio_reviews(id) on delete cascade,
  idx int not null,
  text text not null,
  cache_key text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  lease_until timestamptz,
  ms int,
  reused boolean not null default false,
  error text,
  primary key (review_id, idx)
);
alter table public.audio_review_blocks enable row level security; -- sem políticas: só o backend

-- Pega a etapa da revisão por um tempo (lease). null: outro worker está nela ou já acabou.
create function public.audio_claim_review(p_id uuid, p_seconds int) returns public.audio_reviews
language sql security definer set search_path = '' as $$
  update public.audio_reviews set lease_until = now() + make_interval(secs => p_seconds), updated_at = now()
  where id = p_id and status in ('queued', 'planning', 'scripting', 'validating') and (lease_until is null or lease_until < now())
  returning *;
$$;

-- Pega o próximo bloco livre (pendente sem lease vigente), sem disputar com outro worker.
create function public.audio_claim_block(p_review uuid, p_seconds int) returns public.audio_review_blocks
language sql security definer set search_path = '' as $$
  update public.audio_review_blocks b set lease_until = now() + make_interval(secs => p_seconds), attempts = b.attempts + 1
  where (b.review_id, b.idx) = (
    select review_id, idx from public.audio_review_blocks
    where review_id = p_review and status = 'pending' and (lease_until is null or lease_until < now())
    order by idx limit 1 for update skip locked)
  returning b.*;
$$;

-- Pega a geração da miniavaliação.
create function public.audio_claim_quiz(p_id uuid, p_seconds int) returns boolean
language sql security definer set search_path = '' as $$
  with c as (
    update public.audio_reviews set quiz_status = 'running', quiz_lease_until = now() + make_interval(secs => p_seconds)
    where id = p_id and script is not null and (quiz_status = 'pending' or (quiz_status = 'running' and quiz_lease_until < now()))
    returning 1)
  select exists (select 1 from c);
$$;

revoke all on function public.audio_claim_review(uuid, int), public.audio_claim_block(uuid, int), public.audio_claim_quiz(uuid, int) from public, anon, authenticated;
grant execute on function public.audio_claim_review(uuid, int), public.audio_claim_block(uuid, int), public.audio_claim_quiz(uuid, int) to service_role;
