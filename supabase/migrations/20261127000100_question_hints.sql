-- Dicas em graus nas questões do banco (shared/qbank/hints.ts, ação 'hint' da função questions).
-- 1) qbank_questions.hints: as dicas da IA, uma vez por questão (compartilhadas, como a explicação).
-- 2) question_hint_uses: o maior grau que o estudante abriu numa questão ainda não respondida. Só o backend grava
--    (note_hint_use); a correção (record_answer_for) lê, grava na tentativa e apaga. Uso com mais de 12 h é ignorado.
-- 3) question_attempts.hint_level (0 a 3) e error_book.hinted (entrou no caderno por acerto com dica).
-- 4) Acerto com dica fora da revisão entra no caderno de erros: grau 1 na etapa 1 (volta em 7 dias, no dia da revisão
--    semanal); grau 2 ou 3 na etapa 0 (amanhã, como um erro). Já no caderno, só antecipa. Na revisão, acerto com dica não
--    avança a etapa: repete o intervalo dela.
-- 5) review_factor: acerto com dica vale meio acerto no ajuste do intervalo da revisão de teoria.

alter table public.qbank_questions add column hints jsonb, add column hints_model text;
alter table public.question_attempts add column hint_level smallint not null default 0 check (hint_level between 0 and 3);
alter table public.error_book add column hinted boolean not null default false;

create table public.question_hint_uses (
  owner_id uuid not null references auth.users (id) on delete cascade,
  qid text not null,
  level smallint not null check (level between 1 and 3),
  updated_at timestamptz not null default now(),
  primary key (owner_id, qid)
);
alter table public.question_hint_uses enable row level security;
-- Sem políticas: só o backend lê e grava.

create function public.note_hint_use(p_owner uuid, p_qid text, p_level int) returns void
language sql security definer set search_path = '' as $$
  insert into public.question_hint_uses (owner_id, qid, level, updated_at)
  values (p_owner, p_qid, least(greatest(p_level, 1), 3), now())
  on conflict (owner_id, qid) do update set
    level = case when public.question_hint_uses.updated_at < now() - interval '12 hours' then excluded.level
                 else greatest(public.question_hint_uses.level, excluded.level) end,
    updated_at = now();
$$;
revoke all on function public.note_hint_use(uuid, text, int) from public, anon, authenticated;
grant execute on function public.note_hint_use(uuid, text, int) to service_role;

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
  v_hint smallint := 0;
  v_stage int;
  v_due date;
begin
  select payload, gabarito, materia, assunto, explanation into q from public.qbank_questions where qid = p_qid;
  if not found then raise exception 'Questão não encontrada.' using errcode = 'P0002'; end if;
  v_correct := v_chosen <> '' and upper(left(trim(v_chosen), 1)) = upper(left(trim(q.gabarito), 1));

  -- Simulado não tem dica: um uso pendente fica para a próxima resposta fora dele.
  if p_simulado is null then
    delete from public.question_hint_uses where owner_id = p_owner and qid = p_qid returning
      case when updated_at > now() - interval '12 hours' then level else 0 end into v_hint;
    v_hint := coalesce(v_hint, 0);
  end if;

  insert into public.question_attempts (owner_id, plan_id, task_id, session_id, subject_id, qid, materia, assunto, chosen, correct, context, simulado_id, hint_level)
  values (p_owner, p_plan, p_task, p_session, p_subject, p_qid, q.materia, q.assunto, v_chosen, v_correct, p_context, p_simulado, v_hint);

  select stage, wrong_count, resolved, due_on into eb from public.error_book where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
  if not v_correct then
    insert into public.error_book (owner_id, plan_id, qid, materia, assunto, stage, due_on, wrong_count, resolved, hinted, updated_at)
    values (p_owner, p_plan, p_qid, q.materia, q.assunto, 0, current_date + 1, 1, false, false, now())
    on conflict (owner_id, plan_id, qid) do update set stage = 0, due_on = current_date + 1, wrong_count = public.error_book.wrong_count + 1, resolved = false, hinted = false, updated_at = now();
  elsif v_hint > 0 and p_context = 'review' then
    -- Acerto com dica na revisão: fica na mesma etapa e repete o intervalo dela.
    if found and not eb.resolved then
      v_due := current_date + v_days[eb.stage + 1];
      if eb.stage >= 1 and p_plan is not null then v_due := public.weekly_snap(p_plan, v_due); end if;
      update public.error_book set due_on = v_due, updated_at = now() where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
    end if;
  elsif v_hint > 0 and p_simulado is null then
    -- Acerto com dica: a questão volta na revisão (grau 1 em 7 dias; grau 2 ou 3 amanhã).
    v_stage := case when v_hint >= 2 then 0 else 1 end;
    v_due := current_date + v_days[v_stage + 1];
    if v_stage >= 1 and p_plan is not null then v_due := public.weekly_snap(p_plan, v_due); end if;
    if not found or eb.resolved then
      insert into public.error_book (owner_id, plan_id, qid, materia, assunto, stage, due_on, wrong_count, resolved, hinted, updated_at)
      values (p_owner, p_plan, p_qid, q.materia, q.assunto, v_stage, v_due, 0, false, true, now())
      on conflict (owner_id, plan_id, qid) do update set stage = v_stage, due_on = v_due, resolved = false, hinted = true, updated_at = now();
    else
      update public.error_book set stage = least(eb.stage, v_stage), due_on = least(eb.due_on, v_due), updated_at = now()
      where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
    end if;
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
  return jsonb_build_object('correct', v_correct, 'gabarito', q.gabarito, 'hint', v_hint);
end $$;

create or replace function public.review_factor(p_owner uuid, p_session uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when a >= 0.85 then 1.5 when a < 0.6 then 0.5 else 1 end
  from (
    select (count(*) filter (where qa.correct and qa.hint_level = 0) + 0.5 * count(*) filter (where qa.correct and qa.hint_level > 0) + 3.5) / (count(*) + 5.0) as a
    from public.question_attempts qa
    where qa.owner_id = p_owner and (
      qa.session_id in (select t.id from public.theme_sessions(p_session) t)
      or qa.session_id in (select r.id from public.study_sessions r where r.source_session_id in (select t.id from public.theme_sessions(p_session) t))
    )
  ) x;
$$;
