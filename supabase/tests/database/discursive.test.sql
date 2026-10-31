-- Discursivas: gabarito fora do alcance do estudante, nota só pelo backend e isolamento entre usuários.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a8', 'disc-a@test.local'), ('00000000-0000-4000-8000-0000000000b8', 'disc-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', 'Concurso', 'reviewed');
insert into public.discursive_prompts (id, cache_key, format, title, content, model, prompt_version) values
  ('71000000-0000-4000-8000-000000000001', 'k', 'questao', 'Peculato', '{"espelho": []}', 'm', 'v');
insert into public.discursive_answers (id, owner_id, notice_id, prompt_id, format, title, statement) values
  ('72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'questao', 'Peculato', 'Caso'),
  ('72000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a8', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'questao', 'Corrigida', 'Caso');
update public.discursive_answers set status = 'graded', pct = 50 where id = '72000000-0000-4000-8000-000000000002';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a8');
select throws_ok($$select * from public.discursive_prompts$$, '42501', null, 'estudante não lê enunciados nem gabaritos');
select is((select count(*) from public.discursive_answers), 2::bigint, 'dono lê os próprios treinos');
update public.discursive_answers set body = 'minha resposta', seconds = 30 where id = '72000000-0000-4000-8000-000000000001';
select is((select body from public.discursive_answers where id = '72000000-0000-4000-8000-000000000001'), 'minha resposta', 'dono edita o rascunho');
update public.discursive_answers set body = 'mudei depois da nota' where id = '72000000-0000-4000-8000-000000000002';
select is((select body from public.discursive_answers where id = '72000000-0000-4000-8000-000000000002'), '', 'treino corrigido não muda');
select throws_ok($$update public.discursive_answers set pct = 100 where id = '72000000-0000-4000-8000-000000000001'$$, '42501', null, 'estudante não dá a própria nota');
select throws_ok($$update public.discursive_answers set status = 'graded' where id = '72000000-0000-4000-8000-000000000001'$$, '42501', null, 'estudante não muda o status');
select throws_ok($$insert into public.discursive_answers (notice_id, prompt_id, format, title, statement) values ('70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'questao', 'x', 'x')$$, '42501', null, 'estudante não cria treino direto');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b8');
select is((select count(*) from public.discursive_answers), 0::bigint, 'outro usuário não vê');
update public.discursive_answers set body = 'invadido' where id = '72000000-0000-4000-8000-000000000001';
delete from public.discursive_answers where id = '72000000-0000-4000-8000-000000000001';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a8');
select is((select body from public.discursive_answers where id = '72000000-0000-4000-8000-000000000001'), 'minha resposta', 'outro usuário não altera nem apaga');
select lives_ok($$select public.delete_notice('70000000-0000-4000-8000-000000000001')$$, 'excluir o concurso funciona');
select is((select count(*) from public.discursive_answers), 0::bigint, 'excluir o concurso apaga os treinos');

select * from finish();
rollback;
