-- =====================================================================================
-- PLATFORM-01D · D1–D11 (BEGIN / ROLLBACK). Sem e-mail/UUID operacional.
-- HARNESS: exige 20260902000551.
-- =====================================================================================

create or replace function pg_temp.wpplat01d_seed()
returns table (
  a_plat uuid, a_user uuid, a_own uuid,
  pf_plat uuid, pf_user uuid, pf_own uuid
)
language plpgsql
as $seed$
declare
  v_pf_plat uuid := gen_random_uuid(); v_a_plat uuid := gen_random_uuid();
  v_pf_user uuid := gen_random_uuid(); v_a_user uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_plat, v_a_plat, 'professional', 'PA 01D',   'pa-01d@t.test',   'active'),
    (v_pf_user, v_a_user, 'patient',      'User 01D', 'user-01d@t.test', 'pending'),
    (v_pf_own,  v_a_own,  'professional', 'Own 01D',  'own-01d@t.test',  'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_c, 'Clinica 01D', v_pf_own);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_own, v_c, 'other', 'admin', 'active');
  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (v_pf_plat, 'active', now(), null);
  return query select v_a_plat, v_a_user, v_a_own, v_pf_plat, v_pf_user, v_pf_own;
end;
$seed$;


-- D1: auth ausente → NOT_AUTHENTICATED
begin;
do $$
declare
  v_hint text;
begin
  begin
    perform public.get_clinic_onboarding_state();
    raise exception 'PLAT01D D1 FAIL: allowed';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint is distinct from 'NOT_AUTHENTICATED' then
        raise exception 'PLAT01D D1 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- D2: auth presente + profile ausente → PROFILE_NOT_FOUND
begin;
do $$
declare
  v_hint text;
  v_ghost uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_ghost::text)::text, true);
  set local role authenticated;
  begin
    perform public.get_clinic_onboarding_state();
    raise exception 'PLAT01D D2 FAIL: allowed';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'PROFILE_NOT_FOUND' then
        raise exception 'PLAT01D D2 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- D3 / D4: am_i_platform_admin false sem PA, true com PA active
begin;
do $$
declare
  s record;
begin
  select * into s from pg_temp.wpplat01d_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  if public.am_i_platform_admin() is not false then
    raise exception 'PLAT01D D3 FAIL';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  if public.am_i_platform_admin() is not true then
    raise exception 'PLAT01D D4 FAIL';
  end if;
  reset role;
end $$;
rollback;


-- D5: DELETE profile com PA active → bloqueado
begin;
do $$
declare
  s record;
  v_blocked boolean := false;
begin
  select * into s from pg_temp.wpplat01d_seed();
  begin
    delete from public.profiles where id = s.pf_plat;
  exception
    when foreign_key_violation then
      v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'PLAT01D D5 FAIL: delete allowed';
  end if;
  if not exists (select 1 from private.platform_admins where profile_id = s.pf_plat and status = 'active') then
    raise exception 'PLAT01D D5 FAIL: PA row lost';
  end if;
end $$;
rollback;


-- D6: revoke → autoridade false, profile permanece
-- D7: após revoke, DELETE do profile continua bloqueado (RESTRICT enquanto a row existir)
begin;
do $$
declare
  s record;
  v_blocked boolean := false;
begin
  select * into s from pg_temp.wpplat01d_seed();
  update private.platform_admins
     set status = 'revoked', revoked_at = clock_timestamp()
   where profile_id = s.pf_plat;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  if public.am_i_platform_admin() is not false then
    raise exception 'PLAT01D D6 FAIL: still admin';
  end if;
  reset role;
  if not exists (select 1 from public.profiles where id = s.pf_plat) then
    raise exception 'PLAT01D D6 FAIL: profile gone';
  end if;
  begin
    delete from public.profiles where id = s.pf_plat;
  exception
    when foreign_key_violation then
      v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'PLAT01D D7 FAIL: delete after revoke allowed';
  end if;
end $$;
rollback;


-- D8 / D9: usuário comum e clinic admin não inserem PA
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01d_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  begin
    insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
      values (s.pf_user, 'active', now(), null);
    raise exception 'PLAT01D D8 FAIL: user inserted PA';
  exception
    when insufficient_privilege then
      null;
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      if sqlstate = 'P0001' and v_hint = 'PLAT01D D8 FAIL: user inserted PA' then
        raise;
      end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_own::text)::text, true);
  set local role authenticated;
  begin
    insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
      values (s.pf_own, 'active', now(), null);
    raise exception 'PLAT01D D9 FAIL: clinic admin inserted PA';
  exception
    when insufficient_privilege then
      null;
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      if sqlstate = 'P0001' and v_hint = 'PLAT01D D9 FAIL: clinic admin inserted PA' then
        raise;
      end if;
  end;
  reset role;
end $$;
rollback;


-- D10 / D11: PA sem professional/patient/clinic e sem projeção clínica na list
begin;
do $$
declare
  s record;
  v_args text;
  v_n int;
begin
  select * into s from pg_temp.wpplat01d_seed();
  select count(*) into v_n from public.professionals where profile_id = s.pf_plat;
  if v_n <> 0 then raise exception 'PLAT01D D10 FAIL: professional'; end if;
  select count(*) into v_n from public.patients where profile_id = s.pf_plat;
  if v_n <> 0 then raise exception 'PLAT01D D10 FAIL: patient'; end if;
  select count(*) into v_n from public.clinics where owner_profile_id = s.pf_plat;
  if v_n <> 0 then raise exception 'PLAT01D D10 FAIL: clinic'; end if;
  v_args := pg_get_function_result('public.list_clinic_creation_requests()'::regprocedure);
  if v_args ~* 'patient|chat|diagnos|adherence|join_code|document|vri' then
    raise exception 'PLAT01D D11 FAIL: %', v_args;
  end if;
  v_args := pg_get_function_result('public.list_platform_clinics()'::regprocedure);
  if v_args ~* 'join_code|chat|diagnos|adherence|document|vri' then
    raise exception 'PLAT01D D11 FAIL clinics: %', v_args;
  end if;
end $$;
rollback;
