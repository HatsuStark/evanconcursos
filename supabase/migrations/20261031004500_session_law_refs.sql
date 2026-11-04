-- Artigos de lei de cada sessão decididos na montagem do plano: a IA devolve, junto com o título, a lei e a lista de
-- artigos ([{law, ranges: [{from, to, fromSuffix?, toSuffix?}]}]), e a lei seca, a apostila e as questões buscam o texto
-- oficial por esse campo, sem reler o título. Null: sessão de plano antigo ou sem lei (vale a leitura do título).
alter table public.study_sessions add column law_refs jsonb check (law_refs is null or jsonb_typeof(law_refs) = 'array');

-- Igual à anterior, gravando também os artigos de cada sessão.
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
    insert into public.study_sessions (plan_version_id, subject_id, position, title, keyword, topic_ids, incidence, law_refs)
    values (v_version, (s->>'subjectId')::uuid, coalesce((s->>'position')::int, 0), left(s->>'title', 300), left(coalesce(s->>'keyword', ''), 120),
            coalesce(array(select jsonb_array_elements_text(s->'topicIds')::uuid), '{}'),
            case when s->>'incidence' in ('1', '2', '3') then (s->>'incidence')::smallint else 2 end,
            case when jsonb_typeof(s->'lawRefs') = 'array' and jsonb_array_length(s->'lawRefs') > 0 then s->'lawRefs' end)
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

-- Igual à anterior; o dia de aprofundamento leva também os artigos do tema escolhido.
create or replace function public.bind_adaptive_sessions(p_plan uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  d record;
  best record;
  v_max numeric;
  v_title text;
  v_prefix text;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if not exists (select 1 from public.study_plans where id = p_plan and owner_id = v_uid) then return 0; end if;
  for d in
    select t.id as task_id, s.id as session_id, s.subject_id, s.plan_version_id, s.title
    from public.tasks t join public.study_sessions s on s.id = t.session_id
    where t.plan_id = p_plan and t.owner_id = v_uid and t.kind = 'theory' and t.superseded_in_version is null and t.done_at is null
      and t.date <= v_today and s.bound_at is null
      and (s.title like 'Aprofundamento: %' or s.title like 'Revisão com questões: %')
    order by t.date, t.position
  loop
    -- Maior medida da banca entre as sessões da matéria, para levar a escala de 1 a 3.
    select max(tot) into v_max from (
      select (select sum((e->>'total')::numeric) from jsonb_array_elements(m.incidence) e) as tot
      from public.study_sessions c join public.qbank_session_maps m on m.session_id = c.id
      where c.plan_version_id = d.plan_version_id and c.subject_id = d.subject_id and m.incidence is not null
    ) x;
    select c.id, c.title, c.keyword, c.topic_ids, c.incidence, c.law_refs,
           (1 - public.session_accuracy(v_uid, c.id))
           * power(case when bank.tot is not null and v_max > 0 then (coalesce(c.incidence, 2) + 1 + 2 * bank.tot / v_max) / 2 else coalesce(c.incidence, 2) end, 2)
           * case when exists (select 1 from public.study_sessions r where r.source_session_id = c.id and r.bound_at > now() - interval '14 days') then 0.3 else 1 end as score,
           (select count(*) from public.study_sessions r where r.source_session_id = c.id and r.bound_at is not null) as deep_count
    into best
    from public.study_sessions c
    left join lateral (
      select (select sum((e->>'total')::numeric) from jsonb_array_elements(m.incidence) e) as tot
      from public.qbank_session_maps m where m.session_id = c.id and m.incidence is not null
    ) bank on true
    where c.plan_version_id = d.plan_version_id and c.subject_id = d.subject_id and c.id <> d.session_id
      and c.title not like 'Aprofundamento: %' and c.title not like 'Revisão com questões: %'
      and exists (select 1 from public.tasks tc where tc.session_id = c.id and tc.owner_id = v_uid and tc.kind = 'theory' and tc.done_at is not null)
    order by score desc, c.position
    limit 1;

    if best.id is null then
      -- Nada estudado ainda na matéria: fica o tema planejado.
      update public.study_sessions set bound_at = now() where id = d.session_id;
    else
      v_prefix := case when best.deep_count > 0 then 'Revisão com questões: ' else 'Aprofundamento: ' end;
      v_title := left(v_prefix || best.title, 200);
      update public.study_sessions set title = v_title, keyword = best.keyword, topic_ids = best.topic_ids, incidence = best.incidence, law_refs = best.law_refs,
        source_session_id = best.id, bound_at = now()
      where id = d.session_id;
      update public.tasks set title = v_title where id = d.task_id;
      update public.tasks set title = left('Lei seca: ' || v_title, 200)
      where session_id = d.session_id and kind = 'lei_seca' and owner_id = v_uid and done_at is null;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.bind_adaptive_sessions(uuid) from public, anon;
grant execute on function public.bind_adaptive_sessions(uuid) to authenticated;
