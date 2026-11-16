-- Versão das sessões em vigor: depois de reorganizar, continua sendo a versão em que o cronograma foi montado.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a9', 'psv-a@test.local'), ('00000000-0000-4000-8000-0000000000b9', 'psv-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values ('80000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a9', 'A', 'reviewed');
insert into public.notice_subjects (id, owner_id, notice_id, name) values ('81000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a9', '80000000-0000-4000-8000-000000000001', 'Penal');
insert into public.study_plans (id, owner_id, notice_id, name) values ('82000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a9', '80000000-0000-4000-8000-000000000001', 'P');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select is(public.plan_session_version('82000000-0000-4000-8000-000000000001'), null, 'plano sem versão: null');
reset role;

-- v1 e v2 montadas (com sessões); v3 reorganizada (sem sessões) e ativa.
insert into public.plan_versions (id, owner_id, plan_id, number, inputs, strategy, summary) values
  ('83000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a9', '82000000-0000-4000-8000-000000000001', 1, '{}', '{}', '{}'),
  ('83000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a9', '82000000-0000-4000-8000-000000000001', 2, '{}', '{}', '{}'),
  ('83000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a9', '82000000-0000-4000-8000-000000000001', 3, '{}', '{}', '{}');
insert into public.study_sessions (owner_id, plan_version_id, subject_id, position, title) values
  ('00000000-0000-4000-8000-0000000000a9', '83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 0, 'Velha'),
  ('00000000-0000-4000-8000-0000000000a9', '83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 0, 'Dolo');
update public.study_plans set active_version_id = '83000000-0000-4000-8000-000000000003' where id = '82000000-0000-4000-8000-000000000001';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select is(public.plan_session_version('82000000-0000-4000-8000-000000000001'), '83000000-0000-4000-8000-000000000002'::uuid, 'reorganizado: última versão com sessões');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b9');
select is(public.plan_session_version('82000000-0000-4000-8000-000000000001'), null, 'B não vê o plano de A');

reset role;
select * from finish();
rollback;
