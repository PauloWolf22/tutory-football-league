-- Ajuste da Fase 2 (teste de tela de 11/11/2026): o detalhe do grupo devolve também o nome do campo padrão,
-- para a tela não dizer "local a definir" quando o grupo joga num campo da empresa.
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
  return jsonb_build_object('id', g.id, 'org_slug', (select slug from public.orgs where id = g.org_id), 'name', g.name, 'default_venue', (select name from public.venues where id = g.default_venue_id),
    'default_venue_id', g.default_venue_id, 'default_location', g.default_location, 'default_capacity', g.default_capacity,
    'can_manage', v_manage, 'can_match', private.can(g.org_id, 'match.manage', 'group', g.id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'status', x.status,
                 'name', coalesce(p.nick, p.display_name), 'photo_path', p.photo_path, 'joined_at', x.joined_at)
                 order by case x.status when 'active' then 0 when 'invited' then 1 else 2 end, coalesce(p.nick, p.display_name))
        from public.group_members x left join public.profiles p on p.id = x.user_id
       where x.group_id = g.id and (v_manage or x.status = 'active')), '[]'::jsonb));
end $$;
