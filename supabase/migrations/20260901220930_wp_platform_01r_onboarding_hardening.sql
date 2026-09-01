-- =====================================================================================
-- PLATFORM-01R — hardening de onboarding (delta).
--
-- Motivo:
--   H1. Em manual_review, aprovação não pode virar clínica com outro nome.
--   H2. Não permitir segundo request enquanto houver onboarding ativo
--       (pending OU approved com grant válido e não consumido).
--
-- Comportamento:
--   - Comparação de nome: btrim + lower (casing/whitespace não-semântico).
--   - Grant expirado / consumido / clínica já criada ⇒ reentrada permitida.
--   - Locks 90202 e 90203 (nessa ordem) serializam request e create.
--
-- Impacto:
--   - Substitui request_clinic_creation e create_clinic_with_owner.
--   - Helper privado active_approved_clinic_name.
--   - NÃO altera 20260901090000.
--
-- Invariantes:
--   - Platform Admin continua único a mudar policy / aprovar.
--   - AUTOMATIC não trava nome.
--   - CLOSED continua bloqueando create/request.
--
-- Rollback manual (não aplicar automaticamente):
--   drop function private.active_approved_clinic_name(uuid);
--   restaurar request_clinic_creation + create_clinic_with_owner
--     de 20260901090000.
-- =====================================================================================

create or replace function private.active_approved_clinic_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.requested_clinic_name
    from private.clinic_creation_requests r
    join private.clinic_creation_authorizations a
      on a.id = r.authorization_id
   where r.requester_profile_id = p_profile_id
     and r.status = 'approved'
     and r.created_clinic_id is null
     and a.consumed_at is null
     and a.expires_at > now()
   order by r.requested_at desc, r.id
   limit 1
$$;

comment on function private.active_approved_clinic_name(uuid) is
  'PLATFORM-01R: nome da request approved com grant válido e não consumido. '
  'NULL se não há onboarding ativo desse tipo.';

revoke all on function private.active_approved_clinic_name(uuid)
  from public, anon, authenticated, service_role;


