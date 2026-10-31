-- Trechos: o estudante acrescenta e apaga, e o que ele mexeu sobrevive a "Mapear de novo".
alter table public.material_maps add column manual boolean not null default false;
alter table public.material_maps alter column owner_id set default auth.uid();

grant insert (material_id, session_id, page_from, page_to, manual) on public.material_maps to authenticated;
grant delete on public.material_maps to authenticated;
create policy "own rows: insert" on public.material_maps for insert to authenticated
  with check (owner_id = (select auth.uid()) and manual);
create policy "own rows: delete" on public.material_maps for delete to authenticated
  using (owner_id = (select auth.uid()));

create function public.material_maps_mark_manual() returns trigger language plpgsql set search_path = '' as $$
begin
  new.manual := true;
  return new;
end $$;
revoke execute on function public.material_maps_mark_manual() from public, anon, authenticated;
create trigger material_maps_mark_manual before update of page_from, page_to on public.material_maps
  for each row execute function public.material_maps_mark_manual();

-- Marcações e anotações no PDF. As posições são frações da página, para valer em qualquer zoom.
create table public.material_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  material_id uuid not null,
  page int not null check (page > 0),
  rects jsonb not null check (jsonb_typeof(rects) = 'array' and jsonb_array_length(rects) between 1 and 200),
  quote text not null default '' check (char_length(quote) <= 4000),
  note text not null default '' check (char_length(note) <= 4000),
  color text not null default 'yellow' check (color in ('yellow', 'green', 'pink')),
  created_at timestamptz not null default now(),
  foreign key (material_id, owner_id) references public.materials (id, owner_id) on delete cascade
);
create index material_notes_material_idx on public.material_notes (material_id, page);

alter table public.material_notes enable row level security;
grant select, delete on public.material_notes to authenticated;
grant insert (material_id, page, rects, quote, note, color) on public.material_notes to authenticated;
grant update (note, color) on public.material_notes to authenticated;
create policy "own rows: read" on public.material_notes for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows: insert" on public.material_notes for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows: update" on public.material_notes for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows: delete" on public.material_notes for delete to authenticated using (owner_id = (select auth.uid()));
