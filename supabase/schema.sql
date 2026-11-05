-- Estudo PMSC — banco de dados (Supabase, plano gratuito)
-- Cadastro por NOME DE USUÁRIO + SENHA (sem e-mail), protegido por um CÓDIGO DE CONVITE.
-- Cada pessoa só enxerga os PRÓPRIOS simulados e o PRÓPRIO progresso (nada é compartilhado entre usuários).
-- Cole tudo no SQL Editor do Supabase e execute uma vez. Depois, execute o passo "CÓDIGO DE CONVITE" lá no final.
--
-- Camadas de segurança:
--  1. As tabelas ficam num schema PRIVADO (app_private), que a API pública do Supabase não enxerga.
--  2. RLS ligado e nenhuma permissão direta para anon/authenticated: só funções app_* acessam os dados.
--  3. Cada função exige um token de sessão e só devolve os dados do dono do token.
--  4. Senhas com bcrypt; tokens guardados só como hash (SHA-256); sessões expiram.
--  5. Cadastro FECHADO por padrão: só entra quem souber o código de convite; há limite de tentativas e de usuários.
--  6. Limites de tamanho/quantidade em tudo que o usuário envia (respostas, simulados).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists app_private.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_.-]{3,20}$'),
  pass_hash text not null,
  display_name text,                       -- apelido mostrado no ranking (sem relação com o usuário de login)
  fails int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists users_display_name_uq on app_private.users (lower(display_name));
create table if not exists app_private.sessions (
  token_hash text primary key,
  user_id uuid not null references app_private.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on app_private.sessions(user_id);
create table if not exists app_private.answers (
  user_id uuid not null references app_private.users(id) on delete cascade,
  qid text not null,
  chosen text not null,
  ok boolean not null,
  ts bigint not null,
  primary key (user_id, ts, qid)
);
-- Contadores por pessoa: total de respostas (só para o limite de uso) e quantos simulados a pessoa já fez (ranking).
-- NÃO se guarda nem se mostra quantidade de acertos/erros de ninguém.
create table if not exists app_private.stats (
  user_id uuid primary key references app_private.users(id) on delete cascade,
  total bigint not null default 0,
  simulados int not null default 0
);
-- Simulados PRIVADOS: cada um pertence a uma pessoa e só ela enxerga (não existe simulado compartilhado)
create table if not exists app_private.sims (
  owner_id uuid not null references app_private.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9._-]{1,60}$'),
  nome text not null,
  fonte text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create table if not exists app_private.settings (key text primary key, value text not null);
create table if not exists app_private.throttle (key text primary key, n int not null default 0, since timestamptz not null default now());

alter table app_private.users    enable row level security;
alter table app_private.sessions enable row level security;
alter table app_private.answers  enable row level security;
alter table app_private.stats    enable row level security;
alter table app_private.sims     enable row level security;
alter table app_private.settings enable row level security;
alter table app_private.throttle enable row level security;
-- (sem políticas e sem GRANT: ninguém lê/escreve direto nas tabelas; só pelas funções abaixo)

-- ---------- funções internas (ninguém de fora consegue chamar) ----------
create or replace function app_private.uid(p_token text) returns uuid
language sql security definer set search_path = app_private, extensions as $$
  select user_id from app_private.sessions
  where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') and expires_at > now();
$$;

create or replace function app_private.new_session(p_user uuid) returns text
language plpgsql security definer set search_path = app_private, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  delete from app_private.sessions where expires_at < now();
  -- no máximo 10 aparelhos/sessões por pessoa (apaga as mais antigas)
  delete from app_private.sessions where user_id = p_user and token_hash in (
    select token_hash from app_private.sessions where user_id = p_user order by created_at desc offset 9);
  insert into app_private.sessions(token_hash, user_id, expires_at)
  values (encode(digest(t, 'sha256'), 'hex'), p_user, now() + interval '60 days');
  return t;
end $$;

-- ---------- cadastro / login ----------
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

create or replace function public.app_login(p_username text, p_password text) returns json
language plpgsql security definer set search_path = app_private, extensions as $$
declare r app_private.users;
begin
  -- Erros de senha voltam como {"error": "..."} (e não como exceção) para que o contador de tentativas seja gravado.
  select * into r from app_private.users where username = lower(trim(coalesce(p_username, '')));
  if not found then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));   -- gasta o mesmo tempo (não revela se o usuário existe)
    return json_build_object('error', 'Usuário ou senha incorretos.');
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return json_build_object('error', 'Muitas tentativas erradas. Tente de novo em alguns minutos.'); end if;
  if r.pass_hash = crypt(coalesce(p_password, ''), r.pass_hash) then
    update app_private.users set fails = 0, locked_until = null where id = r.id;
    return json_build_object('token', app_private.new_session(r.id), 'username', r.username);
  end if;
  update app_private.users
    set fails = case when fails + 1 >= 8 then 0 else fails + 1 end,
        locked_until = case when fails + 1 >= 8 then now() + interval '10 minutes' else locked_until end
  where id = r.id;
  return json_build_object('error', 'Usuário ou senha incorretos.');
