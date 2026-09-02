-- =====================================================================================
-- PLATFORM-01 · TESTES Nível 1 (BEGIN / DO pequeno / ROLLBACK).
-- HARNESS: exige 20260901090000 aplicada.
-- Login: request.jwt.claims (sub = auth_user_id) + set local role authenticated.
-- NÃO usa SET ROLE anon (isolador PG 17.6 — SIGSEGV). Anon = has_function_privilege.
-- =====================================================================================

create or replace function pg_temp.wpplat01_seed()
returns table (
  a_plat uuid, a_user uuid, a_staff uuid, a_own uuid, a_oth uuid,
  pf_plat uuid, pf_user uuid, pf_staff uuid, pf_own uuid, pf_oth uuid,
  c_exist uuid
)
language plpgsql
as $seed$
declare
  v_c uuid := gen_random_uuid();
  v_pf_plat uuid := gen_random_uuid(); v_a_plat uuid := gen_random_uuid();
  v_pf_user uuid := gen_random_uuid(); v_a_user uuid := gen_random_uuid();
  v_pf_staff uuid := gen_random_uuid(); v_a_staff uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_oth uuid := gen_random_uuid(); v_a_oth uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_plat,  v_a_plat,  'professional', 'PA PLAT01',    'pa-plat01@t.test',    'active'),
    (v_pf_user,  v_a_user,  'patient',      'User PLAT01',  'user-plat01@t.test',  'pending'),
    (v_pf_staff, v_a_staff, 'professional', 'Staff PLAT01', 'staff-plat01@t.test', 'active'),
    (v_pf_own,   v_a_own,   'professional', 'Own PLAT01',   'own-plat01@t.test',   'active'),
    (v_pf_oth,   v_a_oth,   'patient',      'Oth PLAT01',   'oth-plat01@t.test',   'pending');

  insert into public.clinics (id, name, owner_profile_id)
    values (v_c, 'Clinica Existente PLAT01', v_pf_own);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_pf_own,   v_c, 'other',        'admin',  'active'),
    (v_pf_staff, v_c, 'nutritionist', 'member', 'active');

  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (v_pf_plat, 'active', now(), null);

  insert into private.clinic_onboarding_policy (id, mode, updated_at, updated_by_profile_id)
  values (true, 'closed', clock_timestamp(), v_pf_plat)
  on conflict (id) do update
    set mode = 'closed',
        updated_at = excluded.updated_at,
        updated_by_profile_id = excluded.updated_by_profile_id;

  return query select
    v_a_plat, v_a_user, v_a_staff, v_a_own, v_a_oth,
    v_pf_plat, v_pf_user, v_pf_staff, v_pf_own, v_pf_oth,
    v_c;
end;
$seed$;


-- T1: grants — anon sem EXECUTE; authenticated tem; tabelas private fechadas.
begin;
do $$
begin
  if has_function_privilege('anon', 'public.set_clinic_onboarding_policy(text)', 'execute')
     or has_function_privilege('anon', 'public.request_clinic_creation(text)', 'execute')
     or has_function_privilege('anon', 'public.list_clinic_creation_requests()', 'execute')
     or has_function_privilege('anon', 'public.approve_clinic_creation_request(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_clinic_onboarding_state()', 'execute') then
    raise exception 'PLAT01 T1 FAIL: anon execute leaked';
  end if;
  if not has_function_privilege('authenticated', 'public.set_clinic_onboarding_policy(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.request_clinic_creation(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.approve_clinic_creation_request(uuid)', 'execute') then
    raise exception 'PLAT01 T1 FAIL: authenticated sem execute';
  end if;
  if has_table_privilege('authenticated', 'private.clinic_onboarding_policy', 'select')
     or has_table_privilege('authenticated', 'private.clinic_creation_requests', 'select')
     or has_table_privilege('anon', 'private.clinic_onboarding_policy', 'select') then
    raise exception 'PLAT01 T1 FAIL: table privilege leaked';
  end if;
  if has_function_privilege('authenticated', 'private.clinic_onboarding_mode()', 'execute')
     or has_function_privilege('authenticated', 'private.issue_clinic_creation_grant(uuid,text,uuid)', 'execute') then
    raise exception 'PLAT01 T1 FAIL: private helper execute leaked';
  end if;
end $$;
rollback;


-- S1: usuário comum tenta alterar política → NOT_PLATFORM_ADMIN
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.set_clinic_onboarding_policy('automatic');
    raise exception 'PLAT01 S1 FAIL: user alterou policy';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'NOT_PLATFORM_ADMIN' then
        raise exception 'PLAT01 S1 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- S2: admin de clínica tenta alterar política → NOT_PLATFORM_ADMIN
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_own::text)::text, true);
    set local role authenticated;
    perform public.set_clinic_onboarding_policy('automatic');
    raise exception 'PLAT01 S2 FAIL: clinic admin alterou policy';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'NOT_PLATFORM_ADMIN' then
        raise exception 'PLAT01 S2 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- S3/S4: usuário tenta aprovar a própria request / chama RPC admin
