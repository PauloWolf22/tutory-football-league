-- =====================================================================================
-- Testes da Fase 2: campos, agenda, grupos, partidas e presença.
-- Só roda no projeto de TESTES. Um único comando; resultados em private.test_results (n >= 100).
-- Rodar depois de fase1_permissoes.sql (que zera a tabela de resultados).
-- =====================================================================================
do $test$
declare
  v_ga uuid := gen_random_uuid(); v_oa uuid := gen_random_uuid(); v_j1 uuid := gen_random_uuid(); v_j2 uuid := gen_random_uuid();
  v_j3 uuid := gen_random_uuid(); v_fora uuid := gen_random_uuid(); v_gb uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_campo uuid; v_grupo uuid; v_jogo uuid; v_jogo2 uuid; v_res uuid; v_res2 uuid;
  v_tz text := 'America/Sao_Paulo'; v_dia date := current_date + 3;
  v_20h timestamptz; v_21h timestamptz; v_5h timestamptz;
  j jsonb; n int; s text; r jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'private' and table_name = 'env')
     or not exists (select 1 from private.env where key = 'ambiente' and value = 'dev') then
    raise exception 'Este teste só roda no projeto de TESTES.';
  end if;
  create table if not exists private.test_results (n numeric primary key, teste text, ok boolean, detalhe text, rodado_em timestamptz default now());
  delete from private.test_results t where t.n >= 100;   -- "t.n": a coluna, não a variável n
  v_20h := (v_dia + time '20:00') at time zone v_tz;
  v_21h := (v_dia + time '21:00') at time zone v_tz;
  v_5h := (v_dia + time '05:00') at time zone v_tz;

  -- ------------------------------------------------------------ preparação
  delete from public.orgs where slug like 'teste-%';
  delete from auth.users where email like '%@teste.tfl';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', k || '@teste.tfl', '', '{}', '{}', now(), now()
    from (values (v_ga, 'ga'), (v_oa, 'oa'), (v_j1, 'j1'), (v_j2, 'j2'), (v_j3, 'j3'), (v_fora, 'fora'), (v_gb, 'gb')) as x(id, k);
  insert into public.profiles (id, display_name, birth_date)
  select id, 'Teste ' || k, date '1990-01-01' from (values (v_ga, 'GA'), (v_oa, 'OA'), (v_j1, 'J1'), (v_j2, 'J2'), (v_j3, 'J3'), (v_fora, 'FORA'), (v_gb, 'GB')) as x(id, k);
  insert into public.orgs (slug, name, kind) values ('teste-a', 'Arena Teste A', 'venue_company') returning id into v_a;
  insert into public.orgs (slug, name, kind) values ('teste-b', 'Empresa Teste B', 'organizer') returning id into v_b;
  insert into public.org_members (org_id, user_id, display_name, role, status) values
    (v_a, v_ga, 'GA', 'owner', 'approved'), (v_a, v_oa, 'OA', 'organizer', 'approved'), (v_a, v_j1, 'J1', 'player', 'approved'),
    (v_a, v_j2, 'J2', 'player', 'approved'), (v_a, v_j3, 'J3', 'player', 'approved'), (v_a, v_fora, 'FORA', 'player', 'approved'),
    (v_b, v_gb, 'GB', 'owner', 'approved');

  -- ------------------------------------------------------------ 100. campos (gestor)
  perform set_config('request.jwt.claims', json_build_object('sub', v_ga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_venue_save('teste-a', null, 'Campo 1', 'Sintético', 14, 20000, 'active',
         (select jsonb_agg(jsonb_build_object('weekday', d, 'opens', '06:00', 'closes', '00:00')) from generate_series(0, 6) d));
  v_campo := (j->>'id')::uuid;
  r := r || jsonb_build_array(jsonb_build_array(100, 'Gestor cadastra campo com horários e preço', v_campo is not null, j::text));
  j := public.tfl_venues_list('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(100.1, 'Preço mostrado = hora + 6% (R$ 200 → R$ 212)',
    (j->'venues'->0->>'price_with_fee_cents')::int = 21200, j->'venues'->0->>'price_with_fee_cents'));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_venue_save('teste-a', null, 'Campo pirata', null, 14, 100, 'active', '[]');
  r := r || jsonb_build_array(jsonb_build_array(100.2, 'Organizador não cadastra campos', j ? 'error', j::text));

  -- ------------------------------------------------------------ 101. agenda
  j := public.tfl_booking_request('teste-a', v_campo, v_5h, 60);
  r := r || jsonb_build_array(jsonb_build_array(101, 'Pedido fora dos horários publicados é recusado', j ? 'error', j::text));
  j := public.tfl_booking_request('teste-a', v_campo, now() + interval '1 hour', 60);
  r := r || jsonb_build_array(jsonb_build_array(101.1, 'Pedido sem antecedência mínima é recusado', j ? 'error', j::text));
  j := public.tfl_booking_request('teste-a', v_campo, v_20h, 60);
  v_res := (j->>'id')::uuid;
  r := r || jsonb_build_array(jsonb_build_array(101.2, 'Organizador pede 20h: fica segurado, com R$ 200 + R$ 12 = R$ 212',
    v_res is not null and (j->>'total_cents')::int = 21200 and (j->>'fee_cents')::int = 1200, j::text));
  j := public.tfl_booking_request('teste-a', v_campo, v_20h + interval '30 minutes', 60);
  r := r || jsonb_build_array(jsonb_build_array(101.3, 'Outro pedido sobrepondo o horário segurado é recusado', j ? 'error', coalesce(j->>'error', j::text)));
  j := public.tfl_booking_decide('teste-a', v_res, true, null);
  r := r || jsonb_build_array(jsonb_build_array(101.4, 'Organizador não confirma a própria reserva', j ? 'error', j::text));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_booking_decide('teste-a', v_res, true, 'Até lá!');
  select status into s from public.bookings where id = v_res;
  r := r || jsonb_build_array(jsonb_build_array(101.5, 'Gestor confirma o pedido', s = 'confirmed', s));
  reset role;
  -- Pedido segurado vencido deixa o horário livre.
  insert into public.bookings (org_id, venue_id, starts_at, ends_at, status, hold_expires_at, requested_by)
  values (v_a, v_campo, v_21h, v_21h + interval '1 hour', 'held', now() - interval '1 minute', v_oa) returning id into v_res2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_booking_request('teste-a', v_campo, v_21h, 60);
  r := r || jsonb_build_array(jsonb_build_array(101.6, 'Pedido segurado que venceu (24 h) libera o horário', not (j ? 'error'), coalesce(j->>'error', 'ok')));
  reset role;
  select status into s from public.bookings where id = v_res2;
  r := r || jsonb_build_array(jsonb_build_array(101.7, 'O pedido vencido fica marcado como expirado', s = 'expired', s));

  -- ------------------------------------------------------------ 102. grupos
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_group_save('teste-a', null, 'Futebol de terça', v_campo, null, 2);
  v_grupo := (j->>'id')::uuid;
  r := r || jsonb_build_array(jsonb_build_array(102, 'Organizador cria grupo (com 2 vagas por jogo, para testar a espera)', v_grupo is not null, j::text));
  j := public.tfl_group_invite(v_grupo, array[v_j1, v_j2, v_j3, v_gb]);
  r := r || jsonb_build_array(jsonb_build_array(102.1, 'Convite só vale para membros aprovados da empresa (3 de 4)', (j->>'invited')::int = 3, j::text));
  reset role;
  foreach n in array array[1, 2, 3] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case n when 1 then v_j1 when 2 then v_j2 else v_j3 end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.tfl_group_respond(v_grupo, true);
    reset role;
  end loop;
  select count(*) into n from public.group_members where group_id = v_grupo and status = 'active';
  r := r || jsonb_build_array(jsonb_build_array(102.2, 'Os 3 aceitam o convite (grupo com 4, contando o organizador)', n = 4, n::text));

  -- ------------------------------------------------------------ 103. partida e presença
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_match_create('teste-a', v_grupo, v_20h, 60, 2, null, 'Quadra da rua', null);
  v_jogo := (j->>'id')::uuid;
  r := r || jsonb_build_array(jsonb_build_array(103, 'Organizador cria jogo num local livre', v_jogo is not null, coalesce(j->>'error', 'ok')));
  j := public.tfl_match_create('teste-a', v_grupo, v_20h, 60, 2, v_campo, null, null);
  r := r || jsonb_build_array(jsonb_build_array(103.1, 'Jogo no Campo 1 às 20h (já confirmado para outro) é recusado', j ? 'error', coalesce(j->>'error', j::text)));
  reset role;
  select count(*) into n from public.match_participants where match_id = v_jogo and status = 'invited';
  r := r || jsonb_build_array(jsonb_build_array(103.2, 'Todos os membros do grupo entram na lista como convidados', n = 4, n::text));
  select count(*) into n from public.notifications where kind = 'match.invite' and link = '#/jogo/' || v_jogo;
  r := r || jsonb_build_array(jsonb_build_array(103.3, 'Cada convidado recebe um aviso no app', n = 4, n::text));

  perform set_config('request.jwt.claims', json_build_object('sub', v_j1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_match_rsvp(v_jogo, true);
  r := r || jsonb_build_array(jsonb_build_array(103.4, 'J1 confirma: vaga 1 de 2', j->>'status' = 'confirmed', j::text));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_j2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_match_rsvp(v_jogo, true);
  r := r || jsonb_build_array(jsonb_build_array(103.5, 'J2 confirma: vaga 2 de 2', j->>'status' = 'confirmed', j::text));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_j3, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_match_rsvp(v_jogo, true);
  r := r || jsonb_build_array(jsonb_build_array(103.6, 'J3 confirma com o jogo lotado: vai para a espera', j->>'status' = 'waitlist', j::text));
  j := public.tfl_match_rsvp(v_jogo, true);
  r := r || jsonb_build_array(jsonb_build_array(103.7, 'Confirmar de novo não muda a posição', j->>'status' = 'waitlist', j::text));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_j1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_match_rsvp(v_jogo, false);
  reset role;
  select status into s from public.match_participants where match_id = v_jogo and user_id = v_j3;
  r := r || jsonb_build_array(jsonb_build_array(103.8, 'J1 desiste: a vaga passa direto para J3', s = 'confirmed', s));
  select count(*) into n from public.notifications where user_id = v_j3 and kind = 'match.promoted';
  r := r || jsonb_build_array(jsonb_build_array(103.9, 'J3 recebe o aviso de que entrou', n = 1, n::text));
  select count(*) into n from public.match_participants where match_id = v_jogo and status = 'confirmed';
  r := r || jsonb_build_array(jsonb_build_array(103.95, 'Nunca passa das vagas (2 confirmados)', n = 2, n::text));

  -- ------------------------------------------------------------ 104. acesso
  perform set_config('request.jwt.claims', json_build_object('sub', v_fora, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_match_rsvp(v_jogo, true);
  r := r || jsonb_build_array(jsonb_build_array(104, 'Membro da empresa fora do grupo não entra na lista', j ? 'error', j::text));
  j := public.tfl_match_get(v_jogo);
  r := r || jsonb_build_array(jsonb_build_array(104.1, 'E não vê a lista do jogo', j ? 'error', j::text));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_matches_list('teste-a', now(), now() + interval '30 days');
  r := r || jsonb_build_array(jsonb_build_array(104.2, 'Outra empresa não lista os jogos da A', j ? 'error', j::text));
  select count(*) into n from public.match_participants where match_id = v_jogo;
  r := r || jsonb_build_array(jsonb_build_array(104.3, 'Outra empresa lendo a tabela direto: 0 linhas', n = 0, n::text));
  select count(*) into n from public.bookings where org_id = v_a;
  r := r || jsonb_build_array(jsonb_build_array(104.4, 'Outra empresa não vê a agenda da A', n = 0, n::text));
  reset role;

  -- ------------------------------------------------------------ 105. jogo no campo e cancelamento
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_match_create('teste-a', v_grupo, v_20h + interval '1 day', 60, 2, v_campo, null, null);
  v_jogo2 := (j->>'id')::uuid;
  r := r || jsonb_build_array(jsonb_build_array(105, 'Jogo no campo da empresa cria o pedido de horário junto', v_jogo2 is not null and j->'booking'->>'id' is not null, coalesce(j->>'error', 'ok')));
  select b.status into s from public.matches m join public.bookings b on b.id = m.booking_id where m.id = v_jogo2;
  r := r || jsonb_build_array(jsonb_build_array(105.1, 'Esse horário fica segurado até a empresa confirmar', s = 'held', s));
  j := public.tfl_match_cancel(v_jogo2, 'ok');   -- "chuva" (5 letras) é um motivo válido; "ok" não
  r := r || jsonb_build_array(jsonb_build_array(105.2, 'Cancelar exige motivo com 5 letras ou mais', j ? 'error', j::text));
  j := public.tfl_match_cancel(v_jogo2, 'Previsão de chuva forte');
  reset role;
  select b.status into s from public.matches m join public.bookings b on b.id = m.booking_id where m.id = v_jogo2;
  r := r || jsonb_build_array(jsonb_build_array(105.3, 'Cancelar o jogo libera o horário do campo', s = 'cancelled', s));
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_booking_request('teste-a', v_campo, v_20h + interval '1 day', 60);
  r := r || jsonb_build_array(jsonb_build_array(105.4, 'O mesmo horário pode ser pedido de novo', not (j ? 'error'), coalesce(j->>'error', 'ok')));
  reset role;

  -- ------------------------------------------------------------ resultado e limpeza
  perform set_config('request.jwt.claims', '', true);
  insert into private.test_results (n, teste, ok, detalhe)
  select (x->>0)::numeric, x->>1, (x->>2)::boolean, x->>3 from jsonb_array_elements(r) x;
  delete from public.orgs where slug like 'teste-%';
  delete from auth.users where email like '%@teste.tfl';
end $test$;
