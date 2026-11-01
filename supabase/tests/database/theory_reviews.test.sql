-- Revisão de teoria: agenda ao concluir, avança pelo resultado, respeita a prova e isola os usuários.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ac', 'rev-a@test.local'), ('00000000-0000-4000-8000-0000000000bc', 'rev-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
-- Deixa a revisão vencida hoje, como se o intervalo tivesse passado.
create function pg_temp.make_due(p_task uuid) returns void language sql as $$ update public.theory_reviews set due_on = pg_temp.today() where task_id = p_task $$;

insert into public.notices (id, owner_id, title, status, exam_date) values
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ac', 'Sem data', 'reviewed', null),
  ('b0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ac', 'Prova perto', 'reviewed', pg_temp.today() + 5),
  ('b0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ac', 'Prova amanhã', 'reviewed', pg_temp.today() + 1),
  ('b0000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000ac', 'Prova realizada', 'reviewed', pg_temp.today() - 30),
  ('b0000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000ac', 'Prova hoje', 'reviewed', pg_temp.today());
insert into public.notice_subjects (id, owner_id, notice_id, name) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000001', 'Penal'),
  ('b1000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000002', 'Penal'),
  ('b1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000003', 'Penal'),
  ('b1000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000004', 'Penal'),
  ('b1000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000005', 'Penal');
insert into public.study_plans (id, owner_id, notice_id, name) values
  ('b2000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000001', 'P1'),
  ('b2000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000002', 'P2'),
  ('b2000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000003', 'P3'),
  ('b2000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000004', 'P4'),
  ('b2000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000005', 'P5');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values
  ('b3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000001', 1, '{}'),
  ('b3000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000002', 1, '{}'),
  ('b3000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000003', 1, '{}'),
  ('b3000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000004', 1, '{}'),
  ('b3000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000005', 1, '{}');