begin;
do $$
declare
  s record;
  v_hint text;
  v_req uuid;
begin
  select * into s from pg_temp.wpplat01_seed();

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('manual_review');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Pedido')->>'request_id')::uuid;
  reset role;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.approve_clinic_creation_request(v_req);
    raise exception 'PLAT01 S3 FAIL: user aprovou a própria request';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'NOT_PLATFORM_ADMIN' then
        raise exception 'PLAT01 S3 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.list_clinic_creation_requests();
    raise exception 'PLAT01 S4 FAIL: user listou requests';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'NOT_PLATFORM_ADMIN' then
        raise exception 'PLAT01 S4 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- S5: MANUAL_REVIEW — create direto sem aprovação → ONBOARDING_NOT_ALLOWED
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('manual_review');
  reset role;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Sem Aprovacao');
    raise exception 'PLAT01 S5 FAIL: create sem grant';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'PLAT01 S5 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- S6: CLOSED — create direto → ONBOARDING_CLOSED
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Closed');
    raise exception 'PLAT01 S6 FAIL: create em closed';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_CLOSED' then
        raise exception 'PLAT01 S6 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- S7: AUTOMATIC — usuário válido cria exatamente uma clínica + grant platform_policy
begin;
do $$
declare
  s record;
  v_out jsonb;
  v_src text;
  v_n int;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('automatic');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_out := public.create_clinic_with_owner('Clinica Automatica');
  reset role;

  if v_out->>'clinic_id' is null or v_out->>'professional_id' is null then
    raise exception 'PLAT01 S7 FAIL: retorno incompleto';
  end if;

  select a.source into v_src
    from private.clinic_creation_authorizations a
   where a.consumed_clinic_id = (v_out->>'clinic_id')::uuid;
  if v_src is distinct from 'platform_policy' then
    raise exception 'PLAT01 S7 FAIL: source=%', coalesce(v_src, 'null');
  end if;

  select count(*) into v_n from public.clinics where owner_profile_id = s.pf_user;
  if v_n <> 1 then
    raise exception 'PLAT01 S7 FAIL: clinics=%', v_n;
  end if;
end $$;
rollback;


-- S8: tentativa sequencial de criação dupla (mesmo profile) → no máximo uma
begin;
do $$
declare
  s record;
  v_hint text;
  v_n int;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('automatic');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  perform public.create_clinic_with_owner('Clinica Uma');
  begin
    perform public.create_clinic_with_owner('Clinica Duas');
    raise exception 'PLAT01 S8 FAIL: segunda clinica criada';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ALREADY_OWNS_CLINIC' then
        raise exception 'PLAT01 S8 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;

  select count(*) into v_n from public.clinics where owner_profile_id = s.pf_user;
  if v_n <> 1 then
    raise exception 'PLAT01 S8 FAIL: clinics=%', v_n;
  end if;
end $$;
rollback;


-- S9: double approve é idempotente
begin;
do $$
declare
  s record;
  v_req uuid;
  a1 jsonb;
  a2 jsonb;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('manual_review');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Approve')->>'request_id')::uuid;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  a1 := public.approve_clinic_creation_request(v_req);
  a2 := public.approve_clinic_creation_request(v_req);
  reset role;

  if a1->>'authorization_id' is distinct from a2->>'authorization_id' then
    raise exception 'PLAT01 S9 FAIL: authorize divergente';
  end if;
  if a1->>'status' is distinct from 'approved' or a2->>'status' is distinct from 'approved' then
    raise exception 'PLAT01 S9 FAIL: status';
  end if;
end $$;
rollback;


-- S10: duplicate request → uma pending
begin;
do $$
declare
  s record;
  v_hint text;
  v_n int;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('manual_review');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  perform public.request_clinic_creation('Clinica Dup');
  begin
    perform public.request_clinic_creation('Clinica Dup 2');
    raise exception 'PLAT01 S10 FAIL: segunda pending';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'REQUEST_ALREADY_PENDING' then
        raise exception 'PLAT01 S10 FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;

  select count(*) into v_n
    from private.clinic_creation_requests
   where requester_profile_id = s.pf_user and status = 'pending';
  if v_n <> 1 then
    raise exception 'PLAT01 S10 FAIL: pending=%', v_n;
  end if;
end $$;
rollback;


-- S11: request não aceita target de terceiro — requester é sempre o chamador
begin;
do $$
declare
  s record;
  v_req uuid;
  v_owner uuid;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('manual_review');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Minha')->>'request_id')::uuid;
  reset role;

  select requester_profile_id into v_owner
    from private.clinic_creation_requests where id = v_req;
  if v_owner is distinct from s.pf_user then
    raise exception 'PLAT01 S11 FAIL: requester forjado';
  end if;
  if pg_get_function_identity_arguments('public.request_clinic_creation(text)'::regprocedure)
     ~* 'profile' then
    raise exception 'PLAT01 S11 FAIL: request aceita profile_id';
  end if;
