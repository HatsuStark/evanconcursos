-- Aprendizado adaptativo: o dia de aprofundamento vai para a sessão em que o estudante mais erra; a revisão de teoria
-- segue o acerto; a questão de aquecimento conta para a sessão anterior.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ad', 'adapt-a@test.local'), ('00000000-0000-4000-8000-0000000000bd', 'adapt-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'Concurso', 'reviewed');
insert into public.notice_subjects (id, owner_id, notice_id, name) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'a0000000-0000-4000-8000-000000000001', 'Penal');
insert into public.study_plans (id, owner_id, notice_id, name) values ('a2000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'a0000000-0000-4000-8000-000000000001', 'P1');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values ('a3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'a2000000-0000-4000-8000-000000000001', 1, '{}');
update public.study_plans set active_version_id = 'a3000000-0000-4000-8000-000000000001' where id = 'a2000000-0000-4000-8000-000000000001';
-- S1 Peculato (acerta tudo), S2 Concussão (erra muito), S3 Corrupção (não estudada), D1 e D2 aprofundamentos planejados.
insert into public.study_sessions (id, owner_id, plan_version_id, subject_id, position, title, keyword, incidence) values
  ('a4000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 0, 'Peculato: CP, art. 312', 'peculato', 2),
  ('a4000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ad', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 1, 'Concussão: CP, art. 316', 'concussão', 2),
  ('a4000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ad', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 2, 'Corrupção: CP, art. 317', 'corrupção', 3),
  ('a4000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000ad', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 3, 'Aprofundamento: Peculato: CP, art. 312', 'peculato', 3),
  ('a4000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000ad', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 4, 'Aprofundamento: Corrupção: CP, art. 317', 'corrupção', 3);
insert into public.tasks (id, owner_id, plan_id, date, position, kind, title, subject_id, session_id, created_in_version) values
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ad', 'a2000000-0000-4000-8000-000000000001', current_date - 5, 0, 'theory', 'Peculato: CP, art. 312', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ad', 'a2000000-0000-4000-8000-000000000001', current_date - 4, 0, 'theory', 'Concussão: CP, art. 316', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ad', 'a2000000-0000-4000-8000-000000000001', current_date + 3, 0, 'theory', 'Corrupção: CP, art. 317', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000ad', 'a2000000-0000-4000-8000-000000000001', current_date - 1, 0, 'theory', 'Aprofundamento: Peculato: CP, art. 312', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000ad', 'a2000000-0000-4000-8000-000000000001', current_date + 1, 0, 'theory', 'Aprofundamento: Corrupção: CP, art. 317', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000001');
insert into public.question_attempts (owner_id, plan_id, session_id, subject_id, qid, chosen, correct, context)
select '00000000-0000-4000-8000-0000000000ad', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'ad-p' || g, 'A', true, 'plan' from generate_series(1, 10) g;
insert into public.question_attempts (owner_id, plan_id, session_id, subject_id, qid, chosen, correct, context)
select '00000000-0000-4000-8000-0000000000ad', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'ad-c' || g, 'A', g <= 3, 'plan' from generate_series(1, 10) g;
update public.tasks set done_at = now() where id in ('a5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000002');

select is((select due_on from public.theory_reviews where session_id = 'a4000000-0000-4000-8000-000000000001'), (now() at time zone 'America/Sao_Paulo')::date + 2, 'acerto alto: 1ª revisão em 2 dias');
select is((select due_on from public.theory_reviews where session_id = 'a4000000-0000-4000-8000-000000000002'), (now() at time zone 'America/Sao_Paulo')::date + 1, 'acerto baixo: 1ª revisão amanhã');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000bd');
select is(public.bind_adaptive_sessions('a2000000-0000-4000-8000-000000000001'), 0, 'outro usuário não decide o plano de A');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad');
select is(public.bind_adaptive_sessions('a2000000-0000-4000-8000-000000000001'), 1, 'só o dia que chegou é decidido');
select is((select title from public.tasks where id = 'a5000000-0000-4000-8000-000000000004'), 'Aprofundamento: Concussão: CP, art. 316', 'vai para a sessão em que mais erra, não a planejada');
select is((select source_session_id from public.study_sessions where id = 'a4000000-0000-4000-8000-000000000004'), 'a4000000-0000-4000-8000-000000000002'::uuid, 'guarda a sessão de origem');
select is((select title from public.tasks where id = 'a5000000-0000-4000-8000-000000000005'), 'Aprofundamento: Corrupção: CP, art. 317', 'dia futuro fica como planejado');
select is(public.bind_adaptive_sessions('a2000000-0000-4000-8000-000000000001'), 0, 'dia já decidido não muda');

-- Aquecimento: questão respondida na tarefa de Corrupção conta para Peculato.
reset role;
insert into public.qbank_questions (qid, payload, gabarito) values ('ad-w1', '{"enunciado": "E", "alternativas": []}', 'A');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad');
select lives_ok($$select public.answer_question('ad-w1', 'A', 'a5000000-0000-4000-8000-000000000003', 'plan', 'a4000000-0000-4000-8000-000000000001')$$, 'responde o aquecimento');
select is((select session_id from public.question_attempts where qid = 'ad-w1'), 'a4000000-0000-4000-8000-000000000001'::uuid, 'aquecimento conta para a sessão anterior');

select * from finish();
rollback;
