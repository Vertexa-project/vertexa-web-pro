-- =====================================================================================
-- AUTH-EMAIL-01 · identidade provider-agnostic (BEGIN / ROLLBACK).
-- HARNESS: exige 20260912120000. Padrão do repo (DO + RAISE), não tap.plan().
--
-- RED esperado ANTES da migration:
--   helper inexistente; email confirmado não cria/liga profile; search_path do
--   handle_new_user ainda é public, pg_temp; VINCULO-1 ignora email/password.
-- =====================================================================================

create or replace function pg_temp.ae01_ins_auth(
  p_id uuid,
  p_email text,
  p_provider text,
  p_confirmed boolean,
  p_user_meta jsonb default '{}'::jsonb
) returns void
language plpgsql
as $fn$
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    p_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    'x',
    case when p_confirmed then clock_timestamp() else null end,
    jsonb_build_object(
      'provider', p_provider,
      'providers', jsonb_build_array(p_provider)
    ),
    coalesce(p_user_meta, '{}'::jsonb),
    clock_timestamp(),
    clock_timestamp()
  );
end;
$fn$;


-- H1: contrato do helper — existe, INVOKER, search_path vazio, sem EXECUTE público
begin;
do $$
declare
  v_definer boolean;
  v_cfg text;
  v_args text;
