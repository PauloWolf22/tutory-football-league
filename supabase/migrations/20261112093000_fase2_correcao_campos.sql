-- Correção da Fase 2 (teste de 11/11/2026): em tfl_venue_save a variável do laço "h" tinha o
-- mesmo nome do apelido da tabela no insert dos horários ("column reference h is ambiguous").
create or replace function public.tfl_venue_save(p_org text, p_id uuid, p_name text, p_surface text, p_capacity int,
  p_price_per_hour_cents int, p_status text, p_hours jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.org_id(p_org); v_id uuid; v_item jsonb; v_name text := btrim(coalesce(p_name, ''));
begin
  if not private.can(v_org, 'venue.manage') then return jsonb_build_object('error', 'Você não pode gerenciar campos.'); end if;
  if length(v_name) not between 2 and 60 then return jsonb_build_object('error', 'Nome do campo: 2 a 60 letras.'); end if;
  if p_capacity is null or p_capacity not between 2 and 40 then return jsonb_build_object('error', 'Capacidade entre 2 e 40 jogadores.'); end if;
  if p_price_per_hour_cents is null or p_price_per_hour_cents < 0 then return jsonb_build_object('error', 'Informe o preço da hora.'); end if;
  if p_status not in ('active', 'inactive') then return jsonb_build_object('error', 'Situação inválida.'); end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) loop
    if (v_item->>'weekday')::int not between 0 and 6 then return jsonb_build_object('error', 'Dia da semana inválido.'); end if;
    if (v_item->>'closes') <> '00:00' and (v_item->>'closes')::time <= (v_item->>'opens')::time then
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
  select v_id, (e.value->>'weekday')::int, (e.value->>'opens')::time, (e.value->>'closes')::time
    from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) e
  on conflict do nothing;
  perform private.log(v_org, 'venue.save', null, jsonb_build_object('venue', v_id, 'name', v_name, 'price', p_price_per_hour_cents));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