insert into public.study_sessions (id, owner_id, plan_version_id, subject_id, position, title) values
  ('b4000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ac', 'b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 1, 'Dolo'),
  ('b4000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ac', 'b3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 1, 'Culpa'),
  ('b4000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ac', 'b3000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 1, 'Erro'),
  ('b4000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000ac', 'b3000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004', 1, 'Tentativa'),
  ('b4000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000ac', 'b3000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000005', 1, 'Concurso');
insert into public.tasks (id, owner_id, plan_id, date, kind, title, subject_id, session_id, created_in_version) values
  ('b5000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000001', '2026-01-01', 'theory', 'Dolo', 'b1000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000002', '2026-01-01', 'theory', 'Culpa', 'b1000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002'),
  ('b5000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000003', '2026-01-01', 'theory', 'Erro', 'b1000000-0000-4000-8000-000000000003', 'b4000000-0000-4000-8000-000000000003', 'b3000000-0000-4000-8000-000000000003'),
  ('b5000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000001', '2026-01-02', 'weekly_review', 'Revisão da semana', 'b1000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000004', '2026-01-01', 'theory', 'Tentativa', 'b1000000-0000-4000-8000-000000000004', 'b4000000-0000-4000-8000-000000000004', 'b3000000-0000-4000-8000-000000000004'),
  ('b5000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000ac', 'b2000000-0000-4000-8000-000000000005', '2026-01-01', 'theory', 'Concurso', 'b1000000-0000-4000-8000-000000000005', 'b4000000-0000-4000-8000-000000000005', 'b3000000-0000-4000-8000-000000000005');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');

-- Agendar e desfazer
update public.tasks set done_at = now() where id = 'b5000000-0000-4000-8000-000000000004';
select is((select count(*) from public.theory_reviews), 0::bigint, 'só tarefa de teoria agenda revisão');
update public.tasks set done_at = now() where id = 'b5000000-0000-4000-8000-000000000001';
select is((select due_on from public.theory_reviews where task_id = 'b5000000-0000-4000-8000-000000000001'), pg_temp.today() + 1, 'concluir agenda para amanhã');
update public.tasks set done_at = null where id = 'b5000000-0000-4000-8000-000000000001';
select is((select count(*) from public.theory_reviews), 0::bigint, 'desfazer apaga a revisão não feita');
update public.tasks set done_at = now() where id = 'b5000000-0000-4000-8000-000000000001';

-- Só o backend grava; não adianta responder antes da hora
select throws_ok($$update public.theory_reviews set stage = 3$$, '42501', null, 'estudante não altera direto');
select throws_ok($$select public.theory_review_due('b2000000-0000-4000-8000-000000000001', 1)$$, '42501', null, 'função interna não é pública');
select throws_ok($$select public.theory_review_answer((select id from public.theory_reviews limit 1), 'lembrei')$$, 'P0001', null, 'não responde antes da data');

-- Avançar, repetir e voltar
reset role;
select pg_temp.make_due('b5000000-0000-4000-8000-000000000001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');
select throws_ok($$select public.theory_review_answer((select id from public.theory_reviews limit 1), 'talvez')$$, '22023', null, 'resultado inválido é recusado');
select is(public.theory_review_answer((select id from public.theory_reviews limit 1), 'lembrei'), pg_temp.today() + 7, 'lembrei: etapa 2, em 7 dias');
select is((select stage from public.theory_reviews), 2, 'avançou para a etapa 2');
reset role; select pg_temp.make_due('b5000000-0000-4000-8000-000000000001'); select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');
select is(public.theory_review_answer((select id from public.theory_reviews limit 1), 'parcial'), pg_temp.today() + 7, 'parcial: repete 7 dias');
select is((select stage from public.theory_reviews), 2, 'parcial não avança');
reset role; select pg_temp.make_due('b5000000-0000-4000-8000-000000000001'); select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');
select is(public.theory_review_answer((select id from public.theory_reviews limit 1), 'esqueci'), pg_temp.today() + 1, 'esqueci: volta para 1 dia');
select is((select stage from public.theory_reviews), 1, 'esqueci volta à etapa 1');
update public.tasks set done_at = null where id = 'b5000000-0000-4000-8000-000000000001';
select is((select count(*) from public.theory_reviews), 1::bigint, 'desfazer não apaga revisão já feita');

-- Encerrar
reset role; update public.theory_reviews set stage = 3, due_on = pg_temp.today(); select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');
select is(public.theory_review_answer((select id from public.theory_reviews limit 1), 'lembrei'), null::date, 'lembrei na etapa 3 encerra');
select is((select status from public.theory_reviews), 'done', 'tema encerrado');
select throws_ok($$select public.theory_review_answer((select id from public.theory_reviews limit 1), 'lembrei')$$, 'P0001', null, 'tema encerrado não responde de novo');

-- Prova perto
update public.tasks set done_at = now() where id = 'b5000000-0000-4000-8000-000000000002';
reset role; select pg_temp.make_due('b5000000-0000-4000-8000-000000000002'); select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');
select is(public.theory_review_answer((select id from public.theory_reviews where task_id = 'b5000000-0000-4000-8000-000000000002'), 'lembrei'), pg_temp.today() + 4, 'perto da prova, antecipa para a véspera');
update public.tasks set done_at = now() where id = 'b5000000-0000-4000-8000-000000000003';
select is((select count(*) from public.theory_reviews where task_id = 'b5000000-0000-4000-8000-000000000003'), 0::bigint, 'na véspera da prova não agenda');
update public.tasks set done_at = now() where id = 'b5000000-0000-4000-8000-000000000006';
select is((select count(*) from public.theory_reviews where task_id = 'b5000000-0000-4000-8000-000000000006'), 0::bigint, 'no dia da prova não agenda');

-- Plano sem prazo: prova já realizada não bloqueia a revisão.
update public.tasks set done_at = now() where id = 'b5000000-0000-4000-8000-000000000005';
select is((select due_on from public.theory_reviews where task_id = 'b5000000-0000-4000-8000-000000000005'), pg_temp.today() + 1, 'prova já realizada: agenda para amanhã');
reset role; select pg_temp.make_due('b5000000-0000-4000-8000-000000000005'); select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');
select is(public.theory_review_answer((select id from public.theory_reviews where task_id = 'b5000000-0000-4000-8000-000000000005'), 'lembrei'), pg_temp.today() + 7, 'prova já realizada: segue os intervalos normais');

-- Isolamento e exclusão
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bc');
select is((select count(*) from public.theory_reviews), 0::bigint, 'outro usuário não vê');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');
create temp table pg_temp.ids as select id from public.theory_reviews where task_id = 'b5000000-0000-4000-8000-000000000002';
grant select on pg_temp.ids to authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bc');
select throws_ok($$select public.theory_review_answer((select id from pg_temp.ids), 'lembrei')$$, 'P0002', null, 'outro usuário não responde');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ac');
select lives_ok($$select public.delete_notice('b0000000-0000-4000-8000-000000000002')$$, 'excluir o concurso funciona');
select is((select count(*) from public.theory_reviews where task_id = 'b5000000-0000-4000-8000-000000000002'), 0::bigint, 'excluir o concurso apaga as revisões');

select * from finish();
rollback;
