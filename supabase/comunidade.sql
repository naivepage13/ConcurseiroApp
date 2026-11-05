-- Estudo PMSC — PORTAL DA COMUNIDADE (materiais compartilhados + anotações pessoais)
-- Execute UMA vez no SQL Editor do Supabase, DEPOIS do schema.sql. É seguro rodar de novo (idempotente).
--
-- Mesmas camadas de segurança do restante do app:
--  * tabelas no schema privado app_private, com RLS ligado e sem permissão direta para anon/authenticated;
--  * toda função exige o token de sessão; o login (usuário) NUNCA aparece para outras pessoas — só o apelido;
--  * cada publicação é um link https OU um arquivo PDF (guardado no Storage do Supabase, bucket "comunidade");
--  * SEM limite diário de publicações. Para o projeto NUNCA passar do plano gratuito (1 GB de arquivos), há tetos de ESPAÇO:
--    10 MB por PDF, 150 MB por pessoa e 900 MB no total (veja as constantes em app_cm_upload_ticket; mude se contratar plano pago);
--  * denúncia esconde a publicação sozinha a partir de 3 denúncias;
--  * anotações são PRIVADAS: só o dono lê/edita.

create table if not exists app_private.cm_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_private.users(id) on delete cascade,
  kind text not null check (kind in ('video','apostila','simulado','resumo')),
  title text not null check (char_length(title) between 3 and 120),
  url text check (url is null or url ~ '^https://[^\s<>"'']{4,500}$'),
  file_path text,
  file_size int,
  disciplina text check (disciplina is null or char_length(disciplina) <= 60),
  descr text check (descr is null or char_length(descr) <= 300),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists cm_posts_new_idx on app_private.cm_posts (created_at desc);
create index if not exists cm_posts_user_idx on app_private.cm_posts (user_id);

create table if not exists app_private.cm_votes (
  post_id uuid not null references app_private.cm_posts(id) on delete cascade,
  user_id uuid not null references app_private.users(id) on delete cascade,
  primary key (post_id, user_id)
);
create table if not exists app_private.cm_reports (
  post_id uuid not null references app_private.cm_posts(id) on delete cascade,
  user_id uuid not null references app_private.users(id) on delete cascade,
  primary key (post_id, user_id)
);
create table if not exists app_private.cm_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_private.users(id) on delete cascade,
  title text not null default 'Sem título' check (char_length(title) <= 80),
  body text not null check (char_length(body) between 1 and 5000),
  post_id uuid references app_private.cm_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cm_notes_user_idx on app_private.cm_notes (user_id, updated_at desc);

-- (se a versão anterior deste arquivo já foi executada, estas linhas a atualizam)
alter table app_private.cm_posts add column if not exists file_path text;
alter table app_private.cm_posts add column if not exists file_size int;
alter table app_private.cm_posts alter column url drop not null;
alter table app_private.cm_posts drop constraint if exists cm_posts_url_check;
alter table app_private.cm_posts add constraint cm_posts_url_check check (url is null or url ~ '^https://[^\s<>"'']{4,500}$');
alter table app_private.cm_posts drop constraint if exists cm_posts_link_or_file;
alter table app_private.cm_posts add constraint cm_posts_link_or_file check (url is not null or file_path is not null);

-- ---------- PDFs: bucket + "bilhetes" de envio ----------
-- Quem envia precisa de um bilhete (ticket) emitido por app_cm_upload_ticket (que confere sessão e cotas). O Storage só aceita
-- gravar o caminho exato do bilhete e só apaga arquivos marcados como descartáveis. Os nomes são aleatórios (impossíveis de adivinhar).
create table if not exists app_private.cm_uploads (
  path text primary key check (path ~ '^[0-9a-f-]{36}\.pdf$'),
  user_id uuid not null references app_private.users(id) on delete cascade,
  size int not null check (size between 1 and 10485760),
  used boolean not null default false,        -- já virou publicação
  deletable boolean not null default false,   -- o Storage pode apagar este arquivo
  created_at timestamptz not null default now()
);
create index if not exists cm_uploads_user_idx on app_private.cm_uploads (user_id);
alter table app_private.cm_uploads enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comunidade', 'comunidade', true, 10485760, array['application/pdf'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

create or replace function public.cm_can_upload(p_name text) returns boolean
language sql security definer set search_path = app_private, extensions as $$
  select exists(select 1 from app_private.cm_uploads where path = p_name and not used and not deletable and created_at > now() - interval '1 hour');
