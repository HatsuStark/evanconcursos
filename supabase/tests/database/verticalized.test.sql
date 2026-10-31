-- Edital verticalizado: soma as questões por sessão e não mostra as de outro usuário.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ab', 'vert-a@test.local'), ('00000000-0000-4000-8000-0000000000bb', 'vert-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'Concurso A', 'reviewed'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ab', 'Outro concurso de A', 'reviewed');
insert into public.notice_subjects (id, owner_id, notice_id, name) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001', 'Penal'),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000002', 'Civil');
insert into public.study_plans (id, owner_id, notice_id, name) values
  ('a2000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001', 'P'),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000002', 'P2');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values
  ('a3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'a2000000-0000-4000-8000-000000000001', 1, '{}'),
  ('a3000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ab', 'a2000000-0000-4000-8000-000000000002', 1, '{}');
insert into public.study_sessions (id, owner_id, plan_version_id, subject_id, position, title) values
  ('a4000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 1, 'Peculato'),
  ('a4000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ab', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 1, 'Contratos');
insert into public.question_attempts (owner_id, plan_id, session_id, subject_id, qid, chosen, correct, created_at) values
  ('00000000-0000-4000-8000-0000000000ab', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'q1', 'A', true, '2026-10-01'),
  ('00000000-0000-4000-8000-0000000000ab', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'q2', 'B', false, '2026-10-05'),
  ('00000000-0000-4000-8000-0000000000ab', 'a2000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'q3', 'A', true, '2026-10-05'),
  ('00000000-0000-4000-8000-0000000000ab', null, null, null, 'q4', 'A', true, '2026-10-06');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ab');
select results_eq(
  $$select session_id, total, correct, last_at from public.session_attempt_stats('a0000000-0000-4000-8000-000000000001')$$,
  $$values ('a4000000-0000-4000-8000-000000000001'::uuid, 2, 1, '2026-10-05'::timestamptz)$$,
  'soma por sessão, só deste concurso e sem as questões livres');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb');
select is((select count(*) from public.session_attempt_stats('a0000000-0000-4000-8000-000000000001')), 0::bigint, 'outro usuário não vê as somas');

select set_config('role', 'anon', true);
select throws_ok($$select * from public.session_attempt_stats('a0000000-0000-4000-8000-000000000001')$$, '42501', null, 'sem login não executa');

select * from finish();
rollback;
