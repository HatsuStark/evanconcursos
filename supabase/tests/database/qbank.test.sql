-- Banco de questões: gabarito e cache só no servidor; tentativas e mapeamentos isolados por usuário.
begin;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a3', 'qb-a@test.local'),
  ('00000000-0000-4000-8000-0000000000b3', 'qb-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Backend: questão com gabarito, plano de A e uma tentativa de A.
insert into public.qbank_questions (qid, payload, gabarito) values ('q1', '{"enunciado":"x"}', 'C');
insert into public.qbank_assunto_lists (materia, assuntos) values ('Direito Penal', '{Peculato}');
insert into public.notices (id, owner_id, title, status) values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', 'E', 'reviewed');
insert into public.study_plans (id, owner_id, notice_id) values ('41000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', '40000000-0000-4000-8000-000000000001');
insert into public.question_attempts (owner_id, plan_id, qid, chosen, correct) values ('00000000-0000-4000-8000-0000000000a3', '41000000-0000-4000-8000-000000000001', 'q1', 'A', false);

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
select throws_ok($$select gabarito from public.qbank_questions$$, '42501', null, 'gabarito inacessível ao usuário');
select throws_ok($$select * from public.qbank_assunto_lists$$, '42501', null, 'cache de assuntos só no servidor');
select throws_ok($$select * from public.qbank_cursors$$, '42501', null, 'cursores só no servidor');
select is((select count(*) from public.question_attempts), 1::bigint, 'A lê as próprias tentativas');
select throws_ok($$insert into public.question_attempts (owner_id, plan_id, qid, chosen, correct) values ('00000000-0000-4000-8000-0000000000a3', '41000000-0000-4000-8000-000000000001', 'q1', 'C', true)$$, '42501', null, 'usuário não grava tentativa (o acerto é decidido no servidor)');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3');
select is((select count(*) from public.question_attempts), 0::bigint, 'B não vê tentativas de A');

-- Anotações por questão (pessoais) e mnemônicos (compartilhados, só o backend grava).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
select lives_ok($$insert into public.question_notes (qid, note) values ('q1', 'resumo de A')$$, 'A anota a questão');
reset role;
insert into public.mnemonics (concept, concept_key, mnemonic, model, prompt_version) values ('Requisitos do ato', 'requisitos do ato', 'COFIFOMOB', 'm', 'v');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3');
select is((select count(*) from public.question_notes), 0::bigint, 'B não vê anotações de A');
select is((select count(*) from public.mnemonics where concept_key = 'requisitos do ato'), 1::bigint, 'mnemônico é compartilhado (leitura)');
select throws_ok($$insert into public.mnemonics (concept, concept_key, mnemonic, model, prompt_version) values ('x', 'x', 'x', 'm', 'v')$$, '42501', null, 'usuário não grava mnemônico');

select * from finish();
rollback;
