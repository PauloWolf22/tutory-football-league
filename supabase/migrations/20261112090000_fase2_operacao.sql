-- =====================================================================================
-- Tutory Football League · Fase 2: operação
-- Regras decididas pelo Paulo em 11/11/2026 (cofre: "Football SaaS - Regras da Agenda e das Listas"):
--   · vaga por ordem de confirmação; lotou → lista de espera
--   · desistência: a vaga passa direto ao primeiro da espera
--   · empresa publica dias/horários livres e o preço da hora; o pedido fica SEGURADO até a empresa
--     confirmar; sem resposta em 24 h (ou até 2 h antes do jogo) o horário volta a ficar livre
--   · taxa do app: 6% sobre a hora, somados ao preço; só mostrada e registrada (cobrança na fase comercial)
--   · grupos: o organizador convida e o jogador aceita
-- =====================================================================================
create extension if not exists btree_gist with schema extensions;

-- O organizador padrão também pode pedir horários (a empresa confirma cada pedido).
update public.roles set permissions = array_append(permissions, 'booking.manage')
 where org_id is null and key = 'organizer' and not ('booking.manage' = any (permissions));

create or replace function private.org_tz(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from public.orgs where id = p_org), 'America/Sao_Paulo')
$$;

-- ---------------------------------------------------------------- campos
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  surface text check (surface is null or length(surface) <= 40),
  capacity_players int not null default 14 check (capacity_players between 2 and 40),
  price_per_hour_cents int not null default 0 check (price_per_hour_cents between 0 and 10000000),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);
create index if not exists venues_org on public.venues (org_id);

-- Horários publicados (livres para pedido), por dia da semana, no fuso da empresa. 0 = domingo.
create table if not exists public.venue_hours (
  venue_id uuid not null references public.venues (id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  opens time not null,
  closes time not null,                       -- 00:00 = meia-noite (fim do dia)
  primary key (venue_id, weekday, opens)
);

create table if not exists public.booking_rules (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  min_lead_minutes int not null default 180 check (min_lead_minutes between 0 and 10080),
  max_days_ahead int not null default 60 check (max_days_ahead between 1 and 365),
  hold_hours int not null default 24 check (hold_hours between 1 and 168),
  platform_fee_pct numeric(5,2) not null default 6.00 check (platform_fee_pct between 0 and 50)
);

-- ---------------------------------------------------------------- reservas
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'held' check (status in ('held', 'confirmed', 'rejected', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  requested_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 300),
  hour_price_cents int not null default 0,
  fee_pct numeric(5,2) not null default 6.00,
  price_cents int not null default 0,          -- valor do campo pelo período
  fee_cents int not null default 0,            -- taxa do app
  total_cents int not null default 0,          -- o que o organizador vê
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Dois pedidos ativos (segurado ou confirmado) nunca se sobrepõem no mesmo campo.
  constraint bookings_no_overlap exclude using gist (venue_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('held', 'confirmed'))
);
create index if not exists bookings_venue_time on public.bookings (venue_id, starts_at);
create index if not exists bookings_org_status on public.bookings (org_id, status);

-- Pedidos segurados que passaram do prazo deixam de valer (rodado antes de cada pedido e listagem).
create or replace function private.expire_holds() returns void
language sql security definer set search_path = '' as $$
  update public.bookings set status = 'expired' where status = 'held' and hold_expires_at < now()
$$;

-- ---------------------------------------------------------------- grupos
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  sport text not null default 'futebol_society',
  default_venue_id uuid references public.venues (id) on delete set null,
  default_location text check (default_location is null or length(default_location) <= 120),
  default_capacity int not null default 14 check (default_capacity between 2 and 60),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists groups_org on public.groups (org_id);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active', 'declined', 'removed')),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id, status);

create or replace function private.in_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members g join public.groups gr on gr.id = g.group_id
                  where g.group_id = p_group and g.user_id = (select auth.uid()) and g.status = 'active'
                    and private.is_approved(gr.org_id))
$$;

-- ---------------------------------------------------------------- partidas
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  venue_id uuid references public.venues (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  location_text text check (location_text is null or length(location_text) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null check (capacity between 2 and 60),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled', 'played')),
  notes text check (notes is null or length(notes) <= 500),
  version int not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (venue_id is not null or location_text is not null)
);
create index if not exists matches_org_time on public.matches (org_id, starts_at);
create index if not exists matches_group_time on public.matches (group_id, starts_at);

create table if not exists public.match_participants (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'confirmed', 'waitlist', 'declined', 'removed')),
  responded_at timestamptz,                  -- ordem de chegada (confirmados e espera)
  promoted_at timestamptz,                   -- saiu da espera porque abriu vaga
  primary key (match_id, user_id)
);
create index if not exists match_participants_status on public.match_participants (match_id, status, responded_at);

create or replace function private.can_see_match(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches m where m.id = p_match and (
    private.in_group(m.group_id) or private.can(m.org_id, 'match.manage', 'group', m.group_id)
    or exists (select 1 from public.match_participants p where p.match_id = m.id and p.user_id = (select auth.uid()))))
$$;

