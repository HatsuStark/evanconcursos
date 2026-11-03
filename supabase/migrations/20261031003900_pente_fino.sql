-- Reta final com pente-fino: revisão do que já foi estudado (para memorizar, pegadinhas, marcações e flashcards), sem teoria nova.
alter table public.tasks drop constraint tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check
  check (kind in ('theory', 'consolidation', 'final_review', 'pente_fino', 'weekly_review', 'simulado', 'eve', 'exam', 'lei_seca'));
