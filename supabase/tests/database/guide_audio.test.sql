-- Áudio das vozes de IA: tudo pelo backend; o estudante não lê nem grava direto.
begin;
select no_plan();
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a7', 'audio-a@test.local');
insert into public.guide_audio (cache_key, voice, model, prompt_version, storage_path, seconds, size_bytes) values ('k', 'Charon', 'm', 'v', 'k.mp3', 1, 1);
insert into storage.objects (bucket_id, name) values ('guide-audio', 'k.mp3');
select ok((select not public from storage.buckets where id = 'guide-audio'), 'bucket de áudio é privado');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000a7', 'role', 'authenticated')::text, true);
select throws_ok($$select * from public.guide_audio$$, '42501', null, 'estudante não lê a tabela');
select throws_ok($$insert into public.guide_audio (cache_key, voice, model, prompt_version, storage_path, seconds, size_bytes) values ('x', 'v', 'm', 'v', 'x.mp3', 1, 1)$$, '42501', null, 'estudante não grava a tabela');
select is((select count(*) from storage.objects where bucket_id = 'guide-audio'), 0::bigint, 'estudante não vê arquivos do bucket');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('guide-audio', 'y.mp3', '00000000-0000-4000-8000-0000000000a7')$$, '42501', null, 'estudante não envia áudio ao bucket');

select * from finish();
rollback;