begin
  if to_regprocedure('private.auth_identity_is_trusted(jsonb,timestamptz)') is null then
    raise exception 'AE01 H1 FAIL: helper missing';
  end if;
  select p.prosecdef, array_to_string(p.proconfig, ',')
    into v_definer, v_cfg
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'auth_identity_is_trusted';
  if v_definer then
    raise exception 'AE01 H1 FAIL: helper is SECURITY DEFINER';
  end if;
  if v_cfg is null or v_cfg not like '%search_path=%' or v_cfg like '%search_path=public%' then
    raise exception 'AE01 H1 FAIL: search_path=%', coalesce(v_cfg, 'null');
  end if;
  if has_function_privilege('anon', 'private.auth_identity_is_trusted(jsonb,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'private.auth_identity_is_trusted(jsonb,timestamptz)', 'execute') then
    raise exception 'AE01 H1 FAIL: public execute';
  end if;
  select pg_get_function_identity_arguments(
    'private.auth_identity_is_trusted(jsonb,timestamptz)'::regprocedure
  ) into v_args;
  if v_args is distinct from 'p_app jsonb, p_confirmed timestamp with time zone'
     and v_args is distinct from 'jsonb, timestamp with time zone' then
    -- aceita nomes ou só tipos
    if position('jsonb' in v_args) = 0 or position('timestamp' in v_args) = 0 then
      raise exception 'AE01 H1 FAIL: args=%', v_args;
    end if;
  end if;
end $$;
rollback;


-- H2: predicados do helper (confirmado × provider)
begin;
do $$
begin
  if not private.auth_identity_is_trusted(
    jsonb_build_object('provider','google','providers',jsonb_build_array('google')),
    clock_timestamp()
  ) then raise exception 'AE01 H2 FAIL: google confirmed'; end if;

  if not private.auth_identity_is_trusted(
    jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
    clock_timestamp()
  ) then raise exception 'AE01 H2 FAIL: email confirmed'; end if;

  if not private.auth_identity_is_trusted(
    jsonb_build_object('provider','apple','providers',jsonb_build_array('apple')),
    clock_timestamp()
  ) then raise exception 'AE01 H2 FAIL: apple confirmed'; end if;

  if private.auth_identity_is_trusted(
    jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
    null
  ) then raise exception 'AE01 H2 FAIL: email unconfirmed trusted'; end if;

  if private.auth_identity_is_trusted(
    jsonb_build_object('provider','apple','providers',jsonb_build_array('apple')),
    null
  ) then raise exception 'AE01 H2 FAIL: apple unconfirmed trusted'; end if;

  if private.auth_identity_is_trusted(
    jsonb_build_object('provider','phone','providers',jsonb_build_array('phone')),
    clock_timestamp()
  ) then raise exception 'AE01 H2 FAIL: phone trusted'; end if;

  if private.auth_identity_is_trusted('{}'::jsonb, clock_timestamp()) then
    raise exception 'AE01 H2 FAIL: empty app trusted';
  end if;

  -- só providers[], sem provider scalar (forma GoTrue equivalente)
  if not private.auth_identity_is_trusted(
    jsonb_build_object('providers', jsonb_build_array('email')),
    clock_timestamp()
  ) then raise exception 'AE01 H2 FAIL: providers-only email'; end if;

  -- user_metadata NÃO é input do helper — role forjado irrelevante
  if not private.auth_identity_is_trusted(
    jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
    clock_timestamp()
  ) then raise exception 'AE01 H2 FAIL: still trusted with unused meta'; end if;
end $$;
rollback;


-- H3: handle_new_user search_path endurecido + sem EXECUTE público
begin;
do $$
declare
  v_cfg text;
begin
  select array_to_string(p.proconfig, ',')
    into v_cfg
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'handle_new_user';
  if v_cfg is null or v_cfg not like '%search_path%' then
    raise exception 'AE01 H3 FAIL: no search_path';
  end if;
  if v_cfg like '%public%' then
    raise exception 'AE01 H3 FAIL: search_path still mentions public: %', v_cfg;
  end if;
  if has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') then
    raise exception 'AE01 H3 FAIL: handle_new_user execute';
  end if;
  if pg_get_function_identity_arguments('public.ensure_my_profile()'::regprocedure) <> '' then
    raise exception 'AE01 H3 FAIL: ensure_my_profile gained args';
  end if;
end $$;
rollback;


-- E1: email confirmado sem orphan → pending patient bootstrap, sem autoridade
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_email text;
  v_n int;
  v_role text;
  v_status text;
  v_pats int;
  v_pros int;
  v_clin int;
  v_pa int;
  v_pf uuid;
  v_outcome text;
  v_admin boolean;
begin
  v_email := 'ae01-e1-' || v_uid::text || '@t.test';
  perform pg_temp.ae01_ins_auth(
    v_uid, v_email, 'email', true,
    jsonb_build_object(
      'role', 'admin',
      'clinic_id', gen_random_uuid()::text,
      'is_platform_admin', true,
      'signup_surface', 'web'
    )
  );

  select count(*), min(role::text), min(status)
    into v_n, v_role, v_status
  from public.profiles
  where auth_user_id = v_uid;
  select id into v_pf from public.profiles where auth_user_id = v_uid;

  if v_n <> 1 then raise exception 'AE01 E1 FAIL: profile count=%', v_n; end if;
  if v_role is distinct from 'patient' then raise exception 'AE01 E1 FAIL: role=%', v_role; end if;
  if v_status is distinct from 'pending' then raise exception 'AE01 E1 FAIL: status=%', v_status; end if;

  select count(*) into v_pats from public.patients where profile_id = v_pf;
  select count(*) into v_pros from public.professionals where profile_id = v_pf;
  select count(*) into v_clin from public.clinics where owner_profile_id = v_pf;
  select count(*) into v_pa from private.platform_admins where profile_id = v_pf;
  if v_pats <> 0 or v_pros <> 0 or v_clin <> 0 or v_pa <> 0 then
    raise exception 'AE01 E1 FAIL: authority pats=% pros=% clin=% pa=%', v_pats, v_pros, v_clin, v_pa;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text)::text, true);
  set local role authenticated;
  v_admin := public.am_i_platform_admin();
  reset role;
  if v_admin is not false then
    raise exception 'AE01 E1 FAIL: metadata admin became PA';
  end if;

  select outcome into v_outcome
    from public.auth_trigger_events
   where auth_user_id = v_uid
   order by created_at desc
   limit 1;
  if v_outcome is distinct from 'pending_patient' then
    raise exception 'AE01 E1 FAIL: outcome=%', coalesce(v_outcome, 'null');
  end if;
end $$;
rollback;


-- E2: email NÃO confirmado → sem profile / sem link
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_email text;
  v_n int;
  v_outcome text;
begin
  v_email := 'ae01-e2-' || v_uid::text || '@t.test';
  perform pg_temp.ae01_ins_auth(v_uid, v_email, 'email', false, '{}'::jsonb);

  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 0 then raise exception 'AE01 E2 FAIL: trigger created profile'; end if;

  perform private.ensure_auth_profile(v_uid);
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 0 then raise exception 'AE01 E2 FAIL: ensure created profile'; end if;

  select outcome into v_outcome
    from public.auth_trigger_events
   where auth_user_id = v_uid
   order by created_at desc
   limit 1;
  if v_outcome is distinct from 'skipped_unverified_provider' then
    raise exception 'AE01 E2 FAIL: outcome=%', coalesce(v_outcome, 'null');
  end if;
