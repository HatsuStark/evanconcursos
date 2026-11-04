-- Normas enviadas pelo estudante: o edital cita norma fora do registro (ex.: Resolução CNJ 354/2020, Lei estadual
-- 11.608/2003) e o estudante envia o PDF oficial. A norma fica só para ele (owner_id): não há como garantir que o PDF é
-- o texto oficial, então não vale para os outros. As normas do registro continuam com owner_id nulo, para todos.
alter table public.legal_norms
  add column owner_id uuid references auth.users(id) on delete cascade,
  add column match_pattern text,              -- como a norma aparece nos textos (regex), para achar as citações
  add column citation text not null default ''; -- como o edital a cita ("Resolução 354/2020 do Conselho Nacional de Justiça")
create index legal_norms_owner_idx on public.legal_norms (owner_id) where owner_id is not null;

drop policy "logged in: read" on public.legal_norms;
drop policy "logged in: read" on public.legal_articles;
create policy "shared or own: read" on public.legal_norms for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "shared or own: read" on public.legal_articles for select to authenticated
  using (exists (select 1 from public.legal_norms n where n.id = norm_id and (n.owner_id is null or n.owner_id = (select auth.uid()))));

-- O estudante pode apagar a norma que enviou (os artigos e marcações saem em cascata); gravar é só pelo backend.
grant delete on public.legal_norms to authenticated;
create policy "own: delete" on public.legal_norms for delete to authenticated using (owner_id = (select auth.uid()));

-- PDFs enviados: bucket privado, uma pasta por estudante.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('leis', 'leis', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "leis: read own" on storage.objects for select to authenticated
  using (bucket_id = 'leis' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "leis: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'leis' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "leis: update own" on storage.objects for update to authenticated
  using (bucket_id = 'leis' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "leis: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'leis' and (storage.foldername(name))[1] = (select auth.uid())::text);
