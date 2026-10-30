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

-- Resposta pelo banco (answer_question): correção, caderno de erros, flashcard e revisão.
reset role;
insert into public.qbank_questions (qid, payload, gabarito, materia, assunto) values
  ('qa', '{"enunciado":"<p>Quanto é 2+2?</p>","alternativas":[{"letra":"A","texto":"3"},{"letra":"B","texto":"4"}]}', 'B', 'Matemática', 'Soma');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a4');
select is((select public.answer_question('qa', 'A') ->> 'correct'), 'false', 'errou: correção no banco');
select is((select stage from public.error_book where qid = 'qa'), 0, 'errada entra no caderno (etapa 0)');
select is((select due_on from public.error_book where qid = 'qa'), current_date + 1, 'volta amanhã');
select ok((select back like 'Resposta: B — 4%' from public.flashcards where ref = 'qa'), 'flashcard da errada com a resposta');
select is((select public.answer_question('qa', 'b', null, 'review') ->> 'correct'), 'true', 'acerto na revisão (minúscula aceita)');
select is((select stage from public.error_book where qid = 'qa'), 1, 'revisão boa avança para 7 dias');
select is((select due_on from public.error_book where qid = 'qa'), current_date + 7, 'próxima revisão em 7 dias');
select is((select count(*) from public.question_attempts where qid = 'qa'), 2::bigint, 'duas tentativas registradas');
select is((select context from public.question_attempts where qid = 'qa' and correct), 'review', 'contexto da revisão');
select throws_ok($$select public.record_answer_for('00000000-0000-4000-8000-0000000000a4', 'qa', 'B', 'free')$$, '42501', null, 'função interna não é chamável pelo usuário');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b4');
select throws_ok($$select public.answer_question('qa', 'B', '41000000-0000-4000-8000-000000000001')$$, 'P0002', null, 'B não responde pela tarefa de outro');

select * from finish();
rollback;
