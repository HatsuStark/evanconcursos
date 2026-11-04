-- Aprendizado adaptativo: o cronograma reage ao desempenho do estudante.
-- 1) Aprofundamento escolhido na hora: os dias "Aprofundamento:" e "Revisão com questões:" ficam reservados no plano, mas o
--    tema de cada um é decidido quando o dia chega, pela sessão já estudada em que o estudante mais erra, ponderada pela
--    cobrança (a da banca, medida no banco de questões, quando houver; senão a estimada pela IA).
-- 2) Revisão de teoria com intervalo pelo acerto nas questões da sessão, não só pela autoavaliação.
-- 3) Aquecimento: questões da sessão anterior no começo de uma sessão contam para a sessão anterior.
-- 4) Apostila de aprofundamento (exceções, distinções finas, casos difíceis), além da completa e da revisão.

alter table public.study_sessions
  add column source_session_id uuid references public.study_sessions(id) on delete set null, -- tema escolhido para o dia
  add column bound_at timestamptz;                                                           -- quando foi escolhido

alter table public.study_guides drop constraint study_guides_depth_check;
alter table public.study_guides add constraint study_guides_depth_check check (depth in ('completa', 'revisao', 'aprofundamento'));

-- Acerto suavizado de uma sessão: começa em 70% com peso de 5 questões (poucas respostas não decidem sozinhas).
create function public.session_accuracy(p_owner uuid, p_session uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select (count(*) filter (where qa.correct) + 3.5) / (count(*) + 5.0)
  from public.question_attempts qa
  where qa.owner_id = p_owner and (qa.session_id = p_session or qa.session_id in (select id from public.study_sessions where source_session_id = p_session));
$$;
revoke all on function public.session_accuracy(uuid, uuid) from public, anon, authenticated;

-- Escolhe o tema dos dias de aprofundamento que chegaram (data até hoje, não feitos, ainda sem tema). Candidatas: as
-- sessões de conteúdo da mesma matéria e versão do plano já concluídas. Pontuação: (1 − acerto) × cobrança², com cobrança
-- de 1 a 3 (média da estimada pela IA e da medida na banca, quando houver) e peso 0,3 para tema aprofundado nos últimos
-- 14 dias. Sem candidata, fica o tema planejado. O 2º aprofundamento do mesmo tema vira "Revisão com questões".
-- Devolve quantos dias foram decididos.
create function public.bind_adaptive_sessions(p_plan uuid) returns int
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
    select c.id, c.title, c.keyword, c.topic_ids, c.incidence,
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
      update public.study_sessions set title = v_title, keyword = best.keyword, topic_ids = best.topic_ids, incidence = best.incidence,
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

-- Intervalo da revisão pelo acerto nas questões da sessão: 85% ou mais estica 1,5×; abaixo de 60% encurta pela metade.
create function public.review_factor(p_owner uuid, p_session uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when a >= 0.85 then 1.5 when a < 0.6 then 0.5 else 1 end
  from (select public.session_accuracy(p_owner, p_session) as a) x;
$$;
revoke all on function public.review_factor(uuid, uuid) from public, anon, authenticated;

-- 1ª revisão: amanhã; com acerto alto na sessão, em 2 dias.
create or replace function public.schedule_theory_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_due date;
begin
  if new.done_at is null then
    delete from public.theory_reviews where task_id = new.id and reviews = 0;
    return null;
  end if;
  v_due := public.theory_review_due(new.plan_id, case when public.review_factor(new.owner_id, new.session_id) > 1 then 2 else 1 end);
  if v_due is not null then
    insert into public.theory_reviews (owner_id, plan_id, task_id, session_id, due_on)
    values (new.owner_id, new.plan_id, new.id, new.session_id, v_due)
    on conflict (owner_id, session_id) do nothing;
  end if;
  return null;
end $$;

-- lembrei: avança (depois da 3ª, encerra). parcial: repete o intervalo da etapa. esqueci: volta para 1 dia.
-- O intervalo da etapa (1, 7, 30 dias) é ajustado pelo acerto nas questões da sessão.
create or replace function public.theory_review_answer(p_id uuid, p_result text) returns date
language plpgsql security definer set search_path = '' as $$
declare
  v_days int[] := array[1, 7, 30];
  r public.theory_reviews;
  v_stage int;
  v_due date;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if p_result is null or p_result not in ('lembrei', 'parcial', 'esqueci') then raise exception 'Resultado inválido.' using errcode = '22023'; end if;
  select * into r from public.theory_reviews where id = p_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Revisão não encontrada.' using errcode = 'P0002'; end if;
  if r.status <> 'pending' or r.due_on > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Esta revisão ainda não está disponível.' using errcode = 'P0001';
  end if;

  v_stage := case p_result when 'lembrei' then r.stage + 1 when 'parcial' then r.stage else 1 end;
  if v_stage <= 3 then
    v_due := public.theory_review_due(r.plan_id, greatest(1, round(v_days[v_stage] * case when p_result = 'esqueci' then 1 else public.review_factor(r.owner_id, r.session_id) end)::int));
  end if;
  update public.theory_reviews set
    stage = least(v_stage, 3), due_on = coalesce(v_due, r.due_on), status = case when v_due is null then 'done' else 'pending' end,
    reviews = r.reviews + 1, last_result = p_result, last_reviewed_at = now()
  where id = p_id;
  return v_due;
end $$;

-- Aquecimento: a questão da sessão anterior respondida no começo de outra conta para a anterior (p_session, que precisa
-- ser do estudante e da mesma matéria da tarefa).
drop function public.answer_question(text, text, uuid, text);
create function public.answer_question(p_qid text, p_chosen text, p_task uuid default null, p_context text default 'free', p_session uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t record;
  v_session uuid;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if p_task is not null then
    select plan_id, session_id, subject_id, kind into t from public.tasks where id = p_task and owner_id = v_uid;
    if not found then raise exception 'Tarefa não encontrada.' using errcode = 'P0002'; end if;
    if t.kind = 'weekly_review' then
      return public.record_answer_for(v_uid, p_qid, p_chosen, 'review', t.plan_id, p_task, null, null, null);
    end if;
    v_session := t.session_id;
    if p_session is not null then
      select id into v_session from public.study_sessions where id = p_session and owner_id = v_uid and subject_id = t.subject_id;
      v_session := coalesce(v_session, t.session_id);
    end if;
    return public.record_answer_for(v_uid, p_qid, p_chosen, 'plan', t.plan_id, p_task, v_session, t.subject_id, null);
  end if;
  return public.record_answer_for(v_uid, p_qid, p_chosen, case when p_context = 'review' then 'review' else 'free' end, public.active_plan_for(v_uid));
end $$;
revoke all on function public.answer_question(text, text, uuid, text, uuid) from public, anon;
grant execute on function public.answer_question(text, text, uuid, text, uuid) to authenticated;
