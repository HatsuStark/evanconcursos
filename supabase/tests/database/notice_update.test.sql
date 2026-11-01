-- Novo edital: passa o estudo para o plano novo sem perder histórico e sem alcançar dados de outro usuário.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ad', 'upd-a@test.local'), ('00000000-0000-4000-8000-0000000000bd', 'upd-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad');
insert into public.notices (id, title) values ('d0000000-0000-4000-8000-000000000001', 'TJ 2023'), ('d0000000-0000-4000-8000-000000000002', 'TJ 2025');
select public.approve_notice('d0000000-0000-4000-8000-000000000001', null, '{"title":"TJ 2023","examDate":"2023-05-28","subjects":[{"name":"Penal","topics":[{"text":"Dolo"}]},{"name":"Civil","topics":[{"text":"Posse"}]}]}');
select public.approve_notice('d0000000-0000-4000-8000-000000000002', null, '{"title":"TJ 2025","examDate":"2030-03-14","subjects":[{"name":"Direito Penal","topics":[{"text":"Dolo"}]}]}');
create temp table ids as select
  (select id from public.notice_subjects where name = 'Penal') as old_penal, (select id from public.notice_subjects where name = 'Civil') as old_civil,
  (select id from public.notice_subjects where name = 'Direito Penal') as new_penal;
grant select on ids to authenticated;
select public.create_plan_version('d0000000-0000-4000-8000-000000000001', jsonb_build_object('name', 'Velho', 'inputs', '{}'::jsonb, 'tasks', '[{"date":"2023-01-01","kind":"theory","title":"Dolo"}]'::jsonb));
insert into public.materials (plan_id, title, storage_path, sha256, size_bytes)
  select id, 'Apostila', '00000000-0000-4000-8000-0000000000ad/m/u.pdf', repeat('c', 64), 10 from public.study_plans;

select throws_ok($$select public.adopt_notice_update('d0000000-0000-4000-8000-000000000002', '{}')$$, 'P0002', null, 'edital não ligado a outro é recusado');
update public.notices set replaces_notice_id = 'd0000000-0000-4000-8000-000000000001' where id = 'd0000000-0000-4000-8000-000000000002';
select throws_ok($$select public.adopt_notice_update('d0000000-0000-4000-8000-000000000002', '{}')$$, 'P0002', null, 'sem plano novo é recusado');
select public.create_plan_version('d0000000-0000-4000-8000-000000000002', jsonb_build_object('name', 'Novo', 'inputs', '{}'::jsonb, 'tasks', '[{"date":"2030-01-01","kind":"theory","title":"Dolo"}]'::jsonb));

-- Desempenho do plano antigo (gravado pelo backend).
reset role;
insert into public.question_attempts (owner_id, plan_id, subject_id, qid, chosen, correct, context)
  select '00000000-0000-4000-8000-0000000000ad', p.id, x.subject, 'q' || x.subject, 'A', true, 'plan' from public.study_plans p, (select old_penal as subject from ids union all select old_civil from ids) x where p.name = 'Velho';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bd');

-- B não mexe no edital de A.
select throws_ok($$select public.adopt_notice_update('d0000000-0000-4000-8000-000000000002', '{}')$$, 'P0002', null, 'B não adota o edital de A');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad');
select throws_ok(format($$select public.adopt_notice_update('d0000000-0000-4000-8000-000000000002', %L)$$, jsonb_build_object((select new_penal from ids), (select old_penal from ids))), '22023', null, 'equivalência invertida é recusada');
select is(public.adopt_notice_update('d0000000-0000-4000-8000-000000000002', jsonb_build_object((select old_penal from ids), (select new_penal from ids))), 1, 'leva a apostila');
select is((select plan_id from public.materials), (select id from public.study_plans where name = 'Novo'), 'apostila no plano novo');
select is((select status from public.materials), 'uploaded', 'apostila espera novo mapeamento');
select is((select status from public.study_plans where name = 'Velho'), 'archived', 'plano antigo arquivado');
select is((select status from public.notices where id = 'd0000000-0000-4000-8000-000000000001'), 'archived', 'edital antigo arquivado');
select is((select count(*) from public.tasks where title = 'Dolo' and date = '2023-01-01'), 1::bigint, 'histórico do plano antigo fica');
select is((select subject_id from public.question_attempts where qid = 'q' || (select old_penal from ids)), (select new_penal from ids), 'desempenho vai para a matéria nova');
select is((select plan_id from public.question_attempts where qid = 'q' || (select old_penal from ids)), (select id from public.study_plans where name = 'Novo'), 'desempenho no plano novo');
select is((select subject_id from public.question_attempts where qid = 'q' || (select old_civil from ids)), (select old_civil from ids), 'matéria sem equivalente fica no plano antigo');
select is(public.adopt_notice_update('d0000000-0000-4000-8000-000000000002', '{}'), 0, 'repetir não muda nada');

select * from finish();
rollback;
