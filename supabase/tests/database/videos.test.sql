-- Vídeos: cache fora do alcance do estudante, marcações isoladas entre usuários e apagadas com o concurso.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a9', 'vid-a@test.local'), ('00000000-0000-4000-8000-0000000000b9', 'vid-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values
  ('80000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a9', 'Concurso A', 'reviewed'),
  ('80000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b9', 'Concurso B', 'reviewed');
insert into public.video_searches (query_key, query, videos) values ('k', 'q', '[]');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select throws_ok($$select * from public.video_searches$$, '42501', null, 'estudante não lê o cache de buscas');
select throws_ok($$insert into public.video_searches (query_key, query, videos) values ('x', 'x', '[]')$$, '42501', null, 'estudante não grava no cache de buscas');
select lives_ok($$insert into public.video_watches (notice_id, video_id) values ('80000000-0000-4000-8000-000000000001', 'dQw4w9WgXcQ')$$, 'dono marca como assistido');
select is((select count(*) from public.video_watches), 1::bigint, 'dono lê as marcações');
select throws_ok($$insert into public.video_watches (notice_id, video_id) values ('80000000-0000-4000-8000-000000000001', 'x"><script>')$$, '23514', null, 'id de vídeo inválido é recusado');
select throws_ok($$insert into public.video_watches (owner_id, notice_id, video_id) values ('00000000-0000-4000-8000-0000000000b9', '80000000-0000-4000-8000-000000000002', 'dQw4w9WgXcQ')$$, '42501', null, 'não marca em nome de outro usuário');
select throws_ok($$insert into public.video_watches (notice_id, video_id) values ('80000000-0000-4000-8000-000000000002', 'dQw4w9WgXcQ')$$, '23503', null, 'não marca em concurso de outro usuário');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b9');
select is((select count(*) from public.video_watches), 0::bigint, 'outro usuário não vê');
delete from public.video_watches where video_id = 'dQw4w9WgXcQ';

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a9');
select is((select count(*) from public.video_watches), 1::bigint, 'outro usuário não apaga');
select lives_ok($$select public.delete_notice('80000000-0000-4000-8000-000000000001')$$, 'excluir o concurso funciona');
select is((select count(*) from public.video_watches), 0::bigint, 'excluir o concurso apaga as marcações');

select * from finish();
rollback;