-- ---------------------------------------------------------------- avisos dentro do app
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid references public.orgs (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text unique,                      -- o mesmo aviso nunca sai duas vezes
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

create or replace function private.notify(p_user uuid, p_org uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, org_id, kind, title, body, link, dedupe_key)
  values (p_user, p_org, p_kind, p_title, p_body, p_link, p_dedupe) on conflict (dedupe_key) do nothing
$$;

create or replace function private.fmt_when(p_at timestamptz, p_org uuid) returns text
language sql stable set search_path = '' as $$
  select to_char(p_at at time zone private.org_tz(p_org), 'DD/MM "às" HH24"h"MI')
$$;

grant execute on function private.org_tz(uuid), private.in_group(uuid), private.can_see_match(uuid) to authenticated;
revoke execute on function private.expire_holds(), private.notify(uuid, uuid, text, text, text, text, text) from public;

-- ---------------------------------------------------------------- RLS
alter table public.venues enable row level security;
alter table public.venue_hours enable row level security;
alter table public.booking_rules enable row level security;
alter table public.bookings enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.notifications enable row level security;
revoke all on public.venues, public.venue_hours, public.booking_rules, public.bookings, public.groups,
  public.group_members, public.matches, public.match_participants, public.notifications from anon, authenticated;
grant select on public.venues, public.venue_hours, public.booking_rules, public.bookings, public.groups,
  public.group_members, public.matches, public.match_participants, public.notifications to authenticated;

drop policy if exists "campos: membros aprovados" on public.venues;
create policy "campos: membros aprovados" on public.venues for select to authenticated
  using (private.is_approved(org_id) or private.support_session(org_id) is not null);
drop policy if exists "horarios: membros aprovados" on public.venue_hours;
create policy "horarios: membros aprovados" on public.venue_hours for select to authenticated
  using (exists (select 1 from public.venues v where v.id = venue_id and (private.is_approved(v.org_id) or private.support_session(v.org_id) is not null)));
drop policy if exists "regras: membros aprovados" on public.booking_rules;
create policy "regras: membros aprovados" on public.booking_rules for select to authenticated using (private.is_approved(org_id));
drop policy if exists "reservas: gestor ou quem pediu" on public.bookings;
create policy "reservas: gestor ou quem pediu" on public.bookings for select to authenticated
  using (private.can(org_id, 'venue.manage') or requested_by = (select auth.uid()));
drop policy if exists "grupos: quem gerencia ou participa" on public.groups;
create policy "grupos: quem gerencia ou participa" on public.groups for select to authenticated
  using (private.can(org_id, 'group.manage', 'group', id) or private.in_group(id)
         or exists (select 1 from public.group_members g where g.group_id = id and g.user_id = (select auth.uid()) and g.status = 'invited'));
drop policy if exists "membros do grupo: quem gerencia ou participa" on public.group_members;
create policy "membros do grupo: quem gerencia ou participa" on public.group_members for select to authenticated
  using (user_id = (select auth.uid()) or private.in_group(group_id)
         or exists (select 1 from public.groups g where g.id = group_id and private.can(g.org_id, 'group.manage', 'group', g.id)));
drop policy if exists "partidas: quem pode ver" on public.matches;
create policy "partidas: quem pode ver" on public.matches for select to authenticated using (private.can_see_match(id));
drop policy if exists "lista: quem pode ver a partida" on public.match_participants;
create policy "lista: quem pode ver a partida" on public.match_participants for select to authenticated using (private.can_see_match(match_id));
drop policy if exists "avisos: os proprios" on public.notifications;
create policy "avisos: os proprios" on public.notifications for select to authenticated using (user_id = (select auth.uid()));

-- Atualização ao vivo (Supabase Realtime respeita as regras acima).
do $$
declare t text;
begin
  foreach t in array array['matches', 'match_participants', 'bookings', 'notifications', 'group_members'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null; end;
  end loop;
end $$;

-- =====================================================================================
-- API: campos e agenda
-- =====================================================================================
-- Campos da empresa (membros aprovados veem; quem gerencia vê também os inativos).
create or replace function public.tfl_venues_list(p_org text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_manage boolean; v_fee numeric;
begin
  if v_org is null then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  v_manage := private.can(v_org, 'venue.manage');
  if not v_manage and not private.is_approved(v_org) then return jsonb_build_object('error', 'Você não tem acesso a esta empresa.'); end if;
  select coalesce((select platform_fee_pct from public.booking_rules where org_id = v_org), 6.00) into v_fee;
  return jsonb_build_object('can_manage', v_manage, 'fee_pct', v_fee,
    'can_book', private.can(v_org, 'booking.manage') or v_manage,
    'venues', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'name', v.name, 'surface', v.surface, 'capacity_players', v.capacity_players, 'status', v.status,
      'price_per_hour_cents', v.price_per_hour_cents,
      'price_with_fee_cents', v.price_per_hour_cents + round(v.price_per_hour_cents * v_fee / 100),
      'hours', (select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI'))
                  order by h.weekday, h.opens), '[]'::jsonb) from public.venue_hours h where h.venue_id = v.id))
      order by v.name) from public.venues v where v.org_id = v_org and (v_manage or v.status = 'active')), '[]'::jsonb));
end $$;

-- Cria ou edita um campo e seus horários publicados (p_hours: [{weekday, opens, closes}]).
-- (Substituída pela versão de 20261112093000_fase2_correcao_campos.sql.)
create or replace function public.tfl_venue_save(p_org text, p_id uuid, p_name text, p_surface text, p_capacity int,
  p_price_per_hour_cents int, p_status text, p_hours jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_id uuid; h jsonb; v_name text := btrim(coalesce(p_name, ''));
begin
  if not private.can(v_org, 'venue.manage') then return jsonb_build_object('error', 'Você não pode gerenciar campos.'); end if;
  if length(v_name) not between 2 and 60 then return jsonb_build_object('error', 'Nome do campo: 2 a 60 letras.'); end if;
  if p_capacity is null or p_capacity not between 2 and 40 then return jsonb_build_object('error', 'Capacidade entre 2 e 40 jogadores.'); end if;
  if p_price_per_hour_cents is null or p_price_per_hour_cents < 0 then return jsonb_build_object('error', 'Informe o preço da hora.'); end if;
  if p_status not in ('active', 'inactive') then return jsonb_build_object('error', 'Situação inválida.'); end if;
  for h in select * from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) loop
    if (h->>'weekday')::int not between 0 and 6 then return jsonb_build_object('error', 'Dia da semana inválido.'); end if;
    if (h->>'closes') <> '00:00' and (h->>'closes')::time <= (h->>'opens')::time then
      return jsonb_build_object('error', 'O horário de fechar precisa ser depois do de abrir.');
    end if;
  end loop;
  if p_id is null then
    insert into public.venues (org_id, name, surface, capacity_players, price_per_hour_cents, status)
    values (v_org, v_name, nullif(btrim(coalesce(p_surface, '')), ''), p_capacity, p_price_per_hour_cents, p_status) returning id into v_id;
  else
    update public.venues set name = v_name, surface = nullif(btrim(coalesce(p_surface, '')), ''), capacity_players = p_capacity,
           price_per_hour_cents = p_price_per_hour_cents, status = p_status
     where id = p_id and org_id = v_org returning id into v_id;
    if v_id is null then return jsonb_build_object('error', 'Campo não encontrado.'); end if;
  end if;
  delete from public.venue_hours where venue_id = v_id;
  insert into public.venue_hours (venue_id, weekday, opens, closes)
  select v_id, (h->>'weekday')::int, (h->>'opens')::time, (h->>'closes')::time from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) h
  on conflict do nothing;
  perform private.log(v_org, 'venue.save', null, jsonb_build_object('venue', v_id, 'name', v_name, 'price', p_price_per_hour_cents));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Pede um horário. Fica SEGURADO até a empresa confirmar (prazo de 24 h, ou até 2 h antes do jogo).
