-- =====================================================================================
-- Tutory Football League · Fase 1: fundação administrativa
-- Plano aprovado em 10/11/2026 (APP_FUT/docs/PLANO-ETAPA-2.md, §3, §4 e §12).
--
-- 1. Perfil global do jogador (profiles): nome, foto, nascimento e responsável (menores)
-- 2. Super admin da plataforma (platform_admins), fora das empresas
-- 3. Empresas com tipo e situação (ativa, suspensa, encerrada)
-- 4. Permissões: catálogo, papéis (padrão e personalizados) e concessões com escopo
-- 5. private.can(): a única regra de permissão, usada por RLS e funções
-- 6. Sessões de suporte do super admin (com motivo, prazo e auditoria)
-- 7. Funções da API para jogador, gestor e super admin
--
-- Compatível com o protótipo: tfl_me, tfl_join, tfl_set_photo e tfl_admin_* continuam
-- funcionando, agora lendo e gravando o perfil global.
-- =====================================================================================

-- ---------------------------------------------------------------- 1. perfil global
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(display_name) between 2 and 60),
  nick text check (nick is null or length(nick) <= 30),
  photo_path text,
  photo_updated_at timestamptz,
  photo_consent_at timestamptz,
  show_on_screen boolean not null default true,      -- aparecer no telão
  birth_date date check (birth_date is null or birth_date between date '1900-01-01' and current_date),
  guardian_name text check (guardian_name is null or length(guardian_name) between 2 and 80),
  guardian_email text check (guardian_email is null or guardian_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  guardian_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migra nome e foto que estavam no vínculo com a empresa (fase 0).
insert into public.profiles (id, display_name, photo_path, photo_updated_at, photo_consent_at)
select distinct on (m.user_id) m.user_id, m.display_name, m.photo_path, m.photo_updated_at, m.photo_consent_at
  from public.org_members m
 order by m.user_id, m.photo_updated_at desc nulls last, m.created_at desc
on conflict (id) do nothing;

-- Menor de idade: calculado sempre na hora, nunca gravado.
create or replace function private.is_minor(p_birth date) returns boolean
language sql stable set search_path = '' as $$
  select p_birth is not null and p_birth > (current_date - interval '18 years')::date
$$;

-- ---------------------------------------------------------------- 2. super admin
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
-- O super admin (decisão do plano, §3.3) vem do e-mail guardado no próprio banco, fora do código público:
--   insert into private.env (key, value) values ('super_admin_email', '<e-mail>');   -- rodar à mão uma vez
-- (Em 11/11/2026 esta migração já tinha rodado em produção e testes com o e-mail escrito aqui; tirado antes de publicar.)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'private' and table_name = 'env') then
    execute $q$insert into public.platform_admins (user_id)
             select u.id from auth.users u join private.env e on e.key = 'super_admin_email' and lower(e.value) = lower(u.email)
             on conflict do nothing$q$;
  end if;
end $$;

create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()))
$$;

