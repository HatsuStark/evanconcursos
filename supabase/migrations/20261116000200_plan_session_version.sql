-- Versão do plano que guarda as sessões em vigor. Reorganizar (replan_version, split_plan_sessions) cria uma versão nova
-- sem sessões: as tarefas novas continuam apontando para as sessões da versão em que o cronograma foi montado. Por isso
-- "sessões da versão ativa" fica vazio depois da primeira reorganização; vale a última versão do plano que tem sessões.
-- Roda como o usuário: plano de outra pessoa devolve null.
create function public.plan_session_version(p_plan uuid) returns uuid
language sql stable security invoker set search_path = '' as $$
  select v.id from public.plan_versions v
  where v.plan_id = p_plan and exists (select 1 from public.study_sessions s where s.plan_version_id = v.id)
  order by v.number desc limit 1
$$;
revoke all on function public.plan_session_version(uuid) from public, anon;
grant execute on function public.plan_session_version(uuid) to authenticated, service_role;
