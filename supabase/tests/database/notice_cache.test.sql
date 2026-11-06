-- Cache compartilhado das leituras do edital: só o backend lê e grava.
begin;
select no_plan();

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c7', 'cache-a@test.local');
insert into public.notice_ai_cache (kind, doc_key, role_key, prompt_version, model, result)
values ('extract', 'pdf:' || repeat('a', 64), 'h:tecnico', 'notice-v8', 'm', '{"subjects": []}');

select throws_ok($$insert into public.notice_ai_cache (kind, doc_key, prompt_version, result) values ('roles', 'pdf:xyz', 'v', '{}')$$, '23514', null, 'chave do edital precisa ser um hash');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000c7', 'role', 'authenticated')::text, true);
select throws_ok($$select * from public.notice_ai_cache$$, '42501', null, 'candidato não lê o cache');
select throws_ok($$insert into public.notice_ai_cache (kind, doc_key, prompt_version, result) values ('roles', 'pdf:' || repeat('b', 64), 'v', '{}')$$, '42501', null, 'candidato não grava no cache');
select throws_ok($$select * from public.notice_docs$$, '42501', null, 'candidato não lê os editais conhecidos');

select * from finish();
rollback;
