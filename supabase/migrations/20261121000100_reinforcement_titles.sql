-- O rebalanceamento a cada 2 semanas trocava a matéria dos blocos de reforço e de revisão final, mas mantinha o título
-- com a matéria antiga ("Matemática: questões dos pontos fracos" numa tarefa de Língua Portuguesa). O código agora troca
-- o título junto (retitle em shared/domain/replan.ts); aqui, as tarefas já gravadas passam a ter o nome da matéria certa.
update public.tasks t
set title = ns.name || ': ' || substr(t.title, position(': ' in t.title) + 2)
from public.notice_subjects ns
where ns.id = t.subject_id
  and t.kind in ('consolidation', 'final_review')
  and (t.title like '%: questões dos pontos fracos' or t.title like '%: revisão final dos pontos fracos')
  and split_part(t.title, ': ', 1) <> ns.name;
