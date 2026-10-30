-- Isolamento entre usuários (RLS + FKs compostas + Storage). Roda numa transação desfeita no fim.
begin;
select no_plan();

-- Dois usuários de teste.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@test.local'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@test.local');

create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

select ok((select count(*) = 2 from public.profiles where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b')),
  'perfil criado junto com a conta');

-- ---------- A cria seus dados ----------
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
insert into public.notices (id, title) values ('10000000-0000-4000-8000-000000000001', 'Edital A');
insert into public.notice_files (id, notice_id, storage_path, sha256, size_bytes)
  values ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-00000000000a/10000000-0000-4000-8000-000000000001/x.pdf', repeat('a', 64), 100);
insert into public.notice_subjects (id, notice_id, name) values ('12000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Penal');
insert into public.notice_topics (subject_id, text) values ('12000000-0000-4000-8000-000000000001', 'Inquérito policial');
insert into storage.objects (bucket_id, name) values ('editais', '00000000-0000-4000-8000-00000000000a/10000000-0000-4000-8000-000000000001/x.pdf');

select is((select count(*) from public.notices), 1::bigint, 'A vê o próprio edital');
select is((select owner_id from public.notices), '00000000-0000-4000-8000-00000000000a'::uuid, 'owner_id vem do login');
select is((select count(*) from storage.objects where bucket_id = 'editais'), 1::bigint, 'A vê o próprio PDF');

-- Tabelas escritas só pelo backend: usuário não insere.
select throws_ok($$insert into public.notice_extractions (notice_id) values ('10000000-0000-4000-8000-000000000001')$$, '42501', null, 'usuário não grava extração');
select throws_ok($$insert into public.ai_jobs (owner_id, kind) values ('00000000-0000-4000-8000-00000000000a', 'notice_extract')$$, '42501', null, 'usuário não grava job');
select throws_ok($$insert into public.ai_usage (owner_id, operation, model, status) values ('00000000-0000-4000-8000-00000000000a', 'x', 'm', 'ok')$$, '42501', null, 'usuário não grava consumo');
select throws_ok($$select * from public.ai_model_prices$$, '42501', null, 'tabela de preços só no backend');

-- Backend grava extração, job e consumo de A.
select pg_temp.as_admin();
insert into public.notice_extractions (owner_id, notice_id) values ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001');
insert into public.ai_jobs (owner_id, kind) values ('00000000-0000-4000-8000-00000000000a', 'notice_extract');
insert into public.ai_usage (owner_id, operation, model, status) values ('00000000-0000-4000-8000-00000000000a', 'notice_extract', 'm', 'ok');

select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select is((select count(*) from public.notice_extractions), 1::bigint, 'A lê a própria extração');
select is((select count(*) from public.ai_usage), 1::bigint, 'A lê o próprio consumo');

-- ---------- B não enxerga nem altera nada de A ----------
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select is((select count(*) from public.notices), 0::bigint, 'B não vê editais de A');
select is((select count(*) from public.notice_files), 0::bigint, 'B não vê arquivos de A');
select is((select count(*) from public.notice_subjects), 0::bigint, 'B não vê matérias de A');
select is((select count(*) from public.notice_topics), 0::bigint, 'B não vê tópicos de A');
select is((select count(*) from public.notice_extractions), 0::bigint, 'B não vê extrações de A');
select is((select count(*) from public.ai_jobs), 0::bigint, 'B não vê jobs de A');
select is((select count(*) from public.ai_usage), 0::bigint, 'B não vê consumo de A');
select is((select count(*) from public.profiles), 1::bigint, 'B vê só o próprio perfil');
select is((select count(*) from storage.objects where bucket_id = 'editais'), 0::bigint, 'B não vê PDFs de A');

update public.notices set title = 'invadido';
delete from public.notice_topics;
-- O Storage só aceita delete direto em SQL com esta flag (a API usa a mesma política RLS).
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'editais';

select throws_ok($$insert into public.notices (owner_id, title) values ('00000000-0000-4000-8000-00000000000a', 'falso')$$, '42501', null, 'B não cria edital em nome de A');
select throws_ok($$insert into public.notice_subjects (notice_id, name) values ('10000000-0000-4000-8000-000000000001', 'x')$$, '23503', null, 'B não pendura matéria no edital de A (FK composta)');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('editais', '00000000-0000-4000-8000-00000000000a/intruso.pdf')$$, '42501', null, 'B não envia PDF para a pasta de A');

select throws_ok($$select public.approve_notice('10000000-0000-4000-8000-000000000001', null, '{"subjects":[{"name":"X"}]}')$$, 'P0002', null, 'B não aprova o edital de A');

-- Os dados de A continuam intactos.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select is((select title from public.notices), 'Edital A', 'update de B não afetou A');
select is((select count(*) from public.notice_topics), 1::bigint, 'delete de B não afetou A');
select is((select count(*) from storage.objects where bucket_id = 'editais'), 1::bigint, 'PDF de A continua lá');

-- A aprova o próprio edital: substitui matérias e tópicos, atualiza os dados.
select lives_ok($$select public.approve_notice('10000000-0000-4000-8000-000000000001', null,
  '{"title":"TJ","board":"VUNESP","examDate":"2027-03-14","totalQuestions":70,
    "subjects":[{"name":"Português","questions":16,"weight":5,"topics":[{"text":"Crase","page":3},{"text":"Regência","page":0}]},
                {"name":"Penal","core":true,"block":"Direito","topics":[{"text":"Dolo"}]}]}')$$, 'A aprova o próprio edital');
select is((select status from public.notices), 'reviewed', 'edital fica conferido');
select is((select exam_date from public.notices), '2027-03-14'::date, 'data da prova gravada');
select is((select count(*) from public.notice_subjects), 2::bigint, 'matérias substituídas');
select is((select string_agg(t.text, ',' order by t.position) from public.notice_topics t join public.notice_subjects s on s.id = t.subject_id where s.name = 'Português'),
  'Crase,Regência', 'tópicos na ordem');
select throws_ok($$select public.approve_notice('10000000-0000-4000-8000-000000000001', null, '{"subjects":[]}')$$, '22023', null, 'sem disciplinas é recusado');

-- ---------- anônimo ----------
select pg_temp.as_admin();
set local role anon;
select throws_ok($$select * from public.notices$$, '42501', null, 'anônimo sem acesso a editais');
select is((select count(*) from storage.objects where bucket_id = 'editais'), 0::bigint, 'anônimo não vê PDFs');

select * from finish();
rollback;
