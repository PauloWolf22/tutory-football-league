-- =====================================================================================
-- Testes da Fase 1: permissões, isolamento entre empresas, suporte e menores.
-- Só roda no projeto de TESTES (marcado por 00_marcar_ambiente_dev.sql).
-- Um único comando (a CLI "db query" não aceita vários): cria pessoas e empresas de teste
-- (e-mails @teste.tfl, endereços teste-*), testa simulando cada pessoa (role authenticated
-- + JWT), grava o resultado em private.test_results e apaga os dados de teste no fim.
-- Ver o resultado: select * from private.test_results order by n;
-- =====================================================================================
do $test$
declare
  v_sa uuid := gen_random_uuid(); v_ga uuid := gen_random_uuid(); v_oa uuid := gen_random_uuid();
  v_ja uuid := gen_random_uuid(); v_pa uuid := gen_random_uuid(); v_gb uuid := gen_random_uuid();
  v_jx uuid := gen_random_uuid(); v_menor uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_role uuid; v_sess uuid;
  j jsonb; n int; r jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'private' and table_name = 'env')
     or not exists (select 1 from private.env where key = 'ambiente' and value = 'dev') then
    raise exception 'Este teste só roda no projeto de TESTES. Rode antes 00_marcar_ambiente_dev.sql lá.';
  end if;
  create table if not exists private.test_results (n numeric primary key, teste text, ok boolean, detalhe text, rodado_em timestamptz default now());
  truncate private.test_results;

  -- ------------------------------------------------------------ limpeza e preparação
  delete from public.orgs where slug like 'teste-%';
  delete from auth.users where email like '%@teste.tfl';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', k || '@teste.tfl', '', '{}', '{}', now(), now()
    from (values (v_sa, 'sa'), (v_ga, 'ga'), (v_oa, 'oa'), (v_ja, 'ja'), (v_pa, 'pa'), (v_gb, 'gb'), (v_jx, 'jx'), (v_menor, 'menor')) as x(id, k);
  insert into public.platform_admins (user_id) values (v_sa);
  insert into public.profiles (id, display_name, birth_date)
  select id, 'Teste ' || k, date '1990-01-01'
    from (values (v_sa, 'SA'), (v_ga, 'GA'), (v_oa, 'OA'), (v_ja, 'JA'), (v_pa, 'PA'), (v_gb, 'GB'), (v_jx, 'JX')) as x(id, k);
  insert into public.orgs (slug, name, kind) values ('teste-a', 'Empresa Teste A', 'venue_company') returning id into v_a;
  insert into public.orgs (slug, name, kind) values ('teste-b', 'Empresa Teste B', 'organizer') returning id into v_b;
  insert into public.org_members (org_id, user_id, display_name, role, status) values
    (v_a, v_ga, 'Teste GA', 'owner', 'approved'), (v_a, v_oa, 'Teste OA', 'organizer', 'approved'),
    (v_a, v_ja, 'Teste JA', 'player', 'approved'), (v_a, v_pa, 'Teste PA', 'player', 'pending'),
    (v_a, v_jx, 'Teste JX', 'player', 'approved'), (v_b, v_gb, 'Teste GB', 'owner', 'approved'),
    (v_b, v_jx, 'Teste JX', 'player', 'approved');

  -- ------------------------------------------------------------ 1. jogador
  perform set_config('request.jwt.claims', json_build_object('sub', v_ja, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.tfl_pa_overview(); r := r || jsonb_build_array(jsonb_build_array(1, 'Jogador chamando a API do super admin é recusado', false, 'devolveu dados'));
  exception when others then r := r || jsonb_build_array(jsonb_build_array(1, 'Jogador chamando a API do super admin é recusado', true, sqlerrm)); end;
  j := public.tfl_admin_set_status('teste-a', v_pa, 'approved');
  r := r || jsonb_build_array(jsonb_build_array(1.1, 'Jogador não consegue aprovar membro', j ? 'error', j::text));
  j := public.tfl_org_members('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(1.2, 'Jogador vê só aprovados (sem o pendente)',
    not (j->>'can_manage')::boolean and not exists (select 1 from jsonb_array_elements(j->'members') m where m->>'status' <> 'approved'),
    jsonb_array_length(j->'members')::text || ' membros visíveis'));
  r := r || jsonb_build_array(jsonb_build_array(1.25, 'Jogador não fica sabendo quem é menor de idade',
    not exists (select 1 from jsonb_array_elements(j->'members') m where m->'is_minor' <> 'null'::jsonb), null));
  begin update public.org_members set role = 'owner' where user_id = v_ja;
        r := r || jsonb_build_array(jsonb_build_array(1.3, 'Jogador não altera o próprio papel direto na tabela', false, 'update passou'));
  exception when others then r := r || jsonb_build_array(jsonb_build_array(1.3, 'Jogador não altera o próprio papel direto na tabela', true, sqlerrm)); end;
  begin insert into public.platform_admins (user_id) values (v_ja);
        r := r || jsonb_build_array(jsonb_build_array(1.4, 'Jogador não vira super admin', false, 'insert passou'));
  exception when others then r := r || jsonb_build_array(jsonb_build_array(1.4, 'Jogador não vira super admin', true, sqlerrm)); end;
  reset role;

  -- ------------------------------------------------------------ 2. organizador
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_org_set_role('teste-a', v_ja, 'admin');
  r := r || jsonb_build_array(jsonb_build_array(2, 'Organizador não muda papéis', j ? 'error', j::text));
  j := public.tfl_admin_set_status('teste-a', v_pa, 'approved');
  r := r || jsonb_build_array(jsonb_build_array(2.1, 'Organizador não aprova membros (sem org.members)', j ? 'error', j::text));
  reset role;

  -- ------------------------------------------------------------ 3. isolamento entre empresas
  perform set_config('request.jwt.claims', json_build_object('sub', v_gb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_org_members('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(3, 'Gestor da B não lista membros da A', j ? 'error', j::text));
  j := public.tfl_org_overview('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(3.1, 'Gestor da B não abre o painel da A', j ? 'error', j::text));
  select count(*) into n from public.org_members where org_id = v_a;
  r := r || jsonb_build_array(jsonb_build_array(3.2, 'Gestor da B lendo a tabela direto não vê nenhum vínculo da A', n = 0, n::text || ' linhas'));
  select count(*) into n from public.profiles where id = v_ja;
  r := r || jsonb_build_array(jsonb_build_array(3.3, 'Gestor da B não vê o perfil de quem só está na A', n = 0, n::text || ' linhas'));
  select count(*) into n from public.profiles where id = v_jx;
  r := r || jsonb_build_array(jsonb_build_array(3.4, 'Gestor da B vê o perfil do jogador que está nas duas', n = 1, n::text || ' linhas'));
  begin perform birth_date from public.profiles where id = v_jx;
        r := r || jsonb_build_array(jsonb_build_array(3.5, 'Data de nascimento não é legível por outros', false, 'leu a coluna'));
  exception when others then r := r || jsonb_build_array(jsonb_build_array(3.5, 'Data de nascimento não é legível por outros', true, sqlerrm)); end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_jx, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_profile_get();
  r := r || jsonb_build_array(jsonb_build_array(3.6, 'Jogador nas duas empresas vê as duas no próprio perfil', jsonb_array_length(j->'orgs') = 2, jsonb_array_length(j->'orgs')::text || ' ligas'));
  reset role;

  -- ------------------------------------------------------------ 4. gestor: aprovar, papel personalizado, concessão
  perform set_config('request.jwt.claims', json_build_object('sub', v_ga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_admin_set_status('teste-a', v_pa, 'approved');
  r := r || jsonb_build_array(jsonb_build_array(4, 'Gestor aprova membro pendente', coalesce((j->>'ok')::boolean, false), j::text));
  j := public.tfl_role_save('teste-a', null, 'Recepção', array['org.roles']);
  r := r || jsonb_build_array(jsonb_build_array(4.1, 'Papel personalizado não pode dar acessos (org.roles)', j ? 'error', j::text));
  j := public.tfl_role_save('teste-a', null, 'Recepção', array['match.manage', 'draw.run']);
  v_role := (j->>'id')::uuid;
  r := r || jsonb_build_array(jsonb_build_array(4.2, 'Gestor cria papel personalizado', v_role is not null, j::text));
  j := public.tfl_grant_add('teste-a', v_ja, v_role, 'org', null);
  r := r || jsonb_build_array(jsonb_build_array(4.3, 'Gestor concede o papel a um jogador', coalesce((j->>'ok')::boolean, false), j::text));
  j := public.tfl_grant_add('teste-a', v_gb, v_role, 'org', null);
  r := r || jsonb_build_array(jsonb_build_array(4.4, 'Não dá para conceder papel a quem não é da empresa', j ? 'error', j::text));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ja, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || jsonb_build_array(jsonb_build_array(4.5, 'Com a concessão, o jogador pode gerir partidas na A', private.can(v_a, 'match.manage'), null));
  r := r || jsonb_build_array(jsonb_build_array(4.6, 'Mas continua sem aprovar membros na A', not private.can(v_a, 'org.members'), null));
  r := r || jsonb_build_array(jsonb_build_array(4.7, 'E não ganha nada na B', not private.can(v_b, 'match.manage'), null));
  reset role;

  -- ------------------------------------------------------------ 5. menores de idade
  perform set_config('request.jwt.claims', json_build_object('sub', v_menor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_profile_save('Menor Teste', null, (current_date - interval '14 years')::date, null, null, false, true);
  r := r || jsonb_build_array(jsonb_build_array(5, 'Menor sem responsável é recusado', j ? 'error', j::text));
  j := public.tfl_profile_save('Menor Teste', null, (current_date - interval '14 years')::date, 'Mãe Teste', 'mae@teste.tfl', true, true);
  r := r || jsonb_build_array(jsonb_build_array(5.1, 'Menor com responsável e autorização é aceito', not (j ? 'error') and coalesce((j->>'is_minor')::boolean, false), coalesce(j->>'error', j->>'guardian_consent_at')));
  r := r || jsonb_build_array(jsonb_build_array(5.2, 'Menor fica fora do telão mesmo pedindo para aparecer', not coalesce((j->>'show_on_screen')::boolean, true), j->>'show_on_screen'));
  reset role;

  -- ------------------------------------------------------------ 6. sessão de suporte
  perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_org_members('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(6, 'Super admin sem sessão não vê a lista de membros da A', j ? 'error', j::text));
  j := public.tfl_pa_orgs();
  r := r || jsonb_build_array(jsonb_build_array(6.1, 'Super admin vê a A na lista agregada de empresas', exists (select 1 from jsonb_array_elements(j) o where o->>'slug' = 'teste-a'), null));
  j := public.tfl_support_start(v_a, 'curto', 30);
  r := r || jsonb_build_array(jsonb_build_array(6.2, 'Sessão sem motivo descrito é recusada', j ? 'error', j::text));
  j := public.tfl_support_start(v_a, 'Teste automático de suporte', 30);
  v_sess := (j->>'id')::uuid;
  r := r || jsonb_build_array(jsonb_build_array(6.3, 'Super admin abre sessão de suporte com motivo', v_sess is not null, j::text));
  j := public.tfl_org_members('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(6.4, 'Com a sessão, ele gerencia membros da A', coalesce((j->>'can_manage')::boolean, false), coalesce(j->>'error', 'ok')));
  j := public.tfl_admin_set_status('teste-a', v_ja, 'pending');
  reset role;
  r := r || jsonb_build_array(jsonb_build_array(6.5, 'Ação feita no suporte é gravada com a sessão',
    exists (select 1 from private.audit where org_id = v_a and action = 'member.status' and support_session_id = v_sess), j::text));
  perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.tfl_admin_set_status('teste-a', v_ja, 'approved');
  j := public.tfl_org_members('teste-b');
  r := r || jsonb_build_array(jsonb_build_array(6.6, 'A sessão da A não abre a B', j ? 'error', j::text));
  perform public.tfl_support_end(v_sess);
  j := public.tfl_org_members('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(6.7, 'Encerrada a sessão, o acesso some', j ? 'error', j::text));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_org_audit('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(6.8, 'Gestor da A vê o histórico da sessão de suporte', jsonb_array_length(j->'support_sessions') >= 1, j->'support_sessions'->0->>'reason'));
  reset role;

  -- ------------------------------------------------------------ 7. empresa suspensa
  perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_pa_org_set_status(v_a, 'suspended', 'x');
  r := r || jsonb_build_array(jsonb_build_array(7, 'Suspender exige motivo', j ? 'error', j::text));
  j := public.tfl_pa_org_set_status(v_a, 'suspended', 'Teste de suspensão');
  r := r || jsonb_build_array(jsonb_build_array(7.1, 'Super admin suspende a empresa', coalesce((j->>'ok')::boolean, false), j::text));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_admin_set_status('teste-a', v_pa, 'blocked');
  r := r || jsonb_build_array(jsonb_build_array(7.2, 'Empresa suspensa: gestor não altera nada', j ? 'error', j::text));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_menor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_join('teste-a', 'Alguém Novo');
  r := r || jsonb_build_array(jsonb_build_array(7.3, 'Empresa suspensa não aceita novos membros', j ? 'error', j::text));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ja, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.tfl_org_members('teste-a');
  r := r || jsonb_build_array(jsonb_build_array(7.4, 'Empresa suspensa: membros ainda consultam o histórico', not (j ? 'error'), coalesce(j->>'error', 'ok')));
  reset role;

  -- ------------------------------------------------------------ resultado e limpeza
  perform set_config('request.jwt.claims', '', true);
  insert into private.test_results (n, teste, ok, detalhe)
  select (x->>0)::numeric, x->>1, (x->>2)::boolean, x->>3 from jsonb_array_elements(r) x;
  delete from public.orgs where slug like 'teste-%';
  delete from auth.users where email like '%@teste.tfl';
end $test$;
