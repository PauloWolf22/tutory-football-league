-- =====================================================================================
-- Tutory Football League · Fase 3a: sorteio, rodízio e telão
-- Regras do Paulo (11/11/2026, cofre "Football SaaS - Regras do Sorteio e do Registro dos Jogos"):
--   · formato padrão: rodízio, quem ganha fica; os de fora esperam na fila por ordem de confirmação
--   · nível de 1 a 5 dado pelo organizador, secreto (só quem organiza vê)
--   · empate: com 2+ times na fila saem os dois; com 1 time na fila sai quem está há mais rodadas
-- Telão: link com código, sem login; mostra só primeiro nome e foto de quem autorizou (nunca menores).
-- =====================================================================================

-- ---------------------------------------------------------------- notas secretas
create table if not exists public.member_levels (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  level smallint not null check (level between 1 and 5),
  set_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table public.member_levels enable row level security;
revoke all on public.member_levels from anon, authenticated;   -- só pelas funções abaixo

-- ---------------------------------------------------------------- sorteios, rodízio e rodadas
create table if not exists public.draws (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  mode text not null check (mode in ('random', 'balanced', 'order')),
  team_size int not null check (team_size between 2 and 11),
  team_a uuid[] not null,
  team_b uuid[] not null,
  queue uuid[] not null default '{}',
  seed text,
  balance jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists draws_match on public.draws (match_id, created_at desc);

create table if not exists public.match_rotation (
  match_id uuid primary key references public.matches (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  draw_id uuid references public.draws (id) on delete set null,
  team_size int not null,
  team_a uuid[] not null,
  team_b uuid[] not null,
  queue uuid[] not null default '{}',
  streak_a int not null default 0,          -- rodadas seguidas em campo (para o empate)
  streak_b int not null default 0,
  round_no int not null default 1,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.match_rounds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  round_no int not null,
  team_a uuid[] not null,
  team_b uuid[] not null,
  winner text not null check (winner in ('A', 'B', 'draw')),
  score_a int check (score_a between 0 and 99),
  score_b int check (score_b between 0 and 99),
  leaving uuid[] not null default '{}',
  entering uuid[] not null default '{}',
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (match_id, round_no)
);

create table if not exists public.display_screens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  token_hash text not null unique,
  photos jsonb not null default '{}',       -- user_id → URL assinada (só de quem autorizou)
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.draws enable row level security;
alter table public.match_rotation enable row level security;
alter table public.match_rounds enable row level security;
alter table public.display_screens enable row level security;
revoke all on public.draws, public.match_rotation, public.match_rounds, public.display_screens from anon, authenticated;
grant select on public.match_rotation, public.match_rounds to authenticated;
drop policy if exists "rodizio: quem pode ver a partida" on public.match_rotation;
create policy "rodizio: quem pode ver a partida" on public.match_rotation for select to authenticated using (private.can_see_match(match_id));
drop policy if exists "rodadas: quem pode ver a partida" on public.match_rounds;
create policy "rodadas: quem pode ver a partida" on public.match_rounds for select to authenticated using (private.can_see_match(match_id));
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.match_rotation'; exception when duplicate_object or undefined_object then null; end;
end $$;

-- Quem pode sortear e conduzir o rodízio desta partida.
create or replace function private.can_run(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches m where m.id = p_match
                  and (private.can(m.org_id, 'draw.run', 'group', m.group_id) or private.can(m.org_id, 'match.manage', 'group', m.group_id)))
$$;
grant execute on function private.can_run(uuid) to authenticated;

-- Confirmados na ordem de confirmação.
create or replace function private.confirmed_order(p_match uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(user_id order by responded_at, user_id), '{}')
    from public.match_participants where match_id = p_match and status = 'confirmed'
$$;

create or replace function private.level_sum(p_org uuid, p_users uuid[]) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce((select level from public.member_levels l where l.org_id = p_org and l.user_id = u), 3)), 0)::int
    from unnest(p_users) u
$$;

create or replace function private.first_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select split_part(coalesce(nullif(btrim(p.nick), ''), p.display_name), ' ', 1) from public.profiles p where p.id = p_user
$$;

-- ---------------------------------------------------------------- API: notas
-- Notas dos jogadores do grupo da partida (só para quem organiza).
create or replace function public.tfl_levels_get(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found or not private.can_run(p_match) then return jsonb_build_object('error', 'Só quem organiza vê as notas.'); end if;
  return jsonb_build_object('levels', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id,
      'name', coalesce(p.nick, p.display_name), 'photo_path', p.photo_path,
      'level', (select level from public.member_levels l where l.org_id = m.org_id and l.user_id = x.user_id))
      order by coalesce(p.nick, p.display_name))
    from public.group_members x left join public.profiles p on p.id = x.user_id
   where x.group_id = m.group_id and x.status = 'active'), '[]'::jsonb));
