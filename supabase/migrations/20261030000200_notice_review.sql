-- E2 · Conferência do edital: estrutura da prova, blocos por disciplina, preços dos modelos e
-- gravação atômica dos dados conferidos (approve_notice).

alter table public.notices
  add column total_questions int not null default 0 check (total_questions between 0 and 1000),
  -- {blocks:[{name,questions,rule}], stages:[{kind,description}], otherRoles:[...]}
  add column structure jsonb not null default '{}' check (jsonb_typeof(structure) = 'object');

alter table public.notice_subjects
  add column block text not null default '' check (char_length(block) <= 120);

-- Itens do conteúdo programático podem ser parágrafos longos.
alter table public.notice_topics drop constraint notice_topics_text_check;
alter table public.notice_topics add constraint notice_topics_text_check check (char_length(text) between 1 and 2000);

-- Preços oficiais (ai.google.dev/gemini-api/docs/pricing), USD por milhão de tokens.
insert into public.ai_model_prices (model, effective_from, input_per_mtok_usd, output_per_mtok_usd) values
  ('gemini-3.8-flash', '2026-01-01', 0.75, 3.75),
  ('gemini-3.8-flash', '2027-01-01', 1.50, 7.50)
on conflict do nothing;

-- Grava os dados conferidos pelo usuário: atualiza o edital e substitui matérias e tópicos numa transação.
-- security invoker: roda com as permissões do usuário, então a RLS garante que só altera o que é dele.
create or replace function public.approve_notice(p_notice_id uuid, p_extraction_id uuid, p_data jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  s jsonb;
  sid uuid;
  pos int := 0;
begin
  if jsonb_typeof(p_data->'subjects') is distinct from 'array' or jsonb_array_length(p_data->'subjects') = 0 then
    raise exception 'Informe ao menos uma disciplina.' using errcode = '22023';
  end if;
  update public.notices set
    title = left(coalesce(p_data->>'title', ''), 160),
    organization = left(coalesce(p_data->>'organization', ''), 160),
    role_name = left(coalesce(p_data->>'role', ''), 160),
    board = left(coalesce(p_data->>'board', ''), 80),
    exam_date = nullif(p_data->>'examDate', '')::date,
    total_questions = coalesce((p_data->>'totalQuestions')::int, 0),
    notes = coalesce(p_data->'notes', '[]'),
    structure = coalesce(p_data->'structure', '{}'),
    status = 'reviewed',
    approved_extraction_id = p_extraction_id
  where id = p_notice_id;
  if not found then
    raise exception 'Edital não encontrado.' using errcode = 'P0002';
  end if;

  delete from public.notice_subjects where notice_id = p_notice_id;
  for s in select value from jsonb_array_elements(p_data->'subjects') loop
    insert into public.notice_subjects (notice_id, name, block, is_core, questions, weight, position)
    values (p_notice_id, left(s->>'name', 120), left(coalesce(s->>'block', ''), 120), coalesce((s->>'core')::boolean, false),
            coalesce((s->>'questions')::int, 0), coalesce((s->>'weight')::int, 2), pos)
    returning id into sid;
    insert into public.notice_topics (subject_id, text, position, source_page)
    select sid, left(t.value->>'text', 2000), (t.ordinality - 1)::int, nullif((t.value->>'page')::int, 0)
    from jsonb_array_elements(coalesce(s->'topics', '[]')) with ordinality as t(value, ordinality)
    where coalesce(t.value->>'text', '') <> '';
    pos := pos + 1;
  end loop;
end $$;

revoke all on function public.approve_notice(uuid, uuid, jsonb) from public, anon;
grant execute on function public.approve_notice(uuid, uuid, jsonb) to authenticated;
