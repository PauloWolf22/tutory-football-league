-- =====================================================================================
-- Tutory Football League · Fase 0: empresas, contas e foto do jogador
-- Projeto Supabase NOVO, exclusivo do Football (decisão do Paulo em 10/11/2026).
--
-- Rodar inteiro no SQL Editor do projeto. Pode rodar de novo sem duplicar nada.
--
-- Modelo multiempresa desde o início:
--   orgs          uma linha por empresa (a Tutory é a primeira)
--   org_members   vínculo pessoa ↔ empresa: nome, papel, aprovação e foto
-- Foto: bucket privado "player-photos", arquivo em <org_id>/<user_id>/<timestamp>.jpg.
--   Cada um grava e apaga só a própria pasta; só membros aprovados da mesma empresa veem.
--   A foto aparece na hora (sem aprovação prévia); o ADM pode remover e tudo vai para private.audit.
-- =====================================================================================

create extension if not exists pgcrypto;
create schema if not exists private;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (length(name) between 2 and 80),
  created_at timestamptz not null default now()
);
insert into public.orgs (slug, name) values ('tutory', 'Tutory') on conflict (slug) do nothing;

create table if not exists public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(display_name) between 2 and 60),
  role text not null default 'player' check (role in ('owner', 'admin', 'organizer', 'player')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  photo_path text,
  photo_updated_at timestamptz,
  photo_consent_at timestamptz,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  primary key (org_id, user_id)
);
create index if not exists org_members_user on public.org_members (user_id);

