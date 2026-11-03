-- Refaz ligações ao banco de questões feitas com duas regras antigas:
-- 1) sessões sobre o município do edital ligadas às matérias genéricas de estados e municípios, que misturam outras cidades
--    (conferido com a trava de lugar nova sobre todas as ligações salvas: só esta sessão e a matéria dela a violavam);
-- 2) banca escolhida pela primeira palavra do nome ("Instituto Nosso Rumo" virou "Instituto JK").
-- As linhas apagadas são refeitas na próxima busca, com as regras novas.

delete from public.qbank_session_maps
where materia in ('Conhecimentos Específicos dos Estados', 'Conhecimentos Específicos dos Municípios')
   or assuntos && array['Conhecimentos Específicos dos Municípios'];

delete from public.qbank_subject_maps sm
using public.notice_subjects ns, public.notices n
where ns.id = sm.subject_id and n.id = ns.notice_id and sm.banca <> ''
  and position(lower(sm.banca) in lower(n.board)) = 0
  and position(lower(n.board) in lower(sm.banca)) = 0;
