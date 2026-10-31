-- Menos questões por sessão, mais bem distribuídas. A meta de teoria passa de minutos/6 para minutos/12, entre 5 e 10;
-- tarefas já concluídas guardam a meta com que foram feitas.
update public.tasks set goal_questions = least(10, greatest(5, round(minutes / 12.0)))::int
where kind = 'theory' and done_at is null;

-- Quantas questões a banca tem em cada assunto da sessão: medido uma vez, define quantas questões cada assunto recebe.
alter table public.qbank_session_maps add column incidence jsonb;
