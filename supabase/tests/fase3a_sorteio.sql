-- =====================================================================================
-- Testes da Fase 3a: notas, sorteio, rodízio e telão. Só no projeto de TESTES.
-- Um único comando; resultados em private.test_results (n >= 200).
-- =====================================================================================
do $test$
declare
  v_org uuid := gen_random_uuid(); v_oa uuid := gen_random_uuid(); v_grp uuid; v_match uuid;
  v_p uuid[] := '{}'; v_menor uuid; v_semfoto uuid; i int; j jsonb; v_tok text; s text; n int; r jsonb := '[]'::jsonb;
  v_a uuid[]; v_b uuid[]; v_q uuid[];
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'private' and table_name = 'env')
     or not exists (select 1 from private.env where key = 'ambiente' and value = 'dev') then
    raise exception 'Este teste só roda no projeto de TESTES.';
  end if;
  create table if not exists private.test_results (n numeric primary key, teste text, ok boolean, detalhe text, rodado_em timestamptz default now());
  delete from private.test_results t where t.n >= 200;
  delete from public.orgs where slug like 'teste-%';
  delete from auth.users where email like '%@teste.tfl';

  -- 1 organizador + 12 jogadores (o 11º é menor de idade, o 12º não autorizou o telão)
  for i in 1..12 loop v_p := v_p || gen_random_uuid(); end loop;
  v_menor := v_p[11]; v_semfoto := v_p[12];
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', 'j' || k || '@teste.tfl', '', '{}', '{}', now(), now()
    from unnest(array[v_oa] || v_p) with ordinality t(id, k);
  insert into public.profiles (id, display_name, birth_date, photo_path, show_on_screen)
  select id, 'Jogador' || k || ' Sobrenome', case when id = v_menor then (current_date - interval '14 years')::date else date '1990-01-01' end,
         id::text || '/1.jpg', id <> v_semfoto
    from unnest(array[v_oa] || v_p) with ordinality t(id, k);
  update public.profiles set guardian_name = 'Responsável', guardian_email = 'resp@teste.tfl', guardian_consent_at = now(), show_on_screen = false where id = v_menor;
  insert into public.orgs (id, slug, name) values (v_org, 'teste-a', 'Teste A');
  insert into public.org_members (org_id, user_id, display_name, role, status)
  select v_org, id, 'Jogador', case when id = v_oa then 'organizer' else 'player' end, 'approved' from unnest(array[v_oa] || v_p) id;
  insert into public.groups (org_id, name, created_by, default_capacity) values (v_org, 'Terça', v_oa, 14) returning id into v_grp;
  insert into public.group_members (group_id, user_id, status, joined_at) select v_grp, id, 'active', now() from unnest(array[v_oa] || v_p) id;
  insert into public.matches (org_id, group_id, location_text, starts_at, ends_at, capacity, created_by)
  values (v_org, v_grp, 'Quadra', now() + interval '1 day', now() + interval '1 day 1 hour', 14, v_oa) returning id into v_match;
  insert into public.match_participants (match_id, user_id, status, responded_at)
  select v_match, id, 'confirmed', now() - make_interval(mins => 100 - k::int) from unnest(v_p) with ordinality t(id, k);

  -- ------------------------------------------------------------ 200. notas
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_level_set(v_match, v_p[1], 5);
  r := r || jsonb_build_array(jsonb_build_array(200, 'Organizador dá nota a um jogador', coalesce((j->>'ok')::boolean, false), j::text));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p[2], 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_levels_get(v_match);
  r := r || jsonb_build_array(jsonb_build_array(200.1, 'Jogador não vê as notas', j ? 'error', j::text));
  begin perform level from public.member_levels;
        r := r || jsonb_build_array(jsonb_build_array(200.2, 'Notas não são legíveis direto na tabela', false, 'leu'));
  exception when others then r := r || jsonb_build_array(jsonb_build_array(200.2, 'Notas não são legíveis direto na tabela', true, sqlerrm)); end;
  j := public.tfl_draw_save(v_match, 'random', v_p[1:5], v_p[6:10], null);
  r := r || jsonb_build_array(jsonb_build_array(200.3, 'Jogador não sorteia', j ? 'error', j::text));
  j := public.tfl_rotation_get(v_match);
  r := r || jsonb_build_array(jsonb_build_array(200.4, 'Jogador pode ver o rodízio, mas sem as notas', not (j ? 'error'), coalesce(j->>'error', 'ok')));
  reset role;

  -- ------------------------------------------------------------ 201. sorteio
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_draw_save(v_match, 'balanced', array[v_p[1], v_p[2], v_p[3], v_p[4], v_p[11]], v_p[6:10], 'x');
  r := r || jsonb_build_array(jsonb_build_array(201, 'Sorteio com quem não está entre os 10 primeiros é recusado', j ? 'error', j::text));
  j := public.tfl_draw_save(v_match, 'balanced', array[v_p[1], v_p[1], v_p[3], v_p[4], v_p[5]], v_p[6:10], 'x');
  r := r || jsonb_build_array(jsonb_build_array(201.1, 'Sorteio repetindo jogador é recusado', j ? 'error', j::text));
  j := public.tfl_draw_save(v_match, 'balanced', array[v_p[2], v_p[4], v_p[6], v_p[8], v_p[10]], array[v_p[1], v_p[3], v_p[5], v_p[7], v_p[9]], 'semente');
  r := r || jsonb_build_array(jsonb_build_array(201.2, 'Sorteio válido é gravado com o equilíbrio', j ? 'draw_id' and (j->'balance'->>'b')::int = 17, j::text));
  reset role;
  select queue into v_q from public.match_rotation where match_id = v_match;
  r := r || jsonb_build_array(jsonb_build_array(201.3, 'A fila fica com os demais, na ordem de confirmação', v_q = array[v_p[11], v_p[12]], v_q::text));

  -- ------------------------------------------------------------ 202. rodízio
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_round_finish(v_match, 'A', 2, 1);
  reset role;
  select team_a, team_b, queue into v_a, v_b, v_q from public.match_rotation where match_id = v_match;
  r := r || jsonb_build_array(jsonb_build_array(202, 'A vence: B sai, entram os 2 da fila + 3 primeiros de B, sobram 2 de B na fila',
    v_b = array[v_p[11], v_p[12], v_p[1], v_p[3], v_p[5]] and v_q = array[v_p[7], v_p[9]] and v_a = array[v_p[2], v_p[4], v_p[6], v_p[8], v_p[10]],
    'B=' || v_b::text || ' fila=' || v_q::text));
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_round_finish(v_match, 'draw', 0, 0);
  reset role;
  select team_a, queue into v_a, v_q from public.match_rotation where match_id = v_match;
  r := r || jsonb_build_array(jsonb_build_array(202.1, 'Empate com 1 time só na fila: sai A (2 rodadas em campo)',
    v_a[1:2] = array[v_p[7], v_p[9]], 'A=' || v_a::text));
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_round_undo(v_match);
  reset role;
  select team_a, team_b, queue into v_a, v_b, v_q from public.match_rotation where match_id = v_match;
  r := r || jsonb_build_array(jsonb_build_array(202.2, 'Desfazer a última rodada volta os times e a fila',
    v_a = array[v_p[2], v_p[4], v_p[6], v_p[8], v_p[10]] and v_q = array[v_p[7], v_p[9]], 'A=' || v_a::text || ' fila=' || v_q::text));
  select count(*) into n from public.match_rounds where match_id = v_match;
  r := r || jsonb_build_array(jsonb_build_array(202.3, 'O histórico guarda só as rodadas válidas', n = 1, n::text));

  -- ------------------------------------------------------------ 203. desistência depois do sorteio
  update public.match_participants set status = 'declined' where match_id = v_match and user_id = v_p[2];
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_rotation_sync(v_match);
  reset role;
  select team_a, queue into v_a, v_q from public.match_rotation where match_id = v_match;
  r := r || jsonb_build_array(jsonb_build_array(203, 'Quem desistiu sai do time e o 1º da fila entra no lugar',
    not (v_p[2] = any (v_a)) and v_p[7] = any (v_a) and v_q = array[v_p[9]], 'A=' || v_a::text || ' fila=' || v_q::text));

  -- ------------------------------------------------------------ 204. telão
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_display_open(v_match, jsonb_build_object(v_p[4]::text, 'https://exemplo.test/foto4', v_menor::text, 'https://exemplo.test/menor',
                                                          v_semfoto::text, 'https://exemplo.test/sem'), 12);
  v_tok := j->>'token';
  r := r || jsonb_build_array(jsonb_build_array(204, 'Organizador abre o telão e recebe o código', v_tok is not null and length(v_tok) = 36, coalesce(j->>'error', 'ok')));
  reset role;
  select photos::text into s from public.display_screens where match_id = v_match;
  r := r || jsonb_build_array(jsonb_build_array(204.1, 'Telão guarda só a foto de quem autorizou (nem menor, nem quem recusou)',
    s like '%foto4%' and s not like '%menor%' and s not like '%/sem%', s));
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  j := public.tfl_display_state(v_tok);
  reset role;
  r := r || jsonb_build_array(jsonb_build_array(204.2, 'Telão abre sem login e mostra os times',
    jsonb_array_length(j->'rotation'->'A') = 5, coalesce(j->>'error', 'ok')));
  r := r || jsonb_build_array(jsonb_build_array(204.3, 'Só o primeiro nome aparece (sem sobrenome, e-mail ou nota)',
    j::text not like '%Sobrenome%' and j::text not like '%@teste.tfl%' and j::text not like '%level%', left(j->'rotation'->>'A', 120)));
  set local role anon;
  j := public.tfl_display_state('codigo-errado');
  reset role;
  r := r || jsonb_build_array(jsonb_build_array(204.4, 'Código errado não abre nada', j ? 'error', j::text));
  update public.display_screens set expires_at = now() - interval '1 minute' where match_id = v_match;
  set local role anon;
  j := public.tfl_display_state(v_tok);
  reset role;
  r := r || jsonb_build_array(jsonb_build_array(204.5, 'Código vencido para de funcionar', j ? 'error', j::text));
  begin
    set local role anon;
    perform public.tfl_rotation_get(v_match);
    reset role;
    r := r || jsonb_build_array(jsonb_build_array(204.6, 'Visitante sem login não acessa outras funções', false, 'acessou'));
  exception when others then
    reset role;
    r := r || jsonb_build_array(jsonb_build_array(204.6, 'Visitante sem login não acessa outras funções', true, sqlerrm));
  end;

  -- ------------------------------------------------------------ resultado e limpeza
  perform set_config('request.jwt.claims', '', true);
  insert into private.test_results (n, teste, ok, detalhe)
  select (x->>0)::numeric, x->>1, (x->>2)::boolean, x->>3 from jsonb_array_elements(r) x;
  delete from public.orgs where slug like 'teste-%';
  delete from auth.users where email like '%@teste.tfl';
end $test$;
