-- =====================================================================================
-- WP-BILLING-PREPROD-02 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- Harness local. Não muta QA live. Sem HTTP Asaas. Sem apply remoto.
begin;
-- =====================================================================================

create or replace function pg_temp.pp02_as(p_auth uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth::text)::text, true);
end;
$$;

do $pp02$
declare
  v_clinic uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_auth_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_auth_member uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid();
  v_auth_pa uuid := gen_random_uuid();
  v_sandbox uuid;
  v_prod uuid;
  v_access jsonb;
  v_exemption uuid;
  v_mode text;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values
    (v_owner, v_auth_owner, 'professional', 'PP02 Owner', 'pp02-own@t.test', 'active'),
    (v_member, v_auth_member, 'professional', 'PP02 Member', 'pp02-mem@t.test', 'active'),
    (v_pa, v_auth_pa, 'professional', 'PP02 PA', 'pp02-pa@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id)
  values (v_clinic, 'Clinica PP02 Dual', v_owner);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values (v_member, v_clinic, 'nutritionist', 'member');

  insert into private.platform_admins (profile_id, status) values (v_pa, 'active');

  insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment, external_customer_id)
  values (v_owner, v_clinic, 'asaas', 'sandbox', 'cus_sandbox_pp02')
  returning id into v_sandbox;
  insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment, external_customer_id)
  values (v_owner, v_clinic, 'asaas', 'production', 'cus_prod_pp02')
  returning id into v_prod;

  if v_sandbox is null or v_prod is null or v_sandbox = v_prod then
    raise exception 'PP02 FAIL: dual-env accounts were not distinct';
  end if;

  begin
    insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
    values (v_owner, v_clinic, 'asaas', 'sandbox');
    raise exception 'PP02 FAIL: third sandbox account was accepted';
  exception
    when unique_violation then
      null;
  end;

  begin
    update private.billing_accounts set environment = 'production' where id = v_sandbox;
    raise exception 'PP02 FAIL: sandbox environment mutation was accepted';
  exception
    when others then
      if sqlerrm not like '%BILLING_ACCOUNT_ENVIRONMENT_IMMUTABLE%' then
        raise;
      end if;
  end;

  -- OBSERVE: no contract still product_allowed.
  v_access := private.billing_resolve_commercial_access(v_clinic);
  if v_access->>'reason' is distinct from 'OBSERVE_ONLY'
     or (v_access->>'product_allowed')::boolean is not true then
    raise exception 'PP02 FAIL: OBSERVE did not preserve access: %', v_access;
  end if;

  -- Clinic Admin cannot flip mode.
  perform pg_temp.pp02_as(v_auth_owner);
  begin
    perform public.set_platform_commercial_access_mode('enforce');
    raise exception 'PP02 FAIL: clinic admin flipped OBSERVE/ENFORCE';
  exception
    when others then
      if sqlerrm not like '%BILLING_NOT_PLATFORM_ADMIN%' then
        raise;
      end if;
  end;

  -- Clinic Admin cannot grant exemption.
  begin
    perform public.grant_platform_commercial_access_exemption(v_clinic, 'self grant attempt');
    raise exception 'PP02 FAIL: clinic admin granted itself an exemption';
  exception
    when others then
      if sqlerrm not like '%BILLING_NOT_PLATFORM_ADMIN%' then
        raise;
      end if;
  end;

  -- PA ENFORCE then no-contract clinic is blocked.
  perform pg_temp.pp02_as(v_auth_pa);
  perform public.set_platform_commercial_access_mode('enforce');
  v_access := private.billing_resolve_commercial_access(v_clinic);
  if v_access->>'reason' is distinct from 'NO_ACTIVE_CONTRACT'
     or (v_access->>'product_allowed')::boolean is not false then
    raise exception 'PP02 FAIL: ENFORCE did not restrict: %', v_access;
  end if;

  -- Expired exemption does not grant.
  insert into private.billing_commercial_access_exemptions (
    clinic_id, reason, created_by, expires_at
  ) values (v_clinic, 'expired demo access', v_pa, clock_timestamp() - interval '1 day');
  v_access := private.billing_resolve_commercial_access(v_clinic);
  if (v_access->>'product_allowed')::boolean is not false then
    raise exception 'PP02 FAIL: expired exemption still granted';
  end if;

  -- Active exemption grants EXEMPT.
  v_exemption := (
    select (public.grant_platform_commercial_access_exemption(
      v_clinic, 'internal demo clinic', null
    )->>'exemption_id')::uuid
  );
  v_access := private.billing_resolve_commercial_access(v_clinic);
  if v_access->>'reason' is distinct from 'PLATFORM_EXEMPTION' then
    raise exception 'PP02 FAIL: active exemption did not grant: %', v_access;
  end if;

  perform public.revoke_platform_commercial_access_exemption(v_exemption);
  v_access := private.billing_resolve_commercial_access(v_clinic);
  if (v_access->>'product_allowed')::boolean is not false then
    raise exception 'PP02 FAIL: revoked exemption still granted';
  end if;

  -- Production write remains LOCKED.
  if private.billing_production_write_allowed(v_clinic, 'ENSURE_CUSTOMER_FROM_IDENTITY') then
    raise exception 'PP02 FAIL: Production write allowed while LOCKED';
  end if;

  -- Restore OBSERVE default for the transaction remainder.
  perform public.set_platform_commercial_access_mode('observe');
  select rollout_mode into v_mode from private.billing_commercial_access_config where id;
  if v_mode is distinct from 'observe' then
    raise exception 'PP02 FAIL: could not restore OBSERVE';
  end if;

  raise notice 'PP02 PASS';
end;
$pp02$;
rollback;