end $$;

create or replace function public.app_me(p_token text) returns json
language plpgsql security definer set search_path = app_private, extensions as $$
declare r app_private.users;
begin
  select u.* into r from app_private.users u where u.id = app_private.uid(p_token);
  if not found then raise exception 'Sessão expirada. Entre novamente.'; end if;
  return json_build_object('username', r.username, 'display_name', r.display_name);
end $$;

create or replace function public.app_logout(p_token text) returns void
language sql security definer set search_path = app_private, extensions as $$
  delete from app_private.sessions where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
$$;

create or replace function public.app_change_password(p_token text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); h text;
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if length(coalesce(p_new,'')) < 8 or length(p_new) > 72 then raise exception 'A nova senha precisa ter de 8 a 72 caracteres.'; end if;
  select pass_hash into h from app_private.users where id = uid;
  if h <> crypt(coalesce(p_old, ''), h) then raise exception 'Senha atual incorreta.'; end if;
  update app_private.users set pass_hash = crypt(p_new, gen_salt('bf', 10)) where id = uid;
  -- encerra todas as outras sessões (se alguém tinha roubado o acesso, perde)
  delete from app_private.sessions where user_id = uid and token_hash <> encode(digest(p_token, 'sha256'), 'hex');
end $$;

-- ---------- respostas ----------
create or replace function public.app_push_answers(p_token text, p_rows jsonb) returns int
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); n int; cur bigint;
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Formato inválido.'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Lote grande demais.'; end if;
  select coalesce(total, 0) into cur from app_private.stats where user_id = uid;
  if coalesce(cur, 0) + jsonb_array_length(p_rows) > 100000 then raise exception 'Limite de respostas por conta atingido.'; end if;
  with parsed as (
    select r->>'qid' as qid, r->>'chosen' as chosen,
           case when r->>'ok' in ('true', 'false') then (r->>'ok')::boolean end as ok,
           case when r->>'ts' ~ '^[0-9]{12,14}$' then (r->>'ts')::bigint end as ts
    from jsonb_array_elements(p_rows) r where jsonb_typeof(r) = 'object'
  ), ins as (
    insert into app_private.answers(user_id, qid, chosen, ok, ts)
    select uid, qid, chosen, ok, ts from parsed
    where qid ~ '^[A-Za-z0-9._-]{1,90}$' and chosen ~ '^[A-E]$' and ok is not null
      and ts between 1600000000000 and (extract(epoch from now()) * 1000)::bigint + 86400000
    on conflict do nothing
    returning ok
  ), agg as (
    select count(*)::int as t from ins
  ), up as (
    insert into app_private.stats(user_id, total) select uid, t from agg where t > 0
    on conflict (user_id) do update set total = app_private.stats.total + excluded.total
    returning 1
  )
  select t into n from agg;
  return coalesce(n, 0);
end $$;

create or replace function public.app_pull_answers(p_token text, p_after bigint default 0, p_limit int default 1000)
returns table(qid text, chosen text, ok boolean, ts bigint)
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  return query select a.qid, a.chosen, a.ok, a.ts from app_private.answers a
    where a.user_id = uid and a.ts > p_after order by a.ts limit least(greatest(p_limit, 1), 2000);
end $$;

-- ---------- simulados PRIVADOS de cada pessoa ----------
-- Toda função abaixo trabalha só com os simulados do dono do token: ninguém lê, lista, altera ou apaga os de outra pessoa.
drop function if exists public.app_list_sims(text);
create or replace function public.app_list_sims(p_token text) returns table(id text, nome text, n int)
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  return query select s.id, s.nome, coalesce(jsonb_array_length(s.payload->'questions'), 0)
    from app_private.sims s where s.owner_id = uid order by s.created_at;