end $$;

create or replace function public.tfl_level_set(p_match uuid, p_user uuid, p_level int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found or not private.can_run(p_match) then return jsonb_build_object('error', 'Só quem organiza dá notas.'); end if;
  if p_level is not null and p_level not between 1 and 5 then return jsonb_build_object('error', 'Nota de 1 a 5.'); end if;
  if not exists (select 1 from public.group_members where group_id = m.group_id and user_id = p_user and status = 'active') then
    return jsonb_build_object('error', 'Jogador fora do grupo.');
  end if;
  if p_level is null then
    delete from public.member_levels where org_id = m.org_id and user_id = p_user;
  else
    insert into public.member_levels (org_id, user_id, level, set_by) values (m.org_id, p_user, p_level, (select auth.uid()))
    on conflict (org_id, user_id) do update set level = excluded.level, set_by = excluded.set_by, updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- API: sorteio
-- Grava um sorteio. Regras conferidas aqui (não se confia no app):
--   · em campo: exatamente os primeiros 2×N confirmados (ordem de confirmação), N por time
--   · fila: os demais confirmados, na ordem de confirmação
create or replace function public.tfl_draw_save(p_match uuid, p_mode text, p_team_a uuid[], p_team_b uuid[], p_seed text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.matches; v_conf uuid[]; v_n int; v_first uuid[]; v_queue uuid[]; v_id uuid; v_a int; v_b int; v_bal jsonb;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or not private.can_run(p_match) then return jsonb_build_object('error', 'Você não pode sortear este jogo.'); end if;
  if m.status = 'cancelled' then return jsonb_build_object('error', 'Este jogo foi cancelado.'); end if;
  if p_mode not in ('random', 'balanced', 'order') then return jsonb_build_object('error', 'Modo de sorteio inválido.'); end if;
  v_n := coalesce(array_length(p_team_a, 1), 0);
  if v_n < 2 or v_n > 11 or v_n <> coalesce(array_length(p_team_b, 1), 0) then return jsonb_build_object('error', 'Os dois times precisam ter o mesmo tamanho (de 2 a 11).'); end if;
  v_conf := private.confirmed_order(p_match);
  if coalesce(array_length(v_conf, 1), 0) < 2 * v_n then
    return jsonb_build_object('error', format('São precisos %s confirmados para dois times de %s. Agora são %s.', 2 * v_n, v_n, coalesce(array_length(v_conf, 1), 0)));
  end if;
  v_first := v_conf[1:2 * v_n];
  if (select count(distinct u) from unnest(p_team_a || p_team_b) u) <> 2 * v_n
     or exists (select 1 from unnest(p_team_a || p_team_b) u where not (u = any (v_first))) then
    return jsonb_build_object('error', 'Os times precisam ser formados pelos primeiros confirmados, sem repetir ninguém.');
  end if;
  v_queue := coalesce(v_conf[2 * v_n + 1:], '{}');
  v_a := private.level_sum(m.org_id, p_team_a); v_b := private.level_sum(m.org_id, p_team_b);
  v_bal := jsonb_build_object('a', v_a, 'b', v_b, 'pct_a', round(100.0 * v_a / greatest(v_a + v_b, 1)));
  insert into public.draws (match_id, org_id, mode, team_size, team_a, team_b, queue, seed, balance, created_by)
  values (p_match, m.org_id, p_mode, v_n, p_team_a, p_team_b, v_queue, left(p_seed, 80), v_bal, (select auth.uid())) returning id into v_id;
  insert into public.match_rotation (match_id, org_id, draw_id, team_size, team_a, team_b, queue)
  values (p_match, m.org_id, v_id, v_n, p_team_a, p_team_b, v_queue)
  on conflict (match_id) do update set draw_id = v_id, team_size = v_n, team_a = p_team_a, team_b = p_team_b, queue = v_queue,
     streak_a = 0, streak_b = 0, version = public.match_rotation.version + 1, updated_at = now();
  perform private.log(m.org_id, 'draw.save', null, jsonb_build_object('match', p_match, 'draw', v_id, 'mode', p_mode, 'balance', v_bal));
  return jsonb_build_object('ok', true, 'draw_id', v_id, 'balance', v_bal);
end $$;

-- Acerta o rodízio com a lista atual: tira quem desistiu (repondo do começo da fila) e põe no fim da
-- fila quem confirmou depois do sorteio.
create or replace function private.rotation_sync(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.match_rotation; v_conf uuid[]; v_a uuid[]; v_b uuid[]; v_q uuid[]; u uuid;
begin
  select * into r from public.match_rotation where match_id = p_match for update;
  if not found then return; end if;
  v_conf := private.confirmed_order(p_match);
  select coalesce(array_agg(x order by o), '{}') into v_a from unnest(r.team_a) with ordinality t(x, o) where x = any (v_conf);
  select coalesce(array_agg(x order by o), '{}') into v_b from unnest(r.team_b) with ordinality t(x, o) where x = any (v_conf);
  select coalesce(array_agg(x order by o), '{}') into v_q from unnest(r.queue) with ordinality t(x, o) where x = any (v_conf);
  foreach u in array v_conf loop
    if not (u = any (v_a || v_b || v_q)) then v_q := v_q || u; end if;
  end loop;
  while coalesce(array_length(v_a, 1), 0) < r.team_size and coalesce(array_length(v_q, 1), 0) > 0 loop v_a := v_a || v_q[1]; v_q := v_q[2:]; end loop;
  while coalesce(array_length(v_b, 1), 0) < r.team_size and coalesce(array_length(v_q, 1), 0) > 0 loop v_b := v_b || v_q[1]; v_q := v_q[2:]; end loop;
  if v_a is distinct from r.team_a or v_b is distinct from r.team_b or v_q is distinct from r.queue then
    update public.match_rotation set team_a = v_a, team_b = v_b, queue = v_q, version = version + 1, updated_at = now() where match_id = p_match;
  end if;
end $$;

create or replace function public.tfl_rotation_sync(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_run(p_match) then return jsonb_build_object('error', 'Você não conduz este jogo.'); end if;
  perform private.rotation_sync(p_match);
  return jsonb_build_object('ok', true);
end $$;

-- Fim de rodada: quem perde vai para o fim da fila e entram os próximos.
create or replace function public.tfl_round_finish(p_match uuid, p_winner text, p_score_a int default null, p_score_b int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.match_rotation; v_n int; v_q uuid[]; v_leave text; v_leaving uuid[]; v_entering uuid[]; v_a uuid[]; v_b uuid[];
        v_sa int; v_sb int; v_round int; m public.matches;
begin
  if not private.can_run(p_match) then return jsonb_build_object('error', 'Você não conduz este jogo.'); end if;
  if p_winner not in ('A', 'B', 'draw') then return jsonb_build_object('error', 'Informe quem venceu (A, B ou empate).'); end if;
  select * into m from public.matches where id = p_match;
  perform private.rotation_sync(p_match);
  select * into r from public.match_rotation where match_id = p_match for update;
  if not found then return jsonb_build_object('error', 'Faça o sorteio antes de registrar rodadas.'); end if;
  if coalesce(array_length(r.team_a, 1), 0) = 0 or coalesce(array_length(r.team_b, 1), 0) = 0 then
    return jsonb_build_object('error', 'Um dos times está vazio. Confirme mais jogadores.');
  end if;
  v_n := r.team_size; v_q := r.queue; v_a := r.team_a; v_b := r.team_b; v_sa := r.streak_a + 1; v_sb := r.streak_b + 1;
  if p_winner = 'draw' and coalesce(array_length(v_q, 1), 0) >= 2 * v_n then
    v_leaving := v_a || v_b; v_q := v_q || v_a || v_b;
    v_a := v_q[1:v_n]; v_b := v_q[v_n + 1:2 * v_n]; v_q := v_q[2 * v_n + 1:]; v_entering := v_a || v_b; v_sa := 0; v_sb := 0;
  else
    v_leave := case when p_winner = 'A' then 'B' when p_winner = 'B' then 'A' when v_sb > v_sa then 'B' else 'A' end;
    if v_leave = 'A' then
      v_leaving := v_a; v_q := v_q || v_a; v_a := v_q[1:v_n]; v_q := coalesce(v_q[v_n + 1:], '{}'); v_entering := v_a; v_sa := 0;
    else
      v_leaving := v_b; v_q := v_q || v_b; v_b := v_q[1:v_n]; v_q := coalesce(v_q[v_n + 1:], '{}'); v_entering := v_b; v_sb := 0;
    end if;
  end if;
  v_round := r.round_no;
  insert into public.match_rounds (match_id, org_id, round_no, team_a, team_b, winner, score_a, score_b, leaving, entering, recorded_by)
  values (p_match, r.org_id, v_round, r.team_a, r.team_b, p_winner, p_score_a, p_score_b, v_leaving, v_entering, (select auth.uid()));
  update public.match_rotation set team_a = v_a, team_b = v_b, queue = coalesce(v_q, '{}'), streak_a = v_sa, streak_b = v_sb,
         round_no = v_round + 1, version = version + 1, updated_at = now() where match_id = p_match;
  return jsonb_build_object('ok', true, 'round', v_round, 'leaving', v_leaving, 'entering', v_entering);
end $$;

-- Desfaz a última rodada (erro de registro): volta o rodízio ao estado anterior.
create or replace function public.tfl_round_undo(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rd public.match_rounds; r public.match_rotation; v_q uuid[];
begin
  if not private.can_run(p_match) then return jsonb_build_object('error', 'Você não conduz este jogo.'); end if;
  select * into rd from public.match_rounds where match_id = p_match order by round_no desc limit 1;
  if not found then return jsonb_build_object('error', 'Nenhuma rodada para desfazer.'); end if;
  select * into r from public.match_rotation where match_id = p_match for update;
  -- A fila anterior = fila atual sem quem saiu (que foi para o fim), com quem entrou de volta no começo.
  select coalesce(array_agg(x order by o), '{}') into v_q from unnest(r.queue) with ordinality t(x, o) where not (x = any (rd.leaving));
  v_q := (select coalesce(array_agg(x order by o), '{}') from unnest(rd.entering) with ordinality t(x, o) where not (x = any (rd.leaving))) || v_q;
  update public.match_rotation set team_a = rd.team_a, team_b = rd.team_b, queue = v_q, round_no = rd.round_no,
         streak_a = greatest(streak_a - 1, 0), streak_b = greatest(streak_b - 1, 0), version = version + 1, updated_at = now()
   where match_id = p_match;
  delete from public.match_rounds where id = rd.id;
  perform private.log(r.org_id, 'round.undo', null, jsonb_build_object('match', p_match, 'round', rd.round_no));
  return jsonb_build_object('ok', true);
end $$;

-- Troca manual de dois jogadores (entre times e/ou fila).
create or replace function public.tfl_rotation_swap(p_match uuid, p_user1 uuid, p_user2 uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.match_rotation; v_all uuid[]; i1 int; i2 int; na int; nb int; v_tmp uuid;
begin
  if not private.can_run(p_match) then return jsonb_build_object('error', 'Você não conduz este jogo.'); end if;
  select * into r from public.match_rotation where match_id = p_match for update;
  if not found then return jsonb_build_object('error', 'Faça o sorteio antes.'); end if;
  na := coalesce(array_length(r.team_a, 1), 0); nb := coalesce(array_length(r.team_b, 1), 0);
  v_all := r.team_a || r.team_b || r.queue;
  i1 := array_position(v_all, p_user1); i2 := array_position(v_all, p_user2);
  if i1 is null or i2 is null then return jsonb_build_object('error', 'Os dois precisam estar no rodízio.'); end if;
  v_tmp := v_all[i1]; v_all[i1] := v_all[i2]; v_all[i2] := v_tmp;
  update public.match_rotation set team_a = v_all[1:na], team_b = v_all[na + 1:na + nb], queue = coalesce(v_all[na + nb + 1:], '{}'),
         version = version + 1, updated_at = now() where match_id = p_match;
  perform private.log(r.org_id, 'rotation.swap', null, jsonb_build_object('match', p_match));
  return jsonb_build_object('ok', true);
end $$;

-- Estado do rodízio para quem vê a partida (notas só para quem organiza).
create or replace function public.tfl_rotation_get(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.match_rotation; d public.draws; v_run boolean; v_org uuid;
begin
  if not private.can_see_match(p_match) then return jsonb_build_object('error', 'Sem acesso a este jogo.'); end if;
  v_run := private.can_run(p_match);
  select org_id into v_org from public.matches where id = p_match;
  select * into r from public.match_rotation where match_id = p_match;
  if not found then return jsonb_build_object('exists', false, 'can_run', v_run, 'confirmed', coalesce(array_length(private.confirmed_order(p_match), 1), 0)); end if;
  select * into d from public.draws where id = r.draw_id;
  return jsonb_build_object('exists', true, 'can_run', v_run, 'team_size', r.team_size, 'round_no', r.round_no, 'version', r.version,
    'confirmed', coalesce(array_length(private.confirmed_order(p_match), 1), 0),
    'draw', jsonb_build_object('id', d.id, 'mode', d.mode, 'created_at', d.created_at, 'balance', case when v_run then d.balance end),
    'teams', jsonb_build_object(
      'A', (select coalesce(jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(p.nick, p.display_name), 'photo_path', p.photo_path,
              'level', case when v_run then (select level from public.member_levels l where l.org_id = v_org and l.user_id = u) end) order by o), '[]'::jsonb)
              from unnest(r.team_a) with ordinality t(u, o) left join public.profiles p on p.id = u),
      'B', (select coalesce(jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(p.nick, p.display_name), 'photo_path', p.photo_path,
              'level', case when v_run then (select level from public.member_levels l where l.org_id = v_org and l.user_id = u) end) order by o), '[]'::jsonb)
              from unnest(r.team_b) with ordinality t(u, o) left join public.profiles p on p.id = u)),
    'queue', (select coalesce(jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(p.nick, p.display_name), 'photo_path', p.photo_path) order by o), '[]'::jsonb)
              from unnest(r.queue) with ordinality t(u, o) left join public.profiles p on p.id = u),
    'streak', jsonb_build_object('A', r.streak_a, 'B', r.streak_b),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object('round_no', round_no, 'winner', winner, 'score_a', score_a, 'score_b', score_b, 'at', created_at)
               order by round_no desc), '[]'::jsonb) from public.match_rounds where match_id = p_match));
