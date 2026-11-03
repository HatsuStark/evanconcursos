-- Cronograma montado como um especialista (scheduler-v2): dias com 2 ou 3 blocos de matérias diferentes, lei seca diária
-- em concurso de legislação e sessões com a incidência do assunto na banca (1 pouco, 2 médio, 3 muito cobrado).
alter table public.tasks drop constraint tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check
  check (kind in ('theory', 'consolidation', 'final_review', 'weekly_review', 'simulado', 'eve', 'exam', 'lei_seca'));
alter table public.study_sessions add column incidence smallint not null default 2 check (incidence between 1 and 3);

-- Igual à anterior, gravando também a incidência de cada sessão.
create or replace function public.create_plan_version(p_notice_id uuid, p_data jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan uuid;
  v_version uuid;
  v_number int;
  v_from date := coalesce(nullif(p_data->>'from', '')::date, current_date);
  v_first boolean;
  v_keys jsonb := '{}';
  v_sid uuid;
  s jsonb;
begin
  if not exists (select 1 from public.notices where id = p_notice_id and status = 'reviewed') then
    raise exception 'Edital não encontrado ou ainda não conferido.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_data->'tasks') is distinct from 'array' or jsonb_array_length(p_data->'tasks') = 0 then
    raise exception 'O cronograma não tem tarefas.' using errcode = '22023';
  end if;
  -- Tópicos citados nas sessões precisam existir e ser do usuário (a RLS limita o que é visível).
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_data->'sessions', '[]')) se, jsonb_array_elements_text(coalesce(se->'topicIds', '[]')) t
    where not exists (select 1 from public.notice_topics nt where nt.id = t::uuid)
  ) then
    raise exception 'Sessão aponta para tópico inexistente.' using errcode = '22023';
  end if;

  select id into v_plan from public.study_plans where notice_id = p_notice_id and status = 'active';
  v_first := v_plan is null;
  if v_first then
    insert into public.study_plans (notice_id, name) values (p_notice_id, left(coalesce(p_data->>'name', ''), 160)) returning id into v_plan;
  end if;
  select coalesce(max(number), 0) + 1 into v_number from public.plan_versions where plan_id = v_plan;
  insert into public.plan_versions (plan_id, number, reason, inputs, strategy, summary, generator_version, prompt_version)
  values (v_plan, v_number, case when v_first then 'initial' else 'regenerate' end, coalesce(p_data->'inputs', '{}'),
          coalesce(p_data->'strategy', '{}'), coalesce(p_data->'summary', '{}'),
          left(coalesce(p_data->>'generatorVersion', ''), 40), left(coalesce(p_data->>'promptVersion', ''), 40))
  returning id into v_version;

  for s in select value from jsonb_array_elements(coalesce(p_data->'sessions', '[]')) loop
    insert into public.study_sessions (plan_version_id, subject_id, position, title, keyword, topic_ids, incidence)
    values (v_version, (s->>'subjectId')::uuid, coalesce((s->>'position')::int, 0), left(s->>'title', 300), left(coalesce(s->>'keyword', ''), 120),
            coalesce(array(select jsonb_array_elements_text(s->'topicIds')::uuid), '{}'),
            case when s->>'incidence' in ('1', '2', '3') then (s->>'incidence')::smallint else 2 end)
    returning id into v_sid;
    v_keys := v_keys || jsonb_build_object(s->>'key', v_sid);
  end loop;

  if not v_first then
    update public.tasks set superseded_in_version = v_version
    where plan_id = v_plan and superseded_in_version is null and done_at is null and date >= v_from;
  end if;

  insert into public.tasks (plan_id, date, position, minutes, kind, subject_id, session_id, title, keyword, goal_questions, created_in_version)
  select v_plan, (t->>'date')::date, coalesce((t->>'position')::int, 0), coalesce((t->>'minutes')::int, 0), t->>'kind',
         nullif(t->>'subjectId', '')::uuid, (v_keys->>(t->>'sessionKey'))::uuid, left(t->>'title', 300),
         left(coalesce(t->>'keyword', ''), 120), coalesce((t->>'goal')::int, 0), v_version
  from jsonb_array_elements(p_data->'tasks') t
  where v_first or (t->>'date')::date >= v_from;

  update public.study_plans set active_version_id = v_version, name = coalesce(nullif(left(p_data->>'name', 160), ''), name) where id = v_plan;
  return v_version;
end $$;
revoke all on function public.create_plan_version(uuid, jsonb) from public, anon;
grant execute on function public.create_plan_version(uuid, jsonb) to authenticated;
