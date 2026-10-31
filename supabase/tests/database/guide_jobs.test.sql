-- Apostilas em segundo plano: uma geração por apostila, e o estudante não mexe nos jobs.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000aa', 'job-a@test.local'), ('00000000-0000-4000-8000-0000000000ba', 'job-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values ('90000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', 'Concurso', 'reviewed');
insert into public.ai_jobs (id, owner_id, kind, status, input) values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', 'study_guide', 'running', '{"cacheKey": "k1", "noticeId": "90000000-0000-4000-8000-000000000001"}');

select throws_ok($$insert into public.ai_jobs (owner_id, kind, status, input) values ('00000000-0000-4000-8000-0000000000ba', 'study_guide', 'running', '{"cacheKey": "k1"}')$$, '23505', null, 'outro estudante não dispara a mesma apostila ao mesmo tempo');
select lives_ok($$insert into public.ai_jobs (owner_id, kind, status, input) values ('00000000-0000-4000-8000-0000000000aa', 'study_guide', 'running', '{"cacheKey": "k2"}')$$, 'outra apostila pode gerar em paralelo');
select lives_ok($$insert into public.ai_jobs (owner_id, kind, status, input) values ('00000000-0000-4000-8000-0000000000aa', 'study_guide', 'failed', '{"cacheKey": "k1"}')$$, 'histórico de falhas não trava');
update public.ai_jobs set status = 'succeeded' where id = '91000000-0000-4000-8000-000000000001';
select lives_ok($$insert into public.ai_jobs (owner_id, kind, status, input) values ('00000000-0000-4000-8000-0000000000ba', 'study_guide', 'running', '{"cacheKey": "k1"}')$$, 'terminada a geração, a trava sai');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa');
select throws_ok($$insert into public.ai_jobs (owner_id, kind, status) values ('00000000-0000-4000-8000-0000000000aa', 'study_guide', 'running')$$, '42501', null, 'estudante não cria job');
select is((select count(*) from public.ai_jobs where input->>'cacheKey' = 'k1' and owner_id <> '00000000-0000-4000-8000-0000000000aa'), 0::bigint, 'estudante não vê job de outro');
select lives_ok($$select public.delete_notice('90000000-0000-4000-8000-000000000001')$$, 'excluir o concurso funciona');
select is((select count(*) from public.ai_jobs where input->>'noticeId' = '90000000-0000-4000-8000-000000000001'), 0::bigint, 'excluir o concurso apaga os jobs dele');

select * from finish();
rollback;
