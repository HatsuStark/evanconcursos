-- Prática: caderno de erros, flashcards e simulados isolados; correção e criação só pelo backend.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a4', 'pr-a@test.local'), ('00000000-0000-4000-8000-0000000000b4', 'pr-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Backend: erro, flashcard, simulado em andamento e um entregue, tentativa livre sem plano.
insert into public.error_book (owner_id, qid, due_on) values ('00000000-0000-4000-8000-0000000000a4', 'q1', current_date);
insert into public.flashcards (owner_id, kind, ref, front, back) values ('00000000-0000-4000-8000-0000000000a4', 'question', 'q1', 'f', 'b');
insert into public.simulados (id, owner_id, title, config) values
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a4', 'S1', '{}'),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a4', 'S2', '{}');
update public.simulados set status = 'finished' where id = '50000000-0000-4000-8000-000000000002';
insert into public.question_attempts (owner_id, qid, chosen, correct, context) values ('00000000-0000-4000-8000-0000000000a4', 'q9', 'A', true, 'free');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a4');
select is((select count(*) from public.error_book), 1::bigint, 'A vê o caderno de erros');
select throws_ok($$update public.error_book set resolved = true$$, '42501', null, 'caderno de erros é atualizado só pelo backend');
select lives_ok($$update public.flashcards set box = 3, due_on = current_date + 4$$, 'A revisa flashcard (caixa e data)');
select throws_ok($$update public.flashcards set back = 'x'$$, '42501', null, 'conteúdo do flashcard não é editável');
select lives_ok($$insert into public.simulado_answers (simulado_id, qid, chosen) values ('50000000-0000-4000-8000-000000000001', 'q1', 'B')$$, 'A responde simulado em andamento');
select throws_ok($$insert into public.simulado_answers (simulado_id, qid, chosen) values ('50000000-0000-4000-8000-000000000002', 'q1', 'B')$$, '42501', null, 'simulado entregue não aceita resposta');
select throws_ok($$update public.simulados set result = '{}'$$, '42501', null, 'resultado do simulado é do backend');
select is((select count(*) from public.question_attempts where context = 'free'), 1::bigint, 'tentativa livre (sem plano) visível ao dono');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b4');
select is((select count(*) from public.error_book), 0::bigint, 'B não vê erros de A');
select is((select count(*) from public.flashcards), 0::bigint, 'B não vê flashcards de A');
select is((select count(*) from public.simulados), 0::bigint, 'B não vê simulados de A');
select throws_ok($$insert into public.simulado_answers (simulado_id, qid, chosen) values ('50000000-0000-4000-8000-000000000001', 'q2', 'C')$$, '42501', null, 'B não responde simulado de A');

select * from finish();
rollback;
