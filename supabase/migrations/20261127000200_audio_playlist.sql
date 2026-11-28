-- Playlist das revisões em áudio (shared/audio/playlist.ts): o estudante fixa ou tira trechos (capítulos) das revisões
-- já geradas. A fila em si é calculada na hora; aqui fica só a escolha dele, que vale em qualquer aparelho.
create table public.audio_playlist_marks (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  review_id uuid not null references public.audio_reviews (id) on delete cascade,
  chapter_id text not null check (length(chapter_id) between 1 and 40),
  mark text not null check (mark in ('pin', 'hide')),
  created_at timestamptz not null default now(),
  primary key (owner_id, review_id, chapter_id)
);
alter table public.audio_playlist_marks enable row level security;
grant select, insert, update, delete on public.audio_playlist_marks to authenticated;
create policy "own rows: read" on public.audio_playlist_marks for select to authenticated using (owner_id = (select auth.uid()));
-- Só em revisão do próprio estudante.
create policy "own rows: insert" on public.audio_playlist_marks for insert to authenticated
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.audio_reviews r where r.id = review_id and r.owner_id = (select auth.uid())));
create policy "own rows: update" on public.audio_playlist_marks for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows: delete" on public.audio_playlist_marks for delete to authenticated using (owner_id = (select auth.uid()));