create or replace function public.request_clinic_creation(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_mode text;
  v_status text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'request_clinic_creation: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90202, pg_catalog.hashtext(v_me::text));
  perform pg_catalog.pg_advisory_xact_lock(90203, pg_catalog.hashtext(v_me::text));

  v_mode := private.clinic_onboarding_mode();

  if v_mode = 'closed' then
    raise exception 'request_clinic_creation: onboarding closed'
      using errcode = '42501', hint = 'ONBOARDING_CLOSED';
  end if;

  if v_mode = 'automatic' then
    raise exception 'request_clinic_creation: request not needed'
      using errcode = '42501', hint = 'REQUEST_NOT_NEEDED';
  end if;

  if exists (select 1 from public.clinics c where c.owner_profile_id = v_me) then
    raise exception 'request_clinic_creation: profile already owns a clinic'
      using errcode = '42501', hint = 'ALREADY_OWNS_CLINIC';
  end if;

  if private.active_approved_clinic_name(v_me) is not null then
    raise exception 'request_clinic_creation: approved request still active'
      using errcode = '42501', hint = 'REQUEST_ALREADY_APPROVED';
  end if;

  if v_name = '' then
    raise exception 'request_clinic_creation: clinic name is required'
      using errcode = '22023', hint = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'request_clinic_creation: clinic name too short (min 2)'
      using errcode = '22023', hint = 'NAME_TOO_SHORT';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'request_clinic_creation: clinic name too long (max 120)'
      using errcode = '22023', hint = 'NAME_TOO_LONG';
  end if;

  select pr.status into v_status from public.profiles pr where pr.id = v_me;
  if v_status is distinct from 'active' and v_status is distinct from 'pending' then
    raise exception 'request_clinic_creation: target status incompatible'
      using errcode = '42501', hint = 'TARGET_STATUS_INCOMPATIBLE';
  end if;

  begin
    insert into private.clinic_creation_requests (
      requester_profile_id,
      requested_clinic_name,
      status
    ) values (
      v_me,
      v_name,
      'pending'
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'request_clinic_creation: already pending'
        using errcode = '42501', hint = 'REQUEST_ALREADY_PENDING';
  end;

  return jsonb_build_object(
    'request_id', v_id,
    'status', 'pending',
    'requested_clinic_name', v_name
  );
end;
$$;

comment on function public.request_clinic_creation(text) is
  'PLATFORM-01R: solicita criação em manual_review. '
  'Bloqueia se já existe pending ou approved com grant válido.';

revoke all on function public.request_clinic_creation(text) from public, anon;
grant execute on function public.request_clinic_creation(text) to authenticated;


create or replace function public.create_clinic_with_owner(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_profile_id();
  v_name   text := btrim(coalesce(p_name, ''));
  v_clinic uuid;
  v_prof   uuid;
  v_auth   uuid;
  v_status text;
  v_mode   text;
  v_locked text;
begin
  if v_me is null then
    raise exception 'create_clinic_with_owner: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90202, pg_catalog.hashtext(v_me::text));
  perform pg_catalog.pg_advisory_xact_lock(90203, pg_catalog.hashtext(v_me::text));

  if exists (select 1 from public.clinics c where c.owner_profile_id = v_me) then
    raise exception 'create_clinic_with_owner: profile already owns a clinic'
      using errcode = '42501', hint = 'ALREADY_OWNS_CLINIC';
  end if;

  if v_name = '' then
    raise exception 'create_clinic_with_owner: clinic name is required'
      using errcode = '22023', hint = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'create_clinic_with_owner: clinic name too short (min 2)'
      using errcode = '22023', hint = 'NAME_TOO_SHORT';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'create_clinic_with_owner: clinic name too long (max 120)'
      using errcode = '22023', hint = 'NAME_TOO_LONG';
  end if;

  select pr.status
    into v_status
    from public.profiles pr
   where pr.id = v_me;

  if v_status is distinct from 'active' and v_status is distinct from 'pending' then
    raise exception 'create_clinic_with_owner: target status incompatible'
      using errcode = '42501', hint = 'TARGET_STATUS_INCOMPATIBLE';
  end if;

  v_mode := private.clinic_onboarding_mode();

  if v_mode = 'closed' then
    raise exception 'create_clinic_with_owner: onboarding closed'
      using errcode = '42501', hint = 'ONBOARDING_CLOSED';
  end if;

  if v_mode = 'manual_review' then
    v_locked := private.active_approved_clinic_name(v_me);
    if v_locked is not null
       and lower(v_locked) is distinct from lower(v_name) then
      raise exception 'create_clinic_with_owner: approved clinic name mismatch'
        using errcode = '42501', hint = 'APPROVED_CLINIC_NAME_MISMATCH';
    end if;
  end if;

  if v_mode = 'automatic' then
    perform private.issue_clinic_creation_grant(v_me, 'platform_policy', null);
  end if;

  update private.clinic_creation_authorizations a
     set consumed_at = clock_timestamp()
   where a.id = (
     select x.id
       from private.clinic_creation_authorizations x
      where x.target_profile_id = v_me
        and x.consumed_at is null
        and x.expires_at > clock_timestamp()
      order by x.granted_at asc, x.id
      limit 1
      for update
   )
  returning a.id into v_auth;

  if v_auth is null then
    raise exception 'create_clinic_with_owner: onboarding not permitted'
      using errcode = '42501', hint = 'ONBOARDING_NOT_ALLOWED';
  end if;

  insert into public.clinics (name, owner_profile_id)
  values (v_name, v_me)
  returning id into v_clinic;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values (v_me, v_clinic, 'other', 'admin')
  returning id into v_prof;

  update public.profiles
     set role = 'professional', status = 'active'
   where id = v_me;

  update private.clinic_creation_authorizations
     set consumed_clinic_id = v_clinic
   where id = v_auth;

  update private.clinic_creation_requests r
     set created_clinic_id = v_clinic,
         status = case when r.status = 'pending' then 'approved' else r.status end,
         decided_at = coalesce(r.decided_at, clock_timestamp()),
         authorization_id = coalesce(r.authorization_id, v_auth)
   where r.requester_profile_id = v_me
     and r.created_clinic_id is null
     and r.status in ('pending', 'approved')
     and r.id = (
       select x.id
         from private.clinic_creation_requests x
        where x.requester_profile_id = v_me
          and x.created_clinic_id is null
          and x.status in ('pending', 'approved')
        order by case when x.status = 'approved' then 0 else 1 end, x.requested_at desc
        limit 1
     );

  return jsonb_build_object('clinic_id', v_clinic, 'professional_id', v_prof);
end
$$;

comment on function public.create_clinic_with_owner(text) is
  'SEC-02 + PLATFORM-01R: cria a PRÓPRIA clínica. '
  'manual_review com grant aprovado exige o nome aprovado (trim/lower). '
  'Mismatch não consome o grant.';

revoke all on function public.create_clinic_with_owner(text) from public, anon;
grant execute on function public.create_clinic_with_owner(text) to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260901220930',
  '20260901220930_wp_platform_01r_onboarding_hardening.sql',
  'PLATFORM-01R: trava nome aprovado em manual_review e impede segundo '
  'request enquanto houver grant aprovado válido.',
  'PLATFORM-01R'
)
on conflict (version) do nothing;
