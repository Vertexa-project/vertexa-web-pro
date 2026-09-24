-- =====================================================================================
-- WP-BILLING-PRODUCT-05 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260920210000 aplicada localmente. Não muta QA live.
-- Fixtures sintéticos. Sem HTTP Asaas. Sem QR. Sem apply remoto neste WP.
-- =====================================================================================

create or replace function pg_temp.bp05_seed()
returns table (
  clinic_a uuid,
  clinic_b uuid,
  clinic_c uuid,
  auth_owner_a uuid,
  auth_admin_a uuid,
  auth_member_a uuid,
  auth_owner_b uuid,
  auth_patient_a uuid,
  auth_pa uuid,
  auth_pa_member uuid,
  account_a uuid,
  account_b uuid,
  authz_a uuid,
  pay_overdue uuid,
  pay_received uuid
)
language plpgsql
as $seed$
declare
  v_clinic_a uuid := gen_random_uuid();
  v_clinic_b uuid := gen_random_uuid();
  v_clinic_c uuid := gen_random_uuid();
  v_owner_a uuid := gen_random_uuid();
  v_auth_owner_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_auth_admin_a uuid := gen_random_uuid();
  v_member_a uuid := gen_random_uuid();
  v_auth_member_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_auth_owner_b uuid := gen_random_uuid();
  v_owner_c uuid := gen_random_uuid();
  v_patient uuid := gen_random_uuid();
  v_auth_patient uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid();
  v_auth_pa uuid := gen_random_uuid();
  v_pa_member uuid := gen_random_uuid();
  v_auth_pa_member uuid := gen_random_uuid();
  v_plan_version uuid;
  v_contract_a uuid := gen_random_uuid();
  v_contract_b uuid := gen_random_uuid();
  v_account_a uuid := gen_random_uuid();
  v_account_b uuid := gen_random_uuid();
  v_authz_a uuid := gen_random_uuid();
  v_authz_b uuid := gen_random_uuid();
  v_pay_overdue uuid := gen_random_uuid();
  v_pay_received uuid := gen_random_uuid();
  v_pay_pending uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values
    (v_owner_a, v_auth_owner_a, 'professional', 'Owner A BP05', 'own-a-bp05@t.test', 'active'),
    (v_admin_a, v_auth_admin_a, 'professional', 'Admin A BP05', 'adm-a-bp05@t.test', 'active'),
    (v_member_a, v_auth_member_a, 'professional', 'Member A BP05', 'mem-a-bp05@t.test', 'active'),
    (v_owner_b, v_auth_owner_b, 'professional', 'Owner B BP05', 'own-b-bp05@t.test', 'active'),
    (v_owner_c, gen_random_uuid(), 'professional', 'Owner C BP05', 'own-c-bp05@t.test', 'active'),
    (v_patient, v_auth_patient, 'patient', 'Patient A BP05', 'pat-a-bp05@t.test', 'active'),
    (v_pa, v_auth_pa, 'professional', 'PA BP05', 'pa-bp05@t.test', 'active'),
    (v_pa_member, v_auth_pa_member, 'professional', 'PA Member BP05', 'pa-mem-bp05@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id)
  values
    (v_clinic_a, 'Clinica BP05 A', v_owner_a),
    (v_clinic_b, 'Clinica BP05 B', v_owner_b),
    (v_clinic_c, 'Clinica BP05 C Sem Contrato', v_owner_c);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values
    (v_admin_a, v_clinic_a, 'nutritionist', 'admin'),
    (v_member_a, v_clinic_a, 'nutritionist', 'member'),
    (v_pa_member, v_clinic_a, 'nutritionist', 'admin');

  insert into private.platform_admins (profile_id, status)
  values
    (v_pa, 'active'),
    (v_pa_member, 'active');

  select pv.id into v_plan_version
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse'
   order by pv.version desc
   limit 1;

  insert into private.billing_customer_identities (
    clinic_id, legal_name, tax_id, email
  ) values (
    v_clinic_a, 'Clinica BP05 A LTDA', '39053344705', 'fiscal-a@t.test'
  );

  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  ) values
    (v_contract_a, v_clinic_a, v_plan_version, 39000, 'BRL', 'monthly', 'active', now()),
    (v_contract_b, v_clinic_b, v_plan_version, 39000, 'BRL', 'monthly', 'active', now());

  insert into private.billing_accounts (
    id, owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values
    (v_account_a, v_owner_a, v_clinic_a, 'asaas', 'sandbox', 'cus-bound-bp05'),
    (v_account_b, v_owner_b, v_clinic_b, 'asaas', 'sandbox', null);

  insert into private.billing_pix_automatic_authorizations (
    id, commercial_contract_id, billing_account_id, environment,
    provider_status, is_primary, provider_contract_id
  ) values
    (v_authz_a, v_contract_a, v_account_a, 'sandbox', 'ACTIVE', true, replace(v_contract_a::text, '-', '')),
    (v_authz_b, v_contract_b, v_account_b, 'sandbox', 'REFUSED', true, replace(v_contract_b::text, '-', ''));

  insert into private.billing_payments (
    id, billing_account_id, provider, environment, external_payment_id,
    external_customer_id, provider_status, financial_state, billing_type,
    value_cents, due_date, pix_authorization_id
  ) values
    (
      v_pay_overdue, v_account_a, 'asaas', 'sandbox', 'pay-overdue-bp05',
      'cus-bound-bp05', 'OVERDUE', 'overdue', 'PIX',
      39000, date '2020-01-18', v_authz_a
    ),
    (
      v_pay_received, v_account_a, 'asaas', 'sandbox', 'pay-recv-bp05',
      'cus-bound-bp05', 'RECEIVED', 'received', 'PIX',
      39000, date '2026-08-18', v_authz_a
    ),
    (
      v_pay_pending, v_account_b, 'asaas', 'sandbox', 'pay-pending-bp05',
      'cus-unbound-bp05', 'PENDING', 'pending', 'BOLETO',
      39000, date '2099-11-18', v_authz_b
    );

  update private.billing_payments
     set payment_date = (timezone('America/Sao_Paulo', now()))::date
   where id = v_pay_received;

  insert into private.billing_pix_automatic_payment_instructions (
    id, pix_authorization_id, environment, provider_instruction_id, status, due_date
  ) values (
    gen_random_uuid(), v_authz_a, 'sandbox', 'instr-bp05-1', 'AWAITING_REQUEST', date '2099-10-18'
  );

  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type,
    external_resource_type, external_resource_id, payload_hash,
    processing_status, last_error_category, processed_at
  ) values (
    v_event, 'asaas', 'sandbox', 'evt-bp05-1', 'PAYMENT_RECEIVED',
    'payment', 'pay-recv-bp05', repeat('ab', 16),
    'processed', null, now()
  );

  insert into private.billing_provider_events (
    provider, environment, external_event_id, event_type,
    external_resource_type, external_resource_id, payload_hash,
    processing_status, last_error_category
  ) values (
    'asaas', 'sandbox', 'evt-bp05-fail', 'PAYMENT_OVERDUE',
    'payment', 'pay-overdue-bp05', repeat('cd', 16),
    'failed', 'provider_timeout'
  );

  return query select
    v_clinic_a, v_clinic_b, v_clinic_c, v_auth_owner_a, v_auth_admin_a, v_auth_member_a,
    v_auth_owner_b, v_auth_patient, v_auth_pa, v_auth_pa_member,
    v_account_a, v_account_b, v_authz_a, v_pay_overdue, v_pay_received;
