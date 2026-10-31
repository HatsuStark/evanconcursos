-- Ritmo do plano: agenda (tarefas nas datas) ou ciclo (fila na ordem do plano, sem dias fixos). Refazer o cronograma mantém a escolha.
alter table public.study_plans add column pacing text not null default 'agenda' check (pacing in ('agenda', 'ciclo'));
grant update (pacing) on public.study_plans to authenticated;
