-- Lei seca: textos compartilhados (só leitura para usuários) e marcações pessoais isoladas.
begin;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a2', 'legal-a@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'legal-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Backend grava a lei.
insert into public.legal_norms (id, urn, law_key, name, source_url, content_url, version)
values ('30000000-0000-4000-8000-000000000001', 'urn:test:lei;1', 'T', 'Lei de Teste', 'https://normas.leg.br/x', 'https://normas.leg.br/y', 'Current');
insert into public.legal_articles (id, norm_id, ord, label, num, text)
values ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 0, '1', 1, 'Art. 1º Texto.');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select is((select count(*) from public.legal_articles where norm_id = '30000000-0000-4000-8000-000000000001'), 1::bigint, 'usuário lê o texto da lei');
select throws_ok($$insert into public.legal_norms (urn, name, source_url, content_url, version) values ('x', 'x', 'x', 'x', 'Current')$$, '42501', null, 'usuário não grava lei');
select throws_ok($$update public.legal_articles set text = 'alterado'$$, '42501', null, 'usuário não altera artigo');
select lives_ok($$insert into public.legal_marks (article_id, color, note) values ('31000000-0000-4000-8000-000000000001', 'green', 'cai muito')$$, 'A marca o artigo');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select is((select count(*) from public.legal_marks), 0::bigint, 'B não vê marcações de A');
select is((select count(*) from public.legal_articles where norm_id = '30000000-0000-4000-8000-000000000001'), 1::bigint, 'B também lê a lei (compartilhada)');
delete from public.legal_marks;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select is((select note from public.legal_marks), 'cai muito', 'delete de B não afetou A');

select * from finish();
rollback;
