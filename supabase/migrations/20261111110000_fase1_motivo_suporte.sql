-- Ajuste da Fase 1 (teste 6.2 de 11/11/2026): o motivo de uma sessão de suporte precisa
-- ter pelo menos 10 letras. Com 5, "curto" passava e não descrevia nada.
alter table public.support_sessions drop constraint if exists support_sessions_reason_check;
alter table public.support_sessions add constraint support_sessions_reason_check check (length(reason) between 10 and 300) not valid;

create or replace function public.tfl_support_start(p_org_id uuid, p_reason text, p_minutes int default 60) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_platform_admin(); v_id uuid; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) not between 10 and 300 then return jsonb_build_object('error', 'Descreva o motivo do suporte (10 a 300 letras).'); end if;
  if p_minutes is null or p_minutes not between 5 and 120 then return jsonb_build_object('error', 'Duração entre 5 e 120 minutos.'); end if;
  if not exists (select 1 from public.orgs where id = p_org_id) then return jsonb_build_object('error', 'Empresa não encontrada.'); end if;
  update public.support_sessions set ended_at = now() where admin_id = v_uid and org_id = p_org_id and ended_at is null;
  insert into public.support_sessions (admin_id, org_id, reason, expires_at)
  values (v_uid, p_org_id, v_reason, now() + make_interval(mins => p_minutes)) returning id into v_id;
  insert into private.audit (org_id, actor, action, target, detail, support_session_id)
  values (p_org_id, v_uid, 'support.start', null, jsonb_build_object('reason', v_reason, 'minutes', p_minutes), v_id);
  return jsonb_build_object('ok', true, 'id', v_id, 'slug', (select slug from public.orgs where id = p_org_id));
end $$;
