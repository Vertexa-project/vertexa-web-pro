-- =====================================================================================
-- PLATFORM-01F · identidades Google antigas sem profile (BEGIN / ROLLBACK).
-- HARNESS: exige 20260902124500.
-- =====================================================================================

-- F1: contrato de privilégio
begin;
do $$
begin
  if has_function_privilege('anon', 'public.ensure_my_profile()', 'execute') then
    raise exception 'PLAT01F F1 FAIL: anon execute';
  end if;
  if not has_function_privilege('authenticated', 'public.ensure_my_profile()', 'execute') then
    raise exception 'PLAT01F F1 FAIL: authenticated sem execute';
  end if;
  if has_function_privilege('authenticated', 'private.ensure_auth_profile(uuid)', 'execute') then
    raise exception 'PLAT01F F1 FAIL: authenticated execute private';
  end if;
end $$;
rollback;


-- F2–F5: profile apagado + ensure_auth_profile recria pending patient, sem PA
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_n int;
  v_role text;
  v_status text;
  v_mode text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    v_uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'legacy-01f-' || v_uid::text || '@t.test',
    'x',
    clock_timestamp(),
    jsonb_build_object('provider', 'google', 'providers', jsonb_build_array('google')),
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

  delete from public.profiles where auth_user_id = v_uid;

  perform private.ensure_auth_profile(v_uid);

  select count(*), min(role), min(status)
    into v_n, v_role, v_status
  from public.profiles
  where auth_user_id = v_uid;

  if v_n <> 1 then
    raise exception 'PLAT01F F2 FAIL: profile count=%', v_n;
  end if;
  if v_role is distinct from 'patient' then
    raise exception 'PLAT01F F2 FAIL: role=%', v_role;
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'PLAT01F F3 FAIL: status=%', v_status;
  end if;

  if exists (
    select 1
    from private.platform_admins pa
    join public.profiles p on p.id = pa.profile_id
    where p.auth_user_id = v_uid
  ) then
    raise exception 'PLAT01F F3 FAIL: PA concedido';
  end if;

  perform private.ensure_auth_profile(v_uid);
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then
    raise exception 'PLAT01F F4 FAIL: duplicate=%', v_n;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text)::text, true);
  set local role authenticated;
  perform public.ensure_my_profile();
  v_mode := public.get_clinic_onboarding_state() ->> 'mode';
  reset role;
  if v_mode is null or v_mode not in ('automatic', 'manual_review', 'closed') then
    raise exception 'PLAT01F F5 FAIL: mode=%', coalesce(v_mode, 'null');
  end if;
end $$;
rollback;


-- F6: sem JWT → NOT_AUTHENTICATED
begin;
do $$
declare
  v_hint text;
begin
  begin
    perform public.ensure_my_profile();
    raise exception 'PLAT01F F6 FAIL: allowed';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint is distinct from 'NOT_AUTHENTICATED' then
        raise exception 'PLAT01F F6 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- F7: profile existente → no-op (role/status/contagem)
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_pf uuid := gen_random_uuid();
  v_role text;
  v_status text;
  v_n int;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, v_uid, 'professional', 'Existente 01F', 'exist-01f@t.test', 'active');
  perform private.ensure_auth_profile(v_uid);
  select count(*), min(role), min(status)
    into v_n, v_role, v_status
  from public.profiles
  where auth_user_id = v_uid;
  if v_n <> 1 or v_role is distinct from 'professional' or v_status is distinct from 'active' then
    raise exception 'PLAT01F F7 FAIL: n=% role=% status=%', v_n, v_role, v_status;
  end if;
end $$;
rollback;


-- F8: ensure não cria professional/patient/clinic/PA
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_pf uuid;
  v_pros int;
  v_pats int;
  v_clin int;
  v_pa int;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'gap-01f-' || v_uid::text || '@t.test', 'x', clock_timestamp(),
    jsonb_build_object('provider', 'google', 'providers', jsonb_build_array('google')),
    '{}'::jsonb, clock_timestamp(), clock_timestamp()
  );
  delete from public.profiles where auth_user_id = v_uid;
  perform private.ensure_auth_profile(v_uid);
  select id into v_pf from public.profiles where auth_user_id = v_uid;
  select count(*) into v_pros from public.professionals where profile_id = v_pf;
  select count(*) into v_pats from public.patients where profile_id = v_pf;
  select count(*) into v_clin from public.clinics where owner_profile_id = v_pf;
  select count(*) into v_pa from private.platform_admins where profile_id = v_pf;
  if v_pros <> 0 or v_pats <> 0 or v_clin <> 0 or v_pa <> 0 then
    raise exception 'PLAT01F F8 FAIL: pros=% pats=% clin=% pa=%', v_pros, v_pats, v_clin, v_pa;
  end if;
end $$;
rollback;


-- F9: client não escolhe identidade — ensure_my_profile tem zero args
begin;
do $$
begin
  if pg_get_function_identity_arguments('public.ensure_my_profile()'::regprocedure) <> '' then
    raise exception 'PLAT01F F9 FAIL: args';
  end if;
end $$;
rollback;