end $$;

-- ---------------------------------------------------------------- API: telão
-- Abre um telão. O app manda as URLs assinadas das fotos; aqui só ficam as de quem autorizou o telão
-- (show_on_screen) e não é menor de idade. Devolve o código uma única vez (no banco fica só o hash).
create or replace function public.tfl_display_open(p_match uuid, p_photos jsonb default '{}', p_hours int default 12) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.matches; v_token text; v_photos jsonb := '{}'; k text;
begin
  select * into m from public.matches where id = p_match;
  if not found or not private.can_run(p_match) then return jsonb_build_object('error', 'Você não pode abrir o telão deste jogo.'); end if;
  if p_hours is null or p_hours not between 1 and 24 then return jsonb_build_object('error', 'Validade entre 1 e 24 horas.'); end if;
  for k in select jsonb_object_keys(coalesce(p_photos, '{}')) loop
    if exists (select 1 from public.profiles p join public.match_participants x on x.user_id = p.id and x.match_id = p_match
                where p.id = private.try_uuid(k) and p.show_on_screen and not private.is_minor(p.birth_date) and p.photo_path is not null)
       and (p_photos->>k) ~ '^https://' then
      v_photos := v_photos || jsonb_build_object(k, p_photos->>k);
    end if;
  end loop;
  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.display_screens (org_id, match_id, token_hash, photos, expires_at, created_by)
  values (m.org_id, p_match, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_photos, now() + make_interval(hours => p_hours), (select auth.uid()));
  perform private.log(m.org_id, 'display.open', null, jsonb_build_object('match', p_match, 'hours', p_hours));
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', now() + make_interval(hours => p_hours));
end $$;