end $$;
rollback;


-- E3: Google confirmado ainda cria pending (regressão)
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_n int;
  v_role text;
begin
  perform pg_temp.ae01_ins_auth(
    v_uid, 'ae01-g-' || v_uid::text || '@t.test', 'google', true, '{}'::jsonb
  );
  select count(*), min(role::text) into v_n, v_role
    from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 or v_role is distinct from 'patient' then
    raise exception 'AE01 E3 FAIL: n=% role=%', v_n, v_role;
  end if;
  perform private.ensure_auth_profile(v_uid);
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then raise exception 'AE01 E3 FAIL: ensure dup=%', v_n; end if;
end $$;
rollback;


-- E4: Apple-shaped confirmado (só identidade; sem OAuth real)
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_n int;
begin
  perform pg_temp.ae01_ins_auth(
    v_uid, 'ae01-a-' || v_uid::text || '@t.test', 'apple', true, '{}'::jsonb
  );
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then raise exception 'AE01 E4 FAIL: apple profile count=%', v_n; end if;
end $$;
rollback;


-- P1: patient-first — orphan + patients row, depois email confirmado liga o mesmo profile
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_staff_pf uuid := gen_random_uuid();
  v_clinic uuid := gen_random_uuid();
  v_orphan uuid := gen_random_uuid();
  v_email text;
  v_pat int;
  v_n int;
  v_role text;
  v_status text;
  v_linked uuid;
begin
  v_email := 'ae01-p1-' || v_uid::text || '@t.test';
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values
      (v_staff_pf, v_staff, 'professional', 'Staff AE01', 'staff-p1-'||v_staff::text||'@t.test', 'active'),
      (v_orphan, null, 'patient', 'Orphan P1', v_email, 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_clinic, 'AE01 P1', v_staff_pf);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_staff_pf, v_clinic, 'other', 'admin', 'active');
  insert into public.patients (profile_id, clinic_id) values (v_orphan, v_clinic);

  perform pg_temp.ae01_ins_auth(v_uid, v_email, 'email', true, '{}'::jsonb);

  select auth_user_id, role::text, status into v_linked, v_role, v_status
    from public.profiles where id = v_orphan;
  if v_linked is distinct from v_uid then
    raise exception 'AE01 P1 FAIL: orphan not linked';
  end if;
  if v_role is distinct from 'patient' or v_status is distinct from 'active' then
    raise exception 'AE01 P1 FAIL: role=% status=%', v_role, v_status;
  end if;
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then raise exception 'AE01 P1 FAIL: second profile n=%', v_n; end if;
  select count(*) into v_pat from public.patients where profile_id = v_orphan;
  if v_pat <> 1 then raise exception 'AE01 P1 FAIL: patient count=%', v_pat; end if;
end $$;
rollback;


-- P2: auth-first → pending; create_patient VINCULO-2 reusa e cria 1 patient
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_staff_pf uuid := gen_random_uuid();
  v_clinic uuid := gen_random_uuid();
  v_email text;
  v_pf uuid;
  v_pat uuid;
  v_n int;
  v_status text;
  v_auth uuid;
begin
  v_email := 'ae01-p2-' || v_uid::text || '@t.test';
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_staff_pf, v_staff, 'professional', 'Staff AE01 P2', 'staff-p2-'||v_staff::text||'@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_clinic, 'AE01 P2', v_staff_pf);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_staff_pf, v_clinic, 'other', 'admin', 'active');

  perform pg_temp.ae01_ins_auth(v_uid, v_email, 'email', true, '{}'::jsonb);
  select id, status into v_pf, v_status from public.profiles where auth_user_id = v_uid;
  if v_pf is null or v_status is distinct from 'pending' then
    raise exception 'AE01 P2 FAIL: pending bootstrap status=%', coalesce(v_status, 'null');
  end if;
  if exists (select 1 from public.patients where profile_id = v_pf) then
    raise exception 'AE01 P2 FAIL: patient created at signup';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text)::text, true);
  set local role authenticated;
  v_pat := public.create_patient(v_clinic, 'Auth First', v_email);
  reset role;

  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then raise exception 'AE01 P2 FAIL: profile split n=%', v_n; end if;
  select status, auth_user_id into v_status, v_auth from public.profiles where id = v_pf;
  if v_auth is distinct from v_uid then raise exception 'AE01 P2 FAIL: auth_user_id changed'; end if;
  if v_status is distinct from 'active' then raise exception 'AE01 P2 FAIL: not activated'; end if;
  if (select count(*) from public.patients where profile_id = v_pf) <> 1 then
    raise exception 'AE01 P2 FAIL: patient count';
  end if;
  if (select profile_id from public.patients where id = v_pat) is distinct from v_pf then
    raise exception 'AE01 P2 FAIL: wrong patient profile';
  end if;