create or replace function private.booking_request(p_org uuid, p_venue uuid, p_starts timestamptz, p_minutes int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.venues; r public.booking_rules; v_tz text := private.org_tz(p_org); v_ends timestamptz;
        v_local timestamp; v_start_min int; v_end_min int; v_ok boolean; v_price int; v_fee int; v_hold timestamptz; v_id uuid;
begin
  select * into v from public.venues where id = p_venue and org_id = p_org;
  if not found or v.status <> 'active' then return jsonb_build_object('error', 'Campo não encontrado ou inativo.'); end if;
  if not (private.can(p_org, 'booking.manage', 'venue', p_venue) or private.can(p_org, 'venue.manage')) then
    return jsonb_build_object('error', 'Você não tem acesso para pedir horários neste campo.');
  end if;
  if p_minutes is null or p_minutes not between 30 and 240 or p_minutes % 30 <> 0 then
    return jsonb_build_object('error', 'Duração em blocos de 30 minutos, de 30 min a 4 h.');
  end if;
  select * into r from public.booking_rules where org_id = p_org;
  if not found then r.min_lead_minutes := 180; r.max_days_ahead := 60; r.hold_hours := 24; r.platform_fee_pct := 6.00; end if;
  if p_starts < now() + make_interval(mins => r.min_lead_minutes) then
    return jsonb_build_object('error', format('Pedidos precisam de pelo menos %s horas de antecedência.', r.min_lead_minutes / 60));
  end if;
  if p_starts > now() + make_interval(days => r.max_days_ahead) then
    return jsonb_build_object('error', format('Só dá para pedir até %s dias à frente.', r.max_days_ahead));
  end if;
  v_ends := p_starts + make_interval(mins => p_minutes);
  -- Precisa caber num horário publicado do dia (no fuso da empresa).
  v_local := p_starts at time zone v_tz;
  v_start_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_end_min := v_start_min + p_minutes;
  select exists (select 1 from public.venue_hours h where h.venue_id = p_venue and h.weekday = extract(dow from v_local)::int
                   and extract(hour from h.opens) * 60 + extract(minute from h.opens) <= v_start_min
                   and v_end_min <= case when h.closes = '00:00' then 1440 else extract(hour from h.closes) * 60 + extract(minute from h.closes) end)
    into v_ok;
  if not v_ok then return jsonb_build_object('error', 'Esse horário não está entre os horários publicados do campo.'); end if;
  perform private.expire_holds();
  v_price := round(v.price_per_hour_cents * p_minutes / 60.0);
  v_fee := round(v_price * r.platform_fee_pct / 100);
  v_hold := least(now() + make_interval(hours => r.hold_hours), p_starts - interval '2 hours');
  begin
    insert into public.bookings (org_id, venue_id, starts_at, ends_at, status, hold_expires_at, requested_by,
                                 hour_price_cents, fee_pct, price_cents, fee_cents, total_cents)
    values (p_org, p_venue, p_starts, v_ends, 'held', v_hold, (select auth.uid()),
            v.price_per_hour_cents, r.platform_fee_pct, v_price, v_fee, v_price + v_fee) returning id into v_id;
  exception when exclusion_violation then
    return jsonb_build_object('error', 'Esse horário acabou de ser pedido ou já está ocupado. Escolha outro.');
  end;
  perform private.log(p_org, 'booking.request', null, jsonb_build_object('booking', v_id, 'venue', p_venue, 'starts_at', p_starts));
  -- Avisa quem confirma reservas na empresa.
  perform private.notify(m.user_id, p_org, 'booking.pending', 'Pedido de horário para confirmar',
            v.name || ' · ' || private.fmt_when(p_starts, p_org), '#/o/' || (select slug from public.orgs where id = p_org) || '/agenda',
            'booking.pending:' || v_id || ':' || m.user_id)
    from public.org_members m where m.org_id = p_org and m.status = 'approved' and m.role in ('owner', 'admin');
  return jsonb_build_object('ok', true, 'id', v_id, 'hold_expires_at', v_hold, 'price_cents', v_price, 'fee_cents', v_fee, 'total_cents', v_price + v_fee);
end $$;

create or replace function public.tfl_booking_request(p_org text, p_venue uuid, p_starts_at timestamptz, p_minutes int) returns jsonb
language sql security definer set search_path = '' as $$ select private.booking_request(private.org_id(p_org), p_venue, p_starts_at, p_minutes) $$;

-- A empresa confirma ou recusa um pedido segurado.
create or replace function public.tfl_booking_decide(p_org text, p_booking uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); b public.bookings; v_match uuid;
begin
  if not private.can(v_org, 'venue.manage') then return jsonb_build_object('error', 'Só quem gerencia os campos confirma reservas.'); end if;
  perform private.expire_holds();
  select * into b from public.bookings where id = p_booking and org_id = v_org for update;
  if not found then return jsonb_build_object('error', 'Reserva não encontrada.'); end if;
  if b.status <> 'held' then return jsonb_build_object('error', 'Esse pedido não está mais aguardando confirmação (' || b.status || ').'); end if;
  update public.bookings set status = case when p_approve then 'confirmed' else 'rejected' end, decided_by = (select auth.uid()),
         decided_at = now(), decision_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300), hold_expires_at = null
   where id = p_booking;
  perform private.log(v_org, case when p_approve then 'booking.confirm' else 'booking.reject' end, b.requested_by, jsonb_build_object('booking', p_booking, 'note', p_note));
  select id into v_match from public.matches where booking_id = p_booking;
  perform private.notify(b.requested_by, v_org, case when p_approve then 'booking.confirmed' else 'booking.rejected' end,
            case when p_approve then 'Horário confirmado pelo campo' else 'Horário recusado pelo campo' end,
            (select name from public.venues where id = b.venue_id) || ' · ' || private.fmt_when(b.starts_at, v_org) || coalesce(' · ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
            case when v_match is not null then '#/jogo/' || v_match end, 'booking.decided:' || p_booking);
  return jsonb_build_object('ok', true);
end $$;

-- Cancela uma reserva (quem pediu ou quem gerencia os campos).
create or replace function public.tfl_booking_cancel(p_org text, p_booking uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); b public.bookings;
begin
  select * into b from public.bookings where id = p_booking and org_id = v_org for update;
  if not found then return jsonb_build_object('error', 'Reserva não encontrada.'); end if;
  if not (private.can(v_org, 'venue.manage') or (b.requested_by = (select auth.uid()) and private.can(v_org, 'booking.manage', 'venue', b.venue_id))) then
    return jsonb_build_object('error', 'Você não pode cancelar esta reserva.');
  end if;
  if b.status not in ('held', 'confirmed') then return jsonb_build_object('error', 'Esta reserva já não está ativa.'); end if;
  update public.bookings set status = 'cancelled', decision_note = left(nullif(btrim(coalesce(p_reason, '')), ''), 300), decided_at = now(), decided_by = (select auth.uid())
   where id = p_booking;
  perform private.log(v_org, 'booking.cancel', b.requested_by, jsonb_build_object('booking', p_booking, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Agenda: quem gerencia vê tudo; quem pede vê os próprios pedidos. Todos com acesso a pedir veem os horários ocupados.
create or replace function public.tfl_bookings_list(p_org text, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_manage boolean; v_book boolean;
begin
  v_manage := private.can(v_org, 'venue.manage');
  v_book := v_manage or private.can(v_org, 'booking.manage') or exists (select 1 from public.role_grants g join public.roles r on r.id = g.role_id
             where g.org_id = v_org and g.user_id = (select auth.uid()) and 'booking.manage' = any (r.permissions));
  if not v_book then return jsonb_build_object('error', 'Você não tem acesso à agenda dos campos.'); end if;
  perform private.expire_holds();
  return jsonb_build_object('can_manage', v_manage, 'timezone', private.org_tz(v_org), 'bookings', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'venue_id', b.venue_id, 'venue', v.name, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
      'hold_expires_at', b.hold_expires_at, 'mine', b.requested_by = (select auth.uid()),
      'requested_by', case when v_manage or b.requested_by = (select auth.uid()) then (select display_name from public.profiles where id = b.requested_by) end,
      'price_cents', case when v_manage or b.requested_by = (select auth.uid()) then b.price_cents end,
      'fee_cents', case when v_manage or b.requested_by = (select auth.uid()) then b.fee_cents end,
      'total_cents', case when v_manage or b.requested_by = (select auth.uid()) then b.total_cents end,
      'decision_note', case when v_manage or b.requested_by = (select auth.uid()) then b.decision_note end,
      'match_id', (select id from public.matches mt where mt.booking_id = b.id limit 1),
      'group', (select g.name from public.matches mt join public.groups g on g.id = mt.group_id where mt.booking_id = b.id limit 1))
      order by b.starts_at)
      from public.bookings b join public.venues v on v.id = b.venue_id
     where b.org_id = v_org and b.starts_at < p_to and b.ends_at > p_from
       and (v_manage or b.requested_by = (select auth.uid()) or b.status in ('held', 'confirmed'))), '[]'::jsonb));
