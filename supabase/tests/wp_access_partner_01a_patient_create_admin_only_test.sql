-- =====================================================================================
-- WP-ACCESS-PARTNER-01A · create_patient admin-only (BEGIN / DO pequeno / ROLLBACK).
-- Exige 20260917214500. Login via request.jwt.claims + set local role.
-- =====================================================================================

create or replace function pg_temp.ap01a_ins_auth(
  p_id uuid,
  p_email text,
  p_provider text,
  p_confirmed boolean
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
    jsonb_build_object('provider', p_provider, 'providers', jsonb_build_array(p_provider)),
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );
end;
$fn$;

create or replace function pg_temp.ap01a_seed()
returns table (
  c_a uuid, c_b uuid,
  a_own uuid, a_adm uuid, a_mem uuid, a_lnk uuid, a_oth uuid, a_pat uuid, a_plat uuid,
  pf_own uuid, pf_adm uuid, pf_mem uuid, pf_lnk uuid, pf_oth uuid, pf_pat uuid, pf_plat uuid, pf_spare uuid,
  prof_adm uuid, prof_mem uuid, prof_lnk uuid, prof_oth uuid,
  pat_exist uuid
)
language plpgsql
as $seed$
declare
  v_c_a uuid := gen_random_uuid(); v_c_b uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_adm uuid := gen_random_uuid(); v_a_adm uuid := gen_random_uuid();
  v_pf_mem uuid := gen_random_uuid(); v_a_mem uuid := gen_random_uuid();
  v_pf_lnk uuid := gen_random_uuid(); v_a_lnk uuid := gen_random_uuid();
  v_pf_oth uuid := gen_random_uuid(); v_a_oth uuid := gen_random_uuid();
  v_pf_ownb uuid := gen_random_uuid(); v_a_ownb uuid := gen_random_uuid();
  v_pf_pat uuid := gen_random_uuid(); v_a_pat uuid := gen_random_uuid();
  v_pf_plat uuid := gen_random_uuid(); v_a_plat uuid := gen_random_uuid();
  v_pf_spare uuid := gen_random_uuid();
  v_pr_adm uuid; v_pr_mem uuid; v_pr_lnk uuid; v_pr_oth uuid;
  v_pat uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_own,  v_a_own,  'professional', 'Owner Alfa',   'own-ap01a@t.test',  'active'),
    (v_pf_adm,  v_a_adm,  'professional', 'CoAdmin Alfa', 'adm-ap01a@t.test',  'active'),
    (v_pf_mem,  v_a_mem,  'professional', 'Member Alfa',  'mem-ap01a@t.test',  'active'),
    (v_pf_lnk,  v_a_lnk,  'professional', 'Linked Mem',   'lnk-ap01a@t.test',  'active'),
    (v_pf_oth,  v_a_oth,  'professional', 'Member Beta',  'oth-ap01a@t.test',  'active'),
    (v_pf_ownb, v_a_ownb, 'professional', 'Owner Beta',   'ownb-ap01a@t.test', 'active'),
    (v_pf_pat,  v_a_pat,  'patient',      'Paciente A',   'pat-ap01a@t.test',  'active'),
    (v_pf_plat, v_a_plat, 'professional', 'Platform Op',  'plat-ap01a@t.test', 'active'),
    (v_pf_spare, null,    'patient',      'Spare A',      'spare-ap01a@t.test','active');

  insert into public.clinics (id, name, owner_profile_id) values
    (v_c_a, 'Clinica Alfa AP01A', v_pf_own),
    (v_c_b, 'Clinica Beta AP01A', v_pf_ownb);

  -- owner SEM professional row (T1 / T10 canonical: sem vínculo automático)
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_adm, v_c_a, 'doctor', 'admin', 'active') returning id into v_pr_adm;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_mem, v_c_a, 'nutritionist', 'member', 'active') returning id into v_pr_mem;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_lnk, v_c_a, 'physiotherapist', 'member', 'active') returning id into v_pr_lnk;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_oth, v_c_b, 'nutritionist', 'member', 'active') returning id into v_pr_oth;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_ownb, v_c_b, 'other', 'admin', 'active');

  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pf_pat, v_c_a, 'meta') returning id into v_pat;
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (v_pr_lnk, v_pat, false, 'active');

  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (v_pf_plat, 'active', now(), null);

  return query select
    v_c_a, v_c_b,
    v_a_own, v_a_adm, v_a_mem, v_a_lnk, v_a_oth, v_a_pat, v_a_plat,
    v_pf_own, v_pf_adm, v_pf_mem, v_pf_lnk, v_pf_oth, v_pf_pat, v_pf_plat, v_pf_spare,
    v_pr_adm, v_pr_mem, v_pr_lnk, v_pr_oth,
    v_pat;
