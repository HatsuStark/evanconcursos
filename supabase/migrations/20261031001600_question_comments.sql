-- Comentários por questão, visíveis a todos os estudantes que já a responderam. Tudo passa por funções: a regra
-- "sem spoiler" (só depois de responder ou de entregar o simulado) não pode depender do app.

alter table public.profiles add column nickname text check (nickname ~ '^[[:alnum:]_ .-]{3,24}$');
create unique index profiles_nickname_key on public.profiles (lower(nickname));

create table public.question_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  qid text not null,
  body text not null check (char_length(body) between 1 and 2000),
  hidden boolean not null default false,   -- escondido por denúncias, até revisão manual
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index question_comments_qid_idx on public.question_comments (qid, created_at desc);
create index question_comments_owner_idx on public.question_comments (owner_id, created_at desc);

create table public.comment_votes (
  comment_id uuid not null references public.question_comments(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  primary key (comment_id, owner_id)
);
create table public.comment_reports (
  comment_id uuid not null references public.question_comments(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, owner_id)
);
alter table public.question_comments enable row level security;
alter table public.comment_votes enable row level security;
alter table public.comment_reports enable row level security;
-- Sem grants nem políticas: o acesso é só pelas funções abaixo.

-- Pode ver a discussão quem já respondeu a questão ou entregou um simulado que a contém (mesmo em branco).
create or replace function public.can_see_comments(p_uid uuid, p_qid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.question_attempts where owner_id = p_uid and qid = p_qid)
      or exists (select 1 from public.simulados where owner_id = p_uid and status = 'finished' and questions @> jsonb_build_array(jsonb_build_object('qid', p_qid)));
$$;
revoke all on function public.can_see_comments(uuid, text) from public, anon, authenticated;

-- Usuário logado com acesso ao comentário (não escondido), ou erro.
create or replace function public.comment_for_action(p_id uuid) returns public.question_comments
language plpgsql stable security definer set search_path = '' as $$
declare c public.question_comments;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  select * into c from public.question_comments where id = p_id;
  if not found or c.hidden or not public.can_see_comments(auth.uid(), c.qid) then
    raise exception 'Comentário não encontrado.' using errcode = 'P0002';
  end if;
  return c;
end $$;
revoke all on function public.comment_for_action(uuid) from public, anon, authenticated;

create or replace function public.comments_list(p_qid text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if not public.can_see_comments(v_uid, p_qid) then
    raise exception 'Responda a questão para ver os comentários.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'nickname', (select nickname from public.profiles where id = v_uid),
    'comments', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.helpful desc, x.created_at desc) from (
        select c.id, c.body, c.created_at, c.edited_at, c.hidden, coalesce(p.nickname, 'Estudante') as author, c.owner_id = v_uid as mine,
               (select count(*) from public.comment_votes v where v.comment_id = c.id) as helpful,
               exists (select 1 from public.comment_votes v where v.comment_id = c.id and v.owner_id = v_uid) as voted,
               exists (select 1 from public.comment_reports r where r.comment_id = c.id and r.owner_id = v_uid) as reported
        from public.question_comments c left join public.profiles p on p.id = c.owner_id
        where c.qid = p_qid and (not c.hidden or c.owner_id = v_uid)
        order by helpful desc, c.created_at desc limit 200
      ) x), '[]'::jsonb));
end $$;

create or replace function public.comment_set_nickname(p_nickname text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_nick text := trim(coalesce(p_nickname, ''));
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if v_nick !~ '^[[:alnum:]_ .-]{3,24}$' then
    raise exception 'O apelido precisa ter de 3 a 24 letras, números, espaços, ponto, hífen ou sublinhado.' using errcode = '22023';
  end if;
  update public.profiles set nickname = v_nick where id = auth.uid();
exception when unique_violation then
  raise exception 'Este apelido já está em uso.' using errcode = '23505';
end $$;

create or replace function public.comment_add(p_qid text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_body text := trim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if not public.can_see_comments(v_uid, p_qid) then
    raise exception 'Responda a questão para comentar.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and nickname is not null) then
    raise exception 'Escolha um apelido para comentar.' using errcode = '22023';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'O comentário precisa ter de 1 a 2000 caracteres.' using errcode = '22023';
  end if;
  if (select count(*) from public.question_comments where owner_id = v_uid and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Muitos comentários em pouco tempo. Aguarde um minuto.' using errcode = '53400';
  end if;
  insert into public.question_comments (owner_id, qid, body) values (v_uid, p_qid, v_body) returning id into v_id;
  return v_id;
end $$;

-- Comentário escondido não pode ser editado: seria um jeito de driblar as denúncias.
create or replace function public.comment_edit(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_body text := trim(coalesce(p_body, ''));
begin
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'O comentário precisa ter de 1 a 2000 caracteres.' using errcode = '22023';
  end if;
  update public.question_comments set body = v_body, edited_at = now() where id = p_id and owner_id = auth.uid() and not hidden;
  if not found then raise exception 'Comentário não encontrado.' using errcode = 'P0002'; end if;
end $$;

create or replace function public.comment_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.question_comments where id = p_id and owner_id = auth.uid();
  if not found then raise exception 'Comentário não encontrado.' using errcode = 'P0002'; end if;
end $$;

-- Marca ou desmarca como útil; não vale para o próprio comentário.
create or replace function public.comment_vote(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.question_comments := public.comment_for_action(p_id);
begin
  if c.owner_id = auth.uid() then raise exception 'Você não pode votar no próprio comentário.' using errcode = '22023'; end if;
  delete from public.comment_votes where comment_id = p_id and owner_id = auth.uid();
  if not found then insert into public.comment_votes (comment_id, owner_id) values (p_id, auth.uid()); end if;
end $$;

-- Três denúncias de pessoas diferentes escondem o comentário até revisão manual.
create or replace function public.comment_report(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.question_comments := public.comment_for_action(p_id);
begin
  if c.owner_id = auth.uid() then raise exception 'Você não pode denunciar o próprio comentário.' using errcode = '22023'; end if;
  insert into public.comment_reports (comment_id, owner_id) values (p_id, auth.uid()) on conflict do nothing;
  if (select count(*) from public.comment_reports where comment_id = p_id) >= 3 then
    update public.question_comments set hidden = true where id = p_id;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['comments_list(text)', 'comment_set_nickname(text)', 'comment_add(text, text)', 'comment_edit(uuid, text)', 'comment_delete(uuid)', 'comment_vote(uuid)', 'comment_report(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
