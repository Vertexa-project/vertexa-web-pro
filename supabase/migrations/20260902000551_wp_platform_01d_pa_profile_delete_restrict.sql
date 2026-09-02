-- =====================================================================================
-- PLATFORM-01D — proteger profile de Platform Admin + semântica de erro.
--
-- Motivo:
--   DELETE em public.profiles de um PA apagava private.platform_admins em silêncio
--   (ON DELETE CASCADE). Sessão Auth válida sem profile virava NOT_AUTHENTICATED.
--
-- Comportamento:
--   - FK platform_admins.profile_id: ON DELETE RESTRICT.
--     Qualquer row em platform_admins (active ou revoked) bloqueia DELETE do profile.
--     Revogar PA NÃO apaga o profile. Apagar profile após revoke exige remover
--     antes a row de autoridade (operação privilegiada explícita).
--   - private.require_current_profile_id():
--       auth.uid() IS NULL → NOT_AUTHENTICATED
--       auth presente + profile ausente → PROFILE_NOT_FOUND
--   - get_clinic_onboarding_state usa o helper.
--
-- Impacto:
--   - Não contém repair de identidade. Sem UUID/e-mail operacional.
--   - NÃO edita 20260818090000 nem 20260901222656.
--
-- Invariantes:
--   - PA não nasce por e-mail / metadata / login.
--   - Profiles sem row em platform_admins continuam deletáveis (se demais FKs permitirem).
--
-- Rollback manual (não aplicar automaticamente):
--   restaurar get_clinic_onboarding_state de 20260901222656;
--   drop function private.require_current_profile_id();
--   recriar FK ON DELETE CASCADE.
-- =====================================================================================

alter table private.platform_admins
  drop constraint platform_admins_profile_id_fkey;

alter table private.platform_admins
  add constraint platform_admins_profile_id_fkey
  foreign key (profile_id)
  references public.profiles(id)
  on delete restrict;

comment on constraint platform_admins_profile_id_fkey on private.platform_admins is
  'PLATFORM-01D: RESTRICT. DELETE de profile referenciado falha; não apaga autoridade em silêncio.';


create or replace function private.require_current_profile_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_me uuid;
begin
  if v_uid is null then
    raise exception 'require_current_profile_id: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  v_me := private.current_profile_id();
  if v_me is null then
    raise exception 'require_current_profile_id: profile not found'
      using errcode = '42501', hint = 'PROFILE_NOT_FOUND';
  end if;

  return v_me;
end;
$$;

comment on function private.require_current_profile_id() is
  'PLATFORM-01D: auth.uid() obrigatório; profile obrigatório. '
  'NOT_AUTHENTICATED vs PROFILE_NOT_FOUND. EXECUTE só owner.';

revoke all on function private.require_current_profile_id()
  from public, anon, authenticated, service_role;


create or replace function public.get_clinic_onboarding_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid;
  v_req record;
begin
  v_me := private.require_current_profile_id();

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
  'PLATFORM-01D: modo + request do chamador. '
  'auth ausente → NOT_AUTHENTICATED; auth sem profile → PROFILE_NOT_FOUND.';

revoke all on function public.get_clinic_onboarding_state() from public, anon;
grant execute on function public.get_clinic_onboarding_state() to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260902000551',
  '20260902000551_wp_platform_01d_pa_profile_delete_restrict.sql',
  'PLATFORM-01D: RESTRICT no DELETE de profile com platform_admins; PROFILE_NOT_FOUND.',
  'PLATFORM-01D'
)
on conflict (version) do nothing;
