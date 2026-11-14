-- Reorganizar sessões que cresceram (artigos do edital incluídos depois da montagem): cada sessão vira partes, e cada
-- parte nova ocupa o dia de uma tarefa pendente da mesma matéria (aprofundamento, revisão com questões ou consolidação),
-- que sai. A divisão é calculada na função plan-design (passo "reorganize"); aqui só se confere e grava, numa versão nova
-- do plano, como replan_version. As leituras de lei seca pendentes da sessão alternam entre as partes já estudadas até
-- o dia de cada leitura. O aviso (plan_notices) fica como lido.
-- p_data: { notice, parts: [{ sessionId, title, lawRefs, extra: [{ title, lawRefs, replaceTaskId }] }], summary }
create function public.split_plan_sessions(p_plan uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.study_plans;
  v_prev public.plan_versions;
  v_version uuid;
  p jsonb;
  e jsonb;
  v_src public.study_sessions;
  v_goal int;
  v_slot public.tasks;
  v_new uuid;
  v_ids uuid[];
  v_dates date[];
  v_elig uuid[];
  v_first date;
  r record;
  i int;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  select * into v_plan from public.study_plans where id = p_plan and owner_id = v_uid and status = 'active';
  if not found then raise exception 'Cronograma não encontrado.' using errcode = 'P0002'; end if;
  select * into v_prev from public.plan_versions where id = v_plan.active_version_id;
  if not found then raise exception 'Cronograma sem versão ativa.' using errcode = 'P0002'; end if;

  insert into public.plan_versions (owner_id, plan_id, number, reason, inputs, strategy, summary, generator_version, prompt_version)
  values (v_uid, p_plan, (select max(number) + 1 from public.plan_versions where plan_id = p_plan), 'adaptive', v_prev.inputs, v_prev.strategy,
          v_prev.summary || jsonb_build_object('replan', coalesce(p_data->'summary', '{}')), 'split-v1', '')
  returning id into v_version;

  for p in select value from jsonb_array_elements(coalesce(p_data->'parts', '[]')) loop
    -- A sessão precisa estar em vigor neste plano (alguma tarefa atual aponta para ela).
    select s.* into v_src from public.study_sessions s
    where s.id = (p->>'sessionId')::uuid and s.owner_id = v_uid
      and exists (select 1 from public.tasks t where t.session_id = s.id and t.plan_id = p_plan and t.superseded_in_version is null);
    if not found then raise exception 'Sessão inválida: atualize a página.' using errcode = '22023'; end if;
    select goal_questions, date into v_goal, v_first from public.tasks where session_id = v_src.id and plan_id = p_plan and kind = 'theory' and superseded_in_version is null order by date limit 1;

    update public.tasks set title = left(replace(title, v_src.title, p->>'title'), 300)
    where session_id = v_src.id and plan_id = p_plan and superseded_in_version is null and done_at is null;
    update public.study_sessions set title = left(p->>'title', 300), law_refs = p->'lawRefs' where id = v_src.id;

    v_ids := array[v_src.id];
    v_dates := array[coalesce(v_first, '-infinity'::date)];
    for e in select value from jsonb_array_elements(coalesce(p->'extra', '[]')) loop
      select t.* into v_slot from public.tasks t
      where t.id = (e->>'replaceTaskId')::uuid and t.plan_id = p_plan and t.subject_id = v_src.subject_id
        and t.done_at is null and t.superseded_in_version is null and t.kind in ('theory', 'consolidation');
      if not found then raise exception 'O dia escolhido já mudou: atualize a página.' using errcode = '22023'; end if;
      update public.tasks set superseded_in_version = v_version where id = v_slot.id;
      insert into public.study_sessions (owner_id, plan_version_id, subject_id, position, title, keyword, topic_ids, incidence, law_refs)
      values (v_uid, v_src.plan_version_id, v_src.subject_id, v_src.position, left(e->>'title', 300), v_src.keyword, v_src.topic_ids, v_src.incidence, e->'lawRefs')
      returning id into v_new;
      insert into public.tasks (owner_id, plan_id, date, position, minutes, kind, subject_id, session_id, title, keyword, goal_questions, created_in_version)
      values (v_uid, p_plan, v_slot.date, v_slot.position, v_slot.minutes, 'theory', v_src.subject_id, v_new, left(e->>'title', 300), v_src.keyword, coalesce(v_goal, 0), v_version);
      v_ids := v_ids || v_new;
      v_dates := v_dates || v_slot.date;
    end loop;

    -- Lei seca pendente da sessão: as leituras alternam, na ordem das datas, entre as partes já estudadas até o dia dela.
    if array_length(v_ids, 1) > 1 then
      i := 0;
      for r in select t.id, t.date from public.tasks t where t.session_id = v_src.id and t.plan_id = p_plan and t.kind = 'lei_seca'
                 and t.done_at is null and t.superseded_in_version is null order by t.date, t.position loop
        select array_agg(x.id order by x.ord) into v_elig from unnest(v_ids, v_dates) with ordinality as x(id, d, ord) where x.d < r.date;
        continue when v_elig is null;
        v_new := v_elig[(i % array_length(v_elig, 1)) + 1];
        update public.tasks t set session_id = v_new, title = left('Lei seca: ' || (select s.title from public.study_sessions s where s.id = v_new), 300) where t.id = r.id;
        i := i + 1;
      end loop;
    end if;
  end loop;

  update public.plan_notices set seen_at = now() where id = nullif(p_data->>'notice', '')::uuid and owner_id = v_uid and plan_id = p_plan;
  update public.study_plans set active_version_id = v_version where id = p_plan;
  return v_version;
end $$;
revoke all on function public.split_plan_sessions(uuid, jsonb) from public, anon;
grant execute on function public.split_plan_sessions(uuid, jsonb) to authenticated;
