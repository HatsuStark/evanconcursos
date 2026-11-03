-- Cada concurso com os próprios dados: caderno de erros, flashcards, questões livres, revisões, simulados, tempo de estudo e
-- desempenho ficam no plano do concurso ativo. O estudante escolhe o concurso ativo (profiles.active_notice_id); sem escolha,
-- vale o plano ativo mais recente. Anotações por questão e marcações de lei continuam do estudante.

-- ---------- concurso ativo ----------
alter table public.profiles add column active_notice_id uuid;
alter table public.profiles add foreign key (active_notice_id, id)
  references public.notices (id, owner_id) on delete set null (active_notice_id);

-- Plano do concurso ativo; sem escolha válida, o plano ativo mais recente. Null se o estudante não tem plano.
create function public.active_plan_for(p_owner uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.study_plans p
  left join public.profiles pr on pr.id = p_owner
  where p.owner_id = p_owner and p.status = 'active'
  order by (p.notice_id = pr.active_notice_id) desc nulls last, p.created_at desc
  limit 1;
$$;
revoke all on function public.active_plan_for(uuid) from public, anon, authenticated;
grant execute on function public.active_plan_for(uuid) to service_role;

create function public.my_active_plan() returns uuid
language sql stable security definer set search_path = '' as $$
  select public.active_plan_for(auth.uid());
$$;
revoke all on function public.my_active_plan() from public, anon;
grant execute on function public.my_active_plan() to authenticated;

-- Plano novo vira o concurso ativo: quem acabou de montar o cronograma quer estudar por ele.
create function public.activate_new_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set active_notice_id = new.notice_id where id = new.owner_id;
  return null;
end $$;
revoke all on function public.activate_new_plan() from public, anon, authenticated;
create trigger study_plans_activate after insert on public.study_plans for each row execute function public.activate_new_plan();

-- Plano em vigor numa data: o mais recente criado até ela (ou o primeiro, se a data for anterior a todos).
create function pg_temp.plan_at(p_owner uuid, p_at timestamptz) returns uuid
language sql stable as $$
  select id from public.study_plans where owner_id = p_owner
  order by (created_at <= p_at) desc, case when created_at <= p_at then created_at end desc nulls last, created_at
  limit 1;
$$;

-- ---------- tentativas fora do cronograma ----------
update public.question_attempts set plan_id = pg_temp.plan_at(owner_id, created_at) where plan_id is null;

-- ---------- caderno de erros ----------
alter table public.error_book add column plan_id uuid;
update public.error_book e set plan_id = coalesce(
  (select a.plan_id from public.question_attempts a where a.owner_id = e.owner_id and a.qid = e.qid and a.plan_id is not null order by a.created_at desc limit 1),
  pg_temp.plan_at(e.owner_id, e.updated_at));
alter table public.error_book drop constraint error_book_pkey;
alter table public.error_book add constraint error_book_owner_plan_qid_key unique nulls not distinct (owner_id, plan_id, qid);
alter table public.error_book add foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade;
drop index if exists public.error_book_due_idx;
create index error_book_due_idx on public.error_book (owner_id, plan_id, resolved, due_on);

-- ---------- flashcards ----------
update public.flashcards f set plan_id = coalesce(
  (select a.plan_id from public.question_attempts a where f.kind = 'question' and a.owner_id = f.owner_id and a.qid = f.ref and a.plan_id is not null order by a.created_at desc limit 1),
  pg_temp.plan_at(f.owner_id, f.created_at))
where plan_id is null;
alter table public.flashcards drop constraint flashcards_owner_id_kind_ref_key;
alter table public.flashcards add constraint flashcards_owner_plan_kind_ref_key unique nulls not distinct (owner_id, plan_id, kind, ref);
alter table public.flashcards drop constraint flashcards_plan_id_owner_id_fkey;
alter table public.flashcards add foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade;
drop index if exists public.flashcards_due_idx;
create index flashcards_due_idx on public.flashcards (owner_id, plan_id, due_on);

-- ---------- simulados personalizados ----------
update public.simulados set plan_id = pg_temp.plan_at(owner_id, started_at) where plan_id is null;
create index simulados_plan_idx on public.simulados (owner_id, plan_id, started_at desc);

-- ---------- tempo de estudo por dia ----------
alter table public.study_days add column plan_id uuid;
update public.study_days d set plan_id = pg_temp.plan_at(d.owner_id, (d.day + 1)::timestamp at time zone 'America/Sao_Paulo');
delete from public.study_days where plan_id is null;
alter table public.study_days drop constraint study_days_pkey;
alter table public.study_days alter column plan_id set not null;
alter table public.study_days add primary key (owner_id, plan_id, day);
alter table public.study_days add foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete cascade;

create or replace function public.log_study_time() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.study_days (owner_id, plan_id, day, seconds)
  values (new.owner_id, new.plan_id, (now() at time zone 'America/Sao_Paulo')::date, new.time_spent_sec - old.time_spent_sec)
  on conflict (owner_id, plan_id, day) do update set seconds = study_days.seconds + excluded.seconds;
  return null;
end $$;

-- Atividade do plano por dia desde p_from: tempo, questões e discursivas corrigidas do concurso, tarefas concluídas.
create or replace function public.study_activity(p_plan uuid, p_from date)
returns table (day date, seconds int, questions int, tasks_done int, discursives int)
language sql stable security invoker set search_path = '' as $$
  select a.d, sum(a.s)::int, sum(a.q)::int, sum(a.t)::int, sum(a.r)::int
  from (
    select sd.day as d, sd.seconds as s, 0 as q, 0 as t, 0 as r from public.study_days sd where sd.plan_id = p_plan and sd.day >= p_from
    union all
    select (qa.created_at at time zone 'America/Sao_Paulo')::date, 0, 1, 0, 0 from public.question_attempts qa
    where qa.plan_id = p_plan and qa.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    union all
    select (t.done_at at time zone 'America/Sao_Paulo')::date, 0, 0, 1, 0 from public.tasks t
    where t.plan_id = p_plan and t.done_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    union all
    select (da.graded_at at time zone 'America/Sao_Paulo')::date, 0, 0, 0, 1 from public.discursive_answers da
    where da.notice_id = (select notice_id from public.study_plans where id = p_plan)
      and da.graded_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
  ) a
  group by a.d;
$$;

-- ---------- correção: caderno de erros e flashcard no plano da resposta ----------
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

  select stage, wrong_count, resolved into eb from public.error_book where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
  if not v_correct then
    insert into public.error_book (owner_id, plan_id, qid, materia, assunto, stage, due_on, wrong_count, resolved, updated_at)
    values (p_owner, p_plan, p_qid, q.materia, q.assunto, 0, current_date + 1, 1, false, now())
    on conflict (owner_id, plan_id, qid) do update set stage = 0, due_on = current_date + 1, wrong_count = public.error_book.wrong_count + 1, resolved = false, updated_at = now();
    -- Flashcard da questão errada: frente = enunciado e alternativas; verso = resposta (+ explicação, se houver).
    select a->>'texto' into v_alt from jsonb_array_elements(q.payload->'alternativas') a where upper(left(a->>'letra', 1)) = upper(left(q.gabarito, 1)) limit 1;
    v_front := left(regexp_replace(coalesce(q.payload->>'enunciado', ''), '<[^>]+>', ' ', 'g'), 900) || coalesce(e'\n' || (
      select string_agg((a->>'letra') || ') ' || left(regexp_replace(a->>'texto', '<[^>]+>', ' ', 'g'), 160), e'\n')
      from jsonb_array_elements(q.payload->'alternativas') a), '');
    insert into public.flashcards (owner_id, plan_id, kind, ref, front, back)
    values (p_owner, p_plan, 'question', p_qid, left(regexp_replace(v_front, '\s+', ' ', 'g'), 2000),
            left('Resposta: ' || q.gabarito || coalesce(' — ' || left(regexp_replace(v_alt, '<[^>]+>', ' ', 'g'), 300), '') || coalesce(e'\n\n' || (q.explanation->>'resumo'), ''), 4000))
    on conflict (owner_id, plan_id, kind, ref) do nothing;
  elsif found and not eb.resolved and p_context = 'review' then
    -- Acerto na revisão avança a etapa (7 e depois 30 dias); após a última, sai do caderno.
    if eb.stage + 1 >= array_length(v_days, 1) then
      update public.error_book set stage = 3, resolved = true, updated_at = now() where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
    else
      update public.error_book set stage = eb.stage + 1, due_on = current_date + v_days[eb.stage + 2], updated_at = now() where owner_id = p_owner and plan_id is not distinct from p_plan and qid = p_qid;
    end if;
  end if;
  return jsonb_build_object('correct', v_correct, 'gabarito', q.gabarito);
end $$;

-- Prática livre e revisão entram no concurso ativo. Na revisão semanal, a resposta é revisão do caderno de erros:
-- acerto avança a etapa (7 e 30 dias) e conta na tarefa.
create or replace function public.answer_question(p_qid text, p_chosen text, p_task uuid default null, p_context text default 'free')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t record;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if p_task is not null then
    select plan_id, session_id, subject_id, kind into t from public.tasks where id = p_task and owner_id = v_uid;
    if not found then raise exception 'Tarefa não encontrada.' using errcode = 'P0002'; end if;
    if t.kind = 'weekly_review' then
      return public.record_answer_for(v_uid, p_qid, p_chosen, 'review', t.plan_id, p_task, null, null, null);
    end if;
    return public.record_answer_for(v_uid, p_qid, p_chosen, 'plan', t.plan_id, p_task, t.session_id, t.subject_id, null);
  end if;
  return public.record_answer_for(v_uid, p_qid, p_chosen, case when p_context = 'review' then 'review' else 'free' end, public.active_plan_for(v_uid));
end $$;

-- Motivo do erro: o último erro da questão no concurso ativo.
create or replace function public.set_error_reason(p_qid text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  select id into v_id from public.question_attempts
  where owner_id = auth.uid() and qid = p_qid and not correct and plan_id is not distinct from public.active_plan_for(auth.uid())
  order by created_at desc limit 1;
  if not found then raise exception 'Erro não encontrado.' using errcode = 'P0002'; end if;
  update public.question_attempts set error_reason = p_reason where id = v_id;
end $$;

-- ---------- excluir concurso ----------
-- Caderno de erros, flashcards, tempo de estudo e tentativas saem em cascata com o plano. Anotações e marcações de lei
-- seguem a regra anterior: saem só se não foram usadas em outro concurso.
create or replace function public.delete_notice(p_notice uuid, p_law_urns text[] default '{}')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plans uuid[];
  v_sims uuid[];
  v_scopes text[];
  v_gone text[];
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if not exists (select 1 from public.notices where id = p_notice and owner_id = v_uid) then
    raise exception 'Concurso não encontrado.' using errcode = 'P0002';
  end if;

  v_plans := array(select id from public.study_plans where notice_id = p_notice and owner_id = v_uid);
  v_sims := array(select id from public.simulados where owner_id = v_uid and plan_id = any(v_plans));
  v_scopes := array(
    select s.id::text from public.study_sessions s join public.plan_versions v on v.id = s.plan_version_id where v.plan_id = any(v_plans)
    union all
    select 'subject:' || id from public.notice_subjects where notice_id = p_notice and owner_id = v_uid);

  -- Anotação sai se a questão só apareceu neste concurso.
  v_gone := array(
    select qid from public.question_notes where owner_id = v_uid and (plan_id = any(v_plans)
      or qid in (select qid from public.question_attempts where owner_id = v_uid and plan_id = any(v_plans)))
    except
    select qid from public.question_attempts where owner_id = v_uid and (plan_id is null or not plan_id = any(v_plans))
    except
    select qid from public.question_notes where owner_id = v_uid and plan_id is not null and not plan_id = any(v_plans));
  delete from public.question_notes where owner_id = v_uid and qid = any(v_gone);
  delete from public.simulados where id = any(v_sims);
  delete from public.qbank_cursors where owner_id = v_uid and scope = any(v_scopes);
  delete from public.legal_marks m using public.legal_articles a, public.legal_norms n
    where m.owner_id = v_uid and a.id = m.article_id and n.id = a.norm_id and n.urn = any(p_law_urns);
  -- O registro de custo (ai_usage) fica: não tem conteúdo do estudante e o vínculo com o job vira nulo.
  delete from public.ai_jobs where owner_id = v_uid and input->>'noticeId' = p_notice::text;
  delete from public.notices where id = p_notice and owner_id = v_uid;
end $$;

-- ---------- edital novo do mesmo concurso ----------
-- Além do desempenho das matérias equivalentes e das apostilas, leva caderno de erros, flashcards, prática livre,
-- revisões, simulados e tempo de estudo para o plano novo, e o concurso novo passa a ser o ativo.
create or replace function public.adopt_notice_update(p_notice uuid, p_subjects jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_old uuid;
  v_old_plan uuid;
  v_new_plan uuid;
  v_moved int;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  select replaces_notice_id into v_old from public.notices where id = p_notice and owner_id = v_uid;
  if v_old is null then raise exception 'Este edital não atualiza outro.' using errcode = 'P0002'; end if;
  select id into v_new_plan from public.study_plans where notice_id = p_notice and owner_id = v_uid and status = 'active';
  if v_new_plan is null then raise exception 'Gere o cronograma do novo edital primeiro.' using errcode = 'P0002'; end if;
  select id into v_old_plan from public.study_plans where notice_id = v_old and owner_id = v_uid and status = 'active';
  if v_old_plan is null then return 0; end if; -- já feito: repetir não muda nada

  if exists (select 1 from jsonb_each_text(coalesce(p_subjects, '{}')) m
             where not exists (select 1 from public.notice_subjects s where s.id = m.key::uuid and s.notice_id = v_old and s.owner_id = v_uid)
                or not exists (select 1 from public.notice_subjects s where s.id = m.value::uuid and s.notice_id = p_notice and s.owner_id = v_uid)) then
    raise exception 'A equivalência aponta para matéria de outro edital.' using errcode = '22023';
  end if;

  update public.question_attempts a set plan_id = v_new_plan, subject_id = (m.value)::uuid
  from jsonb_each_text(coalesce(p_subjects, '{}')) m
  where a.owner_id = v_uid and a.plan_id = v_old_plan and a.subject_id = (m.key)::uuid;
  update public.question_attempts set plan_id = v_new_plan where owner_id = v_uid and plan_id = v_old_plan and context <> 'plan';

  update public.error_book e set plan_id = v_new_plan where e.owner_id = v_uid and e.plan_id = v_old_plan
    and not exists (select 1 from public.error_book x where x.owner_id = v_uid and x.plan_id = v_new_plan and x.qid = e.qid);
  update public.flashcards f set plan_id = v_new_plan where f.owner_id = v_uid and f.plan_id = v_old_plan
    and not exists (select 1 from public.flashcards x where x.owner_id = v_uid and x.plan_id = v_new_plan and x.kind = f.kind and x.ref = f.ref);
  insert into public.study_days (owner_id, plan_id, day, seconds)
  select owner_id, v_new_plan, day, seconds from public.study_days where owner_id = v_uid and plan_id = v_old_plan
  on conflict (owner_id, plan_id, day) do update set seconds = study_days.seconds + excluded.seconds;
  delete from public.study_days where owner_id = v_uid and plan_id = v_old_plan;
  update public.simulados set plan_id = v_new_plan where owner_id = v_uid and plan_id = v_old_plan and task_id is null;

  delete from public.material_maps x using public.materials m where x.material_id = m.id and m.plan_id = v_old_plan and m.owner_id = v_uid;
  update public.materials set plan_id = v_new_plan, status = 'uploaded', status_detail = '' where plan_id = v_old_plan and owner_id = v_uid;
  get diagnostics v_moved = row_count;

  update public.study_plans set status = 'archived' where id = v_old_plan;
  update public.notices set status = 'archived' where id = v_old and owner_id = v_uid;
  update public.profiles set active_notice_id = p_notice where id = v_uid;
  return v_moved;
end $$;
