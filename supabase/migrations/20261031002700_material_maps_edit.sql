-- O estudante corrige as páginas que a IA indicou; criar e apagar o mapeamento continua com o backend.
grant update (page_from, page_to) on public.material_maps to authenticated;
create policy "own rows: update" on public.material_maps for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