-- ---------------------------------------------------------------- 3. empresas
alter table public.orgs add column if not exists kind text not null default 'community';
alter table public.orgs add column if not exists status text not null default 'active';
alter table public.orgs add column if not exists status_reason text;
alter table public.orgs add column if not exists timezone text not null default 'America/Sao_Paulo';
alter table public.orgs add column if not exists created_by uuid references auth.users (id) on delete set null;
do $$ begin
  alter table public.orgs add constraint orgs_kind_check check (kind in ('venue_company', 'organizer', 'community'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orgs add constraint orgs_status_check check (status in ('trial', 'active', 'suspended', 'closed'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- 4. permissões
create table if not exists public.permissions (
  key text primary key check (key ~ '^[a-z]+\.[a-z_]+$'),
  area text not null,
  label text not null,
  sort int not null default 0
);
insert into public.permissions (key, area, label, sort) values
  ('org.settings',       'Empresa',     'Editar dados da empresa',                 10),
  ('org.members',        'Empresa',     'Aprovar e bloquear membros',              20),
  ('org.roles',          'Empresa',     'Dar acessos à equipe',                    30),
  ('org.billing',        'Empresa',     'Ver e gerenciar a assinatura',            40),
  ('venue.manage',       'Campos',      'Gerenciar campos e horários',             50),
  ('booking.manage',     'Campos',      'Gerenciar reservas',                      60),
  ('group.manage',       'Jogos',       'Gerenciar grupos',                        70),
  ('match.manage',       'Jogos',       'Criar partidas e cuidar das listas',      80),
  ('draw.run',           'Jogos',       'Fazer sorteio e abrir o telão',           90),
  ('competition.manage', 'Jogos',       'Criar e organizar campeonatos',          100),
  ('comms.send',         'Comunicação', 'Enviar convites e lembretes',            110),
  ('comms.settings',     'Comunicação', 'Configurar WhatsApp e modelos',          120),
  ('reports.org',        'Relatórios',  'Ver relatórios',                         130)
on conflict (key) do update set area = excluded.area, label = excluded.label, sort = excluded.sort;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs (id) on delete cascade,   -- null = papel padrão da plataforma
  key text not null check (key ~ '^[a-z0-9_-]{2,40}$'),
  name text not null check (length(name) between 2 and 40),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now()
);
create unique index if not exists roles_org_key on public.roles (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- Papéis padrão (sem empresa). O papel principal de cada membro (org_members.role) aponta para um deles.
insert into public.roles (org_id, key, name, permissions)
select null, k, n, p from (values
  ('owner',     'Gestor',      array['org.settings','org.members','org.roles','org.billing','venue.manage','booking.manage','group.manage','match.manage','draw.run','competition.manage','comms.send','comms.settings','reports.org']),
  ('admin',     'Administrador', array['org.settings','org.members','venue.manage','booking.manage','group.manage','match.manage','draw.run','competition.manage','comms.send','comms.settings','reports.org']),
  ('organizer', 'Organizador', array['group.manage','match.manage','draw.run','competition.manage','comms.send','reports.org']),
  ('player',    'Jogador',     array[]::text[])
) as v(k, n, p)
where not exists (select 1 from public.roles r where r.org_id is null and r.key = v.k);

create table if not exists public.role_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references public.roles (id) on delete cascade,
  scope_type text not null default 'org' check (scope_type in ('org', 'venue', 'group')),
  scope_id uuid,                                  -- campo ou grupo (tabelas chegam na Fase 2)
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, user_id) references public.org_members (org_id, user_id) on delete cascade,
  check ((scope_type = 'org') = (scope_id is null))
);
create index if not exists role_grants_lookup on public.role_grants (org_id, user_id);

-- ---------------------------------------------------------------- 6. sessões de suporte
create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  reason text not null check (length(reason) between 5 and 300),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (expires_at > started_at and expires_at <= started_at + interval '2 hours')
);
create index if not exists support_sessions_org on public.support_sessions (org_id, started_at desc);

alter table private.audit add column if not exists support_session_id uuid;

create or replace function private.support_session(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.support_sessions s
   where s.org_id = p_org and s.admin_id = (select auth.uid())
     and s.ended_at is null and now() < s.expires_at
     and private.is_platform_admin()
   order by s.started_at desc limit 1
$$;

-- Registro de auditoria: marca sozinho a sessão de suporte, quando houver.
create or replace function private.log(p_org uuid, p_action text, p_target uuid, p_detail jsonb default null) returns void
language sql security definer set search_path = '' as $$
  insert into private.audit (org_id, actor, action, target, detail, support_session_id)
  values (p_org, (select auth.uid()), p_action, p_target, p_detail,
          case when p_org is null then null else private.support_session(p_org) end)
$$;

-- ---------------------------------------------------------------- 5. a regra de permissão
-- Pode o usuário atual fazer p_perm na empresa p_org (no campo/grupo p_scope_id, se houver)?
--   · super admin: só com sessão de suporte aberta naquela empresa
--   · empresa suspensa ou encerrada: ninguém escreve (exceto suporte)
--   · membro aprovado: papel principal (vale na empresa toda) + concessões com escopo
create or replace function private.can(p_org uuid, p_perm text, p_scope_type text default 'org', p_scope_id uuid default null)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_status text; v_role text;
begin
  if v_uid is null or p_org is null then return false; end if;
  if private.support_session(p_org) is not null then return true; end if;
  select status into v_status from public.orgs where id = p_org;
  if v_status is null or v_status in ('suspended', 'closed') then return false; end if;
  select role into v_role from public.org_members where org_id = p_org and user_id = v_uid and status = 'approved';
  if v_role is null then return false; end if;
  if exists (select 1 from public.roles r where r.org_id is null and r.key = v_role and p_perm = any (r.permissions)) then
    return true;
  end if;
  return exists (
    select 1 from public.role_grants g join public.roles r on r.id = g.role_id
     where g.org_id = p_org and g.user_id = v_uid and p_perm = any (r.permissions)
       and (g.scope_type = 'org' or (g.scope_type = p_scope_type and g.scope_id = p_scope_id)));
end $$;

-- Lista das permissões do usuário na empresa (para a tela mostrar só o que ele pode usar).
create or replace function private.my_permissions(p_org uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.key order by p.sort), '{}') from public.permissions p where private.can(p_org, p.key)
$$;

-- Os dois compartilham alguma empresa como membros aprovados?
create or replace function private.shares_org(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members a join public.org_members b on b.org_id = a.org_id
                  where a.user_id = (select auth.uid()) and a.status = 'approved'
                    and b.user_id = p_other and b.status = 'approved')
$$;

-- Quem cuida de membros numa empresa em que p_other está (mesmo pendente) pode ver o perfil básico.
create or replace function private.manages_member(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members m where m.user_id = p_other and private.can(m.org_id, 'org.members'))
$$;

grant execute on function private.is_minor(date), private.is_platform_admin(), private.support_session(uuid),
  private.can(uuid, text, text, uuid), private.my_permissions(uuid), private.shares_org(uuid),
  private.manages_member(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS das tabelas novas
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_grants enable row level security;
alter table public.support_sessions enable row level security;

revoke all on public.profiles, public.platform_admins, public.permissions, public.roles,
  public.role_grants, public.support_sessions from anon, authenticated;
-- Do perfil, só colunas públicas podem ser lidas direto. Nascimento e responsável só pela função do próprio.
grant select (id, display_name, nick, photo_path, photo_updated_at, show_on_screen) on public.profiles to authenticated;
grant select on public.permissions to authenticated;
grant select on public.roles, public.role_grants to authenticated;

drop policy if exists "perfis: o proprio, colegas ou quem gerencia" on public.profiles;
create policy "perfis: o proprio, colegas ou quem gerencia" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_org(id) or private.manages_member(id));
drop policy if exists "permissoes: leitura" on public.permissions;
create policy "permissoes: leitura" on public.permissions for select to authenticated using (true);
drop policy if exists "papeis: padrao ou da empresa" on public.roles;
create policy "papeis: padrao ou da empresa" on public.roles for select to authenticated
  using (org_id is null or private.can(org_id, 'org.roles') or private.is_approved(org_id));
drop policy if exists "concessoes: as proprias ou quem gerencia" on public.role_grants;
create policy "concessoes: as proprias ou quem gerencia" on public.role_grants for select to authenticated
  using (user_id = (select auth.uid()) or private.can(org_id, 'org.roles'));

-- Membros: quem gerencia membros vê também os pendentes e bloqueados.
drop policy if exists "membros: o proprio ou aprovados da empresa" on public.org_members;
drop policy if exists "membros: o proprio, aprovados ou quem gerencia" on public.org_members;
create policy "membros: o proprio, aprovados ou quem gerencia" on public.org_members for select to authenticated
  using (user_id = (select auth.uid()) or (status = 'approved' and private.is_approved(org_id))
         or private.can(org_id, 'org.members'));

-- ---------------------------------------------------------------- foto no perfil global
-- Caminho novo: <user_id>/<timestamp>.jpg. O antigo (<org>/<user>/<ts>.jpg) continua válido.
create or replace function private.photo_owner(p_name text) returns uuid
language sql stable set search_path = '' as $$
  select case when array_length(storage.foldername(p_name), 1) >= 2
              then private.try_uuid((storage.foldername(p_name))[2])
              else private.try_uuid((storage.foldername(p_name))[1]) end
$$;
grant execute on function private.photo_owner(text) to authenticated;

drop policy if exists "fotos: ver (dono ou aprovados da empresa)" on storage.objects;
drop policy if exists "fotos: ver (dono, colegas ou quem gerencia)" on storage.objects;
create policy "fotos: ver (dono, colegas ou quem gerencia)" on storage.objects for select to authenticated
  using (bucket_id = 'player-photos' and (
    private.photo_owner(name) = (select auth.uid())
    or private.shares_org(private.photo_owner(name))
    or private.manages_member(private.photo_owner(name))));

drop policy if exists "fotos: enviar so na propria pasta" on storage.objects;
create policy "fotos: enviar so na propria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'player-photos' and private.photo_owner(name) = (select auth.uid()));

drop policy if exists "fotos: apagar (dono ou ADM da empresa)" on storage.objects;
drop policy if exists "fotos: apagar (dono ou quem gerencia)" on storage.objects;
create policy "fotos: apagar (dono ou quem gerencia)" on storage.objects for delete to authenticated
  using (bucket_id = 'player-photos' and (
    private.photo_owner(name) = (select auth.uid()) or private.manages_member(private.photo_owner(name))));

-- ---------------------------------------------------------------- 7. API: jogador
create or replace function private.require_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  return v;
end $$;

-- Perfil completo do próprio jogador + suas empresas + se é super admin.
create or replace function public.tfl_profile_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); p public.profiles;
begin
  select * into p from public.profiles where id = v_uid;
  return jsonb_build_object(
    'id', v_uid,
    'email', (select email from auth.users where id = v_uid),
    'exists', p.id is not null,
    'display_name', p.display_name, 'nick', p.nick,
    'photo_path', p.photo_path, 'photo_updated_at', p.photo_updated_at,
    'show_on_screen', coalesce(p.show_on_screen, true) and not private.is_minor(p.birth_date),
    'birth_date', p.birth_date, 'is_minor', private.is_minor(p.birth_date),
    'guardian_name', p.guardian_name, 'guardian_email', p.guardian_email, 'guardian_consent_at', p.guardian_consent_at,
    'complete', p.id is not null and p.birth_date is not null
                and (not private.is_minor(p.birth_date) or p.guardian_consent_at is not null),
    'is_platform_admin', private.is_platform_admin(),
    'orgs', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'kind', o.kind,
               'org_status', o.status, 'role', m.role, 'status', m.status,
               'permissions', private.my_permissions(o.id)) order by o.name)
        from public.org_members m join public.orgs o on o.id = m.org_id where m.user_id = v_uid), '[]'::jsonb),
    'support', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'org_id', s.org_id, 'org_slug', o.slug, 'org_name', o.name,
               'reason', s.reason, 'expires_at', s.expires_at))
        from public.support_sessions s join public.orgs o on o.id = s.org_id
       where s.admin_id = v_uid and s.ended_at is null and now() < s.expires_at and private.is_platform_admin()), '[]'::jsonb)
  );
