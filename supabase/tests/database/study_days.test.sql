-- Metas e constância: o cronômetro soma ao dia, a atividade junta as fontes e cada usuário só vê a sua.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ad', 'days-a@test.local'), ('00000000-0000-4000-8000-0000000000bd', 'days-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

insert into public.notices (id, owner_id, title, status) values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'Concurso', 'reviewed');
insert into public.study_plans (id, owner_id, notice_id, name) values ('c2000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'c0000000-0000-4000-8000-000000000001', 'P1');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values ('c3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', 1, '{}');
insert into public.tasks (id, owner_id, plan_id, date, kind, title, created_in_version) values
  ('c5000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', '2026-01-01', 'simulado', 'Simulado', 'c3000000-0000-4000-8000-000000000001');
insert into public.question_attempts (owner_id, plan_id, qid, chosen, correct, created_at) values
  ('00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', 'q1', 'A', true, now()),
  ('00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', 'q2', 'B', false, now()),
  ('00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', 'q3', 'B', false, now() - interval '30 days');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad');
update public.tasks set time_spent_sec = 600 where id = 'c5000000-0000-4000-8000-000000000001';
update public.tasks set time_spent_sec = 900 where id = 'c5000000-0000-4000-8000-000000000001';
select is((select seconds from public.study_days where day = pg_temp.today()), 900, 'o cronômetro soma só o que avançou');
update public.tasks set time_spent_sec = 100 where id = 'c5000000-0000-4000-8000-000000000001';
select is((select seconds from public.study_days where day = pg_temp.today()), 900, 'reduzir o tempo da tarefa não desconta do dia');
update public.tasks set done_at = now() where id = 'c5000000-0000-4000-8000-000000000001';

select is((select seconds from public.study_activity('c2000000-0000-4000-8000-000000000001', pg_temp.today() - 7) where day = pg_temp.today()), 900, 'atividade traz o tempo do dia');
select is((select questions from public.study_activity('c2000000-0000-4000-8000-000000000001', pg_temp.today() - 7) where day = pg_temp.today()), 2, 'atividade traz as questões do dia');
select is((select tasks_done from public.study_activity('c2000000-0000-4000-8000-000000000001', pg_temp.today() - 7) where day = pg_temp.today()), 1, 'atividade traz as tarefas concluídas no dia');
select is((select count(*) from public.study_activity('c2000000-0000-4000-8000-000000000001', pg_temp.today() - 7)), 1::bigint, 'o que veio antes de p_from fica de fora');
select is((select count(*) from public.study_activity('c2000000-0000-4000-8000-000000000001', pg_temp.today() - 60)), 2::bigint, 'dias anteriores aparecem separados');
select throws_ok($$insert into public.study_days (owner_id, day, seconds) values ('00000000-0000-4000-8000-0000000000ad', '2026-01-01', 10)$$, '42501', null, 'o estudante não grava o tempo direto');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000bd');
select is((select count(*) from public.study_days), 0::bigint, 'outro usuário não vê o tempo');
select is((select count(*) from public.study_activity('c2000000-0000-4000-8000-000000000001', pg_temp.today() - 60)), 0::bigint, 'outro usuário não vê a atividade');

select * from finish();
rollback;
