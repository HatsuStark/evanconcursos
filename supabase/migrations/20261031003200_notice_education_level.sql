-- Escolaridade do cargo no edital (Fundamental, Médio ou Superior; vazio se não informada), para filtrar as questões.
alter table public.notices
  add column education_level text not null default '' check (education_level in ('', 'Fundamental', 'Médio', 'Superior'));

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
    education_level = coalesce(p_data->>'educationLevel', ''),
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