end $$;
rollback;


-- S12: list_clinic_creation_requests projection sem dado clínico
begin;
do $$
declare
  s record;
  v_args text;
begin
  select * into s from pg_temp.wpplat01_seed();
  v_args := pg_get_function_result('public.list_clinic_creation_requests()'::regprocedure);
  if v_args ~* 'patient|chat|diagnos|adherence|join_code' then
    raise exception 'PLAT01 S12 FAIL: projection clínica: %', v_args;
  end if;
  if position('requester_email' in v_args) = 0
     or position('requested_clinic_name' in v_args) = 0 then
    raise exception 'PLAT01 S12 FAIL: faltou coluna mínima';
  end if;
end $$;
rollback;


-- CLOSED: request também bloqueada; join path (request_clinic_access) NÃO é este WP
begin;
do $$
declare
  s record;
  v_hint text;
begin
  select * into s from pg_temp.wpplat01_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.request_clinic_creation('Clinica Closed Req');
    raise exception 'PLAT01 CLOSED REQ FAIL';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_CLOSED' then
        raise exception 'PLAT01 CLOSED REQ FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- MANUAL_REVIEW feliz: request → approve → create
begin;
do $$
declare
  s record;
  v_req uuid;
  v_out jsonb;
  v_n int;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('manual_review');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Feliz')->>'request_id')::uuid;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.approve_clinic_creation_request(v_req);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_out := public.create_clinic_with_owner('Clinica Feliz');
  reset role;

  select count(*) into v_n from public.clinics where id = (v_out->>'clinic_id')::uuid
    and owner_profile_id = s.pf_user;
  if v_n <> 1 then
    raise exception 'PLAT01 HAPPY FAIL: clinic not owned';
  end if;

  if not exists (
    select 1 from private.clinic_creation_requests
     where id = v_req and created_clinic_id = (v_out->>'clinic_id')::uuid
  ) then
    raise exception 'PLAT01 HAPPY FAIL: request nao vinculou clinica';
  end if;
end $$;
rollback;


-- Recusa + motivo; usuário não cria
begin;
do $$
declare
  s record;
  v_req uuid;
  v_hint text;
  v_reason text;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('manual_review');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Recusada')->>'request_id')::uuid;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.reject_clinic_creation_request(v_req, 'Fora do perfil');
  reset role;

  select rejection_reason into v_reason from private.clinic_creation_requests where id = v_req;
  if v_reason is distinct from 'Fora do perfil' then
    raise exception 'PLAT01 REJECT FAIL: reason';
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
    set local role authenticated;
    perform public.create_clinic_with_owner('Clinica Recusada');
    raise exception 'PLAT01 REJECT FAIL: create apos recusa';
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      reset role;
      if v_hint is distinct from 'ONBOARDING_NOT_ALLOWED' then
        raise exception 'PLAT01 REJECT FAIL: hint=%', coalesce(v_hint, 'null');
      end if;
  end;
end $$;
rollback;


-- Race: create não estampa request já rejected (não viola decision_check)
begin;
do $$
declare
  s record;
  v_req uuid;
  v_out jsonb;
  v_status text;
  v_clinic uuid;
begin
  select * into s from pg_temp.wpplat01_seed();
  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.set_clinic_onboarding_policy('manual_review');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_req := (public.request_clinic_creation('Clinica Race')->>'request_id')::uuid;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_plat::text)::text, true);
  set local role authenticated;
  perform public.reject_clinic_creation_request(v_req, 'recusa concorrente');
  perform public.set_clinic_onboarding_policy('automatic');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', s.a_user::text)::text, true);
  set local role authenticated;
  v_out := public.create_clinic_with_owner('Clinica Apos Recusa');
  reset role;

  if v_out->>'clinic_id' is null then
    raise exception 'PLAT01 RACE FAIL: create abortou';
  end if;
  select status, created_clinic_id into v_status, v_clinic
    from private.clinic_creation_requests where id = v_req;
  if v_status is distinct from 'rejected' or v_clinic is not null then
    raise exception 'PLAT01 RACE FAIL: request rejected foi alterada';
  end if;
end $$;
rollback;


-- Default fail-closed: singleton existe e clinic_onboarding_mode coalesce closed
begin;
do $$
begin
  if to_regclass('private.clinic_onboarding_policy') is null then
    raise exception 'PLAT01 POLICY FAIL: table missing';
  end if;
  if private.clinic_onboarding_mode() not in ('automatic', 'manual_review', 'closed') then
    raise exception 'PLAT01 POLICY FAIL: mode invalido';
  end if;
end $$;
rollback;
