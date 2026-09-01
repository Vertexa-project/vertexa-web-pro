-- =====================================================================================
-- PLATFORM-01R · TESTES Nível 1 (BEGIN / ROLLBACK).
-- HARNESS: exige 20260901220930 aplicada.
-- =====================================================================================

create or replace function pg_temp.wpplat01r_seed()
returns table (
  a_plat uuid, a_user uuid, a_user2 uuid,
  pf_plat uuid, pf_user uuid, pf_user2 uuid
)
language plpgsql
as $seed$
declare
  v_pf_plat uuid := gen_random_uuid(); v_a_plat uuid := gen_random_uuid();
  v_pf_user uuid := gen_random_uuid(); v_a_user uuid := gen_random_uuid();
  v_pf_user2 uuid := gen_random_uuid(); v_a_user2 uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_plat,  v_a_plat,  'professional', 'PA PLAT01R',   'pa-plat01r@t.test',   'active'),
    (v_pf_user,  v_a_user,  'patient',      'User PLAT01R', 'user-plat01r@t.test', 'pending'),
    (v_pf_user2, v_a_user2, 'patient',      'User2 PLAT01R','user2-plat01r@t.test','pending');
  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (v_pf_plat, 'active', now(), null);
  insert into private.clinic_onboarding_policy (id, mode, updated_at, updated_by_profile_id)
  values (true, 'manual_review', clock_timestamp(), v_pf_plat)
  on conflict (id) do update
    set mode = 'manual_review',
        updated_at = excluded.updated_at,
        updated_by_profile_id = excluded.updated_by_profile_id;
  return query select v_a_plat, v_a_user, v_a_user2, v_pf_plat, v_pf_user, v_pf_user2;
end;
$seed$;


-- S13: request A → approve → create B ⇒ APPROVED_CLINIC_NAME_MISMATCH
begin;
do $$
declare
  s record;
  v_req uuid;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01r_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Alpha')->>'request_id')::uuid;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.approve_clinic_creation_request(v_req);
  reset role;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Beta');
    raise exception 'PLAT01R S13 FAIL: mismatch allowed';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'APPROVED_CLINIC_NAME_MISMATCH' then
        raise exception 'PLAT01R S13 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;

  if exists (select 1 from public.clinics c where c.owner_profile_id = s.pf_user) then
    raise exception 'PLAT01R S13 FAIL: clinic created';
  end if;
  if exists (
    select 1 from private.clinic_creation_authorizations a
     where a.target_profile_id = s.pf_user and a.consumed_at is not null
  ) then
    raise exception 'PLAT01R S13 FAIL: grant consumed on mismatch';
  end if;
end $$;
rollback;


-- S13b: casing/whitespace do nome aprovado é aceito
begin;
do $$
declare
  s record;
  v_req uuid;
  v_out jsonb;
begin
  select * into s from pg_temp.wpplat01r_seed();
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
  v_out := public.create_clinic_with_owner('  clinica alpha  ');
  reset role;
  if v_out->>'clinic_id' is null then
    raise exception 'PLAT01R S13b FAIL: equivalent name denied';
  end if;
end $$;
rollback;


-- S14: request → approve (grant válido) → nova request ⇒ REQUEST_ALREADY_APPROVED
begin;
do $$
declare
  s record;
  v_req uuid;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01r_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Alpha')->>'request_id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.approve_clinic_creation_request(v_req);
  reset role;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_creation('Clinica Gamma');
    raise exception 'PLAT01R S14 FAIL: second request allowed';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'REQUEST_ALREADY_APPROVED' then
        raise exception 'PLAT01R S14 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- S15: grant aprovado expirado e não consumido ⇒ nova request permitida
begin;
do $$
declare
  s record;
  v_req uuid;
  v_req2 uuid;
  v_auth uuid;
begin
  select * into s from pg_temp.wpplat01r_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Alpha')->>'request_id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.approve_clinic_creation_request(v_req);
  reset role;

  select authorization_id into v_auth
    from private.clinic_creation_requests where id = v_req;
  update private.clinic_creation_authorizations
     set granted_at = clock_timestamp() - interval '8 days',
         expires_at = clock_timestamp() - interval '1 minute'
   where id = v_auth;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req2 := (public.request_clinic_creation('Clinica Nova')->>'request_id')::uuid;
  reset role;
  if v_req2 is null or v_req2 = v_req then
    raise exception 'PLAT01R S15 FAIL: reentry blocked';
  end if;
end $$;
rollback;


-- S16: duas requests — no máximo uma pending
begin;
do $$
declare
  s record;
  v_hint text;
  v_n int;
begin
  select * into s from pg_temp.wpplat01r_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  perform public.request_clinic_creation('Clinica Um');
  begin
    perform public.request_clinic_creation('Clinica Dois');
    raise exception 'PLAT01R S16 FAIL: two pending';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'REQUEST_ALREADY_PENDING' then
        raise exception 'PLAT01R S16 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
  select count(*) into v_n
    from private.clinic_creation_requests
   where requester_profile_id = s.pf_user and status = 'pending';
  if v_n <> 1 then
    raise exception 'PLAT01R S16 FAIL: pending=%', v_n;
  end if;
end $$;
rollback;


-- S17: request após create aprovado em andamento/concluído — estado consistente
begin;
do $$
declare
  s record;
  v_req uuid;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01r_seed();
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
  perform public.create_clinic_with_owner('Clinica Alpha');
  begin
    perform public.request_clinic_creation('Outra');
    raise exception 'PLAT01R S17 FAIL: request after create';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ALREADY_OWNS_CLINIC' then
        raise exception 'PLAT01R S17 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;
