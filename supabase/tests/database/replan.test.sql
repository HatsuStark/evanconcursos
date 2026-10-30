-- Reorganização do cronograma e motivo do erro: progresso preservado, histórico mantido e isolamento entre usuários.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a8', 'rep-a@test.local'), ('00000000-0000-4000-8000-0000000000b8', 'rep-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', 'A', 'reviewed'),
  ('70000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b8', 'B', 'reviewed');
insert into public.notice_subjects (id, owner_id, notice_id, name) values
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', '70000000-0000-4000-8000-000000000001', 'Penal'),
  ('71000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b8', '70000000-0000-4000-8000-000000000002', 'Civil');
insert into public.study_plans (id, owner_id, notice_id, name) values
  ('72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', '70000000-0000-4000-8000-000000000001', 'P'),
  ('72000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b8', '70000000-0000-4000-8000-000000000002', 'Q');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs, strategy, summary) values
  ('73000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', '72000000-0000-4000-8000-000000000001', 1, '{"hours":[2]}', '{"advice":["x"]}', '{"weeks":3}'),
  ('73000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b8', '72000000-0000-4000-8000-000000000002', 1, '{}', '{}', '{}');
update public.study_plans set active_version_id = '73000000-0000-4000-8000-000000000001' where id = '72000000-0000-4000-8000-000000000001';
update public.study_plans set active_version_id = '73000000-0000-4000-8000-000000000002' where id = '72000000-0000-4000-8000-000000000002';
insert into public.study_sessions (id, owner_id, plan_version_id, subject_id, position, title) values
  ('74000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', '73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 0, 'Dolo'),
  ('74000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b8', '73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', 0, 'Posse');
insert into public.tasks (id, owner_id, plan_id, date, kind, title, subject_id, session_id, created_in_version, time_spent_sec, done_at) values
  ('75000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', '72000000-0000-4000-8000-000000000001', '2020-01-01', 'theory', 'Dolo', '71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 600, null),
  ('75000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a8', '72000000-0000-4000-8000-000000000001', '2020-01-02', 'theory', 'Feita', '71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 0, now()),
  ('75000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a8', '72000000-0000-4000-8000-000000000001', '2030-01-01', 'consolidation', 'Reforço', '71000000-0000-4000-8000-000000000001', null, '73000000-0000-4000-8000-000000000001', 0, null),
  ('75000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000b8', '72000000-0000-4000-8000-000000000002', '2020-01-01', 'theory', 'De B', '71000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000002', 0, null);
insert into public.question_attempts (owner_id, plan_id, task_id, qid, chosen, correct, created_at) values
  ('00000000-0000-4000-8000-0000000000a8', '72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', 'q1', 'A', false, now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000000a8', '72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', 'q1', 'B', false, now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000000a8', '72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', 'q1', 'C', true, now()),
  ('00000000-0000-4000-8000-0000000000b8', '72000000-0000-4000-8000-000000000002', '75000000-0000-4000-8000-000000000004', 'q1', 'A', false, now());
insert into public.simulados (id, owner_id, plan_id, task_id, title, config) values
  ('76000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', '72000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000003', 'S', '{}');

-- Motivo do erro.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a8');
select lives_ok($$select public.set_error_reason('q1', 'atencao')$$, 'A marca o motivo');
select is((select error_reason from public.question_attempts where chosen = 'B'), 'atencao', 'vale para o último erro');
select is((select error_reason from public.question_attempts where chosen = 'A'), null, 'erro anterior não muda');
select is((select error_reason from public.question_attempts where chosen = 'C'), null, 'acerto não muda');
select throws_ok($$select public.set_error_reason('q1', 'preguica')$$, '23514', null, 'motivo fora da lista recusado');
select throws_ok($$select public.set_error_reason('q9', 'atencao')$$, 'P0002', null, 'questão sem erro recusada');
select throws_ok($$update public.question_attempts set error_reason = 'atencao'$$, '42501', null, 'tentativa não é alterada direto');
select lives_ok($$select public.set_error_reason('q1', null)$$, 'A desmarca');
select is((select error_reason from public.question_attempts where chosen = 'B'), null, 'motivo desmarcado');
reset role;
select is((select error_reason from public.question_attempts where owner_id = '00000000-0000-4000-8000-0000000000b8'), null, 'motivo de A não alcança B');

-- Isolamento: B não reorganiza o plano de A, nem aponta para dados de A.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b8');
select throws_ok($$select public.replan_version('72000000-0000-4000-8000-000000000001', '{}')$$, 'P0002', null, 'B não reorganiza o plano de A');
select throws_ok($$select public.replan_version('72000000-0000-4000-8000-000000000002', '{"supersede":["75000000-0000-4000-8000-000000000001"]}')$$, '22023', null, 'B não retira tarefa de A');
select throws_ok($$select public.replan_version('72000000-0000-4000-8000-000000000002', '{"tasks":[{"date":"2030-02-01","kind":"theory","title":"x","sessionId":"74000000-0000-4000-8000-000000000001"}]}')$$, '22023', null, 'B não usa sessão de A');
select throws_ok($$select public.replan_version('72000000-0000-4000-8000-000000000002', '{"tasks":[{"date":"2030-02-01","kind":"theory","title":"x","subjectId":"71000000-0000-4000-8000-000000000001"}]}')$$, '22023', null, 'B não usa matéria de A');
select throws_ok($$select public.replan_version('72000000-0000-4000-8000-000000000002', '{"tasks":[{"date":"2030-02-01","kind":"theory","title":"x","fromTaskId":"75000000-0000-4000-8000-000000000001"}]}')$$, '22023', null, 'B não puxa o progresso de tarefa de A');

-- Regras no plano do próprio usuário.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a8');
select throws_ok($$select public.replan_version('72000000-0000-4000-8000-000000000001', '{"supersede":["75000000-0000-4000-8000-000000000002"]}')$$, '22023', null, 'tarefa feita não sai');

-- A reorganiza: a atrasada vai para 2030 e o reforço vira a sessão; tarefas antigas ficam no histórico.
select lives_ok($$select public.replan_version('72000000-0000-4000-8000-000000000001', '{
  "supersede":["75000000-0000-4000-8000-000000000001","75000000-0000-4000-8000-000000000003"],
  "summary":{"overdueTheory":1},
  "tasks":[{"date":"2030-01-01","position":0,"minutes":120,"kind":"theory","subjectId":"71000000-0000-4000-8000-000000000001","sessionId":"74000000-0000-4000-8000-000000000001","title":"Dolo","keyword":"","goal":20,"fromTaskId":"75000000-0000-4000-8000-000000000001"},
           {"date":"2030-01-02","position":0,"minutes":120,"kind":"simulado","title":"Sim","keyword":"","goal":20,"fromTaskId":"75000000-0000-4000-8000-000000000003"}]}')$$, 'A reorganiza');
create temp table moved as select id from public.tasks where date = '2030-01-01' and superseded_in_version is null;
grant select on moved to authenticated;

select is((select reason from public.plan_versions where number = 2), 'adaptive', 'nova versão é adaptativa');
select is((select active_version_id from public.study_plans), (select id from public.plan_versions where number = 2), 'nova versão ativa');
select is((select inputs from public.plan_versions where number = 2), '{"hours":[2]}'::jsonb, 'herda as respostas do questionário');
select is((select strategy from public.plan_versions where number = 2), '{"advice":["x"]}'::jsonb, 'herda a estratégia');
select is((select summary->'replan'->>'overdueTheory' from public.plan_versions where number = 2), '1', 'guarda o resumo');
select is((select summary->>'weeks' from public.plan_versions where number = 2), '3', 'mantém o resumo anterior');
select is((select count(*) from public.tasks where superseded_in_version is null and date = '2020-01-01'), 0::bigint, 'atrasada saiu da agenda');
select is((select count(*) from public.tasks where id = '75000000-0000-4000-8000-000000000001'), 1::bigint, 'a antiga continua no histórico');
select ok((select done_at is not null and superseded_in_version is null from public.tasks where id = '75000000-0000-4000-8000-000000000002'), 'tarefa feita intacta');
select is((select session_id from public.tasks where id = (select id from moved)), '74000000-0000-4000-8000-000000000001'::uuid, 'reaproveita a sessão');
select is((select time_spent_sec from public.tasks where id = (select id from moved)), 600, 'tempo estudado acompanha');
select is((select count(*) from public.question_attempts where task_id = (select id from moved)), 3::bigint, 'tentativas acompanham');
select is((select task_id from public.simulados), (select id from public.tasks where date = '2030-01-02' and superseded_in_version is null), 'simulado acompanha');
select is((select max(number) from public.plan_versions), 2, 'uma versão a mais');

reset role;
select is((select count(*) from public.question_attempts where task_id = '75000000-0000-4000-8000-000000000004'), 1::bigint, 'tentativa de B intacta');
select is((select superseded_in_version from public.tasks where id = '75000000-0000-4000-8000-000000000004'), null, 'tarefa de B intacta');

select * from finish();
rollback;
