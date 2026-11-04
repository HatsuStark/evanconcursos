-- Tema dividido em partes ("Atos processuais (parte 2 de 3): ..."): a revisão espaçada conta o tema inteiro.
-- - Concluir uma parte que não é a última não abre a revisão para amanhã: ela fica para o dia seguinte à última parte
--   planejada (se o estudante nunca fizer a última, a parte ainda é revisada).
-- - Concluir a última parte abre uma revisão só, a do tema inteiro, e apaga as das partes anteriores ainda não feitas.
-- - O intervalo da revisão usa o acerto nas questões de todas as partes.
-- Mesmas regras de leitura do título que shared/domain/parts.ts.

-- Parte do título: tema (minúsculo), número e total; nada para sessão inteira, aprofundamento ou revisão.
create function public.session_part(p_title text) returns table (head text, part int, parts int)
language sql immutable set search_path = '' as $$
  select lower(trim(m[1])), m[2]::int, m[3]::int
  from (select regexp_match(p_title, '^(.*?)\s*\(parte (\d+) de (\d+)\)', 'i') as m) x
  where m is not null and p_title !~* '(^|: )(Aprofundamento|Revisão com questões|Revisão): '
    and m[3]::int >= 2 and m[2]::int between 1 and m[3]::int;
$$;
revoke all on function public.session_part(text) from public, anon, authenticated;

-- Todas as partes do tema da sessão (mesma versão do plano e matéria), em ordem; sessão inteira devolve só ela.
create function public.theme_sessions(p_session uuid) returns table (id uuid, part int, parts int)
language sql stable security definer set search_path = '' as $$
  select c.id, cp.part, cp.parts
  from public.study_sessions s
  cross join lateral public.session_part(s.title) sp
  join public.study_sessions c on c.plan_version_id = s.plan_version_id and c.subject_id is not distinct from s.subject_id and c.owner_id = s.owner_id
  cross join lateral public.session_part(c.title) cp
  where s.id = p_session and cp.head = sp.head and cp.parts = sp.parts
  union all
  select s.id, 1, 1 from public.study_sessions s
  where s.id = p_session and not exists (select 1 from public.session_part(s.title))
  order by 2;
$$;
revoke all on function public.theme_sessions(uuid) from public, anon, authenticated;

-- Intervalo da revisão pelo acerto nas questões do tema (todas as partes e os aprofundamentos delas): 85% ou mais estica
-- 1,5×; abaixo de 60% encurta pela metade. Acerto suavizado como em session_accuracy.
create or replace function public.review_factor(p_owner uuid, p_session uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when a >= 0.85 then 1.5 when a < 0.6 then 0.5 else 1 end
  from (
    select (count(*) filter (where qa.correct) + 3.5) / (count(*) + 5.0) as a
    from public.question_attempts qa
    where qa.owner_id = p_owner and (
      qa.session_id in (select t.id from public.theme_sessions(p_session) t)
      or qa.session_id in (select r.id from public.study_sessions r where r.source_session_id in (select t.id from public.theme_sessions(p_session) t))
    )
  ) x;
$$;

-- Concluir: tema inteiro, revisão em 1 dia (2 com acerto alto). Parte que não é a última: revisão no dia seguinte à data
-- planejada da última parte, a não ser que a revisão do tema já exista. Última parte: apaga as revisões das partes
-- anteriores ainda não feitas. Desfazer apaga a revisão não feita da tarefa; desfazer a última parte devolve a revisão
-- adiada às partes anteriores concluídas.
create or replace function public.schedule_theory_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_due date;
  v_part record;
  v_last uuid;
  v_last_date date;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  p record;
begin
  select part, parts into v_part from public.session_part((select title from public.study_sessions where id = new.session_id));
  if v_part.parts is not null then
    select t.id into v_last from public.theme_sessions(new.session_id) t where t.part = t.parts limit 1;
    select min(tk.date) into v_last_date from public.tasks tk
    where tk.session_id = v_last and tk.owner_id = new.owner_id and tk.kind = 'theory' and tk.superseded_in_version is null;
  end if;

  if new.done_at is null then
    delete from public.theory_reviews where task_id = new.id and reviews = 0;
    if v_part.part is not null and v_part.part = v_part.parts then
      for p in
        select tk.id, tk.plan_id, tk.session_id from public.tasks tk join public.theme_sessions(new.session_id) t on t.id = tk.session_id
        where t.part < t.parts and tk.owner_id = new.owner_id and tk.kind = 'theory' and tk.done_at is not null and tk.superseded_in_version is null
      loop
        v_due := public.theory_review_due(p.plan_id, greatest(1, coalesce(v_last_date + 1 - v_today, 1)));
        if v_due is not null then
          insert into public.theory_reviews (owner_id, plan_id, task_id, session_id, due_on)
          values (new.owner_id, p.plan_id, p.id, p.session_id, v_due)
          on conflict (owner_id, session_id) do nothing;
        end if;
      end loop;
    end if;
    return null;
  end if;

  if v_part.part is not null and v_part.part < v_part.parts then
    -- A revisão do tema inteiro já existe (última parte feita antes): esta parte entra nela.
    if exists (select 1 from public.theory_reviews r where r.owner_id = new.owner_id and r.session_id = v_last) then return null; end if;
    v_due := public.theory_review_due(new.plan_id, greatest(1, coalesce(v_last_date + 1 - v_today, 1)));
  else
    v_due := public.theory_review_due(new.plan_id, case when public.review_factor(new.owner_id, new.session_id) > 1 then 2 else 1 end);
    if v_part.part is not null then
      delete from public.theory_reviews r
      where r.owner_id = new.owner_id and r.reviews = 0 and r.session_id <> new.session_id
        and r.session_id in (select t.id from public.theme_sessions(new.session_id) t);
    end if;
  end if;
  if v_due is not null then
    insert into public.theory_reviews (owner_id, plan_id, task_id, session_id, due_on)
    values (new.owner_id, new.plan_id, new.id, new.session_id, v_due)
    on conflict (owner_id, session_id) do nothing;
  end if;
  return null;
end $$;
