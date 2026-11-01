-- Novo edital do mesmo concurso: liga o edital novo ao antigo e passa o estudo para o plano novo.
alter table public.notices add column replaces_notice_id uuid;
alter table public.notices add foreign key (replaces_notice_id, owner_id)
  references public.notices (id, owner_id) on delete set null (replaces_notice_id);

-- Depois de gerar o plano do edital novo: arquiva o plano e o edital antigos (o histórico fica) e leva as apostilas,
-- que precisam de novo mapeamento. Com p_subjects ({matéria antiga: matéria nova}), leva também o desempenho dessas
-- matérias. Devolve quantas apostilas foram levadas. Security definer: o estudante não altera plano nem tentativas direto.
create function public.adopt_notice_update(p_notice uuid, p_subjects jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_old uuid;
  v_old_plan uuid;
  v_new_plan uuid;
  v_moved int;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  select replaces_notice_id into v_old from public.notices where id = p_notice and owner_id = v_uid;
  if v_old is null then raise exception 'Este edital não atualiza outro.' using errcode = 'P0002'; end if;
  select id into v_new_plan from public.study_plans where notice_id = p_notice and owner_id = v_uid and status = 'active';
  if v_new_plan is null then raise exception 'Gere o cronograma do novo edital primeiro.' using errcode = 'P0002'; end if;
  select id into v_old_plan from public.study_plans where notice_id = v_old and owner_id = v_uid and status = 'active';
  if v_old_plan is null then return 0; end if; -- já feito: repetir não muda nada

  if exists (select 1 from jsonb_each_text(coalesce(p_subjects, '{}')) m
             where not exists (select 1 from public.notice_subjects s where s.id = m.key::uuid and s.notice_id = v_old and s.owner_id = v_uid)
                or not exists (select 1 from public.notice_subjects s where s.id = m.value::uuid and s.notice_id = p_notice and s.owner_id = v_uid)) then
    raise exception 'A equivalência aponta para matéria de outro edital.' using errcode = '22023';
  end if;

  update public.question_attempts a set plan_id = v_new_plan, subject_id = (m.value)::uuid
  from jsonb_each_text(coalesce(p_subjects, '{}')) m
  where a.owner_id = v_uid and a.plan_id = v_old_plan and a.subject_id = (m.key)::uuid;

  delete from public.material_maps x using public.materials m where x.material_id = m.id and m.plan_id = v_old_plan and m.owner_id = v_uid;
  update public.materials set plan_id = v_new_plan, status = 'uploaded', status_detail = '' where plan_id = v_old_plan and owner_id = v_uid;
  get diagnostics v_moved = row_count;

  update public.study_plans set status = 'archived' where id = v_old_plan;
  update public.notices set status = 'archived' where id = v_old and owner_id = v_uid;
  return v_moved;
end $$;
revoke all on function public.adopt_notice_update(uuid, jsonb) from public, anon;
grant execute on function public.adopt_notice_update(uuid, jsonb) to authenticated;
