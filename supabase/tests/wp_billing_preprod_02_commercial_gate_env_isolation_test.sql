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
  v_rep jsonb;
  v_export jsonb;
  v_timeline jsonb;
  v_bound boolean;
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

  insert into private.billing_payments (
    billing_account_id, provider, environment, external_payment_id,
    external_customer_id, provider_status, financial_state, billing_type,
    value_cents, due_date, payment_date
  ) values
    (v_sandbox, 'asaas', 'sandbox', 'pay-sbx-pp02r1', 'cus_sandbox_pp02', 'RECEIVED', 'received', 'PIX',
     39000, date '2026-09-10', date '2026-09-11'),
    (v_prod, 'asaas', 'production', 'pay-prd-pp02r1', 'cus_prod_pp02', 'RECEIVED', 'received', 'PIX',
     89000, date '2026-09-10', date '2026-09-12'),
    (v_sandbox, 'asaas', 'sandbox', 'pay-sbx-pend-pp02r1', 'cus_sandbox_pp02', 'PENDING', 'pending', 'PIX',
     1000, date '2026-09-20', null),
    (v_prod, 'asaas', 'production', 'pay-prd-pend-pp02r1', 'cus_prod_pp02', 'PENDING', 'pending', 'PIX',
     2500, date '2026-09-21', null);

  select f.customer_bound into v_bound
    from private.platform_billing_clinic_facts() f
   where f.clinic_id = v_clinic;
  if v_bound is not true then
    raise exception 'PP02R1 FAIL: both bound accounts must yield customer_bound';
  end if;

  update private.billing_accounts
     set external_customer_id = null
   where id = v_prod;
  select f.customer_bound into v_bound
    from private.platform_billing_clinic_facts() f
   where f.clinic_id = v_clinic;
  if v_bound is not true then
    raise exception 'PP02R1 FAIL: sandbox bound + production unbound must stay customer_bound';
  end if;

  update private.billing_accounts
     set external_customer_id = null
   where id = v_sandbox;
  select f.customer_bound into v_bound
    from private.platform_billing_clinic_facts() f
   where f.clinic_id = v_clinic;
  if v_bound is not false then
    raise exception 'PP02R1 FAIL: both unbound must be customer_bound false';
  end if;

  update private.billing_accounts
     set external_customer_id = 'cus_sandbox_pp02'
   where id = v_sandbox;
  update private.billing_accounts
     set external_customer_id = 'cus_prod_pp02'
   where id = v_prod;

  perform pg_temp.pp02_as(v_auth_pa);
  v_rep := public.get_platform_billing_report(date '2026-09-01', date '2026-09-30');
  if v_rep ? 'received_in_period_cents' then
    raise exception 'PP02R1 FAIL: unlabeled combined received total is still exposed';
  end if;
  if (v_rep#>>'{financial,sandbox,received_in_period_cents}')::int is distinct from 39000 then
    raise exception 'PP02R1 FAIL: sandbox received: %', v_rep->'financial';
  end if;
  if (v_rep#>>'{financial,production,received_in_period_cents}')::int is distinct from 89000 then
    raise exception 'PP02R1 FAIL: production received: %', v_rep->'financial';
  end if;
  if (v_rep#>>'{financial,sandbox,pending_in_period_cents}')::int
       is not distinct from (v_rep#>>'{financial,production,pending_in_period_cents}')::int then
    raise exception 'PP02R1 FAIL: pending buckets collapsed: %', v_rep->'financial';
  end if;

  v_export := public.list_platform_billing_report_export(
    date '2026-09-01', date '2026-09-30', 'payments', 200, 0, 'sandbox'
  );
  if exists (
    select 1
      from jsonb_array_elements(v_export->'items') item
     where item->>'environment' is distinct from 'sandbox'
  ) then
    raise exception 'PP02R1 FAIL: sandbox CSV leaked another environment: %', v_export;
  end if;
  v_export := public.list_platform_billing_report_export(
    date '2026-09-01', date '2026-09-30', 'payments', 200, 0, 'production'
  );
  if exists (
    select 1
      from jsonb_array_elements(v_export->'items') item
     where item->>'environment' is distinct from 'production'
  ) then
    raise exception 'PP02R1 FAIL: production CSV leaked another environment: %', v_export;
  end if;

  perform pg_temp.pp02_as(v_auth_owner);
  v_timeline := public.list_my_clinic_billing_timeline(v_clinic);
  if (
    select count(distinct item->>'environment')
      from jsonb_array_elements(v_timeline->'items') item
     where item->>'type' = 'payment_received'
  ) is distinct from 2 then
    raise exception 'PP02R1 FAIL: timeline payment_received missing dual environments: %', v_timeline;
  end if;

  raise notice 'PP02 PASS';
end;
$pp02$;
rollback;
