-- Migração: apelido do ranking separado do usuário de login. Seguro para rodar mais de uma vez; não apaga nada.
-- Rode no SQL Editor do Supabase de quem já tem o schema anterior instalado.
alter table app_private.users add column if not exists display_name text;
update app_private.users set display_name = 'Estudante-' || substr(md5(id::text || random()::text), 1, 6) where display_name is null;
create unique index if not exists users_display_name_uq on app_private.users (lower(display_name));
create or replace function public.app_register(p_username text, p_password text, p_invite text) returns json
language plpgsql security definer set search_path = app_private, extensions as $$
declare u text := lower(trim(p_username)); new_id uuid; ih text; th app_private.throttle; maxu int := 500; dn text;
begin
  -- Fechado por padrão: sem código de convite cadastrado, ninguém se cadastra.
  select value into ih from app_private.settings where key = 'invite_hash';
  if ih is null then return json_build_object('error', 'Cadastros fechados. Peça ao administrador.'); end if;
  -- Limite global de tentativas erradas de código (20 a cada 10 minutos)
  select * into th from app_private.throttle where key = 'invite';
  if found and th.n >= 20 and th.since > now() - interval '10 minutes' then
    return json_build_object('error', 'Muitas tentativas de código. Tente de novo em alguns minutos.'); end if;
  if ih <> crypt(coalesce(p_invite, ''), ih) then
    insert into app_private.throttle(key, n, since) values ('invite', 1, now())
    on conflict (key) do update set
      n = case when app_private.throttle.since < now() - interval '10 minutes' then 1 else app_private.throttle.n + 1 end,
      since = case when app_private.throttle.since < now() - interval '10 minutes' then now() else app_private.throttle.since end;
    return json_build_object('error', 'Código de convite incorreto.');
  end if;
  if u !~ '^[a-z0-9_.-]{3,20}$' then return json_build_object('error', 'Nome de usuário inválido: use 3 a 20 letras minúsculas, números, ponto, traço ou _.'); end if;
  if length(coalesce(p_password, '')) < 8 or length(p_password) > 72 then return json_build_object('error', 'A senha precisa ter de 8 a 72 caracteres.'); end if;
  if lower(p_password) = u then return json_build_object('error', 'A senha não pode ser igual ao nome de usuário.'); end if;
  if (select count(*) from app_private.users) >= maxu then return json_build_object('error', 'Limite de usuários atingido.'); end if;
  loop   -- apelido inicial aleatório: não tem relação nenhuma com o usuário de login (a pessoa pode trocar)
    dn := 'Estudante-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    exit when not exists (select 1 from app_private.users where lower(display_name) = lower(dn));
  end loop;
  begin
    insert into app_private.users(username, pass_hash, display_name) values (u, crypt(p_password, gen_salt('bf', 10)), dn) returning id into new_id;
  exception when unique_violation then
    return json_build_object('error', 'Esse nome de usuário já existe. Escolha outro.');
  end;
  return json_build_object('token', app_private.new_session(new_id), 'username', u);
end $$;
create or replace function public.app_me(p_token text) returns json
language plpgsql security definer set search_path = app_private, extensions as $$
declare r app_private.users;
begin
  select u.* into r from app_private.users u where u.id = app_private.uid(p_token);
  if not found then raise exception 'Sessão expirada. Entre novamente.'; end if;
  return json_build_object('username', r.username, 'display_name', r.display_name);
end $$;
create or replace function public.app_set_display_name(p_token text, p_name text) returns json
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); me text;
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if char_length(n) < 2 or char_length(n) > 24 then raise exception 'O apelido precisa ter de 2 a 24 caracteres.'; end if;
  if n !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]+$' then raise exception 'Use só letras, números, espaço, ponto, traço ou _ no apelido.'; end if;
  select username into me from app_private.users where id = uid;
  if lower(n) = lower(me) then raise exception 'Escolha um apelido diferente do seu usuário de login.'; end if;
  begin
    update app_private.users set display_name = n where id = uid;
  exception when unique_violation then
    raise exception 'Esse apelido já está em uso no ranking. Escolha outro.';
  end;
  return json_build_object('display_name', n);
end $$;
drop function if exists public.app_leaderboard(text);
create or replace function public.app_leaderboard(p_token text)
returns table(name text, simulados int, eu boolean)
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  return query
    select u.display_name, s.simulados, (u.id = uid)
    from app_private.stats s join app_private.users u on u.id = s.user_id
    where s.simulados > 0
    order by s.simulados desc, u.display_name limit 100;
end $$;
revoke all on function public.app_set_display_name(text,text), public.app_leaderboard(text) from public, anon, authenticated;
grant execute on function public.app_set_display_name(text,text), public.app_leaderboard(text) to anon, authenticated;