end;
$seed$;


-- T15: uma assinatura; único INSERT DEFINER em public.patients; gate admin, sem staff, sem billing
begin;
do $$
declare
  v_n int;
  v_src text;
  v_definer boolean;
  v_cfg text;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_patient';
  if v_n <> 1 then raise exception 'AP01A T15 FAIL: create_patient overloads=%', v_n; end if;

  select p.prosecdef, array_to_string(p.proconfig, ','), p.prosrc
    into v_definer, v_cfg, v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_patient';
  if not v_definer then raise exception 'AP01A T15 FAIL: not DEFINER'; end if;
  if v_cfg is null or v_cfg not like '%search_path=%' or v_cfg like '%search_path=public%' then
    raise exception 'AP01A T15 FAIL: search_path=%', coalesce(v_cfg, 'null');
  end if;
  if v_src !~ 'is_clinic_admin' then raise exception 'AP01A T15 FAIL: missing is_clinic_admin'; end if;
  if v_src ~ 'is_clinic_staff' then raise exception 'AP01A T15 FAIL: still is_clinic_staff'; end if;
  if v_src !~ 'PATIENT_CREATE_ADMIN_REQUIRED' then
    raise exception 'AP01A T15 FAIL: missing PATIENT_CREATE_ADMIN_REQUIRED';
  end if;
  if v_src ~* 'billing_evaluate_clinic_capacity|plan_version_id|billing_plan_versions|billing_create_commercial_contract|billing_clinic_active_contract' then
    raise exception 'AP01A T15 FAIL: billing gate leaked into create_patient';
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosrc ilike '%insert into public.patients%';
  if v_n <> 1 then
    raise exception 'AP01A T15 FAIL: extra patients INSERT functions n=%', v_n;
  end if;

  if has_function_privilege('anon', 'public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date)', 'execute') then
    raise exception 'AP01A T15 FAIL: anon execute';
  end if;
  if not has_function_privilege('authenticated', 'public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date)', 'execute') then
    raise exception 'AP01A T15 FAIL: authenticated execute missing';
  end if;
  raise notice 'AP01A T15 PASSED';
end $$;
rollback;


-- T1: owner ativo cria paciente
begin;
do $$
declare
  s record; v_new uuid; v_role text; v_auth uuid; v_n int;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_own::text)::text, true);
  set local role authenticated;
  v_new := public.create_patient(s.c_a, 'Paciente Owner');
  reset role;
  if v_new is null then raise exception 'AP01A T1 FAIL: null'; end if;
  select p.role::text, p.auth_user_id into v_role, v_auth
    from public.profiles p join public.patients pt on pt.profile_id = p.id
   where pt.id = v_new;
  if v_role is distinct from 'patient' then raise exception 'AP01A T1 FAIL: role=%', v_role; end if;
  if v_auth is not null then raise exception 'AP01A T1 FAIL: auth set'; end if;
  select count(*) into v_n from public.patients where id = v_new and clinic_id = s.c_a;
  if v_n <> 1 then raise exception 'AP01A T1 FAIL: clinic'; end if;
  raise notice 'AP01A T1 PASSED';
end $$;
rollback;


-- T2: co-admin (clinic_role=admin) cria paciente
begin;
do $$
declare
  s record; v_new uuid;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text)::text, true);
  set local role authenticated;
  v_new := public.create_patient(s.c_a, 'Paciente CoAdmin');
  reset role;
  if v_new is null then raise exception 'AP01A T2 FAIL: null'; end if;
  raise notice 'AP01A T2 PASSED';
end $$;
rollback;


