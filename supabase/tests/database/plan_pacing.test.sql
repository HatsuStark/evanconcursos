-- Ritmo do plano: começa em agenda, o dono troca e outro usuário não altera.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ae', 'pace-a@test.local'), ('00000000-0000-4000-8000-0000000000be', 'pace-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values ('e0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ae', 'Concurso', 'reviewed');
insert into public.study_plans (id, owner_id, notice_id, name) values ('e2000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ae', 'e0000000-0000-4000-8000-000000000001', 'P1');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ae');
select is((select pacing from public.study_plans where id = 'e2000000-0000-4000-8000-000000000001'), 'agenda', 'plano começa em agenda');
update public.study_plans set pacing = 'ciclo' where id = 'e2000000-0000-4000-8000-000000000001';
select is((select pacing from public.study_plans where id = 'e2000000-0000-4000-8000-000000000001'), 'ciclo', 'o dono troca para ciclo');
select throws_ok($$update public.study_plans set pacing = 'outro' where id = 'e2000000-0000-4000-8000-000000000001'$$, '23514', null, 'valor inválido é recusado');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000be');
update public.study_plans set pacing = 'agenda' where id = 'e2000000-0000-4000-8000-000000000001';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ae');
select is((select pacing from public.study_plans where id = 'e2000000-0000-4000-8000-000000000001'), 'ciclo', 'outro usuário não altera');

select * from finish();
rollback;
