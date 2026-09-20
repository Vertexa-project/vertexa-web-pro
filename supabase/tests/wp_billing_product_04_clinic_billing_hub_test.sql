-- =====================================================================================
-- WP-BILLING-PRODUCT-04 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260920200000 aplicada. Não muta QA live.
-- Fixtures sintéticos. Sem HTTP Asaas. Sem QR. Sem apply remoto neste WP.
-- =====================================================================================

create or replace function pg_temp.bp04_seed()
returns table (
  clinic_a uuid,
  clinic_b uuid,
  auth_owner_a uuid,
  auth_admin_a uuid,
  auth_member_a uuid,
  auth_owner_b uuid,
  auth_patient_a uuid,
  auth_pa uuid,
  contract_a uuid,
  account_a uuid,
  authz_a uuid
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
  v_plan_version uuid;
  v_contract uuid := gen_random_uuid();
  v_account uuid := gen_random_uuid();
  v_authz uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values
    (v_owner_a, v_auth_owner_a, 'professional', 'Owner A BP04', 'own-a-bp04@t.test', 'active'),
    (v_admin_a, v_auth_admin_a, 'professional', 'Admin A BP04', 'adm-a-bp04@t.test', 'active'),
    (v_member_a, v_auth_member_a, 'professional', 'Member A BP04', 'mem-a-bp04@t.test', 'active'),
    (v_owner_b, v_auth_owner_b, 'professional', 'Owner B BP04', 'own-b-bp04@t.test', 'active'),
    (v_patient, v_auth_patient, 'patient', 'Patient A BP04', 'pat-a-bp04@t.test', 'active'),
    (v_pa, v_auth_pa, 'professional', 'PA BP04', 'pa-bp04@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id)
  values
    (v_clinic_a, 'Clinica BP04 A', v_owner_a),
    (v_clinic_b, 'Clinica BP04 B', v_owner_b);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values
    (v_admin_a, v_clinic_a, 'nutritionist', 'admin'),
    (v_member_a, v_clinic_a, 'nutritionist', 'member');

  insert into private.platform_admins (profile_id, status)
  values (v_pa, 'active');

  select pv.id into v_plan_version
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse'
   order by pv.version desc
   limit 1;

  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  ) values (
    v_contract, v_clinic_a, v_plan_version, 39000, 'BRL',
    'monthly', 'active', now()
  );

  insert into private.billing_accounts (
    id, owner_profile_id, clinic_id, provider, environment
  ) values (
    v_account, v_owner_a, v_clinic_a, 'asaas', 'sandbox'
  );

  insert into private.billing_pix_automatic_authorizations (
    id, commercial_contract_id, billing_account_id, environment,
    provider_status, is_primary, provider_contract_id
  ) values (
    v_authz, v_contract, v_account, 'sandbox',
    'ACTIVE', true, replace(v_contract::text, '-', '')
  );

  return query select
    v_clinic_a, v_clinic_b, v_auth_owner_a, v_auth_admin_a, v_auth_member_a,
    v_auth_owner_b, v_auth_patient, v_auth_pa, v_contract, v_account, v_authz;
end;
$seed$;

create or replace function pg_temp.bp04_as(p_auth uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth::text)::text, true);
end;
$$;


-- T1: grants + no new core tables + no browser ledger access
begin;
do $$
declare
  v_src text;
  v_name text;
