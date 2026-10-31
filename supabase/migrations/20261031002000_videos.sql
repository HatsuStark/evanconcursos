-- Vídeos do YouTube: buscas guardadas (compartilhadas, só o backend usa) e vídeos marcados como assistidos.

-- Os termos da YouTube Data API exigem renovar ou apagar estes dados em até 30 dias (a função "videos" faz isso).
create table public.video_searches (
  query_key text primary key,
  query text not null,
  videos jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.video_searches enable row level security;

-- Por concurso: excluir o concurso leva as marcações em cascata.
create table public.video_watches (
  owner_id uuid not null default auth.uid(),
  notice_id uuid not null,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  watched_at timestamptz not null default now(),
  primary key (owner_id, notice_id, video_id),
  foreign key (notice_id, owner_id) references public.notices (id, owner_id) on delete cascade
);
alter table public.video_watches enable row level security;
grant select, insert, delete on public.video_watches to authenticated;
create policy "own rows: read" on public.video_watches for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.video_watches for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: delete" on public.video_watches for delete to authenticated using (owner_id = (select auth.uid()));
