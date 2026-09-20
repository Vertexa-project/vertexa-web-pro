-- =====================================================================================
-- WP-BILLING-PRODUCT-02 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260920130011 aplicada (R1). Não muta QA live.
-- Fixtures sintéticos. Sem HTTP Asaas. Sem QR. Sem entitlement grant.
-- =====================================================================================

create or replace function pg_temp.bp02_seed()
returns table (
  clinic_a uuid,
  clinic_b uuid,
  owner_a uuid,
  auth_owner_a uuid,
  admin_a uuid,
  auth_admin_a uuid,
  member_a uuid,
  auth_member_a uuid,
  owner_b uuid,
  auth_owner_b uuid,
  patient_a uuid,
  auth_patient_a uuid,
  pa_profile uuid,
  auth_pa uuid
)
language plpgsql
as $seed$
declare
  v_clinic_a uuid := gen_random_uuid();
  v_clinic_b uuid := gen_random_uuid();
  v_owner_a uuid := gen_random_uuid();
  v_auth_owner_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_auth_admin_a uuid := gen_random_uuid();
  v_member_a uuid := gen_random_uuid();
  v_auth_member_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_auth_owner_b uuid := gen_random_uuid();
  v_patient uuid := gen_random_uuid();
  v_auth_patient uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid();
  v_auth_pa uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values
    (v_owner_a, v_auth_owner_a, 'professional', 'Owner A BP02', 'own-a-bp02@t.test', 'active'),
    (v_admin_a, v_auth_admin_a, 'professional', 'Admin A BP02', 'adm-a-bp02@t.test', 'active'),
    (v_member_a, v_auth_member_a, 'professional', 'Member A BP02', 'mem-a-bp02@t.test', 'active'),
    (v_owner_b, v_auth_owner_b, 'professional', 'Owner B BP02', 'own-b-bp02@t.test', 'active'),
    (v_patient, v_auth_patient, 'patient', 'Patient A BP02', 'pat-a-bp02@t.test', 'active'),
    (v_pa, v_auth_pa, 'professional', 'PA BP02', 'pa-bp02@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id)
  values
    (v_clinic_a, 'Clinica BP02 A', v_owner_a),
    (v_clinic_b, 'Clinica BP02 B', v_owner_b);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values
    (v_admin_a, v_clinic_a, 'nutritionist', 'admin'),
    (v_member_a, v_clinic_a, 'nutritionist', 'member');

  insert into private.platform_admins (profile_id, status)
  values (v_pa, 'active');

  return query select
    v_clinic_a, v_clinic_b, v_owner_a, v_auth_owner_a,
    v_admin_a, v_auth_admin_a, v_member_a, v_auth_member_a,
    v_owner_b, v_auth_owner_b, v_patient, v_auth_patient,
    v_pa, v_auth_pa;
end;
$seed$;

create or replace function pg_temp.bp02_as(p_auth uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth::text)::text, true);
end;
$$;

create or replace function pg_temp.bp02_plan(p_code text)
returns uuid
language sql
as $$
  select pv.id
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = p_code
   order by pv.version desc
   limit 1;
$$;


-- T1: grants fail-closed
begin;
do $$
begin
  if has_function_privilege('anon', 'public.list_sellable_billing_plans()', 'execute')
     or has_function_privilege('anon', 'public.get_my_clinic_commercial_checkout(uuid)', 'execute')
     or has_function_privilege('anon', 'public.create_my_clinic_commercial_contract(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.ensure_my_clinic_billing_account(uuid)', 'execute') then
    raise exception 'BP02 T1 FAIL: anon execute';
  end if;
  if has_function_privilege('service_role', 'public.list_sellable_billing_plans()', 'execute')
     or has_function_privilege('service_role', 'public.create_my_clinic_commercial_contract(uuid,uuid)', 'execute') then
    raise exception 'BP02 T1 FAIL: service_role execute';
  end if;
  if not has_function_privilege('authenticated', 'public.list_sellable_billing_plans()', 'execute')
     or not has_function_privilege('authenticated', 'public.create_my_clinic_commercial_contract(uuid,uuid)', 'execute') then
    raise exception 'BP02 T1 FAIL: authenticated sem execute';
  end if;
end $$;
rollback;


-- T2: catalog safe read + founder blocked + server list price
begin;
do $$
declare
  s record;
  v_cat jsonb;
  v_codes text;
  v_pulse int;
