-- =====================================================================================
-- AUTH-EMAIL-01 — identidade provider-agnostic (local foundation).
--
-- Confirmed identity is required. This WP depends on GoTrue
-- mailer_autoconfirm = false. Do NOT add a fallback that links
-- unconfirmed email/password identities.
--
-- Trusted providers (GoTrue raw_app_meta_data only): google | email | apple.
-- Apple is allowlisted for future identity compatibility. No Apple OAuth here.
-- Provider is never product authority.
--
-- Replaces ONLY the Google-only gate in:
--   public.handle_new_user()
--   private.ensure_auth_profile(uuid)
--   public.create_patient(...) VINCULO-1
--
-- Preserves: orphan email match (exactly 1, lower(btrim)), pending-patient
-- bootstrap, no professional/clinic/patient/PA from signup, unique auth_user_id,
-- VINCULO-2, ensure_my_profile() zero-arg contract.
--
-- Profile self-update: reaffirms WP-05B column grants. Client may UPDATE
-- (full_name, avatar_url) only. role/auth_user_id/status/email/avatar_path
-- stay ungated to authenticated. Avatar writes remain set_my_avatar /
-- remove_my_avatar (SECURITY DEFINER).
--
-- helper is SECURITY INVOKER: pure predicate on arguments, no table read.
--
-- LOCAL ONLY in this WP. Do not apply remotely from AUTH-EMAIL-01.
-- =====================================================================================

