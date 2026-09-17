-- WP-ACCESS-PARTNER-01A
-- public.create_patient: clinic admin/owner only.
-- Forward rewrite of AUTH-EMAIL-01 body. Signature, DEFINER, search_path,
-- operational check, AUTH-EMAIL linking, initial link, start_date, grants
-- unchanged. Member/staff no longer sufficient. No can_create_patients.
-- No billing enforcement. No clinic_role / is_external / discipline change.

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
  if not private.clinic_is_operational(p_clinic_id) then
    raise exception 'forbidden: caller is not staff of clinic'
      using errcode = '42501', hint = 'CLINIC_NOT_OPERATIONAL';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'forbidden: PATIENT_CREATE_ADMIN_REQUIRED'
      using errcode = '42501', hint = 'PATIENT_CREATE_ADMIN_REQUIRED';
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
  'ACCESS-PARTNER-01A: creation requires private.is_clinic_admin (owner or clinic_role=admin). '
  'AUTH-EMAIL-01 VINCULO-1/2 identity logic unchanged. Member/staff cannot create.';


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260917214500',
  '20260917214500_wp_access_partner_01a_patient_create_admin_only.sql',
  'ACCESS-PARTNER-01A: create_patient requires is_clinic_admin; AUTH-EMAIL identity preserved.',
  'ACCESS-PARTNER-01A'
);
