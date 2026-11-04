-- Cargo e escolaridade só estreitam a busca da disciplina quando rendem (ao menos 500 questões na matéria e no máximo 90%
-- dela). A medição (3 buscas) fica aqui; sem ela, cada assunto passava por 6 níveis vazios de ~1,1 s cada e o pedido
-- estourava o tempo antes de chegar às outras bancas, mandando a sessão para as questões da IA.
alter table public.qbank_subject_maps add column narrowing jsonb;

-- Medições de incidência com assunto zerado ou quase vazio (menos de 5 questões) são refeitas com a regra nova.
update public.qbank_session_maps
set incidence = null
where incidence is not null and jsonb_path_exists(incidence, '$[*] ? (@.total < 5)');