end $$;

-- =====================================================================================
-- API: grupos
-- =====================================================================================
create or replace function public.tfl_groups_list(p_org text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_uid uuid := (select auth.uid());
begin
  if v_org is null then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  if not private.is_approved(v_org) and private.support_session(v_org) is null then return jsonb_build_object('error', 'Você não tem acesso a esta empresa.'); end if;
  return jsonb_build_object('can_create', private.can(v_org, 'group.manage'), 'groups', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'status', g.status, 'default_location', g.default_location,
             'default_venue_id', g.default_venue_id, 'default_venue', (select name from public.venues where id = g.default_venue_id),
             'default_capacity', g.default_capacity, 'can_manage', private.can(v_org, 'group.manage', 'group', g.id),
             'can_match', private.can(v_org, 'match.manage', 'group', g.id),
             'my_status', (select status from public.group_members where group_id = g.id and user_id = v_uid),
             'members', (select count(*) from public.group_members where group_id = g.id and status = 'active'),
             'invited', (select count(*) from public.group_members where group_id = g.id and status = 'invited'),
             'next_match', (select jsonb_build_object('id', m.id, 'starts_at', m.starts_at) from public.matches m
                             where m.group_id = g.id and m.status = 'open' and m.starts_at > now() order by m.starts_at limit 1))
           order by g.name)
      from public.groups g
     where g.org_id = v_org and g.status = 'active'
       and (private.can(v_org, 'group.manage', 'group', g.id) or private.can(v_org, 'match.manage', 'group', g.id)
            or exists (select 1 from public.group_members x where x.group_id = g.id and x.user_id = v_uid and x.status in ('active', 'invited')))), '[]'::jsonb));
end $$;

