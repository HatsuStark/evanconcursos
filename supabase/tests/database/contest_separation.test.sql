-- Concursos separados: o concurso ativo é escolhido pelo estudante, e caderno de erros, flashcards, prática livre, revisão
-- semanal e atividade ficam no plano de cada concurso.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ae', 'sep-a@test.local'), ('00000000-0000-4000-8000-0000000000be', 'sep-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

insert into public.notices (id, owner_id, title, status) values
  ('d0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ae', 'TJ', 'reviewed'),
  ('d0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ae', 'Prefeitura', 'reviewed'),
  ('d0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000be', 'De B', 'reviewed');
insert into public.study_plans (id, owner_id, notice_id, name, created_at) values
  ('d2000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ae', 'd0000000-0000-4000-8000-000000000001', 'TJ', now() - interval '2 days');
select is((select active_notice_id from public.profiles where id = '00000000-0000-4000-8000-0000000000ae'), 'd0000000-0000-4000-8000-000000000001'::uuid, 'plano novo vira o concurso ativo');
insert into public.study_plans (id, owner_id, notice_id, name, created_at) values
  ('d2000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ae', 'd0000000-0000-4000-8000-000000000002', 'Prefeitura', now() - interval '1 day');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values
  ('d3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ae', 'd2000000-0000-4000-8000-000000000001', 1, '{}'),
  ('d3000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ae', 'd2000000-0000-4000-8000-000000000002', 1, '{}');
insert into public.tasks (id, owner_id, plan_id, date, kind, title, created_in_version) values
  ('d5000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ae', 'd2000000-0000-4000-8000-000000000001', '2030-01-01', 'weekly_review', 'Revisão da semana', 'd3000000-0000-4000-8000-000000000001'),
  ('d5000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ae', 'd2000000-0000-4000-8000-000000000002', '2030-01-01', 'simulado', 'Simulado', 'd3000000-0000-4000-8000-000000000002');
insert into public.qbank_questions (qid, payload, gabarito) values ('sep-q1', '{"enunciado": "E", "alternativas": []}', 'B');

-- Concurso ativo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ae');
select is(public.my_active_plan(), 'd2000000-0000-4000-8000-000000000002'::uuid, 'sem trocar, vale o último plano criado');
update public.profiles set active_notice_id = 'd0000000-0000-4000-8000-000000000001' where id = '00000000-0000-4000-8000-0000000000ae';
select is(public.my_active_plan(), 'd2000000-0000-4000-8000-000000000001'::uuid, 'o estudante escolhe o concurso ativo');
select throws_ok($$update public.profiles set active_notice_id = 'd0000000-0000-4000-8000-000000000003' where id = '00000000-0000-4000-8000-0000000000ae'$$, '23503', null, 'não escolhe concurso de outro usuário');

-- Prática livre entra no concurso ativo; o mesmo erro em outro concurso é outra linha do caderno.
select public.answer_question('sep-q1', 'A', null, 'free');
select is((select plan_id from public.question_attempts where qid = 'sep-q1' and context = 'free'), 'd2000000-0000-4000-8000-000000000001'::uuid, 'questão livre fica no concurso ativo');
update public.profiles set active_notice_id = 'd0000000-0000-4000-8000-000000000002' where id = '00000000-0000-4000-8000-0000000000ae';
select public.answer_question('sep-q1', 'A', null, 'free');
select is((select count(*) from public.error_book where qid = 'sep-q1'), 2::bigint, 'cada concurso tem o próprio caderno de erros');
select is((select count(*) from public.flashcards where ref = 'sep-q1'), 2::bigint, 'cada concurso tem os próprios flashcards');
select lives_ok($$select public.set_error_reason('sep-q1', 'atencao')$$, 'motivo do erro no concurso ativo');
select is((select count(*) from public.question_attempts where qid = 'sep-q1' and error_reason = 'atencao'), 1::bigint, 'motivo marcado só no erro do concurso ativo');

-- Revisão semanal: a resposta é revisão do caderno daquele concurso e conta na tarefa.
reset role;
update public.error_book set due_on = current_date where qid = 'sep-q1';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ae');
select public.answer_question('sep-q1', 'B', 'd5000000-0000-4000-8000-000000000001');
select is((select context from public.question_attempts where task_id = 'd5000000-0000-4000-8000-000000000001'), 'review', 'resposta na revisão semanal é revisão');
select is((select stage from public.error_book where qid = 'sep-q1' and plan_id = 'd2000000-0000-4000-8000-000000000001'), 1, 'acerto avança a etapa no caderno do concurso da tarefa');
select is((select stage from public.error_book where qid = 'sep-q1' and plan_id = 'd2000000-0000-4000-8000-000000000002'), 0, 'o caderno do outro concurso não muda');

-- Tempo e atividade por concurso.
update public.tasks set time_spent_sec = 300 where id = 'd5000000-0000-4000-8000-000000000002';
select is((select seconds from public.study_days where plan_id = 'd2000000-0000-4000-8000-000000000002' and day = pg_temp.today()), 300, 'tempo do dia fica no concurso da tarefa');
select is((select coalesce(sum(seconds), 0) from public.study_activity('d2000000-0000-4000-8000-000000000001', pg_temp.today() - 7)), 0::bigint, 'tempo de um concurso não aparece no outro');
select is((select sum(questions) from public.study_activity('d2000000-0000-4000-8000-000000000001', pg_temp.today() - 7)), 2::bigint, 'questões contam só no concurso delas');

-- Outro usuário não vê nada disso.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000be');
select is(public.my_active_plan(), null::uuid, 'sem plano, sem concurso ativo');
select is((select count(*) from public.error_book), 0::bigint, 'outro usuário não vê o caderno');

select * from finish();
rollback;