end $$;
rollback;


-- P3: VINCULO-1 email — auth confirmado SEM profile; staff cria patient
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_staff_pf uuid := gen_random_uuid();
  v_clinic uuid := gen_random_uuid();
  v_email text;
  v_pat uuid;
  v_auth uuid;
  v_n int;
begin
  v_email := 'ae01-p3-' || v_uid::text || '@t.test';
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_staff_pf, v_staff, 'professional', 'Staff AE01 P3', 'staff-p3-'||v_staff::text||'@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_clinic, 'AE01 P3', v_staff_pf);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_staff_pf, v_clinic, 'other', 'admin', 'active');

  perform pg_temp.ae01_ins_auth(v_uid, v_email, 'email', true, '{}'::jsonb);
  delete from public.profiles where auth_user_id = v_uid;

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text)::text, true);
  set local role authenticated;
  v_pat := public.create_patient(v_clinic, 'Vinculo1 Email', v_email);
  reset role;

  select auth_user_id into v_auth
    from public.profiles
   where id = (select profile_id from public.patients where id = v_pat);
  if v_auth is distinct from v_uid then
    raise exception 'AE01 P3 FAIL: VINCULO-1 did not claim email user';
  end if;
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then raise exception 'AE01 P3 FAIL: profile n=%', v_n; end if;
end $$;
rollback;


-- P4: VINCULO-1 Google regressão + unconfirmed email inelegível
begin;
do $$
declare
  v_g uuid := gen_random_uuid();
  v_e uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_staff_pf uuid := gen_random_uuid();
  v_clinic uuid := gen_random_uuid();
  v_g_email text;
  v_e_email text;
  v_pat uuid;
  v_auth uuid;
begin
  v_g_email := 'ae01-p4g-' || v_g::text || '@t.test';
  v_e_email := 'ae01-p4e-' || v_e::text || '@t.test';
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_staff_pf, v_staff, 'professional', 'Staff AE01 P4', 'staff-p4-'||v_staff::text||'@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_clinic, 'AE01 P4', v_staff_pf);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_staff_pf, v_clinic, 'other', 'admin', 'active');

  perform pg_temp.ae01_ins_auth(v_g, v_g_email, 'google', true, '{}'::jsonb);
  delete from public.profiles where auth_user_id = v_g;
  perform pg_temp.ae01_ins_auth(v_e, v_e_email, 'email', false, '{}'::jsonb);

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text)::text, true);
  set local role authenticated;
  v_pat := public.create_patient(v_clinic, 'Vinculo1 Google', v_g_email);
  reset role;
  select auth_user_id into v_auth
    from public.profiles where id = (select profile_id from public.patients where id = v_pat);
  if v_auth is distinct from v_g then
    raise exception 'AE01 P4 FAIL: google VINCULO-1';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text)::text, true);
  set local role authenticated;
  v_pat := public.create_patient(v_clinic, 'Unconfirmed skip', v_e_email);
  reset role;
  select auth_user_id into v_auth
    from public.profiles where id = (select profile_id from public.patients where id = v_pat);
  if v_auth is not null then
    raise exception 'AE01 P4 FAIL: unconfirmed email claimed';
  end if;
end $$;
rollback;


-- D1: dois orphans no mesmo e-mail → não escolhe; não takeover
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_email text;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_linked_a uuid;
  v_linked_b uuid;
  v_n int;