begin
  foreach v_name in array array[
    'public.get_my_clinic_billing_overview(uuid)',
    'public.list_my_clinic_billing_charges(uuid)',
    'public.list_my_clinic_billing_payments(uuid)',
    'public.list_my_clinic_billing_timeline(uuid)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception 'BP04 T1 FAIL: missing %', v_name;
    end if;
    select pg_get_functiondef(v_name::regprocedure) into v_src;
    if v_src !~ 'private.assert_my_clinic_billing_reader' then
      raise exception 'BP04 T1 FAIL: % missing reader assert', v_name;
    end if;
    if v_src ~* 'qr_payload|encoded_image|raw_payload|webhook_payload' then
      raise exception 'BP04 T1 FAIL: % leaked QR/webhook', v_name;
    end if;
    if has_function_privilege('anon', v_name::regprocedure, 'execute') then
      raise exception 'BP04 T1 FAIL: anon execute %', v_name;
    end if;
    if not has_function_privilege('authenticated', v_name::regprocedure, 'execute') then
      raise exception 'BP04 T1 FAIL: authenticated missing execute %', v_name;
    end if;
  end loop;

  if exists (
    select 1 from information_schema.tables
     where table_schema in ('public', 'private')
       and table_name in (
         'billing_invoices', 'billing_clinic_timeline',
         'clinic_billing_timeline', 'billing_hub_events'
       )
  ) then
    raise exception 'BP04 T1 FAIL: unexpected invoice/timeline table';
  end if;

  if has_table_privilege('authenticated', 'private.billing_payments', 'select')
     or has_table_privilege('anon', 'private.billing_payments', 'select')
     or has_table_privilege('authenticated', 'private.billing_pix_automatic_payment_instructions', 'select')
     or has_table_privilege('authenticated', 'private.billing_provider_events', 'select')
  then
    raise exception 'BP04 T1 FAIL: browser can read private ledger';
  end if;
end;
$$;
rollback;


-- T2: overdue and method helpers
begin;
do $$
declare
  v_today date := date '2026-09-20';
begin
  if private.billing_hub_charge_state_from_payment('received', date '2026-09-01', v_today) <> 'PAID' then
    raise exception 'BP04 T2 FAIL: received';
  end if;
  if private.billing_hub_charge_state_from_payment('overdue', date '2026-09-01', v_today) <> 'OVERDUE' then
    raise exception 'BP04 T2 FAIL: financial overdue';
  end if;
  if private.billing_hub_charge_state_from_payment('pending', date '2026-09-01', v_today) <> 'OVERDUE' then
    raise exception 'BP04 T2 FAIL: pending past due';
  end if;
  if private.billing_hub_charge_state_from_payment('pending', date '2026-10-18', v_today) <> 'PENDING' then
    raise exception 'BP04 T2 FAIL: future pending';
  end if;
  if private.billing_hub_payment_display_state('pending', date '2026-09-01', v_today) <> 'overdue' then
    raise exception 'BP04 T2 FAIL: payment overdue display';
  end if;
  if private.billing_hub_payment_method('PIX') <> 'PIX'
     or private.billing_hub_payment_method('boleto') <> 'BOLETO'
     or private.billing_hub_payment_method('CREDIT_CARD') <> 'CREDIT_CARD'
     or private.billing_hub_payment_method(null) <> 'UNDEFINED' then
    raise exception 'BP04 T2 FAIL: method abstraction';
  end if;
  if private.billing_hub_business_date() is null then
    raise exception 'BP04 T2 FAIL: business date';
  end if;
end;
$$;
rollback;


-- T3: authority fail-closed
begin;
do $$
declare
  s record;
  v_err text;
begin
  select * into s from pg_temp.bp04_seed();

  perform pg_temp.bp04_as(s.auth_member_a);
  begin
    perform public.get_my_clinic_billing_overview(s.clinic_a);
    raise exception 'BP04 T3 FAIL: member overview';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%BILLING_NOT_CLINIC_ADMIN%' and sqlstate <> '42501' then
        raise exception 'BP04 T3 FAIL: member err=% / %', sqlstate, v_err;
      end if;
  end;

  perform pg_temp.bp04_as(s.auth_patient_a);
  begin
    perform public.list_my_clinic_billing_charges(s.clinic_a);
    raise exception 'BP04 T3 FAIL: patient charges';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP04 T3 FAIL: patient sqlstate=%', sqlstate;
      end if;
  end;

  perform pg_temp.bp04_as(s.auth_owner_b);
  begin
    perform public.list_my_clinic_billing_payments(s.clinic_a);
    raise exception 'BP04 T3 FAIL: cross-clinic payments';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP04 T3 FAIL: cross-clinic sqlstate=%', sqlstate;
      end if;
  end;

  perform pg_temp.bp04_as(s.auth_owner_b);
  begin
    perform public.list_my_clinic_billing_timeline(s.clinic_a);
    raise exception 'BP04 T3 FAIL: cross-clinic timeline';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP04 T3 FAIL: cross-timeline sqlstate=%', sqlstate;
      end if;
  end;

  perform pg_temp.bp04_as(s.auth_pa);
  begin
    perform public.get_my_clinic_billing_overview(s.clinic_a);
    raise exception 'BP04 T3 FAIL: platform admin tenant read';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP04 T3 FAIL: PA sqlstate=%', sqlstate;
      end if;
  end;

  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_my_clinic_billing_overview(s.clinic_a);
    raise exception 'BP04 T3 FAIL: anon overview';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP04 T3 FAIL: anon sqlstate=%', sqlstate;
      end if;
  end;
end;
$$;
rollback;


-- T4: own-clinic derivation — programmed, pending future, overdue, received, timeline
begin;
do $$
declare
  s record;
  v_overview jsonb;
  v_charges jsonb;
  v_payments jsonb;
  v_timeline jsonb;
  v_instr uuid := gen_random_uuid();
  v_pay_future uuid := gen_random_uuid();
  v_pay_overdue uuid := gen_random_uuid();
  v_pay_received uuid := gen_random_uuid();
  v_types text;
begin
  select * into s from pg_temp.bp04_seed();

  insert into private.billing_pix_automatic_payment_instructions (
    id, pix_authorization_id, environment, provider_instruction_id, status, due_date
  ) values (
    v_instr, s.authz_a, 'sandbox', 'instr-bp04-1', 'AWAITING_REQUEST', date '2099-10-18'
  );

  insert into private.billing_payments (
    id, billing_account_id, provider, environment, external_payment_id,
    external_customer_id, provider_status, financial_state, billing_type,
    value_cents, due_date, pix_authorization_id
  ) values
    (
      v_pay_future, s.account_a, 'asaas', 'sandbox', 'pay-future-bp04',
      'cus-local-bp04', 'PENDING', 'pending', 'PIX',
      39000, date '2099-11-18', s.authz_a
    ),
    (
      v_pay_overdue, s.account_a, 'asaas', 'sandbox', 'pay-overdue-bp04',
      'cus-local-bp04', 'OVERDUE', 'overdue', 'BOLETO',
      39000, date '2020-01-18', s.authz_a
    ),
    (
      v_pay_received, s.account_a, 'asaas', 'sandbox', 'pay-recv-bp04',
      'cus-local-bp04', 'RECEIVED', 'received', 'CREDIT_CARD',
      39000, date '2026-08-18', s.authz_a
    );

  update private.billing_payments
     set payment_date = date '2026-08-18'
   where id = v_pay_received;

  perform pg_temp.bp04_as(s.auth_owner_a);
  v_overview := public.get_my_clinic_billing_overview(s.clinic_a);
  v_charges := public.list_my_clinic_billing_charges(s.clinic_a);
  v_payments := public.list_my_clinic_billing_payments(s.clinic_a);
  v_timeline := public.list_my_clinic_billing_timeline(s.clinic_a);

  if v_overview ->> 'clinic_id' is distinct from s.clinic_a::text then
    raise exception 'BP04 T4 FAIL: clinic id';
  end if;
  if v_overview #>> '{plan,plan_display_name}' is distinct from 'Pulse'
     and v_overview #>> '{plan,display_name}' is distinct from 'Pulse' then
    if v_overview #>> '{plan,plan_display_name}' is null then
      raise exception 'BP04 T4 FAIL: plan missing %', v_overview -> 'plan';
    end if;
  end if;
  if v_overview ->> 'entitlement_granted' <> 'false' then
    raise exception 'BP04 T4 FAIL: entitlement must stay off';
  end if;
  if v_overview -> 'next_charge' is null or v_overview ->> 'next_charge' = 'null' then
    raise exception 'BP04 T4 FAIL: next charge should be derivable';
  end if;
  if (v_overview -> 'next_charge' ->> 'due_date')::date < current_date then
    raise exception 'BP04 T4 FAIL: next charge must be future';
  end if;
  if v_overview -> 'financial_situation' ->> 'summary_code' is distinct from 'overdue' then
    raise exception 'BP04 T4 FAIL: situation=%', v_overview -> 'financial_situation';
  end if;
  if v_overview::text ~* 'qr_payload|encoded_image|webhook|raw_payload|external_payment' then
    raise exception 'BP04 T4 FAIL: leaked internals in overview';
  end if;

  if jsonb_array_length(v_charges -> 'items') < 4 then
    raise exception 'BP04 T4 FAIL: expected programmed+3 payments, got %', v_charges;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_charges -> 'items') x
     where x ->> 'display_state' = 'PROGRAMMED'
  ) then
    raise exception 'BP04 T4 FAIL: missing PROGRAMMED';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_charges -> 'items') x
     where x ->> 'display_state' = 'OVERDUE'
  ) then
    raise exception 'BP04 T4 FAIL: missing OVERDUE';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_charges -> 'items') x
     where x ->> 'display_state' = 'PAID'
  ) then
    raise exception 'BP04 T4 FAIL: missing PAID';
  end if;
  if v_charges::text ~* 'asaas|cus-|pay-|webhook|payload' then
    raise exception 'BP04 T4 FAIL: leaked provider ids in charges';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_payments -> 'items') x
     where x ->> 'method' = 'PIX'
  ) or not exists (
    select 1 from jsonb_array_elements(v_payments -> 'items') x
     where x ->> 'method' = 'BOLETO'
  ) or not exists (
    select 1 from jsonb_array_elements(v_payments -> 'items') x
     where x ->> 'method' = 'CREDIT_CARD'
  ) then
    raise exception 'BP04 T4 FAIL: mixed methods %', v_payments;
  end if;

  select string_agg(x ->> 'type', ',') into v_types
    from jsonb_array_elements(v_timeline -> 'items') x;
  if v_types not like '%plan_contracted%'
     or v_types not like '%pix_active%'
     or v_types not like '%charge_programmed%'
     or v_types not like '%payment_received%'
     or v_types not like '%payment_overdue%' then
    raise exception 'BP04 T4 FAIL: timeline types=%', v_types;
  end if;
  if v_timeline::text ~* 'webhook|payload|processor|qr' then
    raise exception 'BP04 T4 FAIL: timeline sanitization';
  end if;

  -- Deterministic newest-first: first item occurred_at >= second
  if (v_timeline -> 'items' -> 0 ->> 'occurred_at')
       < (v_timeline -> 'items' -> 1 ->> 'occurred_at') then
    raise exception 'BP04 T4 FAIL: timeline not newest-first';
  end if;

  perform pg_temp.bp04_as(s.auth_admin_a);
  v_overview := public.get_my_clinic_billing_overview(s.clinic_a);
  if v_overview ->> 'clinic_id' is distinct from s.clinic_a::text then
    raise exception 'BP04 T4 FAIL: co-admin should read own clinic';
  end if;
end;
$$;
rollback;


-- T5: empty next-charge when nothing future exists
begin;
do $$
declare
  s record;
  v_overview jsonb;
begin
  select * into s from pg_temp.bp04_seed();
  perform pg_temp.bp04_as(s.auth_owner_a);
  v_overview := public.get_my_clinic_billing_overview(s.clinic_a);
  if v_overview -> 'next_charge' is not null
     and v_overview ->> 'next_charge' <> 'null' then
    raise exception 'BP04 T5 FAIL: fabricated next charge %', v_overview -> 'next_charge';
  end if;
  if v_overview -> 'financial_situation' ->> 'summary_code' not in ('no_charges', 'current') then
    raise exception 'BP04 T5 FAIL: empty ledger summary=%', v_overview -> 'financial_situation';
  end if;
end;
$$;
rollback;
