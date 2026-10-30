-- Excluir um concurso: o edital leva em cascata cronograma, tarefas, sessões, tentativas e materiais.
-- Anotações, caderno de erros, flashcards e marcações de lei não pertencem a um edital (são por questão ou
-- artigo): saem só quando foram usados apenas neste concurso. Questões livres e simulados personalizados ficam.

-- Onde a anotação e o cartão de mnemônico nasceram (anotação pode existir em questão ainda não respondida).
alter table public.question_notes
  add column plan_id uuid,
  add foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete set null (plan_id);
alter table public.flashcards
  add column plan_id uuid,
  add foreign key (plan_id, owner_id) references public.study_plans (id, owner_id) on delete set null (plan_id);

-- p_law_urns: leis citadas só por este concurso (o app calcula a partir das matérias e tópicos dos editais).
create or replace function public.delete_notice(p_notice uuid, p_law_urns text[] default '{}')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plans uuid[];
  v_sims uuid[];
  v_scopes text[];
  v_gone text[];
  v_keep text[];
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if not exists (select 1 from public.notices where id = p_notice and owner_id = v_uid) then
    raise exception 'Concurso não encontrado.' using errcode = 'P0002';
  end if;

  v_plans := array(select id from public.study_plans where notice_id = p_notice and owner_id = v_uid);
  v_sims := array(select id from public.simulados where owner_id = v_uid and plan_id = any(v_plans));
  v_scopes := array(
    select s.id::text from public.study_sessions s join public.plan_versions v on v.id = s.plan_version_id where v.plan_id = any(v_plans)
    union all
    select 'subject:' || id from public.notice_subjects where notice_id = p_notice and owner_id = v_uid);

  -- Questão usada em outro plano, em prática livre ou em outro simulado continua do estudante.
  -- A revisão de erros não conta: ela só repete uma questão que veio de outro lugar.
  v_keep := array(
    select qid from public.question_attempts
    where owner_id = v_uid and context <> 'review'
      and (plan_id is null or not plan_id = any(v_plans))
      and (simulado_id is null or not simulado_id = any(v_sims))
    union
    select qid from public.question_notes where owner_id = v_uid and plan_id is not null and not plan_id = any(v_plans));
  v_gone := array(
    select qid from public.question_attempts where owner_id = v_uid and (plan_id = any(v_plans) or simulado_id = any(v_sims))
    union
    select qid from public.question_notes where owner_id = v_uid and plan_id = any(v_plans)
    except
    select unnest(v_keep));

  delete from public.question_notes where owner_id = v_uid and qid = any(v_gone);
  delete from public.error_book where owner_id = v_uid and qid = any(v_gone);
  delete from public.flashcards where owner_id = v_uid and kind = 'question' and ref = any(v_gone);
  -- Mnemônicos são compartilhados: sai só o cartão do estudante, se nenhuma questão mantida usa o mesmo mnemônico.
  delete from public.flashcards f where f.owner_id = v_uid and f.kind = 'mnemonic'
    and (f.plan_id = any(v_plans) or f.ref in (select mnemonic_id::text from public.qbank_questions where qid = any(v_gone) and mnemonic_id is not null))
    and (f.plan_id is null or f.plan_id = any(v_plans))
    and f.ref not in (select mnemonic_id::text from public.qbank_questions where qid = any(v_keep) and mnemonic_id is not null);
  delete from public.question_attempts where owner_id = v_uid and (simulado_id = any(v_sims) or (context = 'review' and qid = any(v_gone)));
  delete from public.simulados where id = any(v_sims);
  delete from public.qbank_cursors where owner_id = v_uid and scope = any(v_scopes);
  delete from public.legal_marks m using public.legal_articles a, public.legal_norms n
    where m.owner_id = v_uid and a.id = m.article_id and n.id = a.norm_id and n.urn = any(p_law_urns);
  -- O registro de custo (ai_usage) fica: não tem conteúdo do estudante e o vínculo com o job vira nulo.
  delete from public.ai_jobs where owner_id = v_uid and input->>'noticeId' = p_notice::text;
  delete from public.notices where id = p_notice and owner_id = v_uid;
end $$;
revoke all on function public.delete_notice(uuid, text[]) from public, anon;
grant execute on function public.delete_notice(uuid, text[]) to authenticated;