begin
  select * into s from pg_temp.bp02_seed();
  perform pg_temp.bp02_as(s.auth_owner_a);
  v_cat := public.list_sellable_billing_plans();
  if v_cat ->> 'founder_checkout' is distinct from 'OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY' then
    raise exception 'BP02 T2 FAIL: founder gate';
  end if;
  select string_agg(x ->> 'code', ',') into v_codes
    from jsonb_array_elements(v_cat -> 'plans') x;
  if v_codes not like '%pulse%' or v_codes like '%founder%' then
    raise exception 'BP02 T2 FAIL: catalog codes=%', v_codes;
  end if;
  select (x ->> 'price_cents')::int into v_pulse
    from jsonb_array_elements(v_cat -> 'plans') x
   where x ->> 'code' = 'pulse';
  if v_pulse is distinct from 39000 then
    raise exception 'BP02 T2 FAIL: pulse price=%', v_pulse;
  end if;
  if v_cat::text ~* 'asaas|cus_|external_customer|founder_2026' then
    raise exception 'BP02 T2 FAIL: leaked provider/founder';
  end if;
end $$;
rollback;


-- T3: authority — owner/admin ok, member/patient/other/PA/anon mutation forbidden
begin;
do $$
declare
  s record;
  v_err text;
begin
  select * into s from pg_temp.bp02_seed();

  perform pg_temp.bp02_as(s.auth_member_a);
  begin
    perform public.create_my_clinic_commercial_contract(s.clinic_a, pg_temp.bp02_plan('pulse'));
    raise exception 'BP02 T3 FAIL: member criou contrato';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%BILLING_NOT_CLINIC_ADMIN%' and v_err not like '%not owned%' then
        if sqlstate not in ('42501') then
          raise exception 'BP02 T3 FAIL: member err=% / %', sqlstate, v_err;
        end if;
      end if;
  end;

  perform pg_temp.bp02_as(s.auth_patient_a);
  begin
    perform public.upsert_my_clinic_billing_identity(s.clinic_a, 'Paciente', '99991111140', 'p@t.test', null);
    raise exception 'BP02 T3 FAIL: patient upsert';
  exception
    when others then
      if sqlstate not in ('42501') then
        raise exception 'BP02 T3 FAIL: patient sqlstate=%', sqlstate;
      end if;
  end;

  perform pg_temp.bp02_as(s.auth_owner_b);
  begin
    perform public.get_my_clinic_commercial_checkout(s.clinic_a);
    raise exception 'BP02 T3 FAIL: other clinic checkout';
  exception
    when others then
      if sqlstate not in ('42501') then
        raise exception 'BP02 T3 FAIL: cross-tenant sqlstate=%', sqlstate;
      end if;
  end;

  perform pg_temp.bp02_as(s.auth_pa);
  begin
    perform public.create_my_clinic_commercial_contract(s.clinic_a, pg_temp.bp02_plan('pulse'));
    raise exception 'BP02 T3 FAIL: PA criou contrato tenant';
  exception
    when others then
      if sqlstate not in ('42501') then
        raise exception 'BP02 T3 FAIL: PA sqlstate=%', sqlstate;
      end if;
  end;

  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.list_sellable_billing_plans();
    raise exception 'BP02 T3 FAIL: anon catalog';
  exception
    when others then
      if sqlstate not in ('42501') then
        raise exception 'BP02 T3 FAIL: anon sqlstate=%', sqlstate;
      end if;
  end;
end $$;
rollback;


-- T4: identity owner + co-admin, invalid tax, completeness
begin;
do $$
declare
  s record;
  v_row jsonb;
begin
  select * into s from pg_temp.bp02_seed();
  perform pg_temp.bp02_as(s.auth_owner_a);
  begin
    perform public.upsert_my_clinic_billing_identity(s.clinic_a, 'Clinica A', '11111111111', 'a@t.test', null);
    raise exception 'BP02 T4 FAIL: invalid tax accepted';
  exception
    when others then
      if sqlerrm not like '%BILLING_INVALID_TAX_ID%' then
        raise exception 'BP02 T4 FAIL: invalid tax err=%', sqlerrm;
      end if;
  end;

  v_row := public.upsert_my_clinic_billing_identity(s.clinic_a, 'Clinica A BP02', '99991111140', 'a@t.test', null);
  if v_row ->> 'is_complete' is distinct from 'true' then
    raise exception 'BP02 T4 FAIL: owner completeness';
  end if;

  perform pg_temp.bp02_as(s.auth_admin_a);
  v_row := public.upsert_my_clinic_billing_identity(s.clinic_a, 'Clinica A Admin', '99991111140', 'admin-a@t.test', '11999999999');
  if v_row ->> 'is_complete' is distinct from 'true' then
    raise exception 'BP02 T4 FAIL: admin completeness';
  end if;
end $$;
rollback;