create or replace function private.auth_identity_is_trusted(
  p_app jsonb,
  p_confirmed timestamptz
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_confirmed is not null
    and (
      coalesce(p_app ->> 'provider' in ('google', 'email', 'apple'), false)
      or coalesce(p_app -> 'providers', '[]'::jsonb) ? 'google'
      or coalesce(p_app -> 'providers', '[]'::jsonb) ? 'email'
      or coalesce(p_app -> 'providers', '[]'::jsonb) ? 'apple'
    );
$$;

comment on function private.auth_identity_is_trusted(jsonb, timestamptz) is
  'AUTH-EMAIL-01: confirmed GoTrue app_metadata with google|email|apple. '
  'INVOKER predicate. Never reads user_metadata. EXECUTE revoked from client roles.';

revoke all on function private.auth_identity_is_trusted(jsonb, timestamptz)
  from public, anon, authenticated;


create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_count int;
  v_profile_id  uuid;
  v_surface     text;
  v_outcome     text;
begin
  if exists (select 1 from public.profiles where auth_user_id = new.id) then
    return new;
  end if;

  v_surface := case
    when new.raw_user_meta_data ->> 'signup_surface' = 'patient_app' then 'patient_app'
    when new.raw_user_meta_data ->> 'signup_surface' = 'web'         then 'web'
    else 'other'
  end;

  -- Confirmed + trusted provider. Unconfirmed email never links.
  -- Outcome name kept for existing consumers / history.
  if not private.auth_identity_is_trusted(new.raw_app_meta_data, new.email_confirmed_at) then
    perform public.log_auth_trigger_event(new.id, v_surface, 'skipped_unverified_provider', null);
    return new;
  end if;

  select count(*)
    into v_match_count
  from public.profiles
  where auth_user_id is null
    and email is not null
    and new.email is not null
    and lower(btrim(email)) = lower(btrim(new.email));

  if v_match_count = 1 then
    select id
      into v_profile_id
    from public.profiles
    where auth_user_id is null
      and email is not null
      and new.email is not null
      and lower(btrim(email)) = lower(btrim(new.email))
    limit 1;
    update public.profiles set auth_user_id = new.id where id = v_profile_id;
    v_outcome := 'linked';
  else
    begin
      insert into public.profiles (auth_user_id, role, full_name, email, status)
      values (
        new.id,
        'patient',
        coalesce(
          nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
          new.email,
          'Novo usuário'
        ),
        new.email,
        'pending'
      );
      v_outcome := 'pending_patient';
    exception
      when unique_violation then
        return new;
    end;
  end if;

  perform public.log_auth_trigger_event(new.id, v_surface, v_outcome, null);
  return new;

exception
  when others then
    raise warning '[handle_new_user] falha assoc user=% sqlstate=%', new.id, sqlstate;
    perform public.log_auth_trigger_event(new.id, coalesce(v_surface, 'other'), 'error', sqlstate);
    return new;
end;
$$;

comment on function public.handle_new_user() is
  'AUTH-EMAIL-01: provider-agnostic confirmed identity. search_path empty. '
  'No-match still pending patient only. Never professional/clinic/patient/PA.';

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;


create or replace function private.ensure_auth_profile(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_app jsonb;
  v_user_meta jsonb;
  v_deleted timestamptz;
  v_banned timestamptz;
  v_match_count int;
  v_profile_id uuid;
begin
  if p_uid is null then
    return;
  end if;

  if exists (select 1 from public.profiles p where p.auth_user_id = p_uid) then
    return;
  end if;

  select u.email, u.email_confirmed_at, u.raw_app_meta_data, u.raw_user_meta_data,
         u.deleted_at, u.banned_until
    into v_email, v_confirmed, v_app, v_user_meta, v_deleted, v_banned
  from auth.users u
  where u.id = p_uid;

  if not found then
    return;
  end if;

  if v_deleted is not null then
    return;
  end if;

  if v_banned is not null and v_banned > clock_timestamp() then
    return;
  end if;

  if not private.auth_identity_is_trusted(v_app, v_confirmed) then
    return;
  end if;

  select count(*)
    into v_match_count
  from public.profiles
  where auth_user_id is null
    and email is not null
    and v_email is not null
    and lower(btrim(email)) = lower(btrim(v_email));

  if v_match_count = 1 then
    select id
      into v_profile_id
    from public.profiles
    where auth_user_id is null
      and email is not null
      and v_email is not null
      and lower(btrim(email)) = lower(btrim(v_email))
    limit 1;
    update public.profiles set auth_user_id = p_uid where id = v_profile_id;
    return;
  end if;

  insert into public.profiles (auth_user_id, role, full_name, email, status)
  values (
    p_uid,
    'patient',
    coalesce(
      nullif(btrim(v_user_meta ->> 'full_name'), ''),
      nullif(btrim(v_user_meta ->> 'name'), ''),
      v_email,
      'Novo usuário'
    ),
    v_email,
    'pending'
  );
exception
  when unique_violation then
    return;
end;
$$;

comment on function private.ensure_auth_profile(uuid) is
  'AUTH-EMAIL-01: same rules as handle_new_user for confirmed trusted providers. '
  'Owner-only. Never professional. Never platform admin.';

revoke all on function private.ensure_auth_profile(uuid)
  from public, anon, authenticated, service_role;


-- ensure_my_profile: signature and grants unchanged (zero args, auth.uid() only).


create or replace function public.create_patient(
  p_clinic_id uuid, p_full_name text, p_email text default null, p_birth_date date default null,
  p_sex text default null, p_height_cm numeric default null, p_goal text default null,
  p_start_weight numeric default null, p_target_weight numeric default null,
  p_anamnese_method text default null, p_anamnese_weight numeric default null,
  p_anamnese_body_fat_pct numeric default null, p_anamnese_notes text default null,
  p_start_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller_profile uuid := private.current_profile_id();
  v_caller_prof uuid;
  v_profile_id uuid;
  v_patient_id uuid;
  v_email text;
  v_match_count int;
  v_auth_user_id uuid;
  v_claim_count int;
  v_claim_profile uuid;
begin
  if v_caller_profile is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if btrim(coalesce(p_full_name,'')) = '' then raise exception 'full_name required' using errcode = '22023'; end if;
  if p_clinic_id is null then raise exception 'clinic_id required' using errcode = '22023'; end if;
  if p_start_date is not null and p_start_date > current_date then
    raise exception 'create_patient: p_start_date cannot be in the future' using errcode = '22023';
  end if;
  if not private.clinic_is_operational(p_clinic_id)
     or not private.is_clinic_staff(p_clinic_id) then
    raise exception 'forbidden: caller is not staff of clinic'
      using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;
  select pr.id into v_caller_prof
    from public.professionals pr
   where pr.clinic_id = p_clinic_id
     and pr.profile_id = v_caller_profile
     and coalesce(pr.status, 'active') = 'active'
   limit 1;

  v_email := nullif(btrim(coalesce(p_email,'')),'');

  if v_email is not null then
    select count(*)
      into v_claim_count
    from public.profiles p
    where p.email is not null
      and lower(btrim(p.email)) = lower(btrim(v_email))
      and p.auth_user_id is not null
      and p.role = 'patient'
      and p.status = 'pending'
      and not exists (select 1 from public.patients pt where pt.profile_id = p.id)
      and not exists (select 1 from public.professionals pr where pr.profile_id = p.id);

    if v_claim_count = 1 then
      select p.id
        into v_claim_profile
      from public.profiles p
      where p.email is not null
        and lower(btrim(p.email)) = lower(btrim(v_email))
        and p.auth_user_id is not null
        and p.role = 'patient'
        and p.status = 'pending'
        and not exists (select 1 from public.patients pt where pt.profile_id = p.id)
        and not exists (select 1 from public.professionals pr where pr.profile_id = p.id)
      limit 1
      for update;
    end if;
  end if;

  if v_claim_profile is not null then
    update public.profiles
       set full_name = btrim(p_full_name),
           status    = 'active'
     where id = v_claim_profile
    returning id into v_profile_id;
  else
    if v_email is not null then
      select count(*)
        into v_match_count
      from auth.users u
      where u.email is not null
        and lower(btrim(u.email)) = lower(btrim(v_email))
        and u.email_confirmed_at is not null
        and private.auth_identity_is_trusted(u.raw_app_meta_data, u.email_confirmed_at)
        and not exists (select 1 from public.profiles p where p.auth_user_id = u.id);

      if v_match_count = 1 then
        select u.id
          into v_auth_user_id
        from auth.users u
        where u.email is not null
          and lower(btrim(u.email)) = lower(btrim(v_email))
          and u.email_confirmed_at is not null
          and private.auth_identity_is_trusted(u.raw_app_meta_data, u.email_confirmed_at)
          and not exists (select 1 from public.profiles p where p.auth_user_id = u.id)
        limit 1;
      end if;
    end if;

    begin
      insert into public.profiles (auth_user_id, role, full_name, email, status)
      values (v_auth_user_id, 'patient', btrim(p_full_name), v_email, 'active')
      returning id into v_profile_id;
    exception when unique_violation then
      if v_auth_user_id is null then raise; end if;
      v_auth_user_id := null;
      insert into public.profiles (auth_user_id, role, full_name, email, status)
      values (null, 'patient', btrim(p_full_name), v_email, 'active')
      returning id into v_profile_id;
    end;
  end if;

  insert into public.patients (profile_id, clinic_id, goal, birth_date, sex, height_cm, start_weight, current_weight, target_weight, start_date)
  values (v_profile_id, p_clinic_id, nullif(btrim(coalesce(p_goal,'')),''), p_birth_date, p_sex, p_height_cm, p_start_weight, p_start_weight, p_target_weight, coalesce(p_start_date, current_date)) returning id into v_patient_id;
  if v_caller_prof is not null then insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values (v_caller_prof, v_patient_id, false, 'active'); end if;
  if p_anamnese_weight is not null or p_anamnese_body_fat_pct is not null or nullif(btrim(coalesce(p_anamnese_method,'')),'') is not null or nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then
    insert into public.body_assessments (patient_id, professional_id, method, weight, body_fat_pct, measurements)
    values (v_patient_id, v_caller_prof, nullif(btrim(coalesce(p_anamnese_method,'')),''), p_anamnese_weight, p_anamnese_body_fat_pct,
            case when nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then jsonb_build_object('notes', btrim(p_anamnese_notes)) else null end);
  end if;
  return v_patient_id;
end $function$;

comment on function public.create_patient(uuid, text, text, date, text, numeric, text, numeric, numeric, text, numeric, numeric, text, date) is
  'AUTH-EMAIL-01: VINCULO-1 accepts confirmed trusted providers (google|email|apple). '
  'VINCULO-2 and staff/clinic checks unchanged.';


-- Reaffirm WP-05B / AVATAR-01: client cannot write identity columns or avatar_path.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url) on public.profiles to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260912120000',
  '20260912120000_wp_auth_email_01_provider_agnostic_identity.sql',
  'AUTH-EMAIL-01: trusted confirmed google|email|apple identity helper; '
  'handle_new_user/ensure_auth_profile/create_patient VINCULO-1 provider-agnostic; '
  'reaffirm profiles column grants.',
  'AUTH-EMAIL-01'
)
on conflict (version) do nothing;