$$;
create or replace function public.cm_can_delete(p_name text) returns boolean
language sql security definer set search_path = app_private, extensions as $$
  select exists(select 1 from app_private.cm_uploads where path = p_name and deletable);
$$;
revoke all on function public.cm_can_upload(text), public.cm_can_delete(text) from public;
grant execute on function public.cm_can_upload(text), public.cm_can_delete(text) to anon, authenticated;

drop policy if exists cm_pdf_insert on storage.objects;
create policy cm_pdf_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'comunidade' and public.cm_can_upload(name));
drop policy if exists cm_pdf_delete on storage.objects;
create policy cm_pdf_delete on storage.objects for delete to anon, authenticated
  using (bucket_id = 'comunidade' and public.cm_can_delete(name));
-- (sem política de SELECT: ninguém consegue LISTAR a pasta; só abre quem tem o link, e o link só aparece dentro do app)

alter table app_private.cm_posts   enable row level security;
alter table app_private.cm_votes   enable row level security;
alter table app_private.cm_reports enable row level security;
alter table app_private.cm_notes   enable row level security;

-- ---------- listar ----------
drop function if exists public.app_cm_list(text,text,text,text,boolean,int);
create or replace function public.app_cm_list(p_token text, p_kind text default null, p_sort text default 'top', p_q text default null, p_mine boolean default false, p_limit int default 30)
returns table(id uuid, kind text, title text, url text, file_path text, file_size int, disciplina text, descr text, author text, votes int, voted boolean, mine boolean, created_at timestamptz)
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); q text := nullif(btrim(coalesce(p_q,'')), '');
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if q is not null then q := '%' || replace(replace(replace(left(q, 60), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select p.id, p.kind, p.title, p.url, p.file_path, p.file_size, p.disciplina, p.descr, coalesce(u.display_name, 'Anônimo'),
           (select count(*)::int from app_private.cm_votes v where v.post_id = p.id),
           exists(select 1 from app_private.cm_votes v where v.post_id = p.id and v.user_id = uid),
           (p.user_id = uid), p.created_at
    from app_private.cm_posts p join app_private.users u on u.id = p.user_id
    where (not p.hidden or p.user_id = uid)
      and (p_kind is null or p.kind = p_kind)
      and (not coalesce(p_mine, false) or p.user_id = uid)
      and (q is null or p.title ilike q or coalesce(p.disciplina,'') ilike q)
    order by case when p_sort = 'new' then 0 else (select count(*) from app_private.cm_votes v where v.post_id = p.id) end desc,
             p.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end $$;

-- ---------- compartilhar ----------
-- Passo 1 de um PDF: pedir o bilhete. Confere sessão, apelido e as cotas de espaço (é aqui que o projeto fica dentro do plano grátis).
create or replace function public.app_cm_upload_ticket(p_token text, p_size int) returns text
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); nick text; pth text;
  max_file constant int := 10485760;          -- 10 MB por PDF
  max_user constant bigint := 157286400;      -- 150 MB por pessoa
  max_total constant bigint := 943718400;     -- 900 MB no total (o plano grátis tem 1 GB)
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  select display_name into nick from app_private.users where id = uid;
  if nick is null then raise exception 'Defina seu apelido em Conta antes de compartilhar (é ele que aparece como autor).'; end if;
  if p_size is null or p_size < 100 or p_size > max_file then raise exception 'O PDF precisa ter no máximo 10 MB.'; end if;
  -- envios antigos que nunca viraram publicação: liberam o arquivo para o app apagar do Storage
  update app_private.cm_uploads set deletable = true where user_id = uid and not used and not deletable and created_at < now() - interval '1 hour';
  if (select count(*) from app_private.cm_uploads where user_id = uid and not used and not deletable and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Você tem envios pendentes demais. Aguarde alguns minutos.'; end if;
  if coalesce((select sum(size) from app_private.cm_uploads where user_id = uid and not deletable and (used or created_at > now() - interval '1 hour')), 0) + p_size > max_user then
    raise exception 'Você atingiu o limite de 150 MB em PDFs. Apague algum material seu para enviar outro.'; end if;
  -- espaço REAL ocupado no Storage (+ envios em andamento), não só o que está registrado
  if coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o where o.bucket_id = 'comunidade'), 0)
     + coalesce((select sum(size) from app_private.cm_uploads where not used and not deletable and created_at > now() - interval '1 hour'), 0) + p_size > max_total then
    raise exception 'O espaço de PDFs da comunidade está cheio no momento. Compartilhe o link do material por enquanto.'; end if;
  pth := gen_random_uuid()::text || '.pdf';
  insert into app_private.cm_uploads(path, user_id, size) values (pth, uid, p_size);
  return pth;
end $$;

-- Compartilhar: informe p_url (link) OU p_file (caminho devolvido pelo bilhete, depois de enviar o PDF).
drop function if exists public.app_cm_add(text,text,text,text,text,text);
create or replace function public.app_cm_add(p_token text, p_kind text, p_title text, p_url text, p_disc text default null, p_descr text default null, p_file text default null)
returns uuid language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); t text := btrim(regexp_replace(coalesce(p_title,''), '\s+', ' ', 'g')); u text := nullif(btrim(coalesce(p_url,'')), ''); nid uuid; nick text; up app_private.cm_uploads; real_size bigint;
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  select display_name into nick from app_private.users where id = uid;
  if nick is null then raise exception 'Defina seu apelido em Conta antes de compartilhar (é ele que aparece como autor).'; end if;
  if p_kind not in ('video','apostila','simulado','resumo') then raise exception 'Tipo de material inválido.'; end if;
  if char_length(t) < 3 or char_length(t) > 120 then raise exception 'O título precisa ter de 3 a 120 caracteres.'; end if;
  if p_file is not null then
    select * into up from app_private.cm_uploads where path = p_file and user_id = uid and not used and not deletable;
    if not found then raise exception 'Envio de PDF não encontrado ou expirado. Tente enviar de novo.'; end if;
    select coalesce((o.metadata->>'size')::bigint, 0) into real_size from storage.objects o where o.bucket_id = 'comunidade' and o.name = p_file;
    if real_size is null or real_size = 0 then raise exception 'O PDF não chegou ao servidor. Tente enviar de novo.'; end if;
    if real_size > 10485760 then update app_private.cm_uploads set deletable = true where path = p_file; raise exception 'O PDF precisa ter no máximo 10 MB.'; end if;
    update app_private.cm_uploads set used = true, size = real_size::int where path = p_file;
    insert into app_private.cm_posts(user_id, kind, title, file_path, file_size, disciplina, descr)
    values (uid, p_kind, t, p_file, real_size::int, nullif(left(btrim(coalesce(p_disc,'')), 60), ''), nullif(left(btrim(coalesce(p_descr,'')), 300), ''))
    returning cm_posts.id into nid;
    return nid;
  end if;
  if u is null or u !~ '^https://[^\s<>"'']{4,500}$' then raise exception 'Cole um link que comece com https://'; end if;
  if exists(select 1 from app_private.cm_posts where url = u and not hidden) then raise exception 'Este link já foi compartilhado.'; end if;
  insert into app_private.cm_posts(user_id, kind, title, url, disciplina, descr)
  values (uid, p_kind, t, u, nullif(left(btrim(coalesce(p_disc,'')), 60), ''), nullif(left(btrim(coalesce(p_descr,'')), 300), ''))
  returning cm_posts.id into nid;
  return nid;
