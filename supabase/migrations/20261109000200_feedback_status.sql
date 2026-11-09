-- Triagem dos relatos na tela de admin (/relatos): novo → resolvido (ou descartado), com nota interna.
alter table public.feedback
  add column status text not null default 'novo' check (status in ('novo', 'resolvido', 'descartado')),
  add column admin_note text check (char_length(admin_note) <= 2000),
  add column resolved_at timestamptz;
create index feedback_status_idx on public.feedback (status, created_at desc);