-- O que o telão mostra (sem login). Só primeiro nome e foto autorizada; nada de e-mail, idade, notas ou contatos.
create or replace function public.tfl_display_state(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.display_screens; m public.matches; r public.match_rotation; d public.draws; lr public.match_rounds;
begin
  select * into s from public.display_screens where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found or s.revoked_at is not null or s.expires_at < now() then return jsonb_build_object('error', 'Este link de telão expirou ou foi encerrado.'); end if;
  select * into m from public.matches where id = s.match_id;
  select * into r from public.match_rotation where match_id = s.match_id;
  select * into d from public.draws where id = r.draw_id;
  select * into lr from public.match_rounds where match_id = s.match_id order by round_no desc limit 1;
  return jsonb_build_object(
    'org', (select name from public.orgs where id = m.org_id), 'group', (select name from public.groups where id = m.group_id),
    'starts_at', m.starts_at, 'status', m.status, 'timezone', private.org_tz(m.org_id),
    'place', coalesce((select name from public.venues where id = m.venue_id), m.location_text),
    'confirmed', coalesce(array_length(private.confirmed_order(m.id), 1), 0),
    'rotation', case when r.match_id is null then null else jsonb_build_object(
      'version', r.version, 'round_no', r.round_no, 'team_size', r.team_size,
      'draw_id', r.draw_id, 'draw_mode', d.mode, 'draw_at', d.created_at,
      'A', (select coalesce(jsonb_agg(jsonb_build_object('name', private.first_name(u), 'photo', s.photos->>u::text) order by o), '[]'::jsonb) from unnest(r.team_a) with ordinality t(u, o)),
      'B', (select coalesce(jsonb_agg(jsonb_build_object('name', private.first_name(u), 'photo', s.photos->>u::text) order by o), '[]'::jsonb) from unnest(r.team_b) with ordinality t(u, o)),
      'queue', (select coalesce(jsonb_agg(private.first_name(u) order by o), '[]'::jsonb) from unnest(r.queue) with ordinality t(u, o)),
      'last', case when lr.id is null then null else jsonb_build_object('round_no', lr.round_no, 'winner', lr.winner, 'score_a', lr.score_a, 'score_b', lr.score_b) end) end);
end $$;

create or replace function public.tfl_display_close(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_run(p_match) then return jsonb_build_object('error', 'Você não conduz este jogo.'); end if;
  update public.display_screens set revoked_at = now() where match_id = p_match and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- execução
do $$
declare f text;
begin
  foreach f in array array['tfl_levels_get(uuid)', 'tfl_level_set(uuid, uuid, int)', 'tfl_draw_save(uuid, text, uuid[], uuid[], text)',
    'tfl_rotation_sync(uuid)', 'tfl_round_finish(uuid, text, int, int)', 'tfl_round_undo(uuid)', 'tfl_rotation_swap(uuid, uuid, uuid)',
    'tfl_rotation_get(uuid)', 'tfl_display_open(uuid, jsonb, int)', 'tfl_display_close(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- O telão abre sem login: só esta função fica disponível para visitantes.
revoke execute on function public.tfl_display_state(text) from public;
grant execute on function public.tfl_display_state(text) to anon, authenticated;
revoke execute on function private.confirmed_order(uuid), private.level_sum(uuid, uuid[]), private.first_name(uuid), private.rotation_sync(uuid) from public;