end $$;

create or replace function public.app_get_sim(p_token text, p_id text) returns jsonb
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); r jsonb;
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  select payload into r from app_private.sims where owner_id = uid and id = p_id;
  return r;
end $$;

create or replace function public.app_add_sim(p_token text, p_id text, p_nome text, p_fonte text, p_payload jsonb) returns void
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if p_id !~ '^[A-Za-z0-9._-]{1,60}$' then raise exception 'Identificador inválido.'; end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'questions') <> 'array' or jsonb_typeof(p_payload->'sim') <> 'object' then raise exception 'Simulado inválido.'; end if;
  if p_payload->'sim'->>'id' is distinct from p_id then raise exception 'Identificador não confere com o conteúdo.'; end if;
  if jsonb_array_length(p_payload->'questions') > 400 then raise exception 'Simulado com questões demais.'; end if;
  if length(p_payload::text) > 800000 then raise exception 'Simulado grande demais.'; end if;
  if (select count(*) from app_private.sims where owner_id = uid) >= 40 then raise exception 'Limite de 40 simulados por conta atingido. Remova algum para adicionar outro.'; end if;
  insert into app_private.sims(owner_id, id, nome, fonte, payload)
  values (uid, p_id, left(coalesce(p_nome, p_id), 120), left(coalesce(p_fonte, ''), 80), p_payload)
  on conflict (owner_id, id) do nothing;
end $$;

-- Remove um simulado da PRÓPRIA conta
create or replace function public.app_delete_sim(p_token text, p_id text) returns void
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  delete from app_private.sims where owner_id = uid and id = p_id;
end $$;

-- ---------- ranking: SÓ quantos simulados cada pessoa já fez ----------
-- Um simulado conta como "feito" quando a pessoa respondeu todas as questões dele ao menos uma vez (o app calcula e informa o número;
-- o contador só sobe). O ranking não mostra acertos, erros, respostas, questões nem o nome dos simulados.
create or replace function public.app_set_simulados(p_token text, p_n int) returns void
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if p_n is null or p_n < 0 or p_n > 500 then raise exception 'Valor inválido.'; end if;
  insert into app_private.stats(user_id, simulados) values (uid, p_n)
  on conflict (user_id) do update set simulados = greatest(app_private.stats.simulados, excluded.simulados);
end $$;

-- Apelido do ranking: qualquer nome (2 a 24 caracteres), sem relação com o usuário de login.
-- O usuário de login NUNCA aparece para outras pessoas (assim ninguém sabe qual conta tentar travar).
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

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function
  public.app_register(text,text,text), public.app_login(text,text), public.app_me(text), public.app_logout(text),
  public.app_change_password(text,text,text), public.app_push_answers(text,jsonb), public.app_pull_answers(text,bigint,int),
  public.app_list_sims(text), public.app_get_sim(text,text), public.app_add_sim(text,text,text,text,jsonb),
  public.app_delete_sim(text,text), public.app_leaderboard(text), public.app_set_simulados(text,int), public.app_set_display_name(text,text)
to anon, authenticated;

-- =====================================================================================
-- CÓDIGO DE CONVITE (execute UMA vez, trocando o texto). Quem não souber o código não consegue se cadastrar.
-- Escolha algo que não esteja em nenhum arquivo do GitHub e passe aos amigos por mensagem privada.
--   insert into app_private.settings(key, value) values ('invite_hash', extensions.crypt('TROQUE-ESTE-CODIGO', extensions.gen_salt('bf', 10)))
--   on conflict (key) do update set value = excluded.value;
-- Para fechar os cadastros (depois que todos entraram):   delete from app_private.settings where key = 'invite_hash';
--
-- Esqueceu a senha de alguém? (sem e-mail não há recuperação automática):
--   update app_private.users set pass_hash = extensions.crypt('nova-senha-aqui', extensions.gen_salt('bf', 10)) where username = 'fulano';
--   delete from app_private.sessions where user_id = (select id from app_private.users where username = 'fulano');
-- Remover um usuário e tudo dele:   delete from app_private.users where username = 'fulano';
-- Remover um simulado de alguém:    delete from app_private.sims where owner_id = (select id from app_private.users where username = 'fulano') and id = 'id-do-simulado';
-- =====================================================================================
