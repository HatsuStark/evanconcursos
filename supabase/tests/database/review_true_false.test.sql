-- Certo ou errado da revisão da semana: leitura para quem está logado, gravação só pelo servidor.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000d1', 'tf@test.local');
insert into public.study_guides (id, cache_key, depth, subject_name, title, content, model, prompt_version)
  values ('d1000000-0000-4000-8000-000000000001', 'tf-test', 'revisao', 'Penal', 'Peculato', '{}', 'm', 'review-v3');
insert into public.review_true_false (guide_id, prompt_version, items, model)
  values ('d1000000-0000-4000-8000-000000000001', 'tf-v1', '[{"afirmacao":"a","certo":true,"explicacao":"b"}]', 'm');
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
select is((select jsonb_array_length(items) from public.review_true_false where guide_id = 'd1000000-0000-4000-8000-000000000001'), 1, 'logado lê o exercício');
select throws_ok($$insert into public.review_true_false (guide_id, prompt_version, items, model) values ('d1000000-0000-4000-8000-000000000001', 'x', '[]', 'm')$$, '42501', null, 'estudante não grava');
reset role;
delete from public.study_guides where id = 'd1000000-0000-4000-8000-000000000001';
select is((select count(*) from public.review_true_false where guide_id = 'd1000000-0000-4000-8000-000000000001'), 0::bigint, 'sai junto com a revisão');
select * from finish();
rollback;