-- T3: member ativo da mesma clínica = DENIED 42501 PATIENT_CREATE_ADMIN_REQUIRED
begin;
do $$
declare
  s record; raised boolean := false; v_hint text; v_state text;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_mem::text)::text, true);
  set local role authenticated;
  begin
    perform public.create_patient(s.c_a, 'Paciente Member');
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    raised := true;
  end;
  reset role;
  if not raised then raise exception 'AP01A T3 FAIL: member created'; end if;
  if v_state is distinct from '42501' then raise exception 'AP01A T3 FAIL: sqlstate=%', v_state; end if;
  if v_hint is distinct from 'PATIENT_CREATE_ADMIN_REQUIRED' then
    raise exception 'AP01A T3 FAIL: hint=%', coalesce(v_hint, 'null');
  end if;
  raise notice 'AP01A T3 PASSED';
end $$;
rollback;


-- T4: member já vinculado a outro paciente ainda não ganha create_patient
begin;
do $$
declare
  s record; raised boolean := false; v_hint text;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_lnk::text)::text, true);
  set local role authenticated;
  begin
    perform public.create_patient(s.c_a, 'Paciente Linked Member');
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    raised := true;
  end;
  reset role;
  if not raised then raise exception 'AP01A T4 FAIL: linked member created'; end if;
  if v_hint is distinct from 'PATIENT_CREATE_ADMIN_REQUIRED' then
    raise exception 'AP01A T4 FAIL: hint=%', coalesce(v_hint, 'null');
  end if;
  raise notice 'AP01A T4 PASSED';
end $$;
rollback;


-- T5: member de outra clínica = DENIED
begin;
do $$
declare
  s record; raised boolean := false;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_oth::text)::text, true);
  set local role authenticated;
  begin
    perform public.create_patient(s.c_a, 'Cross Clinic');
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'AP01A T5 FAIL: cross-clinic create'; end if;
  raise notice 'AP01A T5 PASSED';
end $$;
rollback;


-- T6: patient = DENIED
begin;
do $$
declare
  s record; raised boolean := false;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_pat::text)::text, true);
  set local role authenticated;
  begin
    perform public.create_patient(s.c_a, 'Self Create');
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'AP01A T6 FAIL: patient created'; end if;
  raise notice 'AP01A T6 PASSED';
end $$;
rollback;


-- T7: Platform Admin isolado = DENIED
begin;
do $$
declare
  s record; raised boolean := false;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  begin
    perform public.create_patient(s.c_a, 'PA Create');
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'AP01A T7 FAIL: PA created'; end if;
  raise notice 'AP01A T7 PASSED';
end $$;
rollback;


-- T8: clínica suspensa continua DENIED (owner incluso)
begin;
do $$
declare
  s record; raised boolean := false; v_hint text;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.suspend_platform_clinic(s.c_a, 'motivo suficiente');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_own::text)::text, true);
  set local role authenticated;
  begin
    perform public.create_patient(s.c_a, 'Suspensa');
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    raised := true;
  end;
  reset role;
  if not raised then raise exception 'AP01A T8 FAIL: create on suspended'; end if;
  if v_hint is distinct from 'CLINIC_NOT_OPERATIONAL' then
    raise exception 'AP01A T8 FAIL: hint=%', coalesce(v_hint, 'null');
  end if;
  raise notice 'AP01A T8 PASSED';
end $$;
rollback;


-- T9: INSERT direto por member continua DENIED
begin;
do $$
declare
  s record; raised boolean := false; n int;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_mem::text)::text, true);
  set local role authenticated;
  begin
    insert into public.patients (profile_id, clinic_id) values (s.pf_spare, s.c_a);
    get diagnostics n = row_count;
    if n > 0 then raised := false; else raised := true; end if;
  exception when insufficient_privilege then raised := true;
           when others then raised := true;
  end;
  reset role;
  if not raised then raise exception 'AP01A T9 FAIL: member INSERT'; end if;
  if exists (select 1 from public.patients where profile_id = s.pf_spare) then
    raise exception 'AP01A T9 FAIL: row persisted';
  end if;
  raise notice 'AP01A T9 PASSED';
end $$;
rollback;