create or replace function public.tfl_group_save(p_org text, p_id uuid, p_name text, p_default_venue uuid, p_default_location text, p_default_capacity int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if p_id is null and not private.can(v_org, 'group.manage') then return jsonb_build_object('error', 'Você não pode criar grupos.'); end if;
  if p_id is not null and not private.can(v_org, 'group.manage', 'group', p_id) then return jsonb_build_object('error', 'Você não pode editar este grupo.'); end if;
  if length(v_name) not between 2 and 60 then return jsonb_build_object('error', 'Nome do grupo: 2 a 60 letras.'); end if;
  if p_default_capacity is null or p_default_capacity not between 2 and 60 then return jsonb_build_object('error', 'Vagas por jogo: entre 2 e 60.'); end if;
  if p_default_venue is not null and not exists (select 1 from public.venues where id = p_default_venue and org_id = v_org) then
    return jsonb_build_object('error', 'Campo inválido.');
  end if;
  if p_id is null then
    insert into public.groups (org_id, name, default_venue_id, default_location, default_capacity, created_by)
    values (v_org, v_name, p_default_venue, nullif(btrim(coalesce(p_default_location, '')), ''), p_default_capacity, (select auth.uid())) returning id into v_id;
    -- Quem cria entra no grupo.
    insert into public.group_members (group_id, user_id, status, invited_by, joined_at) values (v_id, (select auth.uid()), 'active', (select auth.uid()), now());
  else
    update public.groups set name = v_name, default_venue_id = p_default_venue, default_location = nullif(btrim(coalesce(p_default_location, '')), ''),
           default_capacity = p_default_capacity where id = p_id and org_id = v_org returning id into v_id;
    if v_id is null then return jsonb_build_object('error', 'Grupo não encontrado.'); end if;
  end if;
  perform private.log(v_org, 'group.save', null, jsonb_build_object('group', v_id, 'name', v_name));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Detalhe do grupo com a lista de membros.
create or replace function public.tfl_group_get(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g public.groups; v_manage boolean;
begin
  select * into g from public.groups where id = p_group;
  if not found then return jsonb_build_object('error', 'Grupo não encontrado.'); end if;
  v_manage := private.can(g.org_id, 'group.manage', 'group', g.id);
  if not v_manage and not private.in_group(g.id) and not private.can(g.org_id, 'match.manage', 'group', g.id) then
    return jsonb_build_object('error', 'Você não tem acesso a este grupo.');
  end if;
  return jsonb_build_object('id', g.id, 'org_slug', (select slug from public.orgs where id = g.org_id), 'name', g.name,
    'default_venue_id', g.default_venue_id, 'default_location', g.default_location, 'default_capacity', g.default_capacity,
    'can_manage', v_manage, 'can_match', private.can(g.org_id, 'match.manage', 'group', g.id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'status', x.status,
                 'name', coalesce(p.nick, p.display_name), 'photo_path', p.photo_path, 'joined_at', x.joined_at)
                 order by case x.status when 'active' then 0 when 'invited' then 1 else 2 end, coalesce(p.nick, p.display_name))
        from public.group_members x left join public.profiles p on p.id = x.user_id
       where x.group_id = g.id and (v_manage or x.status = 'active')), '[]'::jsonb));
end $$;

-- Convida membros aprovados da empresa para o grupo.
create or replace function public.tfl_group_invite(p_group uuid, p_users uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.groups; u uuid; n int := 0;
begin
  select * into g from public.groups where id = p_group;
  if not found or not private.can(g.org_id, 'group.manage', 'group', g.id) then return jsonb_build_object('error', 'Você não pode convidar para este grupo.'); end if;
  foreach u in array coalesce(p_users, '{}') loop
    if not exists (select 1 from public.org_members where org_id = g.org_id and user_id = u and status = 'approved') then continue; end if;
    insert into public.group_members (group_id, user_id, status, invited_by, invited_at) values (g.id, u, 'invited', (select auth.uid()), now())
    on conflict (group_id, user_id) do update set status = 'invited', invited_by = excluded.invited_by, invited_at = now()
      where public.group_members.status in ('declined', 'removed');
    if found then
      n := n + 1;
      perform private.notify(u, g.org_id, 'group.invite', 'Convite para o grupo ' || g.name, 'Aceite para entrar nas listas de jogo.',
                '#/convites', 'group.invite:' || g.id || ':' || u || ':' || extract(epoch from now())::bigint);
    end if;
  end loop;
  perform private.log(g.org_id, 'group.invite', null, jsonb_build_object('group', g.id, 'count', n));
  return jsonb_build_object('ok', true, 'invited', n);
end $$;

-- O jogador aceita ou recusa o convite. Ao aceitar, entra nas listas dos próximos jogos abertos.
create or replace function public.tfl_group_respond(p_group uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); g public.groups;
begin
  select * into g from public.groups where id = p_group;
  if not found then return jsonb_build_object('error', 'Grupo não encontrado.'); end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = v_uid and status = 'invited') then
    return jsonb_build_object('error', 'Não há convite pendente para este grupo.');
  end if;
  if p_accept and not private.is_approved(g.org_id) then return jsonb_build_object('error', 'Sua conta precisa estar aprovada na liga.'); end if;
  update public.group_members set status = case when p_accept then 'active' else 'declined' end, joined_at = case when p_accept then now() end
   where group_id = p_group and user_id = v_uid;
  if p_accept then
    insert into public.match_participants (match_id, user_id, status)
    select m.id, v_uid, 'invited' from public.matches m where m.group_id = p_group and m.status = 'open' and m.starts_at > now()
    on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tfl_group_remove(p_group uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.groups;
begin
  select * into g from public.groups where id = p_group;
  if not found or not (private.can(g.org_id, 'group.manage', 'group', g.id) or p_user = (select auth.uid())) then
    return jsonb_build_object('error', 'Você não pode remover este membro.');
  end if;
  update public.group_members set status = 'removed' where group_id = p_group and user_id = p_user;
  perform private.log(g.org_id, 'group.remove', p_user, jsonb_build_object('group', g.id));
  return jsonb_build_object('ok', true);
end $$;

-- Convites pendentes do próprio jogador.
create or replace function public.tfl_my_invites() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('group_id', g.id, 'group', g.name, 'org', o.name, 'org_slug', o.slug,
           'invited_by', (select display_name from public.profiles where id = x.invited_by), 'invited_at', x.invited_at,
           'org_status', (select status from public.org_members where org_id = g.org_id and user_id = x.user_id))
           order by x.invited_at desc), '[]'::jsonb)
    from public.group_members x join public.groups g on g.id = x.group_id join public.orgs o on o.id = g.org_id
   where x.user_id = (select auth.uid()) and x.status = 'invited' and g.status = 'active'
