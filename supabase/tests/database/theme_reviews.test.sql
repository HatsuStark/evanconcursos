-- Tema em partes: a revisão espaçada conta o tema inteiro, aberta ao concluir a última parte.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ad', 'theme-a@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

select is((select row(head, part, parts)::text from public.session_part('Atos processuais (parte 2 de 3): NSCGJ, arts. 310 a 315')), '("atos processuais",2,3)', 'lê a parte do título');
select is((select count(*) from public.session_part('Aprofundamento: Atos (parte 1 de 2)')), 0::bigint, 'aprofundamento não é parte');
select is((select count(*) from public.session_part('Dolo')), 0::bigint, 'tema inteiro não é parte');

insert into public.notices (id, owner_id, title, status, exam_date) values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'Sem data', 'reviewed', null);
insert into public.notice_subjects (id, owner_id, notice_id, name) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'c0000000-0000-4000-8000-000000000001', 'Normas');
insert into public.study_plans (id, owner_id, notice_id, name) values
  ('c2000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'c0000000-0000-4000-8000-000000000001', 'P');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values
  ('c3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', 1, '{}');
insert into public.study_sessions (id, owner_id, plan_version_id, subject_id, position, title) values
  ('c4000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 0, 'Atos (parte 1 de 2): NSCGJ, arts. 196 a 315'),
  ('c4000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ad', 'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 1, 'Atos (parte 2 de 2): NSCGJ, arts. 410 a 440-A'),
  ('c4000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ad', 'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 2, 'Juizados');
insert into public.tasks (id, owner_id, plan_id, date, kind, title, subject_id, session_id, created_in_version) values
  ('c5000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', pg_temp.today(), 'theory', 'Atos (parte 1 de 2)', 'c1000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', pg_temp.today() + 2, 'theory', 'Atos (parte 2 de 2)', 'c1000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ad', 'c2000000-0000-4000-8000-000000000001', pg_temp.today(), 'theory', 'Juizados', 'c1000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000001');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad');
update public.tasks set done_at = now() where id = 'c5000000-0000-4000-8000-000000000003';
select is((select due_on from public.theory_reviews where task_id = 'c5000000-0000-4000-8000-000000000003'), pg_temp.today() + 1, 'tema inteiro: revisão amanhã');

update public.tasks set done_at = now() where id = 'c5000000-0000-4000-8000-000000000001';
select is((select due_on from public.theory_reviews where task_id = 'c5000000-0000-4000-8000-000000000001'), pg_temp.today() + 3, 'parte 1: revisão adiada para o dia seguinte à última parte');

update public.tasks set done_at = now() where id = 'c5000000-0000-4000-8000-000000000002';
select is((select count(*) from public.theory_reviews where task_id = 'c5000000-0000-4000-8000-000000000001'), 0::bigint, 'última parte: some a revisão da parte 1');
select is((select due_on from public.theory_reviews where task_id = 'c5000000-0000-4000-8000-000000000002'), pg_temp.today() + 1, 'última parte: revisão do tema amanhã');

update public.tasks set done_at = null where id = 'c5000000-0000-4000-8000-000000000001';
update public.tasks set done_at = now() where id = 'c5000000-0000-4000-8000-000000000001';
select is((select count(*) from public.theory_reviews where task_id = 'c5000000-0000-4000-8000-000000000001'), 0::bigint, 'parte refeita com a revisão do tema aberta: não duplica');

update public.tasks set done_at = null where id = 'c5000000-0000-4000-8000-000000000002';
select is((select count(*) from public.theory_reviews where task_id = 'c5000000-0000-4000-8000-000000000002'), 0::bigint, 'desfazer a última parte apaga a revisão do tema');
select is((select due_on from public.theory_reviews where task_id = 'c5000000-0000-4000-8000-000000000001'), pg_temp.today() + 3, 'e devolve a revisão adiada da parte 1');

select * from finish();
rollback;
