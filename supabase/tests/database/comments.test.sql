-- Comentários: sem spoiler, apelido, limite de envio, votos, denúncias e autoria.
begin;
select no_plan();
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a6', 'com-a@test.local'), ('00000000-0000-4000-8000-0000000000b6', 'com-b@test.local'),
  ('00000000-0000-4000-8000-0000000000c6', 'com-c@test.local'), ('00000000-0000-4000-8000-0000000000d6', 'com-d@test.local'),
  ('00000000-0000-4000-8000-0000000000e6', 'com-e@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A, B, C e D responderam q1; E não. D entregou um simulado com q2 em branco e tem outro em andamento com q3.
insert into public.question_attempts (owner_id, qid, chosen, correct, context)
  select u::uuid, 'q1', 'A', true, 'free' from unnest(array['00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000d6']) u;
insert into public.simulados (owner_id, title, config, questions, status) values
  ('00000000-0000-4000-8000-0000000000d6', 'Entregue', '{}', '[{"qid":"q2","block":"b","subject":"s"}]', 'finished'),
  ('00000000-0000-4000-8000-0000000000d6', 'Aberto', '{}', '[{"qid":"q3","block":"b","subject":"s"}]', 'in_progress');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a6');
select throws_ok($$select * from public.question_comments$$, '42501', null, 'tabela não é lida diretamente');
select throws_ok($$insert into public.question_comments (owner_id, qid, body) values ('00000000-0000-4000-8000-0000000000a6', 'q9', 'x')$$, '42501', null, 'tabela não é gravada diretamente');
select throws_ok($$select public.can_see_comments('00000000-0000-4000-8000-0000000000a6', 'q1')$$, '42501', null, 'função interna não é chamável');
select throws_ok($$select public.comment_add('q1', 'Oi')$$, '22023', null, 'comentar exige apelido');
select throws_ok($$select public.comment_set_nickname('x')$$, '22023', null, 'apelido curto recusado');
select throws_ok($$select public.comment_set_nickname('<script>')$$, '22023', null, 'apelido com HTML recusado');
select lives_ok($$select public.comment_set_nickname('Ana_01')$$, 'A escolhe apelido');
select throws_ok($$select public.comment_add('q2', 'spoiler')$$, '42501', null, 'não comenta sem ter respondido');
select throws_ok($$select public.comment_add('q1', '   ')$$, '22023', null, 'comentário vazio recusado');
select lives_ok($$select public.comment_add('q1', 'Cai sempre')$$, 'A comenta');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b6');
select throws_ok($$select public.comment_set_nickname('ana_01')$$, '23505', null, 'apelido repetido recusado, sem diferenciar maiúsculas');
select lives_ok($$select public.comment_set_nickname('Bia')$$, 'B escolhe apelido');
create temp table cid as select (public.comments_list('q1')->'comments'->0->>'id')::uuid as id;
grant select on cid to authenticated;
select is(public.comments_list('q1')->'comments'->0->>'author', 'Ana_01', 'B vê o apelido da autora');
select ok(not (public.comments_list('q1')->'comments'->0 ? 'owner_id'), 'a lista não expõe o id da autora');
select ok(public.comments_list('q1')::text !~ 'test.local', 'a lista não expõe e-mail');
select is(public.comments_list('q1')->'comments'->0->>'mine', 'false', 'comentário de outra pessoa não é "meu"');
select throws_ok($$select public.comment_edit((select id from cid), 'x')$$, 'P0002', null, 'B não edita comentário de A');
select throws_ok($$select public.comment_delete((select id from cid))$$, 'P0002', null, 'B não apaga comentário de A');
select lives_ok($$select public.comment_vote((select id from cid))$$, 'B marca como útil');
select is(public.comments_list('q1')->'comments'->0->>'helpful', '1', 'um voto contado');
select is(public.comments_list('q1')->'comments'->0->>'voted', 'true', 'voto de B registrado');
select lives_ok($$select public.comment_vote((select id from cid))$$, 'B desmarca');
select is(public.comments_list('q1')->'comments'->0->>'helpful', '0', 'voto retirado');
select lives_ok($$select public.comment_add('q1', 'Segundo')$$, 'B comenta');
select lives_ok($$select public.comment_vote((select id from cid))$$, 'B marca de novo');
select is(public.comments_list('q1')->'comments'->0->>'body', 'Cai sempre', 'o mais útil vem primeiro');

-- Sem spoiler: quem não respondeu não lê; simulado só depois de entregue, mesmo com a questão em branco.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000e6');
select throws_ok($$select public.comments_list('q1')$$, '42501', null, 'quem não respondeu não lê');
select throws_ok($$select public.comment_vote((select id from cid))$$, 'P0002', null, 'quem não respondeu não vota');
select throws_ok($$select public.comment_report((select id from cid))$$, 'P0002', null, 'quem não respondeu não denuncia');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d6');
select lives_ok($$select public.comments_list('q2')$$, 'simulado entregue libera, mesmo em branco');
select throws_ok($$select public.comments_list('q3')$$, '42501', null, 'simulado em andamento não libera');

-- Limite de envio.
select lives_ok($$select public.comment_set_nickname('Dani')$$, 'D escolhe apelido');
select public.comment_add('q1', 'c' || g) from generate_series(1, 5) g;
select throws_ok($$select public.comment_add('q1', 'sexto')$$, '53400', null, 'sexto comentário no minuto recusado');

-- Denúncias: três pessoas diferentes escondem; repetir não conta; a autora ainda vê o seu.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a6');
select throws_ok($$select public.comment_vote((select id from cid))$$, '22023', null, 'não vota no próprio');
select throws_ok($$select public.comment_report((select id from cid))$$, '22023', null, 'não denuncia o próprio');
select lives_ok($$select public.comment_edit((select id from cid), 'Cai sempre!')$$, 'A edita o seu');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b6');
select public.comment_report((select id from cid));
select public.comment_report((select id from cid));
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c6');
select public.comment_report((select id from cid));
select ok(exists (select 1 from jsonb_array_elements(public.comments_list('q1')->'comments') c where c->>'body' = 'Cai sempre!'), 'duas denúncias (uma repetida) não escondem');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d6');
select public.comment_report((select id from cid));
select ok(not exists (select 1 from jsonb_array_elements(public.comments_list('q1')->'comments') c where c->>'body' = 'Cai sempre!'), 'três denúncias escondem');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a6');
select is((select c->>'hidden' from jsonb_array_elements(public.comments_list('q1')->'comments') c where c->>'mine' = 'true'), 'true', 'a autora vê o seu marcado como escondido');
select throws_ok($$select public.comment_edit((select id from cid), 'novo')$$, 'P0002', null, 'comentário escondido não é editado');
select lives_ok($$select public.comment_delete((select id from cid))$$, 'A apaga o seu');
select is((select count(*) from jsonb_array_elements(public.comments_list('q1')->'comments') c where c->>'mine' = 'true'), 0::bigint, 'comentário apagado');

select * from finish();
rollback;