$$;

-- =====================================================================================
-- API: partidas e presença
-- =====================================================================================
-- Promove da espera, por ordem de chegada, até encher as vagas. Avisa quem subiu.
create or replace function private.fill_from_waitlist(p_match uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare m public.matches; v_free int; v_user uuid; n int := 0;
begin
  select * into m from public.matches where id = p_match;
  v_free := m.capacity - (select count(*) from public.match_participants where match_id = p_match and status = 'confirmed');
  while v_free > 0 loop
    select user_id into v_user from public.match_participants where match_id = p_match and status = 'waitlist'
     order by responded_at, user_id limit 1 for update skip locked;
    exit when v_user is null;
    update public.match_participants set status = 'confirmed', promoted_at = now() where match_id = p_match and user_id = v_user;
    perform private.notify(v_user, m.org_id, 'match.promoted', 'Abriu vaga: você está confirmado!',
              (select name from public.groups where id = m.group_id) || ' · ' || private.fmt_when(m.starts_at, m.org_id),
              '#/jogo/' || m.id, 'match.promoted:' || m.id || ':' || v_user || ':' || m.version || ':' || extract(epoch from now())::bigint);
    v_free := v_free - 1; n := n + 1; v_user := null;
  end loop;
  return n;
end $$;
revoke execute on function private.fill_from_waitlist(uuid) from public;

-- Cria a partida. Com campo da empresa, pede o horário (fica segurado até a empresa confirmar).
-- Todos os membros ativos do grupo entram na lista como "convidados".
create or replace function public.tfl_match_create(p_org text, p_group uuid, p_starts_at timestamptz, p_minutes int, p_capacity int,
  p_venue uuid default null, p_location text default null, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); g public.groups; v_id uuid; v_booking uuid; b jsonb; v_loc text := nullif(btrim(coalesce(p_location, '')), '');
begin
  select * into g from public.groups where id = p_group and org_id = v_org;
  if not found then return jsonb_build_object('error', 'Grupo não encontrado.'); end if;
  if not private.can(v_org, 'match.manage', 'group', g.id) then return jsonb_build_object('error', 'Você não pode criar jogos neste grupo.'); end if;
  if p_capacity is null or p_capacity not between 2 and 60 then return jsonb_build_object('error', 'Vagas entre 2 e 60.'); end if;
  if p_minutes is null or p_minutes not between 30 and 240 then return jsonb_build_object('error', 'Duração entre 30 minutos e 4 horas.'); end if;
  if p_starts_at < now() + interval '30 minutes' then return jsonb_build_object('error', 'O jogo precisa começar pelo menos 30 minutos a partir de agora.'); end if;
  if p_venue is null and v_loc is null then return jsonb_build_object('error', 'Escolha um campo da empresa ou escreva o local.'); end if;
  if p_venue is not null then
    -- Confere a capacidade ANTES de pedir o horário, para não deixar um pedido órfão.
    if p_capacity > coalesce((select capacity_players from public.venues where id = p_venue and org_id = v_org), 0) then
      return jsonb_build_object('error', 'Vagas acima da capacidade do campo (ou campo inválido).');
    end if;
    b := private.booking_request(v_org, p_venue, p_starts_at, p_minutes);
    if b ? 'error' then return b; end if;
    v_booking := (b->>'id')::uuid;
  end if;
  insert into public.matches (org_id, group_id, venue_id, booking_id, location_text, starts_at, ends_at, capacity, notes, created_by)
  values (v_org, g.id, p_venue, v_booking, case when p_venue is null then v_loc end, p_starts_at, p_starts_at + make_interval(mins => p_minutes),
          p_capacity, left(nullif(btrim(coalesce(p_notes, '')), ''), 500), (select auth.uid()))
  returning id into v_id;
  insert into public.match_participants (match_id, user_id, status)
  select v_id, x.user_id, 'invited' from public.group_members x
   where x.group_id = g.id and x.status = 'active'
     and exists (select 1 from public.org_members o where o.org_id = v_org and o.user_id = x.user_id and o.status = 'approved');
  perform private.notify(x.user_id, v_org, 'match.invite', 'Jogo marcado: ' || g.name,
            private.fmt_when(p_starts_at, v_org) || ' · ' || coalesce((select name from public.venues where id = p_venue), v_loc) || '. Confirme sua presença!',
            '#/jogo/' || v_id, 'match.invite:' || v_id || ':' || x.user_id)
    from public.match_participants x where x.match_id = v_id;
  perform private.log(v_org, 'match.create', null, jsonb_build_object('match', v_id, 'group', g.id, 'starts_at', p_starts_at, 'booking', v_booking));
  return jsonb_build_object('ok', true, 'id', v_id, 'booking', b);
end $$;

-- Presença do próprio jogador: "vou" (confirma ou entra na espera) ou "não vou" (libera e chama o próximo).
create or replace function public.tfl_match_rsvp(p_match uuid, p_going boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); m public.matches; v_prev text; v_new text; v_conf int;
begin
  -- Trava a partida: confirmações simultâneas para a última vaga são decididas uma de cada vez.
  select * into m from public.matches where id = p_match for update;
  if not found then return jsonb_build_object('error', 'Jogo não encontrado.'); end if;
  if m.status <> 'open' then return jsonb_build_object('error', 'A lista deste jogo está fechada.'); end if;
  if m.starts_at <= now() then return jsonb_build_object('error', 'O jogo já começou.'); end if;
  if not private.is_approved(m.org_id) then return jsonb_build_object('error', 'Sua conta precisa estar aprovada na liga.'); end if;
  select status into v_prev from public.match_participants where match_id = p_match and user_id = v_uid;
  if v_prev is null then
    if not private.in_group(m.group_id) then return jsonb_build_object('error', 'Você não faz parte do grupo deste jogo.'); end if;
    insert into public.match_participants (match_id, user_id, status) values (p_match, v_uid, 'invited');
    v_prev := 'invited';
  end if;
  if v_prev = 'removed' then return jsonb_build_object('error', 'O organizador tirou você deste jogo.'); end if;
  if p_going then
    if v_prev in ('confirmed', 'waitlist') then return jsonb_build_object('ok', true, 'status', v_prev); end if;
    select count(*) into v_conf from public.match_participants where match_id = p_match and status = 'confirmed';
    v_new := case when v_conf < m.capacity then 'confirmed' else 'waitlist' end;
    update public.match_participants set status = v_new, responded_at = now(), promoted_at = null where match_id = p_match and user_id = v_uid;
  else
    if v_prev = 'declined' then return jsonb_build_object('ok', true, 'status', 'declined'); end if;
    v_new := 'declined';
    update public.match_participants set status = 'declined', responded_at = now() where match_id = p_match and user_id = v_uid;
    if v_prev = 'confirmed' then perform private.fill_from_waitlist(p_match); end if;
  end if;
  return jsonb_build_object('ok', true, 'status', v_new,
    'position', case when v_new = 'waitlist' then (select count(*) from public.match_participants where match_id = p_match and status = 'waitlist' and responded_at <= now()) end);
end $$;

-- Detalhe da partida com a lista (para a tela ao vivo).
create or replace function public.tfl_match_get(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.matches; v_manage boolean;
begin
  perform private.expire_holds();
  select * into m from public.matches where id = p_match;
  if not found or not private.can_see_match(p_match) then return jsonb_build_object('error', 'Jogo não encontrado ou sem acesso.'); end if;
  v_manage := private.can(m.org_id, 'match.manage', 'group', m.group_id);
  return jsonb_build_object(
    'id', m.id, 'org_slug', (select slug from public.orgs where id = m.org_id), 'org', (select name from public.orgs where id = m.org_id),
    'timezone', private.org_tz(m.org_id), 'group_id', m.group_id, 'group', (select name from public.groups where id = m.group_id),
    'starts_at', m.starts_at, 'ends_at', m.ends_at, 'capacity', m.capacity, 'status', m.status, 'notes', m.notes, 'version', m.version,
    'venue', (select name from public.venues where id = m.venue_id), 'location', m.location_text,
    'booking', (select jsonb_build_object('status', b.status, 'hold_expires_at', b.hold_expires_at,
                  'total_cents', case when v_manage then b.total_cents end, 'fee_cents', case when v_manage then b.fee_cents end,
                  'price_cents', case when v_manage then b.price_cents end) from public.bookings b where b.id = m.booking_id),
    'can_manage', v_manage,
    'me', (select status from public.match_participants where match_id = m.id and user_id = (select auth.uid())),
    'counts', (select jsonb_build_object(
        'confirmed', count(*) filter (where status = 'confirmed'), 'waitlist', count(*) filter (where status = 'waitlist'),
        'pending', count(*) filter (where status = 'invited'), 'declined', count(*) filter (where status = 'declined'))
        from public.match_participants where match_id = m.id),
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'status', x.status, 'responded_at', x.responded_at,
                 'promoted_at', x.promoted_at, 'name', coalesce(p.nick, p.display_name), 'photo_path', p.photo_path,
                 'waitlist_pos', case when x.status = 'waitlist' then (select count(*) from public.match_participants y
                    where y.match_id = x.match_id and y.status = 'waitlist' and (y.responded_at, y.user_id) <= (x.responded_at, x.user_id)) end)
                 order by case x.status when 'confirmed' then 0 when 'waitlist' then 1 when 'invited' then 2 when 'declined' then 3 else 4 end,
                          x.responded_at nulls last, coalesce(p.nick, p.display_name))
        from public.match_participants x left join public.profiles p on p.id = x.user_id
       where x.match_id = m.id and (v_manage or x.status <> 'removed')), '[]'::jsonb));
