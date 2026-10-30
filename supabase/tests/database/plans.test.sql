-- Cronograma versionado: criação, refazer sem perder histórico, isolamento entre usuários.
begin;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'plan-a@test.local'),
  ('00000000-0000-4000-8000-0000000000b1', 'plan-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A: edital conferido com uma matéria e dois tópicos.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
insert into public.notices (id, title) values ('20000000-0000-4000-8000-000000000001', 'Edital A');
select public.approve_notice('20000000-0000-4000-8000-000000000001', null,
  '{"title":"TJ","examDate":"2030-03-14","subjects":[{"name":"Penal","topics":[{"text":"Dolo"},{"text":"Culpa"}]}]}');
create temp table ids as
  select s.id as subject_id, array_agg(t.id order by t.position) as topics
  from public.notice_subjects s join public.notice_topics t on t.subject_id = s.id group by s.id;
grant select on ids to authenticated;

-- Versão 1: uma tarefa no passado e uma no futuro, ligadas a uma sessão.
select lives_ok(format($$select public.create_plan_version('20000000-0000-4000-8000-000000000001', %L)$$, jsonb_build_object(
  'name', 'Plano TJ', 'inputs', '{"hours":[2,2,2,2,2,3,0]}'::jsonb,
  'sessions', jsonb_build_array(jsonb_build_object('key', 's1', 'subjectId', (select subject_id from ids), 'position', 0, 'title', 'Dolo e culpa', 'topicIds', (select to_jsonb(topics) from ids))),
  'tasks', jsonb_build_array(
    jsonb_build_object('date', '2020-01-01', 'kind', 'theory', 'minutes', 120, 'subjectId', (select subject_id from ids), 'sessionKey', 's1', 'title', 'Penal: dolo', 'goal', 20),
    jsonb_build_object('date', '2030-01-01', 'kind', 'theory', 'minutes', 120, 'subjectId', (select subject_id from ids), 'sessionKey', 's1', 'title', 'Penal: culpa', 'goal', 20)))),
  'cria a versão 1');
select is((select count(*) from public.tasks), 2::bigint, 'v1 grava todas as tarefas');
select is((select count(*) from public.tasks where session_id is not null), 2::bigint, 'tarefas ligadas à sessão');
select is((select cardinality(topic_ids) from public.study_sessions), 2, 'sessão aponta para os 2 tópicos');
select is((select active_version_id from public.study_plans), (select id from public.plan_versions where number = 1), 'v1 ativa');

-- Marca a tarefa passada como feita e refaz o cronograma a partir de 2025-06-01.
update public.tasks set done_at = now() where date = '2020-01-01';
select lives_ok($$select public.create_plan_version('20000000-0000-4000-8000-000000000001',
  '{"from":"2025-06-01","tasks":[{"date":"2020-02-01","kind":"theory","title":"antiga, ignorada"},{"date":"2030-01-02","kind":"simulado","title":"Simulado"}]}')$$, 'cria a versão 2');
select is((select count(*) from public.plan_versions), 2::bigint, 'duas versões');
select is((select reason from public.plan_versions where number = 2), 'regenerate', 'v2 é refazer');
select ok((select done_at is not null and superseded_in_version is null from public.tasks where date = '2020-01-01'), 'tarefa concluída preservada');
select ok((select superseded_in_version = (select id from public.plan_versions where number = 2) from public.tasks where date = '2030-01-01'), 'tarefa futura da v1 substituída');
select is((select count(*) from public.tasks where superseded_in_version is null), 2::bigint, 'visíveis: concluída da v1 + nova da v2');
select is((select count(*) from public.tasks where title = 'antiga, ignorada'), 0::bigint, 'v2 não grava datas antes de "from"');

-- Edital com cronograma: matérias não podem ser substituídas.
select throws_ok($$select public.approve_notice('20000000-0000-4000-8000-000000000001', null, '{"subjects":[{"name":"Outra"}]}')$$, '55000', null, 'conferir de novo é bloqueado');

-- ---------- B ----------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.study_plans), 0::bigint, 'B não vê planos de A');
select is((select count(*) from public.plan_versions), 0::bigint, 'B não vê versões de A');
select is((select count(*) from public.study_sessions), 0::bigint, 'B não vê sessões de A');
select is((select count(*) from public.tasks), 0::bigint, 'B não vê tarefas de A');
select throws_ok($$select public.create_plan_version('20000000-0000-4000-8000-000000000001', '{"tasks":[{"date":"2030-01-01","kind":"theory","title":"x"}]}')$$, 'P0002', null, 'B não cria versão no edital de A');
update public.tasks set done_at = null;
-- B com edital próprio tentando usar tópico de A.
insert into public.notices (id, title) values ('20000000-0000-4000-8000-000000000002', 'Edital B');
select public.approve_notice('20000000-0000-4000-8000-000000000002', null, '{"subjects":[{"name":"X","topics":[{"text":"t"}]}]}');
select throws_ok(format($$select public.create_plan_version('20000000-0000-4000-8000-000000000002', %L)$$, jsonb_build_object(
  'sessions', jsonb_build_array(jsonb_build_object('key', 'k', 'subjectId', (select id from public.notice_subjects), 'title', 'x', 'topicIds', (select to_jsonb(topics) from ids))),
  'tasks', '[{"date":"2030-01-01","kind":"theory","title":"x"}]'::jsonb)), '22023', null, 'B não aponta sessão para tópico de A');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select ok((select done_at is not null from public.tasks where date = '2020-01-01'), 'update de B não afetou A');

-- ---------- modo estudo: registros de questões e filtros (E4.1) ----------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$insert into public.question_logs (plan_id, task_id, subject_id, topic, correct, total)
  select p.id, t.id, t.subject_id, 'dolo', 7, 10 from public.study_plans p join public.tasks t on t.plan_id = p.id where t.date = '2020-01-01'$$, 'A registra questões');
select throws_ok($$insert into public.question_logs (plan_id, correct, total) select id, 11, 10 from public.study_plans$$, '23514', null, 'acertos > total é recusado');
select lives_ok($$insert into public.question_filters (plan_id, url) select id, 'https://www.qconcursos.com/questoes-de-concursos/questoes?examining_board_ids%5B%5D=152' from public.study_plans$$, 'A salva filtro base');
select throws_ok($$insert into public.question_filters (plan_id, url) select id, 'https://evil.example/x' from public.study_plans$$, '23514', null, 'só links de sites de questões');
select lives_ok($$update public.tasks set time_spent_sec = 1800 where date = '2020-01-01'$$, 'A grava tempo estudado');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.question_logs), 0::bigint, 'B não vê registros de A');
select is((select count(*) from public.question_filters), 0::bigint, 'B não vê filtros de A');
select throws_ok($$insert into public.question_logs (plan_id, correct, total) values ((select id from public.study_plans limit 1), 1, 1)$$, '23502', null, 'B não registra no plano de A (invisível)');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');

-- Permissões por coluna: só o necessário é alterável.
select throws_ok($$update public.tasks set title = 'outro'$$, '42501', null, 'título da tarefa não é alterável');
select throws_ok($$update public.plan_versions set number = 99$$, '42501', null, 'versão não é alterável');
select throws_ok($$delete from public.tasks$$, '42501', null, 'tarefas não são apagáveis direto');

-- Apagar o edital apaga o plano em cascata.
select lives_ok($$delete from public.notices where id = '20000000-0000-4000-8000-000000000001'$$, 'apagar edital com cronograma');
select is((select count(*) from public.tasks), 0::bigint, 'tarefas apagadas junto');

select * from finish();
rollback;
