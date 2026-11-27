-- Dicas em graus: o grau aberto é gravado pelo backend, vai para a tentativa e decide o caderno de erros.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a9', 'hint-a@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
insert into public.qbank_questions (qid, payload, gabarito, materia, assunto) values
  ('h1', '{"enunciado":"E","alternativas":[{"letra":"A","texto":"1"},{"letra":"B","texto":"2"},{"letra":"C","texto":"3"}]}', 'B', 'M', 'S'),
  ('h2', '{"enunciado":"E","alternativas":[{"letra":"A","texto":"1"},{"letra":"B","texto":"2"}]}', 'B', 'M', 'S'),
  ('h3', '{"enunciado":"E","alternativas":[{"letra":"A","texto":"1"},{"letra":"B","texto":"2"}]}', 'B', 'M', 'S'),
  ('h4', '{"enunciado":"E","alternativas":[{"letra":"A","texto":"1"},{"letra":"B","texto":"2"}]}', 'B', 'M', 'S');

-- Só o backend registra o uso.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select throws_ok($$select public.note_hint_use('00000000-0000-4000-8000-0000000000a9', 'h1', 3)$$, '42501', null, 'estudante não grava o próprio uso de dica');
select throws_ok($$select count(*) from public.question_hint_uses$$, '42501', null, 'uso de dica não é lido pelo estudante');
reset role;

-- Grau 1: acerto entra no caderno na etapa 1 (7 dias). O grau só sobe.
select public.note_hint_use('00000000-0000-4000-8000-0000000000a9', 'h1', 1);
select public.note_hint_use('00000000-0000-4000-8000-0000000000a9', 'h2', 2);
select public.note_hint_use('00000000-0000-4000-8000-0000000000a9', 'h2', 1);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select is((select public.answer_question('h1', 'B') ->> 'hint'), '1', 'resposta devolve o grau usado');
select is((select hint_level from public.question_attempts where qid = 'h1'), 1::smallint, 'grau gravado na tentativa');
select is((select stage from public.error_book where qid = 'h1'), 1, 'acerto com dica grau 1 entra na etapa 1');
select is((select due_on from public.error_book where qid = 'h1'), current_date + 7, 'volta em 7 dias');
select is((select hinted from public.error_book where qid = 'h1'), true, 'marcado como acerto com dica');
select is((select wrong_count from public.error_book where qid = 'h1'), 0, 'não conta como erro');

-- Grau 2: volta amanhã, como um erro. O uso é consumido: a resposta seguinte vem sem dica.
select is((select public.answer_question('h2', 'B') ->> 'hint'), '2', 'grau não desce');
select is((select stage from public.error_book where qid = 'h2'), 0, 'grau 2 entra na etapa 0');
select is((select due_on from public.error_book where qid = 'h2'), current_date + 1, 'volta amanhã');
select is((select public.answer_question('h3', 'B') ->> 'hint'), '0', 'sem dica');
select is((select count(*) from public.error_book where qid = 'h3'), 0::bigint, 'acerto sem dica fora da revisão não entra no caderno');

-- Revisão: acerto com dica não avança; acerto sem dica avança.
reset role;
select public.note_hint_use('00000000-0000-4000-8000-0000000000a9', 'h1', 1);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select public.answer_question('h1', 'B', null, 'review');
select is((select stage from public.error_book where qid = 'h1'), 1, 'acerto com dica na revisão fica na etapa');
select is((select due_on from public.error_book where qid = 'h1'), current_date + 7, 'repete o intervalo da etapa');
select public.answer_question('h1', 'B', null, 'review');
select is((select stage from public.error_book where qid = 'h1'), 2, 'acerto sem dica avança');

-- Erro com dica: entra como erro e desmarca o acerto com dica.
reset role;
select public.note_hint_use('00000000-0000-4000-8000-0000000000a9', 'h2', 3);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select public.answer_question('h2', 'A');
select is((select hint_level from public.question_attempts where qid = 'h2' and not correct), 3::smallint, 'erro guarda o grau');
select is((select hinted from public.error_book where qid = 'h2'), false, 'erro com dica é erro');
select is((select wrong_count from public.error_book where qid = 'h2'), 1, 'conta o erro');

-- Uso velho (mais de 12 h) não conta.
reset role;
insert into public.question_hint_uses (owner_id, qid, level, updated_at) values ('00000000-0000-4000-8000-0000000000a9', 'h4', 3, now() - interval '13 hours');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select is((select public.answer_question('h4', 'B') ->> 'hint'), '0', 'uso de dica velho é ignorado');
reset role;
select is((select count(*) from public.question_hint_uses where owner_id = '00000000-0000-4000-8000-0000000000a9'), 0::bigint, 'usos consumidos');

select * from finish();
rollback;