end;
$seed$;

create or replace function pg_temp.bp05_as(p_auth uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth::text)::text, true);
end;
$$;


-- T1: grants + no new tables + no browser ledger + no tenant RPC reuse
begin;
do $$
declare
  v_src text;
  v_name text;
begin
  foreach v_name in array array[
    'public.get_platform_billing_overview()',
    'public.list_platform_billing_clinics(text,text,text,text,text,boolean,integer,integer)',
    'public.get_platform_clinic_billing_detail(uuid)',
    'public.list_platform_billing_charges(uuid,text,text,text,integer,integer)',
    'public.list_platform_billing_payments(uuid,text,text,integer,integer)',
    'public.list_platform_billing_events(uuid,text,integer,integer)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception 'BP05 T1 FAIL: missing %', v_name;
    end if;
    select pg_get_functiondef(v_name::regprocedure) into v_src;
    if v_src !~ 'private.assert_platform_billing_reader' then
      raise exception 'BP05 T1 FAIL: % missing platform assert', v_name;
    end if;
    if v_src ~ 'get_my_clinic_' then
      raise exception 'BP05 T1 FAIL: % reuses clinic tenant RPC', v_name;
    end if;
    if v_src ~* 'qr_payload|encoded_image|raw_payload|webhook_payload|copia_e_cola' then
      raise exception 'BP05 T1 FAIL: % leaked QR/webhook', v_name;
    end if;
    if has_function_privilege('anon', v_name::regprocedure, 'execute') then
      raise exception 'BP05 T1 FAIL: anon execute %', v_name;
    end if;
    if not has_function_privilege('authenticated', v_name::regprocedure, 'execute') then
      raise exception 'BP05 T1 FAIL: authenticated missing execute %', v_name;
    end if;
  end loop;

  if exists (
    select 1 from information_schema.tables
     where table_schema in ('public', 'private')
       and table_name in (
         'billing_invoices', 'platform_billing_events', 'platform_delinquency_flags'
       )
  ) then
    raise exception 'BP05 T1 FAIL: unexpected extra table';
  end if;

  if has_table_privilege('authenticated', 'private.billing_payments', 'select')
     or has_table_privilege('anon', 'private.billing_payments', 'select')
     or has_table_privilege('authenticated', 'private.billing_provider_events', 'select')
     or has_table_privilege('authenticated', 'private.billing_commercial_contracts', 'select')
  then
    raise exception 'BP05 T1 FAIL: browser can read private ledger';
  end if;

  if to_regprocedure('private.assert_my_clinic_billing_reader(uuid)') is null then
    raise exception 'BP05 T1 FAIL: BP04 assert missing';
  end if;
  select pg_get_functiondef('private.assert_my_clinic_billing_reader(uuid)'::regprocedure) into v_src;
  if v_src ~ 'is_platform_admin' then
    raise exception 'BP05 T1 FAIL: clinic assert gained platform bypass';
  end if;
end;
$$;
rollback;


-- T2: aging + date boundary + Pix REFUSED is not overdue
begin;
do $$
declare
  v_today date := date '2026-09-20';
begin
  if private.platform_billing_overdue_aging(date '2026-09-20', v_today) is not null then
    raise exception 'BP05 T2 FAIL: due today is not overdue';
  end if;
  if private.platform_billing_overdue_aging(date '2026-09-19', v_today) <> 'd1_7' then
    raise exception 'BP05 T2 FAIL: 1 day';
  end if;
  if private.platform_billing_overdue_aging(date '2026-09-12', v_today) <> 'd8_15' then
    raise exception 'BP05 T2 FAIL: 8 days';
  end if;
  if private.platform_billing_overdue_aging(date '2026-08-21', v_today) <> 'd16_30' then
    raise exception 'BP05 T2 FAIL: 30 days';
  end if;
  if private.platform_billing_overdue_aging(date '2026-08-20', v_today) <> 'd31_plus' then
    raise exception 'BP05 T2 FAIL: 31 days';
  end if;
  if private.platform_billing_clamp_limit(999) <> 50
     or private.platform_billing_clamp_limit(0) <> 50
     or private.platform_billing_clamp_offset(-4) <> 0 then
    raise exception 'BP05 T2 FAIL: page clamp';
  end if;
end;
$$;
rollback;


-- T3: authority attack matrix
begin;
do $$
declare
  s record;
  v_err text;
begin
  select * into s from pg_temp.bp05_seed();

  perform pg_temp.bp05_as(s.auth_admin_a);
  begin
    perform public.get_platform_billing_overview();
    raise exception 'BP05 T3 FAIL: clinic admin overview';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%BILLING_NOT_PLATFORM_ADMIN%' and sqlstate <> '42501' then
        raise exception 'BP05 T3 FAIL: clinic admin err=% / %', sqlstate, v_err;
      end if;
  end;

  perform pg_temp.bp05_as(s.auth_owner_a);
  begin
    perform public.list_platform_billing_clinics();
    raise exception 'BP05 T3 FAIL: owner clinics';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP05 T3 FAIL: owner sqlstate=%', sqlstate;
      end if;
  end;

  perform pg_temp.bp05_as(s.auth_member_a);
  begin
    perform public.list_platform_billing_charges();
    raise exception 'BP05 T3 FAIL: member charges';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP05 T3 FAIL: member sqlstate=%', sqlstate;
      end if;
  end;

  perform pg_temp.bp05_as(s.auth_patient_a);
  begin
    perform public.get_platform_clinic_billing_detail(s.clinic_a);
    raise exception 'BP05 T3 FAIL: patient detail';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP05 T3 FAIL: patient sqlstate=%', sqlstate;
      end if;
  end;

  perform pg_temp.bp05_as(s.auth_owner_b);
  begin
    perform public.list_platform_billing_events();
    raise exception 'BP05 T3 FAIL: foreign owner events';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP05 T3 FAIL: owner B sqlstate=%', sqlstate;
      end if;
  end;

  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_platform_billing_overview();
    raise exception 'BP05 T3 FAIL: anon overview';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP05 T3 FAIL: anon sqlstate=%', sqlstate;
      end if;
  end;

  -- PA-only still cannot use Clinic Admin tenant RPCs
  perform pg_temp.bp05_as(s.auth_pa);
  begin
    perform public.get_my_clinic_billing_overview(s.clinic_a);
    raise exception 'BP05 T3 FAIL: PA used clinic tenant RPC';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP05 T3 FAIL: PA tenant sqlstate=%', sqlstate;
      end if;
  end;
end;
$$;
rollback;


-- T4: Platform Admin cross-clinic facts + dual-role + delinquency + events
begin;
do $$
declare
  s record;
  v_overview jsonb;
  v_clinics jsonb;
  v_detail jsonb;
  v_charges jsonb;
  v_payments jsonb;
  v_events jsonb;
  v_row jsonb;
  v_item jsonb;
begin
  select * into s from pg_temp.bp05_seed();
  perform pg_temp.bp05_as(s.auth_pa);

  v_overview := public.get_platform_billing_overview();
  if v_overview ->> 'timezone' is distinct from 'America/Sao_Paulo' then
    raise exception 'BP05 T4 FAIL: timezone';
  end if;
  if v_overview ->> 'entitlement_enforcement' is distinct from 'OFF' then
    raise exception 'BP05 T4 FAIL: entitlement';
  end if;
  if (v_overview ->> 'delinquent_clinics')::int < 1 then
    raise exception 'BP05 T4 FAIL: expected delinquent clinic %', v_overview;
  end if;
  if (v_overview ->> 'overdue_amount_cents')::bigint < 39000 then
    raise exception 'BP05 T4 FAIL: overdue amount %', v_overview;
  end if;
  if v_overview::text ~* 'qr_payload|encoded_image|webhook|raw_payload|external_payment|service_role|payload_hash' then
    raise exception 'BP05 T4 FAIL: leaked internals in overview';
  end if;

  v_clinics := public.list_platform_billing_clinics();
  if jsonb_array_length(v_clinics -> 'items') < 3 then
    raise exception 'BP05 T4 FAIL: expected cross-clinic rows %', v_clinics;
  end if;
  if (v_clinics ->> 'limit')::int <> 50 then
    raise exception 'BP05 T4 FAIL: default limit';
  end if;

  select x into v_row
    from jsonb_array_elements(v_clinics -> 'items') x
   where x ->> 'clinic_id' = s.clinic_a::text;
  if v_row ->> 'financial_summary' is distinct from 'overdue' then
    raise exception 'BP05 T4 FAIL: clinic A financial=%', v_row;
  end if;
  if v_row ->> 'attention_reason' is distinct from 'overdue' then
    raise exception 'BP05 T4 FAIL: clinic A reason=%', v_row;
  end if;
  -- PREPROD-02 omits unlabeled provider facts; verify the explicit Sandbox
  -- bucket used by this fixture instead.
  if v_row ? 'pix_status'
     or v_row#>>'{provider,sandbox,pix_status}' is distinct from 'ACTIVE' then
    raise exception 'BP05 T4 FAIL: clinic A pix';
  end if;
  if v_row ->> 'identity_complete' is distinct from 'true'
     or v_row ->> 'customer_bound' is distinct from 'true' then
    raise exception 'BP05 T4 FAIL: clinic A identity/bound';
  end if;
  if v_row ->> 'entitlement_granted' is distinct from 'false' then
    raise exception 'BP05 T4 FAIL: entitlement granted';
  end if;

  select x into v_row
    from jsonb_array_elements(v_clinics -> 'items') x
   where x ->> 'clinic_id' = s.clinic_b::text;
  if v_row ->> 'financial_summary' = 'overdue' then
    raise exception 'BP05 T4 FAIL: Pix REFUSED clinic must not be delinquent %', v_row;
  end if;
  -- Current priority is overdue, identity, customer, then Pix. B intentionally
  -- has no billing identity while still proving its Sandbox Pix is REFUSED.
  if v_row ->> 'attention_reason' is distinct from 'identity_incomplete' then
    raise exception 'BP05 T4 FAIL: clinic B reason=%', v_row;
  end if;
  if v_row ? 'pix_status'
     or v_row#>>'{provider,sandbox,pix_status}' is distinct from 'REFUSED' then
    raise exception 'BP05 T4 FAIL: clinic B pix';
  end if;

  select x into v_row
    from jsonb_array_elements(v_clinics -> 'items') x
   where x ->> 'clinic_id' = s.clinic_c::text;
  if v_row ->> 'financial_summary' is distinct from 'no_plan' then
    raise exception 'BP05 T4 FAIL: clinic C no_plan %', v_row;
  end if;

  v_clinics := public.list_platform_billing_clinics(
    null, null, null, null, 'overdue', true, 50, 0
  );
  if not exists (
    select 1 from jsonb_array_elements(v_clinics -> 'items') x
     where x ->> 'clinic_id' = s.clinic_a::text
  ) then
    raise exception 'BP05 T4 FAIL: overdue filter missed A';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_clinics -> 'items') x
     where x ->> 'clinic_id' = s.clinic_b::text
  ) then
    raise exception 'BP05 T4 FAIL: overdue filter included REFUSED clinic';
  end if;

  v_clinics := public.list_platform_billing_clinics(null, null, null, null, null, null, 1, 0);
  if jsonb_array_length(v_clinics -> 'items') <> 1 then
    raise exception 'BP05 T4 FAIL: limit 1';
  end if;
  if (v_clinics -> 'items' -> 0 ->> 'attention') is distinct from 'true' then
    raise exception 'BP05 T4 FAIL: first row should need attention';
  end if;

  v_detail := public.get_platform_clinic_billing_detail(s.clinic_a);
  if v_detail ->> 'found' is distinct from 'true' then
    raise exception 'BP05 T4 FAIL: detail found';
  end if;
  if jsonb_array_length(v_detail -> 'charges') < 2 then
    raise exception 'BP05 T4 FAIL: detail charges %', v_detail -> 'charges';
  end if;
  if v_detail::text ~* 'qr_payload|encoded_image|payload_hash|external_payment_id|provider_facts|cus_' then
    raise exception 'BP05 T4 FAIL: detail leaked provider';
  end if;

  v_charges := public.list_platform_billing_charges();
  if jsonb_array_length(v_charges -> 'items') < 3 then
    raise exception 'BP05 T4 FAIL: global charges';
  end if;

  v_payments := public.list_platform_billing_payments();
  if jsonb_array_length(v_payments -> 'items') < 3 then
    raise exception 'BP05 T4 FAIL: global payments';
  end if;
  if v_payments::text ~* 'external_payment|payload|qr_' then
    raise exception 'BP05 T4 FAIL: payments leaked provider';
  end if;

  v_events := public.list_platform_billing_events();
  if jsonb_array_length(v_events -> 'items') < 2 then
    raise exception 'BP05 T4 FAIL: events %', v_events;
  end if;
  select x into v_item
    from jsonb_array_elements(v_events -> 'items') x
   where x ->> 'event_type' = 'PAYMENT_RECEIVED';
  if v_item ->> 'clinic_id' is distinct from s.clinic_a::text then
    raise exception 'BP05 T4 FAIL: event clinic %', v_item;
  end if;
  if v_item ->> 'related_payment_id' is distinct from s.pay_received::text then
    raise exception 'BP05 T4 FAIL: event payment correlation';
  end if;
  if v_item ? 'payload' or v_item ? 'external_resource_id' or v_item ? 'payload_hash' then
    raise exception 'BP05 T4 FAIL: event leaked keys %', v_item;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_events -> 'items') x
     where x ->> 'failure_category' = 'provider_timeout'
  ) is not true then
    raise exception 'BP05 T4 FAIL: missing sanitized failure category';
  end if;

  -- Dual-role: PA who is also clinic admin uses platform authority, not membership
  perform pg_temp.bp05_as(s.auth_pa_member);
  v_overview := public.get_platform_billing_overview();
  if v_overview ->> 'timezone' is distinct from 'America/Sao_Paulo' then
    raise exception 'BP05 T4 FAIL: dual-role overview';
  end if;
  v_clinics := public.list_platform_billing_clinics();
  if not exists (
    select 1 from jsonb_array_elements(v_clinics -> 'items') x
     where x ->> 'clinic_id' = s.clinic_b::text
  ) then
    raise exception 'BP05 T4 FAIL: dual-role must see other clinics';
  end if;

  -- Clinic admin of A still cannot read platform billing
  perform pg_temp.bp05_as(s.auth_admin_a);
  begin
    perform public.get_platform_clinic_billing_detail(s.clinic_a);
    raise exception 'BP05 T4 FAIL: clinic admin detail';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'BP05 T4 FAIL: clinic admin detail sqlstate=%', sqlstate;
      end if;
  end;
end;
$$;
rollback;
