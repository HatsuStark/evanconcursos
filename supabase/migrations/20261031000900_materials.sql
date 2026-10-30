-- E4.5 · Biblioteca pessoal: PDFs do estudante (bucket privado) e mapeamento das páginas para as sessões.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materiais', 'materiais', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "materiais: read own" on storage.objects for select to authenticated
  using (bucket_id = 'materiais' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "materiais: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'materiais' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "materiais: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'materiais' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  plan_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  pages int check (pages > 0),
  status text not null default 'uploaded' check (status in ('uploaded', 'mapping', 'mapped', 'failed')),
  status_detail text not null default '',
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade
);

create table public.material_maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  material_id uuid not null,
  session_id uuid not null,
  page_from int not null check (page_from > 0),
  page_to int not null,
  check (page_to >= page_from),
  foreign key (material_id, owner_id) references public.materials (id, owner_id) on delete cascade,
  foreign key (session_id, owner_id) references public.study_sessions (id, owner_id) on delete cascade
);
create index material_maps_session_idx on public.material_maps (session_id);

alter table public.materials enable row level security;
alter table public.material_maps enable row level security;
-- O estudante envia, renomeia e apaga os seus; status e mapeamento são do backend.
grant select, insert, delete on public.materials to authenticated;
grant update (title) on public.materials to authenticated;
create policy "own rows: read" on public.materials for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.materials for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.materials for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows: delete" on public.materials for delete to authenticated using (owner_id = (select auth.uid()));
grant select on public.material_maps to authenticated;
create policy "own rows: read" on public.material_maps for select to authenticated using (owner_id = (select auth.uid()));