end $$;

-- Se algo falhar depois do envio (ou a pessoa desistir), libera o arquivo para o app apagá-lo do Storage.
create or replace function public.app_cm_discard(p_token text, p_path text) returns void
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  update app_private.cm_uploads set deletable = true where path = p_path and user_id = uid and not used;
end $$;

-- Faxina: arquivos seus que já podem sair do Storage (publicação apagada, envio abandonado). O app apaga e depois chama app_cm_forget.
create or replace function public.app_cm_pending_deletes(p_token text) returns setof text
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  update app_private.cm_uploads set deletable = true where user_id = uid and not used and not deletable and created_at < now() - interval '1 hour';
  return query select path from app_private.cm_uploads where user_id = uid and deletable limit 20;
end $$;
create or replace function public.app_cm_forget(p_token text, p_path text) returns void
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  delete from app_private.cm_uploads where path = p_path and user_id = uid and deletable
    and not exists(select 1 from storage.objects o where o.bucket_id = 'comunidade' and o.name = p_path);
end $$;

-- Apagar a própria publicação. Devolve o caminho do PDF (se havia) para o app removê-lo do Storage e liberar espaço.
drop function if exists public.app_cm_delete(text,uuid);
create or replace function public.app_cm_delete(p_token text, p_id uuid) returns text
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); fp text;
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  delete from app_private.cm_posts where id = p_id and user_id = uid returning file_path into fp;
  if fp is not null then update app_private.cm_uploads set deletable = true where path = fp and user_id = uid; end if;
  return fp;
