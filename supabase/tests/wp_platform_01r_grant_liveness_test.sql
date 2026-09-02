-- =====================================================================================
-- PLATFORM-01R · liveness do grant em get_clinic_onboarding_state.
-- HARNESS: exige 20260901220930 + 20260901222656. BEGIN / ROLLBACK.
-- =====================================================================================

create or replace function pg_temp.wpplat01r_live_seed()
returns table (
  a_plat uuid, a_user uuid,
  pf_plat uuid, pf_user uuid
)
language plpgsql
as $seed$
declare
  v_pf_plat uuid := gen_random_uuid(); v_a_plat uuid := gen_random_uuid();
  v_pf_user uuid := gen_random_uuid(); v_a_user uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_plat, v_a_plat, 'professional', 'PA LIVE',   'pa-live@t.test',   'active'),
    (v_pf_user, v_a_user, 'patient',      'User LIVE', 'user-live@t.test', 'pending');
  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (v_pf_plat, 'active', now(), null);
  insert into private.clinic_onboarding_policy (id, mode, updated_at, updated_by_profile_id)
  values (true, 'manual_review', clock_timestamp(), v_pf_plat)
  on conflict (id) do update
    set mode = 'manual_review',
        updated_at = excluded.updated_at,
        updated_by_profile_id = excluded.updated_by_profile_id;
  return query select v_a_plat, v_a_user, v_pf_plat, v_pf_user;
end;
$seed$;


-- S15-state: approved vivo ⇒ grant_is_active true; expirado ⇒ false; reentry ⇒ pending
begin;
do $$
declare
  s record;
  v_req uuid;
  v_req2 uuid;
  v_auth uuid;
  v_state jsonb;
begin
  select * into s from pg_temp.wpplat01r_live_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Alpha')->>'request_id')::uuid;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.approve_clinic_creation_request(v_req);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_state := public.get_clinic_onboarding_state();
  reset role;
  if v_state->'request'->>'status' is distinct from 'approved'
     or (v_state->'request'->>'grant_is_active')::boolean is distinct from true then
    raise exception 'PLAT01R S15-state FAIL: live grant not exposed: %', v_state;
  end if;

  select authorization_id into v_auth
    from private.clinic_creation_requests where id = v_req;
  update private.clinic_creation_authorizations
     set granted_at = clock_timestamp() - interval '8 days',
         expires_at = clock_timestamp() - interval '1 minute'
   where id = v_auth;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_state := public.get_clinic_onboarding_state();
  if v_state->'request'->>'status' is distinct from 'approved'
     or (v_state->'request'->>'grant_is_active')::boolean is distinct from false then
    raise exception 'PLAT01R S15-state FAIL: expired grant still live: %', v_state;
  end if;

  v_req2 := (public.request_clinic_creation('Clinica Nova')->>'request_id')::uuid;
  v_state := public.get_clinic_onboarding_state();
  reset role;
  if v_req2 is null or v_req2 = v_req then
    raise exception 'PLAT01R S15-state FAIL: reentry blocked';
  end if;
  if v_state->'request'->>'status' is distinct from 'pending'
     or v_state->'request'->>'id' is distinct from v_req2::text then
    raise exception 'PLAT01R S15-state FAIL: pending not preferred: %', v_state;
  end if;
end $$;
rollback;
