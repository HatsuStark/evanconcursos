-- Excluir concurso: apaga o que é só dele, preserva o que é usado em outro lugar e não alcança outro usuário.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a5', 'del-a@test.local'), ('00000000-0000-4000-8000-0000000000b5', 'del-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A tem dois concursos completos; B tem um com o mesmo tipo de dado.
insert into public.notices (id, owner_id, title, status) values
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', 'Apagar', 'reviewed'),
  ('60000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a5', 'Manter', 'reviewed'),
  ('60000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b5', 'De B', 'reviewed');
insert into public.notice_subjects (id, owner_id, notice_id, name) values
  ('61000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', '60000000-0000-4000-8000-000000000001', 'Penal'),
  ('61000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a5', '60000000-0000-4000-8000-000000000002', 'Civil');
insert into public.notice_topics (owner_id, subject_id, text) values ('00000000-0000-4000-8000-0000000000a5', '61000000-0000-4000-8000-000000000001', 'Peculato');
insert into public.study_plans (id, owner_id, notice_id, name) values
  ('62000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', '60000000-0000-4000-8000-000000000001', 'P1'),
  ('62000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a5', '60000000-0000-4000-8000-000000000002', 'P2'),
  ('62000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b5', '60000000-0000-4000-8000-000000000003', 'P3');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values ('63000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', 1, '{}');