end $$;

-- ---------- "útil" (liga/desliga) e denúncia ----------
create or replace function public.app_cm_vote(p_token text, p_id uuid) returns json
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); owner uuid; had boolean; n int;
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  select user_id into owner from app_private.cm_posts where id = p_id and not hidden;
  if owner is null then raise exception 'Material não encontrado.'; end if;
  if owner = uid then raise exception 'Você não pode marcar o próprio material como útil.'; end if;
  delete from app_private.cm_votes where post_id = p_id and user_id = uid; get diagnostics n = row_count; had := n > 0;
  if not had then insert into app_private.cm_votes(post_id, user_id) values (p_id, uid); end if;
  select count(*)::int into n from app_private.cm_votes where post_id = p_id;
  return json_build_object('votes', n, 'voted', not had);
end $$;

create or replace function public.app_cm_report(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if not exists(select 1 from app_private.cm_posts where id = p_id) then raise exception 'Material não encontrado.'; end if;
  insert into app_private.cm_reports(post_id, user_id) values (p_id, uid) on conflict do nothing;
  if (select count(*) from app_private.cm_reports where post_id = p_id) >= 3 then
    update app_private.cm_posts set hidden = true where id = p_id; end if;
end $$;

-- ---------- anotações (privadas) ----------
create or replace function public.app_notes_list(p_token text)
returns table(id uuid, title text, body text, post_id uuid, post_title text, updated_at timestamptz)
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  return query
    select n.id, n.title, n.body, n.post_id, (select p.title from app_private.cm_posts p where p.id = n.post_id and (not p.hidden or p.user_id = uid)), n.updated_at
    from app_private.cm_notes n where n.user_id = uid order by n.updated_at desc limit 300;
end $$;

create or replace function public.app_note_save(p_token text, p_id uuid, p_title text, p_body text, p_post uuid default null)
returns uuid language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token); t text := left(btrim(coalesce(p_title,'')), 80); b text := btrim(coalesce(p_body,'')); nid uuid;
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if char_length(b) < 1 or char_length(b) > 5000 then raise exception 'A anotação precisa ter de 1 a 5000 caracteres.'; end if;
  if t = '' then t := 'Sem título'; end if;
  if p_post is not null and not exists(select 1 from app_private.cm_posts where id = p_post) then p_post := null; end if;
  if p_id is not null and exists(select 1 from app_private.cm_notes where id = p_id and user_id = uid) then
    update app_private.cm_notes set title = t, body = b, post_id = p_post, updated_at = now() where id = p_id and user_id = uid;
    return p_id;
  end if;
  if (select count(*) from app_private.cm_notes where user_id = uid) >= 300 then raise exception 'Limite de 300 anotações atingido. Apague alguma antes.'; end if;
  insert into app_private.cm_notes(user_id, title, body, post_id) values (uid, t, b, p_post) returning cm_notes.id into nid;
  return nid;
end $$;

create or replace function public.app_note_delete(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = app_private, extensions as $$
declare uid uuid := app_private.uid(p_token);
begin
  if uid is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  delete from app_private.cm_notes where id = p_id and user_id = uid;
end $$;

revoke all on function
  public.app_cm_list(text,text,text,text,boolean,int), public.app_cm_add(text,text,text,text,text,text,text), public.app_cm_delete(text,uuid),
  public.app_cm_upload_ticket(text,int), public.app_cm_discard(text,text), public.app_cm_pending_deletes(text), public.app_cm_forget(text,text),
  public.app_cm_vote(text,uuid), public.app_cm_report(text,uuid), public.app_notes_list(text),
  public.app_note_save(text,uuid,text,text,uuid), public.app_note_delete(text,uuid)
from public, anon, authenticated;
grant execute on function
  public.app_cm_list(text,text,text,text,boolean,int), public.app_cm_add(text,text,text,text,text,text,text), public.app_cm_delete(text,uuid),
  public.app_cm_upload_ticket(text,int), public.app_cm_discard(text,text), public.app_cm_pending_deletes(text), public.app_cm_forget(text,text),
  public.app_cm_vote(text,uuid), public.app_cm_report(text,uuid), public.app_notes_list(text),
  public.app_note_save(text,uuid,text,text,uuid), public.app_note_delete(text,uuid)
to anon, authenticated;
