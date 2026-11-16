-- Cronogramas já existentes: simulados marcados antes de ~70% do edital estudado (regra nova do scheduler, FULL_COVERAGE
-- em shared/domain/simulado-scope.ts) viram blocos de reforço ("questões dos pontos fracos"). A cobertura no dia é a
-- parte das sessões de teoria do plano marcadas antes dele. Só mudam simulados futuros (a partir de amanhã), pendentes e
-- ainda não começados; os de hoje ficam (já abrem com o conteúdo estudado).
-- O dia vira de 1 a 3 blocos (~75 min cada, como o scheduler) de matérias diferentes, entre as que têm teoria antes dele,
-- as com mais sessões primeiro e alternando entre os dias. Cada plano ganha uma versão nova por replan_version, com as
-- tarefas antigas no histórico.
do $$
declare
  p record;
  s record;
  v_sup jsonb;
  v_tasks jsonb;
  v_ids uuid[];
  v_names text[];
  v_total int;
  v_ord int;
  n int;
  each_min int;
  m int;
  idx int;
begin
  for p in select id, owner_id from public.study_plans where status = 'active' and active_version_id is not null loop
    v_sup := '[]'; v_tasks := '[]'; v_ord := 0;
    select count(*) into v_total from public.tasks where plan_id = p.id and kind = 'theory' and superseded_in_version is null;
    if v_total = 0 then continue; end if;
    for s in
      select t.id, t.date, t.position, t.minutes from public.tasks t
      where t.plan_id = p.id and t.kind = 'simulado' and t.superseded_in_version is null and t.done_at is null and t.date > current_date
        and not exists (select 1 from public.simulados x where x.task_id = t.id)
        and (select count(*) from public.tasks h where h.plan_id = p.id and h.kind = 'theory' and h.superseded_in_version is null and h.date < t.date) < 0.7 * v_total
      order by t.date
    loop
      select array_agg(sid order by cnt desc, name), array_agg(name order by cnt desc, name) into v_ids, v_names
      from (
        select h.subject_id as sid, ns.name, count(*) as cnt
        from public.tasks h join public.notice_subjects ns on ns.id = h.subject_id
        where h.plan_id = p.id and h.kind = 'theory' and h.superseded_in_version is null and h.date < s.date
        group by h.subject_id, ns.name
      ) q;
      if v_ids is null then continue; end if;
      n := least(3, greatest(1, round(s.minutes / 75.0)::int), array_length(v_ids, 1));
      each_min := floor(s.minutes::numeric / n / 5) * 5;
      for j in 0 .. n - 1 loop
        idx := ((v_ord * n + j) % array_length(v_ids, 1)) + 1;
        m := each_min + case when j = 0 then s.minutes - each_min * n else 0 end;
        v_tasks := v_tasks || jsonb_build_object(
          'date', s.date, 'position', s.position + j, 'minutes', m, 'kind', 'consolidation', 'subjectId', v_ids[idx],
          'sessionId', null, 'title', v_names[idx] || ': questões dos pontos fracos', 'keyword', '*fracos*', 'goal', round(m / 60.0 * 15));
      end loop;
      v_sup := v_sup || to_jsonb(s.id::text);
      v_ord := v_ord + 1;
    end loop;
    if jsonb_array_length(v_sup) = 0 then continue; end if;
    -- replan_version age como o dono do plano (auth.uid()).
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p.owner_id, 'role', 'authenticated')::text, true);
    perform public.replan_version(p.id, jsonb_build_object('supersede', v_sup, 'tasks', v_tasks,
      'summary', jsonb_build_object('simuladoCoverage', jsonb_build_object('moved', jsonb_array_length(v_sup)))));
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;