update public.study_plans set active_version_id = '63000000-0000-4000-8000-000000000001' where id = '62000000-0000-4000-8000-000000000001';
insert into public.study_sessions (id, owner_id, plan_version_id, subject_id, position, title) values
  ('64000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', '63000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 0, 'Peculato');
insert into public.tasks (id, owner_id, plan_id, date, kind, title, subject_id, session_id, created_in_version) values
  ('65000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', '2030-01-01', 'theory', 'Peculato', '61000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001');
insert into public.qbank_cursors (owner_id, scope, filter_key) values
  ('00000000-0000-4000-8000-0000000000a5', '64000000-0000-4000-8000-000000000001', 'f'),
  ('00000000-0000-4000-8000-0000000000a5', 'subject:61000000-0000-4000-8000-000000000001', 'f'),
  ('00000000-0000-4000-8000-0000000000a5', 'simulado', 'f');
insert into public.ai_jobs (owner_id, kind, input) values
  ('00000000-0000-4000-8000-0000000000a5', 'notice_extract', '{"noticeId":"60000000-0000-4000-8000-000000000001"}'),
  ('00000000-0000-4000-8000-0000000000a5', 'notice_extract', '{"noticeId":"60000000-0000-4000-8000-000000000002"}');
insert into public.simulados (id, owner_id, plan_id, title, config) values
  ('66000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', 'Do concurso', '{}'),
  ('66000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a5', null, 'Personalizado', '{}');

-- Questões: só do concurso (+ revisão), também em prática livre, também no outro concurso, em simulado do concurso
-- e em simulado personalizado. Anotada sem responder, e anotada no outro concurso.
insert into public.question_attempts (owner_id, plan_id, simulado_id, qid, chosen, correct, context) values
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', null, 'q-so', 'A', false, 'plan'),
  ('00000000-0000-4000-8000-0000000000a5', null, null, 'q-so', 'B', true, 'review'),
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', null, 'q-livre', 'A', false, 'plan'),
  ('00000000-0000-4000-8000-0000000000a5', null, null, 'q-livre', 'A', false, 'free'),
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', null, 'q-dois', 'A', false, 'plan'),
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000002', null, 'q-dois', 'A', false, 'plan'),
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001', 'q-sim', 'A', false, 'simulado'),
  ('00000000-0000-4000-8000-0000000000a5', null, '66000000-0000-4000-8000-000000000002', 'q-pers', 'A', false, 'simulado'),
  ('00000000-0000-4000-8000-0000000000b5', '62000000-0000-4000-8000-000000000003', null, 'q-so', 'A', false, 'plan');
insert into public.question_notes (owner_id, plan_id, qid, note) values
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', 'q-so', 'n'),
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', 'q-sem-resposta', 'n'),
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000001', 'q-livre', 'n'),
  ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000002', 'q-outra', 'n'),
  ('00000000-0000-4000-8000-0000000000b5', '62000000-0000-4000-8000-000000000003', 'q-so', 'n');
insert into public.error_book (owner_id, qid, due_on) values
  ('00000000-0000-4000-8000-0000000000a5', 'q-so', current_date),
  ('00000000-0000-4000-8000-0000000000a5', 'q-sim', current_date),
  ('00000000-0000-4000-8000-0000000000a5', 'q-livre', current_date),
  ('00000000-0000-4000-8000-0000000000b5', 'q-so', current_date);
insert into public.flashcards (owner_id, kind, ref, front, back) values
  ('00000000-0000-4000-8000-0000000000a5', 'question', 'q-so', 'f', 'b'),
  ('00000000-0000-4000-8000-0000000000a5', 'question', 'q-dois', 'f', 'b'),
  ('00000000-0000-4000-8000-0000000000b5', 'question', 'q-so', 'f', 'b');

-- Mnemônicos: um só da questão excluída, um dividido com questão mantida, um criado ao ver questão sem responder.
insert into public.mnemonics (id, concept, concept_key, mnemonic, model, prompt_version) values
  ('67000000-0000-4000-8000-000000000001', 'só', 'so', 'S', 'm', 'v'),
  ('67000000-0000-4000-8000-000000000002', 'dividido', 'dividido', 'D', 'm', 'v'),
  ('67000000-0000-4000-8000-000000000003', 'sem resposta', 'sem resposta', 'R', 'm', 'v');
insert into public.qbank_questions (qid, payload, gabarito, mnemonic_id) values
  ('q-so', '{}', 'B', '67000000-0000-4000-8000-000000000001'),
  ('q-sim', '{}', 'B', '67000000-0000-4000-8000-000000000002'),
  ('q-dois', '{}', 'B', '67000000-0000-4000-8000-000000000002');
insert into public.flashcards (owner_id, kind, ref, plan_id, front, back) values
  ('00000000-0000-4000-8000-0000000000a5', 'mnemonic', '67000000-0000-4000-8000-000000000001', null, 'f', 'b'),
  ('00000000-0000-4000-8000-0000000000a5', 'mnemonic', '67000000-0000-4000-8000-000000000002', null, 'f', 'b'),
  ('00000000-0000-4000-8000-0000000000a5', 'mnemonic', '67000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000001', 'f', 'b');

-- Marcações: uma lei citada só por este concurso e outra que fica.
insert into public.legal_norms (id, urn, name, source_url, content_url, version) values
  ('68000000-0000-4000-8000-000000000001', 'urn:teste:so', 'Só', 'x', 'x', 'Current'),
  ('68000000-0000-4000-8000-000000000002', 'urn:teste:outra', 'Outra', 'x', 'x', 'Current');
insert into public.legal_articles (id, norm_id, ord, label, num, text) values
  ('69000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 1, '1', 1, 't'),
  ('69000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000002', 1, '1', 1, 't');
insert into public.legal_marks (owner_id, article_id) values
  ('00000000-0000-4000-8000-0000000000a5', '69000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000a5', '69000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-0000000000b5', '69000000-0000-4000-8000-000000000001');

-- Dono da anotação: não pode apontar para o plano de outro usuário.
select throws_ok($$insert into public.question_notes (owner_id, plan_id, qid, note) values ('00000000-0000-4000-8000-0000000000a5', '62000000-0000-4000-8000-000000000003', 'x', 'n')$$, '23503', null, 'anotação não aponta para plano de outro usuário');

-- Permissões.
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b5');
select throws_ok($$select public.delete_notice('60000000-0000-4000-8000-000000000001')$$, 'P0002', null, 'B não exclui o concurso de A');
select is((select count(*) from public.notices), 1::bigint, 'B só vê o próprio concurso');
reset role;
select is((select count(*) from public.notices where id = '60000000-0000-4000-8000-000000000001'), 1::bigint, 'o concurso de A continua lá');

-- A exclui o primeiro concurso.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a5');
select lives_ok($$select public.delete_notice('60000000-0000-4000-8000-000000000001', array['urn:teste:so'])$$, 'A exclui o concurso');
reset role;

create function pg_temp.n(t text, w text) returns bigint language plpgsql as $$
declare c bigint;
begin execute format('select count(*) from public.%I where %s', t, w) into c; return c; end $$;

select is(pg_temp.n('notices', $$id = '60000000-0000-4000-8000-000000000001'$$), 0::bigint, 'edital apagado');
select is(pg_temp.n('notice_subjects', $$id = '61000000-0000-4000-8000-000000000001'$$), 0::bigint, 'matérias apagadas');
select is(pg_temp.n('notice_topics', $$owner_id = '00000000-0000-4000-8000-0000000000a5'$$), 0::bigint, 'tópicos apagados');
select is(pg_temp.n('study_plans', $$id = '62000000-0000-4000-8000-000000000001'$$), 0::bigint, 'plano apagado');
select is(pg_temp.n('tasks', $$owner_id = '00000000-0000-4000-8000-0000000000a5'$$), 0::bigint, 'tarefas apagadas');
select is(pg_temp.n('study_sessions', $$owner_id = '00000000-0000-4000-8000-0000000000a5'$$), 0::bigint, 'sessões apagadas');
select is(pg_temp.n('qbank_cursors', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and scope <> 'simulado'$$), 0::bigint, 'cursores da sessão e da matéria apagados');
select is(pg_temp.n('qbank_cursors', $$scope = 'simulado'$$), 1::bigint, 'cursor geral do simulado fica');
select is(pg_temp.n('ai_jobs', $$input->>'noticeId' = '60000000-0000-4000-8000-000000000001'$$), 0::bigint, 'job da leitura apagado');
select is(pg_temp.n('ai_jobs', $$input->>'noticeId' = '60000000-0000-4000-8000-000000000002'$$), 1::bigint, 'job do outro concurso fica');
select is(pg_temp.n('simulados', $$id = '66000000-0000-4000-8000-000000000001'$$), 0::bigint, 'simulado do concurso apagado');
select is(pg_temp.n('simulados', $$id = '66000000-0000-4000-8000-000000000002'$$), 1::bigint, 'simulado personalizado fica');

select is(pg_temp.n('question_attempts', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and qid in ('q-so', 'q-sim')$$), 0::bigint, 'tentativas do concurso e a revisão delas apagadas');
select is(pg_temp.n('question_attempts', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and qid = 'q-livre'$$), 1::bigint, 'só a tentativa livre fica');
select is(pg_temp.n('question_attempts', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and qid = 'q-dois'$$), 1::bigint, 'tentativa do outro concurso fica');
select is(pg_temp.n('question_attempts', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and qid = 'q-pers'$$), 1::bigint, 'tentativa do simulado personalizado fica');

select is(pg_temp.n('question_notes', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and qid in ('q-so', 'q-sem-resposta')$$), 0::bigint, 'anotações só deste concurso apagadas (mesmo sem resposta)');
select is(pg_temp.n('question_notes', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and qid = 'q-livre' and plan_id is null$$), 1::bigint, 'anotação de questão também usada fora fica, sem vínculo');
select is(pg_temp.n('question_notes', $$qid = 'q-outra'$$), 1::bigint, 'anotação do outro concurso fica');
select is(pg_temp.n('error_book', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and qid in ('q-so', 'q-sim')$$), 0::bigint, 'erros só deste concurso apagados');
select is(pg_temp.n('error_book', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and qid = 'q-livre'$$), 1::bigint, 'erro de questão também usada fora fica');
select is(pg_temp.n('flashcards', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and kind = 'question' and ref = 'q-so'$$), 0::bigint, 'flashcard da questão apagado');
select is(pg_temp.n('flashcards', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and kind = 'question' and ref = 'q-dois'$$), 1::bigint, 'flashcard de questão do outro concurso fica');
select is(pg_temp.n('flashcards', $$kind = 'mnemonic' and ref = '67000000-0000-4000-8000-000000000001'$$), 0::bigint, 'cartão de mnemônico só deste concurso apagado');
select is(pg_temp.n('flashcards', $$kind = 'mnemonic' and ref = '67000000-0000-4000-8000-000000000002'$$), 1::bigint, 'cartão de mnemônico dividido fica');
select is(pg_temp.n('flashcards', $$kind = 'mnemonic' and ref = '67000000-0000-4000-8000-000000000003'$$), 0::bigint, 'cartão criado em questão não respondida apagado');
select is(pg_temp.n('mnemonics', $$id = '67000000-0000-4000-8000-000000000001'$$), 1::bigint, 'o mnemônico compartilhado continua no catálogo');
select is(pg_temp.n('legal_marks', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and article_id = '69000000-0000-4000-8000-000000000001'$$), 0::bigint, 'marcação da lei só deste concurso apagada');
select is(pg_temp.n('legal_marks', $$owner_id = '00000000-0000-4000-8000-0000000000a5' and article_id = '69000000-0000-4000-8000-000000000002'$$), 1::bigint, 'marcação de outra lei fica');

-- O outro concurso de A e todos os dados de B seguem intactos.
select is(pg_temp.n('notices', $$id = '60000000-0000-4000-8000-000000000002'$$), 1::bigint, 'o outro concurso de A fica');
select is(pg_temp.n('notices', $$id = '60000000-0000-4000-8000-000000000003'$$), 1::bigint, 'concurso de B intacto');
select is(pg_temp.n('question_attempts', $$owner_id = '00000000-0000-4000-8000-0000000000b5'$$), 1::bigint, 'tentativa de B intacta');
select is(pg_temp.n('question_notes', $$owner_id = '00000000-0000-4000-8000-0000000000b5'$$), 1::bigint, 'anotação de B intacta');
select is(pg_temp.n('error_book', $$owner_id = '00000000-0000-4000-8000-0000000000b5'$$), 1::bigint, 'erro de B intacto');
select is(pg_temp.n('flashcards', $$owner_id = '00000000-0000-4000-8000-0000000000b5'$$), 1::bigint, 'flashcard de B intacto');
select is(pg_temp.n('legal_marks', $$owner_id = '00000000-0000-4000-8000-0000000000b5'$$), 1::bigint, 'marcação de B intacta');

select * from finish();
rollback;