-- T10: admin cria; vínculo inicial canônico (owner sem prof = 0; co-admin = 1, is_external=false)
begin;
do $$
declare
  s record; v_own uuid; v_adm uuid; v_n int; v_ext boolean; v_st text; v_prof uuid;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_own::text)::text, true);
  set local role authenticated;
  v_own := public.create_patient(s.c_a, 'Owner Canonical');
  reset role;
  select count(*) into v_n from public.professional_patient_links where patient_id = v_own;
  if v_n <> 0 then raise exception 'AP01A T10 FAIL: owner auto-link n=%', v_n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text)::text, true);
  set local role authenticated;
  v_adm := public.create_patient(s.c_a, 'CoAdmin Canonical');
  reset role;
  select professional_id, is_external, status into v_prof, v_ext, v_st
    from public.professional_patient_links where patient_id = v_adm;
  if v_prof is distinct from s.prof_adm then raise exception 'AP01A T10 FAIL: link prof'; end if;
  if v_ext is not false then raise exception 'AP01A T10 FAIL: is_external'; end if;
  if v_st is distinct from 'active' then raise exception 'AP01A T10 FAIL: status=%', v_st; end if;
  raise notice 'AP01A T10 PASSED';
end $$;
rollback;


-- T11: ADMIN cria → ADMIN atribui PROFESSIONAL da mesma clínica
begin;
do $$
declare
  s record; v_new uuid; v_link uuid; v_n int;
begin
  select * into s from pg_temp.ap01a_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_own::text)::text, true);
  set local role authenticated;
  v_new := public.create_patient(s.c_a, 'Para Atribuir');
  v_link := public.assign_patient_professional(v_new, s.prof_mem);
  reset role;
  if v_link is null then raise exception 'AP01A T11 FAIL: assign null'; end if;
  select count(*) into v_n
    from public.professional_patient_links
   where patient_id = v_new and professional_id = s.prof_mem and coalesce(status,'active')='active';
  if v_n <> 1 then raise exception 'AP01A T11 FAIL: link n=%', v_n; end if;
  raise notice 'AP01A T11 PASSED';
end $$;
rollback;


-- T12: AUTH-EMAIL VINCULO-2 pending + VINCULO-1 google/email sem regressão
begin;
do $$
declare
  s record;
  v_uid uuid := gen_random_uuid();
  v_g uuid := gen_random_uuid();
  v_email text;
  v_g_email text;
  v_pf uuid;
  v_pat uuid;
  v_status text;
  v_auth uuid;
  v_n int;
begin
  select * into s from pg_temp.ap01a_seed();
  v_email := 'ap01a-p2-' || v_uid::text || '@t.test';
  v_g_email := 'ap01a-g-' || v_g::text || '@t.test';

  perform pg_temp.ap01a_ins_auth(v_uid, v_email, 'email', true);
  select id, status into v_pf, v_status from public.profiles where auth_user_id = v_uid;
  if v_pf is null or v_status is distinct from 'pending' then
    raise exception 'AP01A T12 FAIL: pending bootstrap status=%', coalesce(v_status, 'null');
  end if;
  if exists (select 1 from public.patients where profile_id = v_pf) then
    raise exception 'AP01A T12 FAIL: patient at signup';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_own::text)::text, true);
  set local role authenticated;
  v_pat := public.create_patient(s.c_a, 'Auth First', v_email);
  reset role;
  select count(*) into v_n from public.profiles where auth_user_id = v_uid;
  if v_n <> 1 then raise exception 'AP01A T12 FAIL: profile split n=%', v_n; end if;
  select status, auth_user_id into v_status, v_auth from public.profiles where id = v_pf;
  if v_auth is distinct from v_uid then raise exception 'AP01A T12 FAIL: auth changed'; end if;
  if v_status is distinct from 'active' then raise exception 'AP01A T12 FAIL: not activated'; end if;
  if (select profile_id from public.patients where id = v_pat) is distinct from v_pf then
    raise exception 'AP01A T12 FAIL: wrong claim';
  end if;

  perform pg_temp.ap01a_ins_auth(v_g, v_g_email, 'google', true);
  delete from public.profiles where auth_user_id = v_g;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_adm::text)::text, true);
  set local role authenticated;
  v_pat := public.create_patient(s.c_a, 'Vinculo1 Google', v_g_email);
  reset role;
  select auth_user_id into v_auth
    from public.profiles where id = (select profile_id from public.patients where id = v_pat);
  if v_auth is distinct from v_g then raise exception 'AP01A T12 FAIL: google VINCULO-1'; end if;
  raise notice 'AP01A T12 PASSED';
end $$;
rollback;
