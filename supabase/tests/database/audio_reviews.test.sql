-- Revisão em áudio: cada estudante só lê as próprias revisões, não grava nada direto, e a fila do worker não entrega o
-- mesmo bloco a dois workers.
begin;
select no_plan();
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'audio-a@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'audio-b@test.local');
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

insert into public.notices (id, owner_id, title, status) values ('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'N', 'reviewed');
insert into public.study_plans (id, owner_id, notice_id, name) values ('a1200000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000001', 'P');
insert into public.plan_versions (id, owner_id, plan_id, number, inputs) values ('a1300000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a1200000-0000-4000-8000-000000000001', 1, '{}');
insert into public.tasks (id, owner_id, plan_id, date, kind, title, created_in_version) values
  ('a1500000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a1200000-0000-4000-8000-000000000001', current_date, 'weekly_review', 'Revisão da semana', 'a1300000-0000-4000-8000-000000000001');
insert into public.audio_reviews (id, owner_id, plan_id, task_id, cache_key, duration_min, voice, status, pipeline_version, prompt_version, text_model, tts_model, script) values
  ('a1600000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a1200000-0000-4000-8000-000000000001', 'a1500000-0000-4000-8000-000000000001', 'k1', 20, 'feminina', 'narrating', 'v', 'p', 'm', 't', '{}');
insert into public.audio_review_blocks (review_id, idx, text, cache_key) values
  ('a1600000-0000-4000-8000-000000000001', 0, 'um', 'b0'), ('a1600000-0000-4000-8000-000000000001', 1, 'dois', 'b1');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.audio_reviews), 1::bigint, 'dono lê a própria revisão');
select throws_ok($$select count(*) from public.audio_review_blocks$$, '42501', null, 'fila do worker não é visível');
select throws_ok($$update public.audio_reviews set quiz_score = 5$$, '42501', null, 'estudante não grava direto');
select throws_ok($$select public.audio_claim_block('a1600000-0000-4000-8000-000000000001', 60)$$, '42501', null, 'claim é só do backend');

reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select is((select count(*) from public.audio_reviews), 0::bigint, 'outro estudante não vê');

reset role;
select is((public.audio_claim_block('a1600000-0000-4000-8000-000000000001', 60)).idx, 0, '1º worker pega o bloco 0');
select is((public.audio_claim_block('a1600000-0000-4000-8000-000000000001', 60)).idx, 1, '2º worker pega o bloco 1');
select ok((public.audio_claim_block('a1600000-0000-4000-8000-000000000001', 60)).idx is null, 'nada livre com lease vigente');
update public.audio_review_blocks set lease_until = now() - interval '1 second' where idx = 0;
select is((public.audio_claim_block('a1600000-0000-4000-8000-000000000001', 60)).idx, 0, 'lease vencido: bloco volta para a fila');
select ok(public.audio_claim_quiz('a1600000-0000-4000-8000-000000000001', 60), 'pega a miniavaliação');
select ok(not public.audio_claim_quiz('a1600000-0000-4000-8000-000000000001', 60), 'não pega duas vezes');
select ok((public.audio_claim_review('a1600000-0000-4000-8000-000000000001', 60)).id is null, 'narrando: etapa sequencial não é pega');

select * from finish();
rollback;