end $$;

-- Lista de jogos da empresa (painel) num período.
create or replace function public.tfl_matches_list(p_org text, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org);
begin
  if v_org is null or (not private.is_approved(v_org) and private.support_session(v_org) is null) then
    return jsonb_build_object('error', 'Você não tem acesso a esta empresa.');
  end if;
  perform private.expire_holds();
  return jsonb_build_object('matches', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'group', g.name, 'group_id', g.id, 'starts_at', m.starts_at, 'ends_at', m.ends_at, 'status', m.status, 'capacity', m.capacity,
      'venue', (select name from public.venues where id = m.venue_id), 'location', m.location_text,
      'booking_status', (select status from public.bookings where id = m.booking_id),
      'can_manage', private.can(v_org, 'match.manage', 'group', m.group_id),
      'confirmed', (select count(*) from public.match_participants where match_id = m.id and status = 'confirmed'),
      'waitlist', (select count(*) from public.match_participants where match_id = m.id and status = 'waitlist'),
      'pending', (select count(*) from public.match_participants where match_id = m.id and status = 'invited'),
      'declined', (select count(*) from public.match_participants where match_id = m.id and status = 'declined'))
      order by m.starts_at)
      from public.matches m join public.groups g on g.id = m.group_id
     where m.org_id = v_org and m.starts_at >= p_from and m.starts_at < p_to and private.can_see_match(m.id)), '[]'::jsonb));
end $$;

-- Próximos jogos do próprio jogador (todas as ligas).
create or replace function public.tfl_my_matches() returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'org', o.name, 'org_slug', o.slug, 'group', g.name, 'starts_at', m.starts_at,
           'ends_at', m.ends_at, 'status', m.status, 'capacity', m.capacity, 'timezone', o.timezone,
           'venue', (select name from public.venues where id = m.venue_id), 'location', m.location_text,
           'booking_status', (select status from public.bookings where id = m.booking_id),
           'me', x.status, 'confirmed', (select count(*) from public.match_participants where match_id = m.id and status = 'confirmed'))
           order by m.starts_at), '[]'::jsonb)
    from public.match_participants x join public.matches m on m.id = x.match_id join public.groups g on g.id = m.group_id
    join public.orgs o on o.id = m.org_id
   where x.user_id = (select auth.uid()) and x.status <> 'removed' and m.starts_at > now() - interval '3 hours'
     and m.status in ('open', 'closed') and private.is_approved(m.org_id)
