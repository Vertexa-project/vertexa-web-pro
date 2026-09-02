-- =====================================================================================
-- PLATFORM-01R — liveness do grant no estado de onboarding (delta).
--
-- Motivo:
--   H2/S15 no SQL já permite novo request após grant aprovado expirar.
--   get_clinic_onboarding_state ainda devolvia a request approved sem dizer
--   se o grant estava vivo. A UI travava o formulário de criação e o usuário
--   não conseguia reentrar no onboarding.
--
-- Comportamento:
--   - Payload ganha grant_is_active (grant SEC-02 válido, não consumido,
--     clínica ainda não criada).
--   - Prioridade: pending > approved-com-grant-vivo > rejected >
--     approved-expirado/consumido.
--
-- Impacto:
--   - Substitui somente public.get_clinic_onboarding_state.
--   - NÃO altera 20260901090000 nem 20260901220930.
--
-- Invariantes:
--   - Sem dados de terceiros; identidade continua via current_profile_id.
--   - SECURITY DEFINER + search_path='' + EXECUTE só authenticated.
--
-- Rollback manual (não aplicar automaticamente):
--   restaurar public.get_clinic_onboarding_state de 20260901090000.
-- =====================================================================================

create or replace function public.get_clinic_onboarding_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_req record;
begin
  if v_me is null then
    raise exception 'get_clinic_onboarding_state: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  select
    r.id,
    r.requested_clinic_name,
    r.status,
    r.requested_at,
    r.decided_at,
    r.rejection_reason,
    (
      r.status = 'approved'
      and r.created_clinic_id is null
      and a.id is not null
      and a.consumed_at is null
      and a.expires_at > now()
    ) as grant_is_active
    into v_req
    from private.clinic_creation_requests r
    left join private.clinic_creation_authorizations a
      on a.id = r.authorization_id
   where r.requester_profile_id = v_me
   order by
     case
       when r.status = 'pending' then 0
       when r.status = 'approved'
        and r.created_clinic_id is null
        and a.consumed_at is null
        and a.expires_at > now() then 1
       when r.status = 'rejected' then 2
       else 3
     end,
     r.requested_at desc
   limit 1;

  return jsonb_build_object(
    'mode', private.clinic_onboarding_mode(),
    'request', case
      when v_req.id is null then null
      else jsonb_build_object(
        'id', v_req.id,
        'requested_clinic_name', v_req.requested_clinic_name,
        'status', v_req.status,
        'requested_at', v_req.requested_at,
        'decided_at', v_req.decided_at,
        'rejection_reason', v_req.rejection_reason,
        'grant_is_active', coalesce(v_req.grant_is_active, false)
      )
    end
  );
end;
$$;

comment on function public.get_clinic_onboarding_state() is
  'PLATFORM-01R: modo vigente + solicitação do chamador, com liveness do grant. '
  'Sem dados de terceiros.';

revoke all on function public.get_clinic_onboarding_state() from public, anon;
grant execute on function public.get_clinic_onboarding_state() to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260901222656',
  '20260901222656_wp_platform_01r_grant_liveness.sql',
  'PLATFORM-01R: get_clinic_onboarding_state expõe grant_is_active para reentrada após expiry.',
  'PLATFORM-01R'
)
on conflict (version) do nothing;