end $$;

-- Salva o perfil. Menor de 18: exige responsável e o consentimento dele; fica fora do telão.
create or replace function public.tfl_profile_save(
  p_name text, p_nick text, p_birth_date date,
  p_guardian_name text default null, p_guardian_email text default null, p_guardian_consent boolean default false,
  p_show_on_screen boolean default true
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_name text := btrim(coalesce(p_name, '')); v_minor boolean;
begin
  if length(v_name) not between 2 and 60 then return jsonb_build_object('error', 'Informe seu nome (2 a 60 letras).'); end if;
  if p_birth_date is null then return jsonb_build_object('error', 'Informe sua data de nascimento.'); end if;
  if p_birth_date > current_date - interval '5 years' or p_birth_date < date '1900-01-01' then
    return jsonb_build_object('error', 'Data de nascimento inválida.');
  end if;
  v_minor := private.is_minor(p_birth_date);
  if v_minor then
    if length(btrim(coalesce(p_guardian_name, ''))) < 2 then return jsonb_build_object('error', 'Menor de 18 anos: informe o nome do responsável.'); end if;
    if coalesce(p_guardian_email, '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('error', 'Menor de 18 anos: informe o e-mail do responsável.'); end if;
    if not coalesce(p_guardian_consent, false) then return jsonb_build_object('error', 'Menor de 18 anos: é preciso a autorização do responsável.'); end if;
  end if;
  insert into public.profiles as p (id, display_name, nick, birth_date, guardian_name, guardian_email, guardian_consent_at, show_on_screen)
  values (v_uid, v_name, nullif(btrim(coalesce(p_nick, '')), ''), p_birth_date,
          case when v_minor then btrim(p_guardian_name) end, case when v_minor then lower(btrim(p_guardian_email)) end,
          case when v_minor then now() end, case when v_minor then false else coalesce(p_show_on_screen, true) end)
  on conflict (id) do update set
    display_name = excluded.display_name, nick = excluded.nick, birth_date = excluded.birth_date,
    guardian_name = excluded.guardian_name, guardian_email = excluded.guardian_email,
    guardian_consent_at = case when v_minor then coalesce(p.guardian_consent_at, now()) end,
    show_on_screen = excluded.show_on_screen, updated_at = now();
  -- O nome nas ligas acompanha o perfil.
  update public.org_members set display_name = v_name where user_id = v_uid;
  perform private.log(null, 'profile.save', v_uid, jsonb_build_object('minor', v_minor));
  return public.tfl_profile_get();
end $$;

-- Foto do perfil global. Caminho: <user_id>/<timestamp>.jpg.
create or replace function public.tfl_profile_set_photo(p_path text, p_consent boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); p public.profiles; v_old text;
begin
  select * into p from public.profiles where id = v_uid;
  if not found then return jsonb_build_object('error', 'Complete seu perfil antes de enviar a foto.'); end if;
  if p_path is not null then
    if not coalesce(p_consent, false) then return jsonb_build_object('error', 'É preciso autorizar o uso da foto.'); end if;
    if private.is_minor(p.birth_date) and p.guardian_consent_at is null then
      return jsonb_build_object('error', 'Menor de 18 anos: a foto precisa da autorização do responsável.');
    end if;
    if p_path !~ ('^' || v_uid::text || '/[0-9]{10,16}\.jpg$') then return jsonb_build_object('error', 'Caminho de foto inválido.'); end if;
    if not exists (select 1 from storage.objects where bucket_id = 'player-photos' and name = p_path) then
      return jsonb_build_object('error', 'A foto não chegou ao armazenamento. Tente de novo.');
    end if;
  end if;
  v_old := p.photo_path;
  update public.profiles set photo_path = p_path, photo_updated_at = now(),
         photo_consent_at = case when p_path is null then photo_consent_at else now() end, updated_at = now()
   where id = v_uid;
  perform private.log(null, case when p_path is null then 'photo.remove' else 'photo.set' end, v_uid,
                      jsonb_build_object('old', v_old, 'new', p_path));
  return jsonb_build_object('ok', true, 'photo_path', p_path, 'old_path', v_old);
end $$;

-- ---------------------------------------------------------------- compatibilidade com o protótipo
create or replace function public.tfl_me(p_org text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); r public.org_members; p public.profiles;
begin
  if (select auth.uid()) is null then return jsonb_build_object('error', 'Entre na sua conta.'); end if;
  if v_org is null then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  select * into r from public.org_members where org_id = v_org and user_id = (select auth.uid());
  if not found then return jsonb_build_object('member', false, 'org_id', v_org); end if;
  select * into p from public.profiles where id = r.user_id;
  return jsonb_build_object('member', true, 'org_id', v_org, 'name', coalesce(p.display_name, r.display_name), 'role', r.role,
    'status', r.status, 'photo_path', p.photo_path, 'photo_updated_at', p.photo_updated_at);
end $$;

create or replace function public.tfl_join(p_org text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.org_id(p_org); v_name text := btrim(coalesce(p_name, '')); v_status text;
begin
  if v_uid is null then return jsonb_build_object('error', 'Entre na sua conta.'); end if;
  select status into v_status from public.orgs where id = v_org;
  if v_status is null then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  if v_status in ('suspended', 'closed') then return jsonb_build_object('error', 'Esta liga não está aceitando novos membros.'); end if;
  if length(v_name) not between 2 and 60 then return jsonb_build_object('error', 'Informe seu nome (2 a 60 letras).'); end if;
  insert into public.profiles (id, display_name) values (v_uid, v_name) on conflict (id) do nothing;
  insert into public.org_members (org_id, user_id, display_name) values (v_org, v_uid, v_name)
    on conflict (org_id, user_id) do nothing;
  return public.tfl_me(p_org);
end $$;

-- Protótipo: aceita o caminho antigo <org>/<user>/<ts>.jpg e grava no perfil global.
create or replace function public.tfl_set_photo(p_org text, p_path text, p_consent boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.org_id(p_org); v_old text; v_status text; p public.profiles;
begin
  if v_uid is null then return jsonb_build_object('error', 'Entre na sua conta.'); end if;
  select status into v_status from public.org_members where org_id = v_org and user_id = v_uid;
  if not found then return jsonb_build_object('error', 'Você ainda não faz parte desta liga.'); end if;
  if v_status = 'blocked' then return jsonb_build_object('error', 'Sua conta está bloqueada nesta liga.'); end if;
  select * into p from public.profiles where id = v_uid;
  if p_path is not null then
    if not coalesce(p_consent, false) then return jsonb_build_object('error', 'É preciso autorizar o uso da foto.'); end if;
    if private.is_minor(p.birth_date) and p.guardian_consent_at is null then
      return jsonb_build_object('error', 'Menor de 18 anos: a foto precisa da autorização do responsável.');
    end if;
    if p_path !~ ('^(' || v_org::text || '/)?' || v_uid::text || '/[0-9]{10,16}\.jpg$') then
      return jsonb_build_object('error', 'Caminho de foto inválido.');
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'player-photos' and name = p_path) then
      return jsonb_build_object('error', 'A foto não chegou ao armazenamento. Tente de novo.');
    end if;
  end if;
  v_old := p.photo_path;
  update public.profiles set photo_path = p_path, photo_updated_at = now(),
         photo_consent_at = case when p_path is null then photo_consent_at else now() end, updated_at = now()
   where id = v_uid;
  perform private.log(v_org, case when p_path is null then 'photo.remove' else 'photo.set' end, v_uid,
                      jsonb_build_object('old', v_old, 'new', p_path));
  return jsonb_build_object('ok', true, 'photo_path', p_path, 'old_path', v_old);
end $$;

-- ---------------------------------------------------------------- 7. API: gestor da empresa
-- Visão da empresa para quem é membro: dados, contagens e as permissões do usuário.
create or replace function public.tfl_org_overview(p_org text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); o public.orgs; v_member public.org_members; v_support uuid;
begin
  select * into o from public.orgs where slug = p_org;
  if not found then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  select * into v_member from public.org_members where org_id = o.id and user_id = v_uid;
  v_support := private.support_session(o.id);
  if v_support is null and (v_member.user_id is null or v_member.status <> 'approved') then
    return jsonb_build_object('error', 'Você não tem acesso a esta empresa.');
  end if;
  return jsonb_build_object(
    'id', o.id, 'slug', o.slug, 'name', o.name, 'kind', o.kind, 'status', o.status, 'status_reason', o.status_reason,
    'timezone', o.timezone, 'my_role', v_member.role, 'permissions', private.my_permissions(o.id),
    'support_session_id', v_support,
    'counts', jsonb_build_object(
      'approved', (select count(*) from public.org_members where org_id = o.id and status = 'approved'),
      'pending',  case when private.can(o.id, 'org.members') then (select count(*) from public.org_members where org_id = o.id and status = 'pending') end,
      'blocked',  case when private.can(o.id, 'org.members') then (select count(*) from public.org_members where org_id = o.id and status = 'blocked') end,
      'staff',    (select count(*) from public.org_members where org_id = o.id and status = 'approved' and role <> 'player'))
  );
end $$;

-- Lista de membros. Quem gerencia membros vê todos; os demais, só aprovados.
-- Dados de menores (nascimento, responsável) nunca saem daqui: só a marca "menor".
create or replace function public.tfl_org_members(p_org text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_org uuid := private.org_id(p_org); v_manage boolean;
begin
  if v_org is null then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  v_manage := private.can(v_org, 'org.members');
  if not v_manage and not private.is_approved(v_org) then return jsonb_build_object('error', 'Você não tem acesso a esta empresa.'); end if;
  return jsonb_build_object('can_manage', v_manage, 'can_roles', private.can(v_org, 'org.roles'), 'members', coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'name', coalesce(p.display_name, m.display_name), 'nick', p.nick,
             'photo_path', p.photo_path, 'role', m.role, 'status', m.status, 'joined_at', m.created_at,
             'approved_at', m.approved_at,
             'is_minor', case when v_manage then private.is_minor(p.birth_date) end,   -- só quem gerencia sabe a idade
             'grants', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'role', r.name, 'role_key', r.key,
                                 'scope_type', g.scope_type, 'scope_id', g.scope_id)), '[]'::jsonb)
                          from public.role_grants g join public.roles r on r.id = g.role_id
                         where g.org_id = v_org and g.user_id = m.user_id))
           order by case m.status when 'pending' then 0 when 'approved' then 1 else 2 end, coalesce(p.display_name, m.display_name))
      from public.org_members m left join public.profiles p on p.id = m.user_id
     where m.org_id = v_org and (v_manage or m.status = 'approved')), '[]'::jsonb));