begin
  v_email := 'ae01-d1-' || v_uid::text || '@t.test';
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_a, null, 'patient', 'Dup A', v_email, 'active'),
    (v_b, null, 'professional', 'Dup B', v_email, 'pending');

  perform pg_temp.ae01_ins_auth(v_uid, v_email, 'email', true, '{}'::jsonb);

  select auth_user_id into v_linked_a from public.profiles where id = v_a;
  select auth_user_id into v_linked_b from public.profiles where id = v_b;
  if v_linked_a is not null or v_linked_b is not null then
    raise exception 'AE01 D1 FAIL: orphan takeover';
  end if;
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then
    raise exception 'AE01 D1 FAIL: expected new pending bootstrap n=%', v_n;
  end if;
end $$;
rollback;


-- C1: trigger + ensure concomitantes → 1 profile (índice único)
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_n int;
begin
  perform pg_temp.ae01_ins_auth(
    v_uid, 'ae01-c1-' || v_uid::text || '@t.test', 'email', true, '{}'::jsonb
  );
  perform private.ensure_auth_profile(v_uid);
  perform private.ensure_auth_profile(v_uid);
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then raise exception 'AE01 C1 FAIL: n=%', v_n; end if;
end $$;
rollback;


-- S1: client não muta colunas de identidade; full_name segue permitido; avatar via RPC
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_pf uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_other_pf uuid := gen_random_uuid();
  n int;
  v_role text;
  v_status text;
  v_email text;
  v_auth uuid;
  v_name text;
  v_path text;
  path_ok text;
begin
  v_email := 'ae01-s1-' || v_uid::text || '@t.test';
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf, v_uid, 'patient', 'Self AE01', v_email, 'pending'),
    (v_other_pf, v_other, 'patient', 'Other AE01', 'other-s1-'||v_other::text||'@t.test', 'active');

  if has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'auth_user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'status', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'UPDATE') then
    raise exception 'AE01 S1 FAIL: identity/avatar_path still updatable';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception 'AE01 S1 FAIL: full_name grant missing';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text)::text, true);

  begin
    update public.profiles set role = 'professional' where id = v_pf;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'AE01 S1 FAIL: role update counted'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set auth_user_id = v_other where id = v_pf;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'AE01 S1 FAIL: auth_user_id update counted'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set status = 'active' where id = v_pf;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'AE01 S1 FAIL: status update counted'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set email = 'hacked@t.test' where id = v_pf;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'AE01 S1 FAIL: email update counted'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set full_name = 'Renamed AE01' where id = v_other_pf;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'AE01 S1 FAIL: other profile updated'; end if;
  exception when others then null;
  end;

  update public.profiles set full_name = 'Renamed AE01' where id = v_pf;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'AE01 S1 FAIL: own full_name denied'; end if;

  reset role;
  select role::text, status, email, auth_user_id, full_name
    into v_role, v_status, v_email, v_auth, v_name
  from public.profiles where id = v_pf;
  if v_role is distinct from 'patient' then raise exception 'AE01 S1 FAIL: role mutated'; end if;
  if v_status is distinct from 'pending' then raise exception 'AE01 S1 FAIL: status mutated'; end if;
  if v_email is distinct from ('ae01-s1-' || v_uid::text || '@t.test') then
    raise exception 'AE01 S1 FAIL: email mutated';
  end if;
  if v_auth is distinct from v_uid then raise exception 'AE01 S1 FAIL: auth_user_id mutated'; end if;
  if v_name is distinct from 'Renamed AE01' then raise exception 'AE01 S1 FAIL: full_name not saved'; end if;

  -- Avatar RPC (DEFINER) continua gravando avatar_path sem grant de coluna.
  path_ok := v_pf::text || '/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp';
  insert into storage.objects (bucket_id, name)
    values ('profile-avatars', path_ok)
  on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text)::text, true);
  set local role authenticated;
  perform public.set_my_avatar(path_ok);
  reset role;
  select avatar_path into v_path from public.profiles where id = v_pf;
  if v_path is distinct from path_ok then
    raise exception 'AE01 S1 FAIL: set_my_avatar broken';
  end if;
end $$;
rollback;


-- N1: nenhuma RPC pública nova de autoridade
begin;
do $$
begin
  if to_regprocedure('public.register_user(text)') is not null
     or to_regprocedure('public.activate_patient(uuid)') is not null
     or to_regprocedure('public.become_professional()') is not null
     or to_regprocedure('public.set_role(text)') is not null
     or to_regprocedure('public.create_platform_admin()') is not null
     or to_regprocedure('public.link_patient(uuid)') is not null then
    raise exception 'AE01 N1 FAIL: new public authority RPC';
  end if;
end $$;
rollback;
