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
  v_plan_version uuid;
  v_contract uuid := gen_random_uuid();
  v_pix_sbx uuid;
  v_pix_prd uuid;
  v_facts jsonb;
  v_overview jsonb;
  v_hub jsonb;
  v_today date;
  v_lookup uuid;
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

  -- Account lookup must never cross environments.
  v_lookup := (private.billing_account_for_clinic(v_clinic, 'sandbox')).id;
  if v_lookup is distinct from v_sandbox then
    raise exception 'PP02 FAIL: sandbox lookup mismatched: % vs %', v_lookup, v_sandbox;
  end if;
  v_lookup := (private.billing_account_for_clinic(v_clinic, 'production')).id;
  if v_lookup is distinct from v_prod then
    raise exception 'PP02 FAIL: production lookup mismatched: % vs %', v_lookup, v_prod;
  end if;
  if (private.billing_account_for_clinic(v_clinic, 'sandbox')).id
       = (private.billing_account_for_clinic(v_clinic, 'production')).id then
    raise exception 'PP02 FAIL: sandbox lookup resolved production account';
  end if;

  -- Write-guard CANARY fixture (restored to LOCKED before commit/rollback).
  perform public.set_platform_provider_write_mode('canary');
  if private.billing_production_write_allowed(v_clinic, 'ENSURE_CUSTOMER_FROM_IDENTITY') then
    raise exception 'PP02 FAIL: canary without allowlist still allowed write';
  end if;
  perform public.set_platform_provider_write_canary(
    v_clinic, array['ENSURE_CUSTOMER_FROM_IDENTITY']::text[]
  );
  if not private.billing_production_write_allowed(v_clinic, 'ENSURE_CUSTOMER_FROM_IDENTITY') then
    raise exception 'PP02 FAIL: canary allowlisted ENSURE write denied';
  end if;
  if private.billing_production_write_allowed(v_clinic, 'PIX_AUTOMATIC_CREATE') then
    raise exception 'PP02 FAIL: canary non-allowlisted PIX write allowed';
  end if;
  delete from private.billing_provider_write_canary_clinics where clinic_id = v_clinic;
  perform public.set_platform_provider_write_mode('locked');
  if private.billing_production_write_allowed(v_clinic, 'ENSURE_CUSTOMER_FROM_IDENTITY') then
    raise exception 'PP02 FAIL: write mode not restored to LOCKED';
  end if;

  -- Contract + Pix auth before payments (ledger_source_check requires pix or subscription).
  v_today := private.billing_hub_business_date();
  select pv.id into v_plan_version
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse'
   order by pv.version desc
   limit 1;
  if v_plan_version is null then
    raise exception 'PP02R2 FAIL: pulse plan version missing';
  end if;

  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  ) values (v_contract, v_clinic, v_plan_version, 39000, 'BRL', 'monthly', 'active', now());

  v_access := private.billing_resolve_commercial_access(v_clinic);
  if v_access->>'reason' is distinct from 'ACTIVE_CONTRACT'
     or (v_access->>'product_allowed')::boolean is not true then
    raise exception 'PP02 FAIL: active contract did not grant full access: %', v_access;
  end if;

  insert into private.billing_pix_automatic_authorizations (
    commercial_contract_id, billing_account_id, environment,
    provider_status, is_primary, provider_contract_id, generation
  ) values
    (v_contract, v_sandbox, 'sandbox', 'ACTIVE', true, replace(v_contract::text, '-', ''), 1)
  returning id into v_pix_sbx;
  insert into private.billing_pix_automatic_authorizations (
    commercial_contract_id, billing_account_id, environment,
    provider_status, is_primary, provider_contract_id, generation
  ) values
    (
      v_contract, v_prod, 'production', 'CREATED', true,
      replace(gen_random_uuid()::text, '-', ''), 1
    )
  returning id into v_pix_prd;

  insert into private.billing_payments (
    billing_account_id, provider, environment, external_payment_id,
    external_customer_id, provider_status, financial_state, billing_type,
    value_cents, due_date, payment_date, pix_authorization_id
  ) values
    (v_sandbox, 'asaas', 'sandbox', 'pay-sbx-pp02r1', 'cus_sandbox_pp02', 'RECEIVED', 'received', 'PIX',
     39000, date '2026-09-10', date '2026-09-11', v_pix_sbx),
    (v_prod, 'asaas', 'production', 'pay-prd-pp02r1', 'cus_prod_pp02', 'RECEIVED', 'received', 'PIX',
     89000, date '2026-09-10', date '2026-09-12', v_pix_prd),
    (v_sandbox, 'asaas', 'sandbox', 'pay-sbx-pend-pp02r1', 'cus_sandbox_pp02', 'PENDING', 'pending', 'PIX',
     1000, date '2026-09-20', null, v_pix_sbx),
    (v_prod, 'asaas', 'production', 'pay-prd-pend-pp02r1', 'cus_prod_pp02', 'PENDING', 'pending', 'PIX',
     2500, date '2026-09-21', null, v_pix_prd);

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
  -- Live Sandbox already has payments; Production has none — assert split, not absolute sandbox cents.
  if (v_rep#>>'{financial,sandbox,received_in_period_cents}')::int < 39000 then
    raise exception 'PP02R1 FAIL: sandbox received missing fixture: %', v_rep->'financial';
  end if;
  if (v_rep#>>'{financial,production,received_in_period_cents}')::int is distinct from 89000 then
    raise exception 'PP02R1 FAIL: production received: %', v_rep->'financial';
  end if;
  if (v_rep#>>'{financial,sandbox,received_in_period_cents}')::int
       = (v_rep#>>'{financial,production,received_in_period_cents}')::int then
    raise exception 'PP02R1 FAIL: received buckets collapsed: %', v_rep->'financial';
  end if;
  if (v_rep#>>'{financial,production,pending_in_period_cents}')::int is distinct from 2500 then
    raise exception 'PP02R1 FAIL: production pending: %', v_rep->'financial';
  end if;
  if (v_rep#>>'{financial,sandbox,pending_in_period_cents}')::int
       is not distinct from (v_rep#>>'{financial,production,pending_in_period_cents}')::int
     and (v_rep#>>'{financial,production,pending_in_period_cents}')::int > 0 then
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

  -- R2: conflicting dual-env provider facts for the same clinic.
  update private.billing_payments
     set payment_date = date '2026-09-20'
   where external_payment_id = 'pay-sbx-pp02r1';
  update private.billing_payments
     set payment_date = date '2026-09-01'
   where external_payment_id = 'pay-prd-pp02r1';
  update private.billing_payments
     set due_date = date '2026-09-25'
   where external_payment_id = 'pay-sbx-pend-pp02r1';
  update private.billing_payments
     set due_date = date '2026-09-28'
   where external_payment_id = 'pay-prd-pend-pp02r1';

  insert into private.billing_payments (
    billing_account_id, provider, environment, external_payment_id,
    external_customer_id, provider_status, financial_state, billing_type,
    value_cents, due_date, payment_date, pix_authorization_id
  ) values
    (v_sandbox, 'asaas', 'sandbox', 'pay-sbx-over-pp02r2', 'cus_sandbox_pp02', 'OVERDUE', 'overdue', 'PIX',
     39000, v_today - 10, null, v_pix_sbx),
    (v_prod, 'asaas', 'production', 'pay-prd-over-pp02r2', 'cus_prod_pp02', 'OVERDUE', 'overdue', 'PIX',
     15000, v_today - 40, null, v_pix_prd);

  select f.provider_facts into v_facts
    from private.platform_billing_clinic_facts() f
   where f.clinic_id = v_clinic;
  if v_facts#>>'{sandbox,pix_status}' is distinct from 'ACTIVE' then
    raise exception 'PP02R2 FAIL: sandbox pix hidden: %', v_facts;
  end if;
  if v_facts#>>'{production,pix_status}' is distinct from 'CREATED' then
    raise exception 'PP02R2 FAIL: production pix collapsed by sandbox ACTIVE: %', v_facts;
  end if;
  if (v_facts#>>'{sandbox,latest_payment_date}')::date
       is not distinct from (v_facts#>>'{production,latest_payment_date}')::date then
    raise exception 'PP02R2 FAIL: latest payment collapsed: %', v_facts;
  end if;
  if v_facts#>>'{sandbox,next_charge,due_date}' is not distinct from
     v_facts#>>'{production,next_charge,due_date}' then
    raise exception 'PP02R2 FAIL: next charge collapsed: %', v_facts;
  end if;
  if v_facts#>>'{sandbox,aging_bucket}' is distinct from 'd8_15' then
    raise exception 'PP02R2 FAIL: sandbox aging: %', v_facts;
  end if;
  if v_facts#>>'{production,aging_bucket}' is distinct from 'd31_plus' then
    raise exception 'PP02R2 FAIL: production aging: %', v_facts;
  end if;
  if (v_facts#>>'{sandbox,overdue_cents}')::int is distinct from 39000
     or (v_facts#>>'{production,overdue_cents}')::int is distinct from 15000 then
    raise exception 'PP02R2 FAIL: overdue cents mixed: %', v_facts;
  end if;

  perform pg_temp.pp02_as(v_auth_pa);
  v_overview := public.get_platform_billing_overview();
  if v_overview ? 'delinquent_clinics' or v_overview#>'{aging,d1_7}' is not null then
    raise exception 'PP02R2 FAIL: unlabeled overview aging/delinquency still exposed: %', v_overview;
  end if;
  if (v_overview#>>'{aging,sandbox,d8_15,amount_cents}')::int < 39000 then
    raise exception 'PP02R2 FAIL: sandbox aging missing: %', v_overview->'aging';
  end if;
  if (v_overview#>>'{aging,production,d8_15,amount_cents}')::int
       >= (v_overview#>>'{aging,sandbox,d8_15,amount_cents}')::int
     and (v_overview#>>'{aging,sandbox,d8_15,amount_cents}')::int > 0 then
    raise exception 'PP02R2 FAIL: sandbox aging leaked into production: %', v_overview->'aging';
  end if;
  if (v_overview#>>'{aging,production,d31_plus,amount_cents}')::int < 15000 then
    raise exception 'PP02R2 FAIL: production aging missing: %', v_overview->'aging';
  end if;
  if (v_overview#>>'{aging,sandbox,d31_plus,amount_cents}')::int
       >= (v_overview#>>'{aging,production,d31_plus,amount_cents}')::int
     and (v_overview#>>'{aging,production,d31_plus,amount_cents}')::int > 0 then
    raise exception 'PP02R2 FAIL: production aging leaked into sandbox: %', v_overview->'aging';
  end if;
  if (v_overview#>>'{active_pix_automatic_authorizations,sandbox}')::int < 1
     or (v_overview#>>'{active_pix_automatic_authorizations,production}')::int is distinct from 0 then
    raise exception 'PP02R2 FAIL: pix counts collapsed: %', v_overview->'active_pix_automatic_authorizations';
  end if;

  v_rep := public.get_platform_billing_report(date '2026-09-01', date '2026-09-30');
  if exists (
    select 1
      from jsonb_array_elements(v_rep->'delinquent_items') item
     where item->>'clinic_id' = v_clinic::text
       and item->>'environment' = 'production'
       and item->>'aging_bucket' = 'd8_15'
  ) then
    raise exception 'PP02R2 FAIL: sandbox d8_15 presented as production delinquency: %', v_rep->'delinquent_items';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_rep->'delinquent_items') item
     where item->>'clinic_id' = v_clinic::text
       and item->>'environment' = 'sandbox'
       and item->>'aging_bucket' = 'd31_plus'
  ) then
    raise exception 'PP02R2 FAIL: production d31_plus presented as sandbox delinquency: %', v_rep->'delinquent_items';
  end if;

  perform pg_temp.pp02_as(v_auth_owner);
  v_hub := public.get_my_clinic_billing_overview(v_clinic);
  if v_hub->>'pix_authorization_status' is distinct from 'ACTIVE'
     or v_hub->>'environment' is distinct from 'sandbox' then
    raise exception 'PP02R2 FAIL: clinic hub used unlabeled/production pix: %', v_hub;
  end if;
  if v_hub#>>'{next_charge,environment}' is distinct from 'sandbox' then
    raise exception 'PP02R2 FAIL: clinic hub next charge unlabeled: %', v_hub->'next_charge';
  end if;

  raise notice 'PP02 PASS';
end;
$pp02$;
rollback;
