-- Assunto sem questão em banca nenhuma agora sai da sessão na medição de incidência (antes ele queimava o tempo do pedido
-- em buscas vazias e a sessão caía nas questões da IA). Medições antigas com assunto zerado são refeitas na próxima busca.
update public.qbank_session_maps
set incidence = null
where incidence is not null and jsonb_path_exists(incidence, '$[*] ? (@.total == 0)');
