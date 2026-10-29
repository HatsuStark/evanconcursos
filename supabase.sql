-- Execute no SQL Editor do seu projeto Supabase.
create table if not exists public.study_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.study_progress enable row level security;
revoke all on public.study_progress from anon;
grant select, insert, update, delete on public.study_progress to authenticated;
create policy "read own study progress" on public.study_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own study progress" on public.study_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own study progress" on public.study_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own study progress" on public.study_progress for delete to authenticated using ((select auth.uid()) = user_id);