-- T5: contract snapshot, idempotency, no pix/customer/entitlement
begin;
do $$
declare
  s record;
  v_first jsonb;
  v_second jsonb;
  v_price int;
  v_auths int;
  v_customer text;
  v_ents int;
begin
  select * into s from pg_temp.bp02_seed();
  perform pg_temp.bp02_as(s.auth_admin_a);
  perform public.upsert_my_clinic_billing_identity(s.clinic_a, 'Clinica A BP02', '99991111140', 'a@t.test', null);

  v_first := public.create_my_clinic_commercial_contract(s.clinic_a, pg_temp.bp02_plan('pulse'));
  v_second := public.create_my_clinic_commercial_contract(s.clinic_a, pg_temp.bp02_plan('pulse'));
  if v_first -> 'commercial_contract' ->> 'id'
     is distinct from v_second -> 'commercial_contract' ->> 'id' then
    raise exception 'BP02 T5 FAIL: idempotency criou segundo contrato';
  end if;
  if v_first -> 'commercial_contract' ->> 'status' is distinct from 'active' then
    raise exception 'BP02 T5 FAIL: status=%', v_first -> 'commercial_contract' ->> 'status';
  end if;

  v_price := (v_first -> 'commercial_contract' ->> 'price_cents')::int;
  if v_price is distinct from 39000 then
    raise exception 'BP02 T5 FAIL: snapshot price=% (founder?)', v_price;
  end if;

  begin
    perform public.create_my_clinic_commercial_contract(s.clinic_a, pg_temp.bp02_plan('sync'));
    raise exception 'BP02 T5 FAIL: plan change aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_ACTIVE_CONTRACT_EXISTS%' then
        raise exception 'BP02 T5 FAIL: duplicate err=%', sqlerrm;
      end if;
  end;

  select count(*) into v_auths
    from private.billing_pix_automatic_authorizations a
    join private.billing_commercial_contracts cc on cc.id = a.commercial_contract_id
   where cc.clinic_id = s.clinic_a;
  if v_auths <> 0 then
    raise exception 'BP02 T5 FAIL: pix auth created=%', v_auths;
  end if;

  select a.external_customer_id into v_customer
    from private.billing_accounts a
   where a.clinic_id = s.clinic_a;
  if v_customer is not null then
    raise exception 'BP02 T5 FAIL: provider customer created';
  end if;
  if not (v_first ->> 'local_billing_account_exists')::boolean then
    raise exception 'BP02 T5 FAIL: local account missing';
  end if;
  if (v_first ->> 'entitlement_granted')::boolean then
    raise exception 'BP02 T5 FAIL: entitlement granted';
  end if;

  select count(*) into v_ents
    from private.billing_commercial_contracts cc
   where cc.clinic_id = s.clinic_a
     and cc.status = 'active';
  if v_ents <> 1 then
    raise exception 'BP02 T5 FAIL: active contracts=%', v_ents;
  end if;
end $$;
rollback;


-- T6: ensure account is sandbox-only and clinic-admin capable
begin;
do $$
declare
  s record;
  v_env text;
  v_owner uuid;
begin
  select * into s from pg_temp.bp02_seed();
  perform pg_temp.bp02_as(s.auth_admin_a);
  perform public.ensure_my_clinic_billing_account(s.clinic_a);
  select a.environment, a.owner_profile_id into v_env, v_owner
    from private.billing_accounts a
   where a.clinic_id = s.clinic_a;
  if v_env is distinct from 'sandbox' then
    raise exception 'BP02 T6 FAIL: env=%', v_env;
  end if;
  if v_owner is distinct from s.owner_a then
    raise exception 'BP02 T6 FAIL: account owner is caller admin';
  end if;

  begin
    perform public.get_or_create_billing_account('asaas', 'production', s.clinic_a);
    raise exception 'BP02 T6 FAIL: production clinic account accepted';
  exception
    when others then
      if sqlerrm not like '%BILLING_PRODUCTION_LOCKED%' then
        raise exception 'BP02 T6 FAIL: production err=%', sqlerrm;
      end if;
  end;

  insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
  values (s.owner_b, s.clinic_b, 'asaas', 'production');
  perform pg_temp.bp02_as(s.auth_owner_b);
  begin
    perform public.ensure_my_clinic_billing_account(s.clinic_b);
    raise exception 'BP02 T6 FAIL: ensure adopted production account';
  exception
    when others then
      if sqlerrm not like '%BILLING_PRODUCTION_LOCKED%' then
        raise exception 'BP02 T6 FAIL: ensure production err=%', sqlerrm;
      end if;
  end;
end $$;
rollback;