end $$;

-- Aprovar, bloquear ou devolver para pendente (substitui a versão da fase 0).
create or replace function public.tfl_admin_set_status(p_org text, p_user uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_role text;
begin
  if not private.can(v_org, 'org.members') then return jsonb_build_object('error', 'Você não tem permissão para aprovar ou bloquear membros.'); end if;
  if p_status not in ('pending', 'approved', 'blocked') then return jsonb_build_object('error', 'Situação inválida.'); end if;
  if p_user = (select auth.uid()) then return jsonb_build_object('error', 'Você não pode mudar a própria situação.'); end if;
  select role into v_role from public.org_members where org_id = v_org and user_id = p_user;
  if not found then return jsonb_build_object('error', 'Jogador não encontrado.'); end if;
  if v_role = 'owner' and private.support_session(v_org) is null then return jsonb_build_object('error', 'O gestor da empresa não pode ser bloqueado.'); end if;
  update public.org_members set status = p_status, approved_at = case when p_status = 'approved' then now() else approved_at end
   where org_id = v_org and user_id = p_user;
  perform private.log(v_org, 'member.status', p_user, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

-- ADM remove a foto de alguém (agora do perfil global, para quem gerencia membros onde ele está).
create or replace function public.tfl_admin_remove_photo(p_org text, p_user uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_old text;
begin
  if not private.can(v_org, 'org.members') then return jsonb_build_object('error', 'Você não tem permissão para remover fotos.'); end if;
  if not exists (select 1 from public.org_members where org_id = v_org and user_id = p_user) then
    return jsonb_build_object('error', 'Jogador não encontrado.');
  end if;
  select photo_path into v_old from public.profiles where id = p_user;
  update public.profiles set photo_path = null, photo_updated_at = now(), updated_at = now() where id = p_user;
  perform private.log(v_org, 'photo.admin_remove', p_user, jsonb_build_object('old', v_old, 'reason', left(p_reason, 200)));
  return jsonb_build_object('ok', true, 'old_path', v_old);
end $$;

-- Papel principal de um membro (admin, organizer, player). O papel de gestor não muda por aqui.
create or replace function public.tfl_org_set_role(p_org text, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_cur text; v_status text;
begin
  if not private.can(v_org, 'org.roles') then return jsonb_build_object('error', 'Só o gestor pode mudar papéis.'); end if;
  if p_role not in ('admin', 'organizer', 'player') then return jsonb_build_object('error', 'Papel inválido.'); end if;
  select role, status into v_cur, v_status from public.org_members where org_id = v_org and user_id = p_user;
  if not found then return jsonb_build_object('error', 'Membro não encontrado.'); end if;
  if v_cur = 'owner' then return jsonb_build_object('error', 'O papel de gestor não pode ser alterado aqui.'); end if;
  if v_status <> 'approved' and p_role <> 'player' then return jsonb_build_object('error', 'Aprove o membro antes de dar um papel administrativo.'); end if;
  update public.org_members set role = p_role where org_id = v_org and user_id = p_user;
  perform private.log(v_org, 'member.role', p_user, jsonb_build_object('from', v_cur, 'to', p_role));
  return jsonb_build_object('ok', true);
end $$;

-- Papéis disponíveis (padrão + personalizados) e catálogo de permissões.
create or replace function public.tfl_roles_list(p_org text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org);
begin
  if not private.can(v_org, 'org.roles') then return jsonb_build_object('error', 'Só o gestor vê e edita papéis.'); end if;
  return jsonb_build_object(
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name, 'permissions', r.permissions,
                  'system', r.org_id is null) order by r.org_id nulls first, r.name), '[]'::jsonb)
                from public.roles r where r.org_id is null or r.org_id = v_org),
    'permissions', (select jsonb_agg(jsonb_build_object('key', key, 'area', area, 'label', label) order by sort) from public.permissions));
