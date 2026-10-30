-- Motivo do erro em cada tentativa e nova versão do cronograma ao reorganizar depois de atrasos.

alter table public.question_attempts add column error_reason text check (error_reason in ('conteudo', 'atencao', 'pegadinha'));

-- O motivo vale para o último erro do estudante nessa questão; nulo desmarca.
create or replace function public.set_error_reason(p_qid text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  select id into v_id from public.question_attempts where owner_id = auth.uid() and qid = p_qid and not correct order by created_at desc limit 1;
  if not found then raise exception 'Erro não encontrado.' using errcode = 'P0002'; end if;
  update public.question_attempts set error_reason = p_reason where id = v_id;
end $$;
revoke all on function public.set_error_reason(text, text) from public, anon;
grant execute on function public.set_error_reason(text, text) to authenticated;

alter table public.plan_versions drop constraint plan_versions_reason_check;
alter table public.plan_versions add constraint plan_versions_reason_check check (reason in ('initial', 'regenerate', 'adaptive'));

-- p_data: {supersede:[taskId], summary, tasks:[{date, position, minutes, kind, subjectId?, sessionId?, title, keyword, goal, fromTaskId?}]}
-- Security definer: move tempo e tentativas da tarefa antiga, que o usuário não altera direto (e reaproveita as sessões,
-- que têm apostila, PDFs e questões ligados a elas). Tudo é conferido contra o plano do usuário logado.
create or replace function public.replan_version(p_plan uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.study_plans;
  v_prev public.plan_versions;
  v_version uuid;
  v_new uuid;
  t jsonb;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  select * into v_plan from public.study_plans where id = p_plan and owner_id = v_uid and status = 'active';
  if not found then raise exception 'Cronograma não encontrado.' using errcode = 'P0002'; end if;
  select * into v_prev from public.plan_versions where id = v_plan.active_version_id;
  if not found then raise exception 'Cronograma sem versão ativa.' using errcode = 'P0002'; end if;

  -- Só tarefas pendentes deste plano podem sair; sessões e matérias novas precisam ser dele.
  if exists (select 1 from jsonb_array_elements_text(coalesce(p_data->'supersede', '[]')) s
             where not exists (select 1 from public.tasks x where x.id = s::uuid and x.plan_id = p_plan and x.done_at is null and x.superseded_in_version is null)) then
    raise exception 'Tarefa inválida ou já concluída: atualize a página.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_data->'tasks', '[]')) e
             where (nullif(e->>'sessionId', '') is not null and not exists (
                      select 1 from public.study_sessions s join public.plan_versions v on v.id = s.plan_version_id where s.id = (e->>'sessionId')::uuid and v.plan_id = p_plan))
                or (nullif(e->>'subjectId', '') is not null and not exists (
                      select 1 from public.notice_subjects n where n.id = (e->>'subjectId')::uuid and n.notice_id = v_plan.notice_id))
                or (nullif(e->>'fromTaskId', '') is not null and not exists (
                      select 1 from jsonb_array_elements_text(coalesce(p_data->'supersede', '[]')) s where s = e->>'fromTaskId'))) then
    raise exception 'A reorganização aponta para dados de outro cronograma.' using errcode = '22023';
  end if;

  insert into public.plan_versions (owner_id, plan_id, number, reason, inputs, strategy, summary, generator_version, prompt_version)
  values (v_uid, p_plan, (select max(number) + 1 from public.plan_versions where plan_id = p_plan), 'adaptive', v_prev.inputs, v_prev.strategy,
          v_prev.summary || jsonb_build_object('replan', coalesce(p_data->'summary', '{}')), 'replan-v1', '')
  returning id into v_version;

  update public.tasks set superseded_in_version = v_version
  where plan_id = p_plan and id in (select s::uuid from jsonb_array_elements_text(coalesce(p_data->'supersede', '[]')) s);

  for t in select value from jsonb_array_elements(coalesce(p_data->'tasks', '[]')) loop
    insert into public.tasks (owner_id, plan_id, date, position, minutes, kind, subject_id, session_id, title, keyword, goal_questions, created_in_version, time_spent_sec)
    values (v_uid, p_plan, (t->>'date')::date, coalesce((t->>'position')::int, 0), coalesce((t->>'minutes')::int, 0), t->>'kind',
            nullif(t->>'subjectId', '')::uuid, nullif(t->>'sessionId', '')::uuid, left(t->>'title', 300), left(coalesce(t->>'keyword', ''), 120),
            coalesce((t->>'goal')::int, 0), v_version,
            coalesce((select time_spent_sec from public.tasks where id = nullif(t->>'fromTaskId', '')::uuid), 0))
    returning id into v_new;
    -- O progresso da tarefa acompanha a sessão no novo dia.
    if nullif(t->>'fromTaskId', '') is not null then
      update public.question_attempts set task_id = v_new where task_id = (t->>'fromTaskId')::uuid;
      update public.simulados set task_id = v_new where task_id = (t->>'fromTaskId')::uuid;
    end if;
  end loop;

  update public.study_plans set active_version_id = v_version where id = p_plan;
  return v_version;
end $$;
revoke all on function public.replan_version(uuid, jsonb) from public, anon;
grant execute on function public.replan_version(uuid, jsonb) to authenticated;
