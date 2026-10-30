-- Resposta de questão numa única ida ao banco (antes: Edge Function com partida a frio e várias consultas).
-- record_answer_for: regra única de correção + caderno de erros (1, 7, 30 dias) + flashcard da questão errada.
-- answer_question: o que o app chama (usa o usuário logado); o backend usa record_answer_for (simulado).

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
  v_alt text;
  v_front text;
  v_days int[] := array[1, 7, 30];
begin
  select payload, gabarito, materia, assunto, explanation into q from public.qbank_questions where qid = p_qid;
  if not found then raise exception 'Questão não encontrada.' using errcode = 'P0002'; end if;
  v_correct := v_chosen <> '' and upper(left(trim(v_chosen), 1)) = upper(left(trim(q.gabarito), 1));

  insert into public.question_attempts (owner_id, plan_id, task_id, session_id, subject_id, qid, materia, assunto, chosen, correct, context, simulado_id)
  values (p_owner, p_plan, p_task, p_session, p_subject, p_qid, q.materia, q.assunto, v_chosen, v_correct, p_context, p_simulado);

  select stage, wrong_count, resolved into eb from public.error_book where owner_id = p_owner and qid = p_qid;
  if not v_correct then
    insert into public.error_book (owner_id, qid, materia, assunto, stage, due_on, wrong_count, resolved, updated_at)
    values (p_owner, p_qid, q.materia, q.assunto, 0, current_date + 1, 1, false, now())
    on conflict (owner_id, qid) do update set stage = 0, due_on = current_date + 1, wrong_count = public.error_book.wrong_count + 1, resolved = false, updated_at = now();
    -- Flashcard da questão errada: frente = enunciado e alternativas; verso = resposta (+ explicação, se houver).
    select a->>'texto' into v_alt from jsonb_array_elements(q.payload->'alternativas') a where upper(left(a->>'letra', 1)) = upper(left(q.gabarito, 1)) limit 1;
    v_front := left(regexp_replace(coalesce(q.payload->>'enunciado', ''), '<[^>]+>', ' ', 'g'), 900) || coalesce(e'\n' || (
      select string_agg((a->>'letra') || ') ' || left(regexp_replace(a->>'texto', '<[^>]+>', ' ', 'g'), 160), e'\n')
      from jsonb_array_elements(q.payload->'alternativas') a), '');
    insert into public.flashcards (owner_id, kind, ref, front, back)
    values (p_owner, 'question', p_qid, left(regexp_replace(v_front, '\s+', ' ', 'g'), 2000),
            left('Resposta: ' || q.gabarito || coalesce(' — ' || left(regexp_replace(v_alt, '<[^>]+>', ' ', 'g'), 300), '') || coalesce(e'\n\n' || (q.explanation->>'resumo'), ''), 4000))
    on conflict (owner_id, kind, ref) do nothing;
  elsif found and not eb.resolved and p_context = 'review' then
    -- Acerto na revisão avança a etapa (7 e depois 30 dias); após a última, sai do caderno.
    if eb.stage + 1 >= array_length(v_days, 1) then
      update public.error_book set stage = 3, resolved = true, updated_at = now() where owner_id = p_owner and qid = p_qid;
    else
      update public.error_book set stage = eb.stage + 1, due_on = current_date + v_days[eb.stage + 2], updated_at = now() where owner_id = p_owner and qid = p_qid;
    end if;
  end if;
  return jsonb_build_object('correct', v_correct, 'gabarito', q.gabarito);
end $$;
revoke all on function public.record_answer_for(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Chamada pelo app: tarefa do cronograma (confere que é do usuário) ou prática livre/revisão.
create or replace function public.answer_question(p_qid text, p_chosen text, p_task uuid default null, p_context text default 'free')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t record;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if p_task is not null then
    select plan_id, session_id, subject_id into t from public.tasks where id = p_task and owner_id = v_uid;
    if not found then raise exception 'Tarefa não encontrada.' using errcode = 'P0002'; end if;
    return public.record_answer_for(v_uid, p_qid, p_chosen, 'plan', t.plan_id, p_task, t.session_id, t.subject_id, null);
  end if;
  return public.record_answer_for(v_uid, p_qid, p_chosen, case when p_context = 'review' then 'review' else 'free' end);
end $$;
revoke all on function public.answer_question(text, text, uuid, text) from public, anon;
grant execute on function public.answer_question(text, text, uuid, text) to authenticated;