end $$;

-- Cria ou edita um papel personalizado da empresa.
create or replace function public.tfl_role_save(p_org text, p_id uuid, p_name text, p_permissions text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_name text := btrim(coalesce(p_name, '')); v_bad text; v_id uuid;
begin
  if not private.can(v_org, 'org.roles') then return jsonb_build_object('error', 'Só o gestor cria papéis.'); end if;
  if length(v_name) not between 2 and 40 then return jsonb_build_object('error', 'Dê um nome ao papel (2 a 40 letras).'); end if;
  select x into v_bad from unnest(coalesce(p_permissions, '{}')) x where x not in (select key from public.permissions) limit 1;
  if v_bad is not null then return jsonb_build_object('error', 'Permissão desconhecida: ' || v_bad); end if;
  if 'org.roles' = any (p_permissions) or 'org.billing' = any (p_permissions) then
    return jsonb_build_object('error', 'Dar acessos e assinatura ficam só com o gestor.');
  end if;
  if p_id is null then
    insert into public.roles (org_id, key, name, permissions)
    values (v_org, 'custom-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), v_name, p_permissions) returning id into v_id;
  else
    update public.roles set name = v_name, permissions = p_permissions where id = p_id and org_id = v_org returning id into v_id;
    if v_id is null then return jsonb_build_object('error', 'Papel não encontrado.'); end if;
  end if;
  perform private.log(v_org, 'role.save', null, jsonb_build_object('role', v_id, 'name', v_name, 'permissions', p_permissions));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Concede um papel a alguém, na empresa toda ou num campo/grupo.
create or replace function public.tfl_grant_add(p_org text, p_user uuid, p_role uuid, p_scope_type text default 'org', p_scope_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_id uuid; v_role_org uuid; v_role_key text;
begin
  if not private.can(v_org, 'org.roles') then return jsonb_build_object('error', 'Só o gestor dá acessos.'); end if;
  if not exists (select 1 from public.org_members where org_id = v_org and user_id = p_user and status = 'approved') then
    return jsonb_build_object('error', 'Aprove o membro antes de dar acessos.');
  end if;
  select org_id, key into v_role_org, v_role_key from public.roles where id = p_role;
  if not found or (v_role_org is not null and v_role_org <> v_org) then return jsonb_build_object('error', 'Papel inválido.'); end if;
  if v_role_org is null and v_role_key in ('owner', 'player') then return jsonb_build_object('error', 'Esse papel não pode ser concedido.'); end if;
  if (p_scope_type = 'org') <> (p_scope_id is null) or p_scope_type not in ('org', 'venue', 'group') then
    return jsonb_build_object('error', 'Escopo inválido.');
  end if;
  insert into public.role_grants (org_id, user_id, role_id, scope_type, scope_id, granted_by)
  values (v_org, p_user, p_role, p_scope_type, p_scope_id, (select auth.uid())) returning id into v_id;
  perform private.log(v_org, 'grant.add', p_user, jsonb_build_object('grant', v_id, 'role', p_role, 'scope_type', p_scope_type, 'scope_id', p_scope_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.tfl_grant_remove(p_org text, p_grant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_user uuid;
begin
  if not private.can(v_org, 'org.roles') then return jsonb_build_object('error', 'Só o gestor retira acessos.'); end if;
  delete from public.role_grants where id = p_grant and org_id = v_org returning user_id into v_user;
  if v_user is null then return jsonb_build_object('error', 'Acesso não encontrado.'); end if;
  perform private.log(v_org, 'grant.remove', v_user, jsonb_build_object('grant', p_grant));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tfl_org_update(p_org text, p_name text, p_timezone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_name text := btrim(coalesce(p_name, ''));
begin
  if not private.can(v_org, 'org.settings') then return jsonb_build_object('error', 'Você não pode editar a empresa.'); end if;
  if length(v_name) not between 2 and 80 then return jsonb_build_object('error', 'Nome da empresa: 2 a 80 letras.'); end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then return jsonb_build_object('error', 'Fuso horário inválido.'); end if;
  update public.orgs set name = v_name, timezone = p_timezone where id = v_org;
  perform private.log(v_org, 'org.update', null, jsonb_build_object('name', v_name, 'timezone', p_timezone));
  return jsonb_build_object('ok', true);
end $$;

-- Auditoria da empresa (gestor) e histórico de sessões de suporte, que o gestor sempre enxerga.
create or replace function public.tfl_org_audit(p_org text, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org);
begin
  if not private.can(v_org, 'org.settings') then return jsonb_build_object('error', 'Você não tem acesso ao histórico da empresa.'); end if;
  return jsonb_build_object(
    'events', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
      select jsonb_build_object('at', a.at, 'action', a.action, 'detail', a.detail, 'support', a.support_session_id is not null,
               'actor', coalesce((select display_name from public.profiles where id = a.actor), 'Sistema'),
               'target', (select display_name from public.profiles where id = a.target)) x
        from private.audit a where a.org_id = v_org order by a.at desc limit least(greatest(p_limit, 1), 500)) t),
    'support_sessions', (select coalesce(jsonb_agg(jsonb_build_object('started_at', s.started_at, 'expires_at', s.expires_at,
               'ended_at', s.ended_at, 'reason', s.reason,
               'admin', coalesce((select display_name from public.profiles where id = s.admin_id), 'Suporte da plataforma'))
               order by s.started_at desc), '[]'::jsonb)
        from public.support_sessions s where s.org_id = v_org));
end $$;

-- ---------------------------------------------------------------- 7. API: super admin
create or replace function private.require_platform_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_uid();
begin
  if not private.is_platform_admin() then raise exception 'Acesso restrito ao administrador da plataforma.' using errcode = '42501'; end if;
  return v;
end $$;

-- Indicadores globais. Só números que o sistema realmente coleta; o resto chega nas próximas fases.
create or replace function public.tfl_pa_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return jsonb_build_object(
    'orgs_total', (select count(*) from public.orgs),
    'orgs_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.orgs group by status) t),
    'orgs_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.orgs group by kind) t),
    'users_total', (select count(*) from auth.users),
    'users_new_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'users_active_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'players_approved', (select count(distinct user_id) from public.org_members where status = 'approved'),
    'members_pending', (select count(*) from public.org_members where status = 'pending'),
    'minors', (select count(*) from public.profiles where private.is_minor(birth_date)),
    'photos', (select count(*) from public.profiles where photo_path is not null),
    'support_open', (select count(*) from public.support_sessions where ended_at is null and now() < expires_at),
    'not_collected_yet', jsonb_build_array('campos', 'jogos agendados', 'jogos realizados', 'taxa de confirmação', 'grupos',
                                           'assinaturas', 'receita recorrente', 'custos de mensagens')
  );
end $$;

-- Empresas com números agregados (sem listas de pessoas).
create or replace function public.tfl_pa_orgs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'slug', o.slug, 'name', o.name, 'kind', o.kind, 'status', o.status, 'status_reason', o.status_reason,
      'created_at', o.created_at,
      'owner', (select coalesce(p.display_name, m.display_name) from public.org_members m left join public.profiles p on p.id = m.user_id
                 where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
      'approved', (select count(*) from public.org_members where org_id = o.id and status = 'approved'),
      'pending', (select count(*) from public.org_members where org_id = o.id and status = 'pending'),
      'last_activity', (select max(at) from private.audit where org_id = o.id),
      'support_active', exists (select 1 from public.support_sessions s where s.org_id = o.id and s.ended_at is null and now() < s.expires_at))
    order by o.created_at), '[]'::jsonb) from public.orgs o);
end $$;

-- Cria empresa e define o gestor (precisa já ter conta).
create or replace function public.tfl_pa_org_create(p_name text, p_slug text, p_kind text, p_owner_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_org uuid; v_name text := btrim(coalesce(p_name, '')); v_slug text := lower(btrim(coalesce(p_slug, ''))); v_owner_name text;
begin
  perform private.require_platform_admin();
  if length(v_name) not between 2 and 80 then return jsonb_build_object('error', 'Nome da empresa: 2 a 80 letras.'); end if;
  if v_slug !~ '^[a-z0-9-]{2,40}$' then return jsonb_build_object('error', 'Endereço: só letras minúsculas, números e hífen (2 a 40).'); end if;
  if p_kind not in ('venue_company', 'organizer', 'community') then return jsonb_build_object('error', 'Tipo de empresa inválido.'); end if;
  if exists (select 1 from public.orgs where slug = v_slug) then return jsonb_build_object('error', 'Esse endereço já está em uso.'); end if;
  select id into v_owner from auth.users where email = lower(btrim(coalesce(p_owner_email, '')));
  if v_owner is null then return jsonb_build_object('error', 'Não há conta com esse e-mail. Peça para a pessoa criar a conta primeiro.'); end if;
  insert into public.orgs (slug, name, kind, created_by) values (v_slug, v_name, p_kind, (select auth.uid())) returning id into v_org;
  select display_name into v_owner_name from public.profiles where id = v_owner;
  insert into public.profiles (id, display_name) values (v_owner, coalesce(v_owner_name, split_part(p_owner_email, '@', 1))) on conflict (id) do nothing;
  insert into public.org_members (org_id, user_id, display_name, role, status, approved_at)
  values (v_org, v_owner, coalesce(v_owner_name, split_part(p_owner_email, '@', 1)), 'owner', 'approved', now());
  perform private.log(v_org, 'org.create', v_owner, jsonb_build_object('name', v_name, 'slug', v_slug, 'kind', p_kind));
  return jsonb_build_object('ok', true, 'id', v_org, 'slug', v_slug);
end $$;

create or replace function public.tfl_pa_org_set_status(p_org_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform private.require_platform_admin();
  if p_status not in ('trial', 'active', 'suspended', 'closed') then return jsonb_build_object('error', 'Situação inválida.'); end if;
  if p_status in ('suspended', 'closed') and length(btrim(coalesce(p_reason, ''))) < 5 then
    return jsonb_build_object('error', 'Informe o motivo (mínimo 5 letras).');
  end if;
  select status into v_old from public.orgs where id = p_org_id;
  if v_old is null then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  update public.orgs set status = p_status, status_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_org_id;
  perform private.log(p_org_id, 'org.status', null, jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Sessão de suporte: motivo obrigatório, até 120 minutos, registrada e visível ao gestor.
create or replace function public.tfl_support_start(p_org_id uuid, p_reason text, p_minutes int default 60) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_platform_admin(); v_id uuid; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) not between 5 and 300 then return jsonb_build_object('error', 'Descreva o motivo do suporte (5 a 300 letras).'); end if;
  if p_minutes is null or p_minutes not between 5 and 120 then return jsonb_build_object('error', 'Duração entre 5 e 120 minutos.'); end if;
  if not exists (select 1 from public.orgs where id = p_org_id) then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  update public.support_sessions set ended_at = now() where admin_id = v_uid and org_id = p_org_id and ended_at is null;
  insert into public.support_sessions (admin_id, org_id, reason, expires_at)
  values (v_uid, p_org_id, v_reason, now() + make_interval(mins => p_minutes)) returning id into v_id;
  insert into private.audit (org_id, actor, action, target, detail, support_session_id)
  values (p_org_id, v_uid, 'support.start', null, jsonb_build_object('reason', v_reason, 'minutes', p_minutes), v_id);
  return jsonb_build_object('ok', true, 'id', v_id, 'slug', (select slug from public.orgs where id = p_org_id));
end $$;

create or replace function public.tfl_support_end(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_platform_admin(); v_org uuid;
begin
  update public.support_sessions set ended_at = now() where id = p_id and admin_id = v_uid and ended_at is null returning org_id into v_org;
  if v_org is null then return jsonb_build_object('error', 'Sessão não encontrada ou já encerrada.'); end if;
  insert into private.audit (org_id, actor, action, target, detail, support_session_id) values (v_org, v_uid, 'support.end', null, null, p_id);
  return jsonb_build_object('ok', true);
end $$;

-- Auditoria global (ou de uma empresa).
create or replace function public.tfl_pa_audit(p_org_id uuid default null, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
    select jsonb_build_object('at', a.at, 'action', a.action, 'detail', a.detail, 'support', a.support_session_id is not null,
             'org', (select name from public.orgs where id = a.org_id),
             'actor', coalesce((select display_name from public.profiles where id = a.actor), 'Sistema'),
             'target', (select display_name from public.profiles where id = a.target)) x
      from private.audit a where p_org_id is null or a.org_id = p_org_id
     order by a.at desc limit least(greatest(p_limit, 1), 500)) t);
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke execute on function
  public.tfl_profile_get(), public.tfl_profile_save(text, text, date, text, text, boolean, boolean),
  public.tfl_profile_set_photo(text, boolean), public.tfl_org_overview(text), public.tfl_org_members(text),
  public.tfl_org_set_role(text, uuid, text), public.tfl_roles_list(text), public.tfl_role_save(text, uuid, text, text[]),
  public.tfl_grant_add(text, uuid, uuid, text, uuid), public.tfl_grant_remove(text, uuid), public.tfl_org_update(text, text, text),
  public.tfl_org_audit(text, int), public.tfl_pa_overview(), public.tfl_pa_orgs(), public.tfl_pa_org_create(text, text, text, text),
  public.tfl_pa_org_set_status(uuid, text, text), public.tfl_support_start(uuid, text, int), public.tfl_support_end(uuid),
  public.tfl_pa_audit(uuid, int)
from public, anon;
grant execute on function
  public.tfl_profile_get(), public.tfl_profile_save(text, text, date, text, text, boolean, boolean),
  public.tfl_profile_set_photo(text, boolean), public.tfl_org_overview(text), public.tfl_org_members(text),
  public.tfl_org_set_role(text, uuid, text), public.tfl_roles_list(text), public.tfl_role_save(text, uuid, text, text[]),
  public.tfl_grant_add(text, uuid, uuid, text, uuid), public.tfl_grant_remove(text, uuid), public.tfl_org_update(text, text, text),
  public.tfl_org_audit(text, int), public.tfl_pa_overview(), public.tfl_pa_orgs(), public.tfl_pa_org_create(text, text, text, text),
  public.tfl_pa_org_set_status(uuid, text, text), public.tfl_support_start(uuid, text, int), public.tfl_support_end(uuid),
  public.tfl_pa_audit(uuid, int)
to authenticated;
-- Funções internas não ficam expostas a ninguém além do que já foi concedido acima.
revoke execute on function private.log(uuid, text, uuid, jsonb), private.require_uid(), private.require_platform_admin() from public;