$$;

-- Organizador: muda vagas, fecha/reabre a lista, edita observação; tira ou recoloca alguém.
create or replace function public.tfl_match_update(p_match uuid, p_capacity int, p_status text, p_notes text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.matches; v_conf int; n int := 0;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not private.can(m.org_id, 'match.manage', 'group', m.group_id) then return jsonb_build_object('error', 'Você não pode editar este jogo.'); end if;
  if m.status in ('cancelled', 'played') then return jsonb_build_object('error', 'Este jogo já foi encerrado.'); end if;
  if p_status not in ('open', 'closed') then return jsonb_build_object('error', 'Situação inválida.'); end if;
  select count(*) into v_conf from public.match_participants where match_id = p_match and status = 'confirmed';
  if p_capacity is null or p_capacity not between 2 and 60 then return jsonb_build_object('error', 'Vagas entre 2 e 60.'); end if;
  if p_capacity < v_conf then return jsonb_build_object('error', format('Já há %s confirmados. Para reduzir as vagas, tire alguém antes.', v_conf)); end if;
  update public.matches set capacity = p_capacity, status = p_status, notes = left(nullif(btrim(coalesce(p_notes, '')), ''), 500) where id = p_match;
  if p_capacity > m.capacity and p_status = 'open' then n := private.fill_from_waitlist(p_match); end if;
  perform private.log(m.org_id, 'match.update', null, jsonb_build_object('match', p_match, 'capacity', p_capacity, 'status', p_status));
  return jsonb_build_object('ok', true, 'promoted', n);
end $$;

create or replace function public.tfl_match_set_player(p_match uuid, p_user uuid, p_remove boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.matches; v_prev text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not private.can(m.org_id, 'match.manage', 'group', m.group_id) then return jsonb_build_object('error', 'Você não pode editar este jogo.'); end if;
  select status into v_prev from public.match_participants where match_id = p_match and user_id = p_user;
  if v_prev is null then return jsonb_build_object('error', 'Jogador não está neste jogo.'); end if;
  update public.match_participants set status = case when p_remove then 'removed' else 'invited' end, responded_at = null, promoted_at = null
   where match_id = p_match and user_id = p_user;
  if p_remove and v_prev = 'confirmed' and m.status = 'open' then perform private.fill_from_waitlist(p_match); end if;
  perform private.log(m.org_id, case when p_remove then 'match.remove_player' else 'match.restore_player' end, p_user, jsonb_build_object('match', p_match));
  return jsonb_build_object('ok', true);
end $$;

-- Cancela a partida: libera o horário do campo e avisa todos.
create or replace function public.tfl_match_cancel(p_match uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.matches; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not private.can(m.org_id, 'match.manage', 'group', m.group_id) then return jsonb_build_object('error', 'Você não pode cancelar este jogo.'); end if;
  if m.status = 'cancelled' then return jsonb_build_object('error', 'Este jogo já foi cancelado.'); end if;
  if length(v_reason) < 5 then return jsonb_build_object('error', 'Informe o motivo do cancelamento (mínimo 5 letras).'); end if;
  update public.matches set status = 'cancelled', notes = left(coalesce(notes || E'\n', '') || 'Cancelado: ' || v_reason, 500), version = version + 1 where id = p_match;
  update public.bookings set status = 'cancelled', decision_note = 'Jogo cancelado: ' || left(v_reason, 200), decided_at = now(), decided_by = (select auth.uid())
   where id = m.booking_id and status in ('held', 'confirmed');
  perform private.notify(x.user_id, m.org_id, 'match.cancelled', 'Jogo cancelado: ' || (select name from public.groups where id = m.group_id),
            private.fmt_when(m.starts_at, m.org_id) || ' · ' || v_reason, '#/jogo/' || m.id, 'match.cancelled:' || m.id || ':' || x.user_id)
    from public.match_participants x where x.match_id = m.id and x.status in ('confirmed', 'waitlist', 'invited');
  perform private.log(m.org_id, 'match.cancel', null, jsonb_build_object('match', p_match, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- avisos
create or replace function public.tfl_notifications(p_limit int default 30) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id = (select auth.uid()) and read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'body', body, 'link', link,
               'created_at', created_at, 'read', read_at is not null) order by created_at desc)
        from (select * from public.notifications where user_id = (select auth.uid()) order by created_at desc limit least(greatest(p_limit, 1), 100)) t), '[]'::jsonb))
$$;

create or replace function public.tfl_notifications_read(p_id uuid default null) returns jsonb
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and read_at is null and (p_id is null or id = p_id);
  select jsonb_build_object('ok', true)
$$;

-- ---------------------------------------------------------------- execução
do $$
declare f text;
begin
  foreach f in array array[
    'tfl_venues_list(text)', 'tfl_venue_save(text, uuid, text, text, int, int, text, jsonb)',
    'tfl_booking_request(text, uuid, timestamptz, int)', 'tfl_booking_decide(text, uuid, boolean, text)',
    'tfl_booking_cancel(text, uuid, text)', 'tfl_bookings_list(text, timestamptz, timestamptz)',
    'tfl_groups_list(text)', 'tfl_group_save(text, uuid, text, uuid, text, int)', 'tfl_group_get(uuid)',
    'tfl_group_invite(uuid, uuid[])', 'tfl_group_respond(uuid, boolean)', 'tfl_group_remove(uuid, uuid)', 'tfl_my_invites()',
    'tfl_match_create(text, uuid, timestamptz, int, int, uuid, text, text)', 'tfl_match_rsvp(uuid, boolean)', 'tfl_match_get(uuid)',
    'tfl_matches_list(text, timestamptz, timestamptz)', 'tfl_my_matches()', 'tfl_match_update(uuid, int, text, text)',
    'tfl_match_set_player(uuid, uuid, boolean)', 'tfl_match_cancel(uuid, text)', 'tfl_notifications(int)', 'tfl_notifications_read(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function private.booking_request(uuid, uuid, timestamptz, int) from public;
