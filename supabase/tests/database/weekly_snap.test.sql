-- Revisão sem acúmulo: intervalos longos caem no dia da revisão semanal mais próximo (teoria, caderno de erros e conceitos).
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c7', 'snap@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function pg_temp.make_due() returns void language sql as $$ update public.theory_reviews set due_on = pg_temp.today() $$;

insert into public.notices (id, owner_id, title, status, exam_date) values
  ('c7000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c7', 'Sem data', 'reviewed', null);
insert into public.notice_subjects (id, owner_id, notice_id, name) values
  ('c7100000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c7', 'c7000000-0000-4000-8000-000000000001', 'Penal');
insert into public.study_plans (id, owner_id, notice_id, name) values
  ('c7200000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c7', 'c7000000-0000-4000-8000-000000000001', 'P');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values
  ('c7300000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c7', 'c7200000-0000-4000-8000-000000000001', 1, '{}'),
  ('c7300000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c7', 'c7200000-0000-4000-8000-000000000001', 2, '{}');
insert into public.study_sessions (id, owner_id, plan_version_id, subject_id, position, title) values
  ('c7400000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c7', 'c7300000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000001', 1, 'Dolo');
insert into public.tasks (id, owner_id, plan_id, date, kind, title, subject_id, session_id, created_in_version, superseded_in_version) values
  ('c7500000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c7', 'c7200000-0000-4000-8000-000000000001', pg_temp.today() - 1, 'theory', 'Dolo', 'c7100000-0000-4000-8000-000000000001', 'c7400000-0000-4000-8000-000000000001', 'c7300000-0000-4000-8000-000000000001', null),
  ('c7500000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c7', 'c7200000-0000-4000-8000-000000000001', pg_temp.today() + 6, 'weekly_review', 'Revisão da semana', null, null, 'c7300000-0000-4000-8000-000000000001', null),
  -- Substituída por outra versão: não conta.
  ('c7500000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c7', 'c7200000-0000-4000-8000-000000000001', pg_temp.today() + 7, 'weekly_review', 'Revisão da semana', null, null, 'c7300000-0000-4000-8000-000000000001', 'c7300000-0000-4000-8000-000000000002');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c7');
update public.tasks set done_at = now() where id = 'c7500000-0000-4000-8000-000000000001';
select is((select due_on from public.theory_reviews), pg_temp.today() + 1, '1ª revisão continua no dia seguinte');
select throws_ok($$select public.weekly_snap('c7200000-0000-4000-8000-000000000001', current_date)$$, '42501', null, 'função interna não é pública');

reset role; select pg_temp.make_due(); select pg_temp.as_user('00000000-0000-4000-8000-0000000000c7');
select is(public.theory_review_answer((select id from public.theory_reviews), 'lembrei'), pg_temp.today() + 6, '7 dias vira o dia da revisão semanal (ignora a substituída)');
reset role; select pg_temp.make_due(); select pg_temp.as_user('00000000-0000-4000-8000-0000000000c7');
select is(public.theory_review_answer((select id from public.theory_reviews), 'esqueci'), pg_temp.today() + 1, 'esqueci: 1 dia, sem encaixe');
reset role; select pg_temp.make_due(); select pg_temp.as_user('00000000-0000-4000-8000-0000000000c7');
select public.theory_review_answer((select id from public.theory_reviews), 'lembrei');
reset role; select pg_temp.make_due(); select pg_temp.as_user('00000000-0000-4000-8000-0000000000c7');
select is(public.theory_review_answer((select id from public.theory_reviews), 'lembrei'), pg_temp.today() + 30, '30 dias sem revisão semanal perto fica na data normal');

-- Caderno de erros: a 2ª etapa (7 dias) vai para a revisão semanal; questão errada não vira flashcard.
reset role;
insert into public.qbank_questions (qid, payload, gabarito, materia, assunto) values
  ('snap-q1', '{"enunciado":"2+2?","alternativas":[{"letra":"A","texto":"3"},{"letra":"B","texto":"4"}]}', 'B', 'Matemática', 'Soma');
select public.record_answer_for('00000000-0000-4000-8000-0000000000c7', 'snap-q1', 'A', 'free', 'c7200000-0000-4000-8000-000000000001');
select is((select due_on from public.error_book where qid = 'snap-q1'), current_date + 1, 'erro volta no dia seguinte');
select is((select count(*) from public.flashcards where ref = 'snap-q1'), 0::bigint, 'erro não vira flashcard');
select public.record_answer_for('00000000-0000-4000-8000-0000000000c7', 'snap-q1', 'B', 'review', 'c7200000-0000-4000-8000-000000000001');
select is((select due_on from public.error_book where qid = 'snap-q1'), pg_temp.today() + 6, 'acerto na revisão: próxima no dia da revisão semanal');

-- Conceitos da Aula guiada: intervalo de 7 dias ou mais vai para a revisão semanal.
insert into public.tutor_concepts (owner_id, concept_key, plan_id, name, level, due_on) values
  ('00000000-0000-4000-8000-0000000000c7', 'a:perto', 'c7200000-0000-4000-8000-000000000001', 'Perto', 'em_progresso', pg_temp.today() + 3),
  ('00000000-0000-4000-8000-0000000000c7', 'a:semana', 'c7200000-0000-4000-8000-000000000001', 'Semana', 'em_progresso', pg_temp.today() + 8),
  ('00000000-0000-4000-8000-0000000000c7', 'a:longe', 'c7200000-0000-4000-8000-000000000001', 'Longe', 'dominado', pg_temp.today() + 20);
select is((select due_on from public.tutor_concepts where concept_key = 'a:perto'), pg_temp.today() + 3, 'intervalo curto fica como está');
select is((select due_on from public.tutor_concepts where concept_key = 'a:semana'), pg_temp.today() + 6, '8 dias vira o dia da revisão semanal');
select is((select due_on from public.tutor_concepts where concept_key = 'a:longe'), pg_temp.today() + 20, 'sem revisão semanal perto fica na data');
update public.tutor_concepts set due_on = pg_temp.today() + 9 where concept_key = 'a:longe';
select is((select due_on from public.tutor_concepts where concept_key = 'a:longe'), pg_temp.today() + 6, 'atualização também encaixa');

select * from finish();
rollback;
