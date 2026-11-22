-- Revisão sem acúmulo (fase 1).
-- 1) Intervalos longos (7 e 30 dias) caem no dia da revisão semanal mais próximo (até 3 dias antes ou depois):
--    temas de teoria a partir da 2ª revisão, caderno de erros a partir da 2ª etapa e conceitos da Aula guiada com
--    intervalo de 7 dias ou mais. Sem revisão semanal perto (plano sem ela, rodada ainda não montada), fica a data normal.
-- 2) Questão errada não vira mais flashcard: repetia o caderno de erros. Os flashcards de questão existentes saem.
-- 3) Pilha atrasada de teoria: espalhada pelas próximas 3 revisões semanais, pela capacidade de cada uma.

-- Data da revisão semanal do plano mais próxima de p_due (empate: a mais cedo), depois de hoje e antes da prova.
create function public.weekly_snap(p_plan uuid, p_due date) returns date
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select t.date from public.tasks t
    join public.study_plans p on p.id = t.plan_id
    join public.notices n on n.id = p.notice_id
    where t.plan_id = p_plan and t.kind = 'weekly_review' and t.superseded_in_version is null and t.done_at is null
      and t.date between greatest(p_due - 3, (now() at time zone 'America/Sao_Paulo')::date + 1) and p_due + 3
      and (n.exam_date is null or t.date < n.exam_date)
    order by abs(t.date - p_due), t.date
    limit 1
  ), p_due);
$$;
revoke all on function public.weekly_snap(uuid, date) from public, anon, authenticated;

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
    -- Revisões de 7 e 30 dias vão para o dia da revisão semanal.
    if v_stage >= 2 and v_due is not null then v_due := public.weekly_snap(r.plan_id, v_due); end if;
  end if;
  update public.theory_reviews set
    stage = least(v_stage, 3), due_on = coalesce(v_due, r.due_on), status = case when v_due is null then 'done' else 'pending' end,
    reviews = r.reviews + 1, last_result = p_result, last_reviewed_at = now()
  where id = p_id;
  return v_due;
end $$;

create or replace function public.record_answer_for(
  p_owner uuid, p_qid text, p_chosen text, p_context text,
  p_plan uuid default null, p_task uuid default null, p_session uuid default null, p_subject uuid default null, p_simulado uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q record;
  eb record;
  v_correct boolean;
  v_chosen text := left(coalesce(p_chosen, ''), 20);
  v_days int[] := array[1, 7, 30];
begin
  select payload, gabarito, materia, assunto, explanation into q from public.qbank_questions where qid = p_qid;
  if not found then raise exception 'Questão não encontrada.' using errcode = 'P0002'; end if;
  v_correct := v_chosen <> '' and upper(left(trim(v_chosen), 1)) = upper(left(trim(q.gabarito), 1));

  insert into public.question_attempts (owner_id, plan_id, task_id, session_id, subject_id, qid, materia, assunto, chosen, correct, context, simulado_id)
  values (p_owner, p_plan, p_task, p_session, p_subject, p_qid, q.materia, q.assunto, v_chosen, v_correct, p_context, p_simulado);

  select stage, wrong_count, resolved into eb from public.error_book where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
  if not v_correct then
    insert into public.error_book (owner_id, plan_id, qid, materia, assunto, stage, due_on, wrong_count, resolved, updated_at)
    values (p_owner, p_plan, p_qid, q.materia, q.assunto, 0, current_date + 1, 1, false, now())
    on conflict (owner_id, plan_id, qid) do update set stage = 0, due_on = current_date + 1, wrong_count = public.error_book.wrong_count + 1, resolved = false, updated_at = now();
  elsif found and not eb.resolved and p_context = 'review' then
    -- Acerto na revisão avança a etapa (7 e depois 30 dias, no dia da revisão semanal); após a última, sai do caderno.
    if eb.stage + 1 >= array_length(v_days, 1) then
      update public.error_book set stage = 3, resolved = true, updated_at = now() where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
    else
      update public.error_book set stage = eb.stage + 1, updated_at = now(),
        due_on = case when p_plan is null then current_date + v_days[eb.stage + 2] else public.weekly_snap(p_plan, current_date + v_days[eb.stage + 2]) end
      where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
    end if;
  end if;
  return jsonb_build_object('correct', v_correct, 'gabarito', q.gabarito);
end $$;

-- Conceitos da Aula guiada: o app grava a data; intervalo de 7 dias ou mais vai para a revisão semanal.
create function public.tutor_concept_snap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.due_on is not null and new.due_on - (now() at time zone 'America/Sao_Paulo')::date >= 7
     and (tg_op = 'INSERT' or new.due_on is distinct from old.due_on) then
    new.due_on := public.weekly_snap(new.plan_id, new.due_on);
  end if;
  return new;
end $$;
revoke all on function public.tutor_concept_snap() from public, anon, authenticated;
create trigger tutor_concepts_weekly_snap before insert or update of due_on on public.tutor_concepts
  for each row execute function public.tutor_concept_snap();

delete from public.flashcards where kind = 'question';

with today as (select (now() at time zone 'America/Sao_Paulo')::date d),
w as (
  select t.plan_id, t.date, row_number() over (partition by t.plan_id order by t.date) n,
    -- Cerca de 6 min por tema, deixando tempo para os erros.
    sum(greatest(1, t.minutes / 6)) over (partition by t.plan_id order by t.date) cap_end
  from public.tasks t
  join public.study_plans p on p.id = t.plan_id
  join public.notices n on n.id = p.notice_id
  cross join today
  where t.kind = 'weekly_review' and t.superseded_in_version is null and t.done_at is null
    and t.date >= today.d and (n.exam_date is null or t.date < n.exam_date)
),
r as (
  select tr.id, tr.plan_id, row_number() over (partition by tr.plan_id order by tr.due_on, tr.created_at) rn
  from public.theory_reviews tr cross join today
  where tr.status = 'pending' and tr.due_on < today.d
),
pick as (
  select r.id, coalesce(
    (select w.date from w where w.plan_id = r.plan_id and w.n <= 3 and w.cap_end >= r.rn order by w.date limit 1),
    (select max(w.date) from w where w.plan_id = r.plan_id and w.n <= 3)) d
  from r
)
update public.theory_reviews tr set due_on = pick.d from pick where tr.id = pick.id and pick.d is not null;