create table if not exists private.audit (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor uuid,
  action text not null,
  target uuid,
  detail jsonb,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------- funções de apoio (schema private, fora da API)
create or replace function private.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function private.member_status(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select status from public.org_members where org_id = p_org and user_id = (select auth.uid())
$$;

create or replace function private.is_approved(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.member_status(p_org) = 'approved', false)
$$;

create or replace function private.is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members
                 where org_id = p_org and user_id = (select auth.uid())
                   and status = 'approved' and role in ('owner', 'admin'))
$$;

create or replace function private.org_id(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.orgs where slug = p_slug
$$;

-- As políticas de RLS rodam com o papel de quem consulta: precisam enxergar estas funções.
grant usage on schema private to authenticated;
grant execute on function private.try_uuid(text), private.member_status(uuid), private.is_approved(uuid),
  private.is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS das tabelas
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

revoke all on public.orgs, public.org_members from anon, authenticated;
grant select on public.orgs to anon, authenticated;
grant select on public.org_members to authenticated;

drop policy if exists "orgs: leitura" on public.orgs;
create policy "orgs: leitura" on public.orgs for select to anon, authenticated using (true);

-- Cada um vê a própria linha; membros aprovados veem os aprovados da mesma empresa.
drop policy if exists "membros: o proprio ou aprovados da empresa" on public.org_members;
create policy "membros: o proprio ou aprovados da empresa" on public.org_members for select to authenticated
  using (user_id = (select auth.uid()) or (status = 'approved' and private.is_approved(org_id)));
-- Nenhuma escrita direta: tudo passa pelas funções tfl_* abaixo.

-- ---------------------------------------------------------------- funções da API
create or replace function public.tfl_me(p_org text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); r public.org_members;
begin
  if (select auth.uid()) is null then return jsonb_build_object('error', 'Entre na sua conta.'); end if;
  if v_org is null then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  select * into r from public.org_members where org_id = v_org and user_id = (select auth.uid());
  if not found then return jsonb_build_object('member', false, 'org_id', v_org); end if;
  return jsonb_build_object('member', true, 'org_id', v_org, 'name', r.display_name, 'role', r.role,
    'status', r.status, 'photo_path', r.photo_path, 'photo_updated_at', r.photo_updated_at);
end $$;

-- Entrar na liga da empresa. Idempotente: chamar de novo não muda papel nem aprovação.
create or replace function public.tfl_join(p_org text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.org_id(p_org); v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then return jsonb_build_object('error', 'Entre na sua conta.'); end if;
  if v_org is null then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  if length(v_name) not between 2 and 60 then return jsonb_build_object('error', 'Informe seu nome (2 a 60 letras).'); end if;
  insert into public.org_members (org_id, user_id, display_name) values (v_org, v_uid, v_name)
    on conflict (org_id, user_id) do nothing;
  return public.tfl_me(p_org);
end $$;

-- Define (ou remove, com p_path nulo) a foto do próprio jogador. Devolve o caminho anterior,
-- que o app apaga do Storage depois.
create or replace function public.tfl_set_photo(p_org text, p_path text, p_consent boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.org_id(p_org); v_old text; v_status text;
begin
  if v_uid is null then return jsonb_build_object('error', 'Entre na sua conta.'); end if;
  select status, photo_path into v_status, v_old from public.org_members where org_id = v_org and user_id = v_uid;
  if not found then return jsonb_build_object('error', 'Você ainda não faz parte desta liga.'); end if;
  if v_status = 'blocked' then return jsonb_build_object('error', 'Sua conta está bloqueada nesta liga.'); end if;
  if p_path is not null then
    if not coalesce(p_consent, false) then return jsonb_build_object('error', 'É preciso autorizar o uso da foto.'); end if;
    if p_path !~ ('^' || v_org::text || '/' || v_uid::text || '/[0-9]{10,16}\.jpg$') then
      return jsonb_build_object('error', 'Caminho de foto inválido.');
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'player-photos' and name = p_path) then
      return jsonb_build_object('error', 'A foto não chegou ao armazenamento. Tente de novo.');
    end if;
  end if;
  update public.org_members
     set photo_path = p_path, photo_updated_at = now(),
         photo_consent_at = case when p_path is null then photo_consent_at else now() end
   where org_id = v_org and user_id = v_uid;
  insert into private.audit (org_id, actor, action, target, detail)
    values (v_org, v_uid, case when p_path is null then 'photo.remove' else 'photo.set' end, v_uid,
            jsonb_build_object('old', v_old, 'new', p_path));
  return jsonb_build_object('ok', true, 'photo_path', p_path, 'old_path', v_old);
end $$;

-- ADM remove a foto de alguém (foto inadequada). O app do ADM apaga o arquivo em seguida.
create or replace function public.tfl_admin_remove_photo(p_org text, p_user uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_old text;
begin
  if not private.is_admin(v_org) then return jsonb_build_object('error', 'Só o administrador da liga pode remover fotos.'); end if;
  select photo_path into v_old from public.org_members where org_id = v_org and user_id = p_user;
  if not found then return jsonb_build_object('error', 'Jogador não encontrado.'); end if;
  update public.org_members set photo_path = null, photo_updated_at = now() where org_id = v_org and user_id = p_user;
  insert into private.audit (org_id, actor, action, target, detail)
    values (v_org, (select auth.uid()), 'photo.admin_remove', p_user,
            jsonb_build_object('old', v_old, 'reason', left(p_reason, 200)));
  return jsonb_build_object('ok', true, 'old_path', v_old);
end $$;

-- ADM aprova, bloqueia ou devolve para pendente.
create or replace function public.tfl_admin_set_status(p_org text, p_user uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org);
begin
  if not private.is_admin(v_org) then return jsonb_build_object('error', 'Só o administrador da liga pode aprovar contas.'); end if;
  if p_status not in ('pending', 'approved', 'blocked') then return jsonb_build_object('error', 'Situação inválida.'); end if;
  if p_user = (select auth.uid()) then return jsonb_build_object('error', 'Você não pode mudar a própria situação.'); end if;
  update public.org_members set status = p_status, approved_at = case when p_status = 'approved' then now() else approved_at end
   where org_id = v_org and user_id = p_user;
  if not found then return jsonb_build_object('error', 'Jogador não encontrado.'); end if;
  insert into private.audit (org_id, actor, action, target, detail)
    values (v_org, (select auth.uid()), 'member.status', p_user, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.tfl_me(text), public.tfl_join(text, text), public.tfl_set_photo(text, text, boolean),
  public.tfl_admin_remove_photo(text, uuid, text), public.tfl_admin_set_status(text, uuid, text) from public, anon;
grant execute on function public.tfl_me(text), public.tfl_join(text, text), public.tfl_set_photo(text, text, boolean),
  public.tfl_admin_remove_photo(text, uuid, text), public.tfl_admin_set_status(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------- Storage: bucket e regras
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

-- Pasta 1 = empresa, pasta 2 = dono do arquivo.
drop policy if exists "fotos: ver (dono ou aprovados da empresa)" on storage.objects;
create policy "fotos: ver (dono ou aprovados da empresa)" on storage.objects for select to authenticated
  using (bucket_id = 'player-photos' and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or private.is_approved(private.try_uuid((storage.foldername(name))[1]))));

drop policy if exists "fotos: enviar so na propria pasta" on storage.objects;
create policy "fotos: enviar so na propria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'player-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and coalesce(private.member_status(private.try_uuid((storage.foldername(name))[1])), 'blocked') <> 'blocked');

drop policy if exists "fotos: apagar (dono ou ADM da empresa)" on storage.objects;
create policy "fotos: apagar (dono ou ADM da empresa)" on storage.objects for delete to authenticated
  using (bucket_id = 'player-photos' and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or private.is_admin(private.try_uuid((storage.foldername(name))[1]))));
-- Sem política de UPDATE: cada troca grava um arquivo novo (evita cache de foto antiga).

-- =====================================================================================
-- DEPOIS DE RODAR:
-- 1. Authentication > Sign In / Providers > Email: desligar "Confirm email"
--    (o SMTP padrão do Supabase só envia para membros do projeto) ou configurar um SMTP próprio.
-- 2. Criar a sua conta pelo protótipo (Entrar > Criar conta).
-- 3. Tornar-se dono da liga da Tutory (troque o e-mail):
--    update public.org_members set role = 'owner', status = 'approved', approved_at = now()
--     where org_id = (select id from public.orgs where slug = 'tutory')
--       and user_id = (select id from auth.users where email = 'SEU-EMAIL-AQUI');
-- =====================================================================================
