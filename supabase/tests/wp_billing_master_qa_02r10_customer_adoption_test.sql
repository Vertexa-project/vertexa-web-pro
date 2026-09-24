-- WP-BILLING-MASTER-QA-02R10: reversible customer-adoption atomicity tests.
begin;
set local session_replication_role = replica;

create or replace function pg_temp.seed_customer_adoption(
  p_label text,
  p_checkout_id text,
  p_bound_customer text default null,
  p_environment text default 'sandbox',
  p_matching_clinic boolean default true,
  p_contract_status text default 'active'
)
returns table (
  event_id uuid,
  account_id uuid,
  contract_id uuid,
  attempt_id uuid,
  checkout_id text,
  customer_id text,
  tax_id text,
  reference text
)
language plpgsql
as $$
declare
  v_profile uuid := gen_random_uuid();
  v_clinic uuid := gen_random_uuid();
  v_contract_clinic uuid := case when p_matching_clinic then v_clinic else gen_random_uuid() end;
begin
  account_id := gen_random_uuid();
  contract_id := gen_random_uuid();
  attempt_id := gen_random_uuid();
  event_id := gen_random_uuid();
  checkout_id := p_checkout_id;
  customer_id := 'cus_r10_' || p_label;
  tax_id := '52998224725';
  reference := 'vtx:local:r10:' || p_label;

  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (v_profile, gen_random_uuid(), 'professional', 'Local R10 fixture',
          p_label || '@local.invalid', 'active');
  insert into public.clinics (id, name, owner_profile_id)
  values (v_clinic, 'Local R10 clinic', v_profile);
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
  values (v_clinic, 'Local R10 identity', tax_id, p_label || '@billing.invalid');
  insert into private.billing_accounts (
    id, owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (account_id, v_profile, v_clinic, 'asaas', p_environment, p_bound_customer);
  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  ) values (
    contract_id, v_contract_clinic, gen_random_uuid(), 39000, 'BRL', 'monthly',
    p_contract_status, clock_timestamp()
  );
  insert into private.billing_hosted_card_checkout_attempts (
    id, billing_account_id, commercial_contract_id, environment, status, attempt_number,
    external_reference, provider_checkout_id, expires_at
  ) values (
    attempt_id, account_id, contract_id, p_environment, 'active', 1,
    reference, checkout_id, clock_timestamp() + interval '60 minutes'
  );
  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type, payload_hash, processing_status
  ) values (
    event_id, 'asaas', p_environment, 'evt_r10_' || p_label,
    'PAYMENT_CONFIRMED', repeat('a', 64), 'processing'
  );
  return next;
end;
$$;

-- Exact ownership with a NULL binding is the only path that exposes the
-- canonical tax identity to the service-role processor.
do $$
declare s record; r jsonb;
begin
  select * into s from pg_temp.seed_customer_adoption('context', 'checkout_r10_context');
  r := public.load_hosted_card_customer_adoption_context(
    'sandbox', s.checkout_id, 'sub_r10_context', s.customer_id
  );
  if r->>'outcome' is distinct from 'customer_adoption_required'
     or (r->>'customer_adoption_required')::boolean is not true
     or r->>'canonical_tax_id' is distinct from s.tax_id then
    raise exception 'valid adoption context rejected';
  end if;
end;
$$;

-- Customer + subscription + payment + event completion are one atomic result.
do $$
declare s record; r jsonb; v_customer text; n_sub int; n_pay int; v_event text;
begin
  select * into s from pg_temp.seed_customer_adoption('valid', 'checkout_r10_valid');
  r := public.apply_hosted_card_payment_with_customer_adoption(
    s.event_id, 'evt_r10_valid', 'sandbox', s.checkout_id, 'pay_r10_valid',
    'sub_r10_valid', s.customer_id, s.tax_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date,
    'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select external_customer_id into v_customer from private.billing_accounts where id = s.account_id;
  select count(*) into n_sub from private.billing_subscriptions where external_subscription_id = 'sub_r10_valid';
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_r10_valid';
  select processing_status into v_event from private.billing_provider_events where id = s.event_id;
  if r->>'outcome' is distinct from 'applied' or v_customer is distinct from s.customer_id
     or n_sub <> 1 or n_pay <> 1 or v_event <> 'processed' then
    raise exception 'valid customer adoption was not atomic';
  end if;
end;
$$;

-- Tax mismatch preserves the NULL binding and creates no financial facts.
do $$
declare s record; r jsonb; v_customer text; n_sub int; n_pay int;
begin
  select * into s from pg_temp.seed_customer_adoption('tax_mismatch', 'checkout_r10_tax_mismatch');
  r := public.apply_hosted_card_payment_with_customer_adoption(
    s.event_id, 'evt_r10_tax_mismatch', 'sandbox', s.checkout_id, 'pay_r10_tax_mismatch',
    'sub_r10_tax_mismatch', s.customer_id, '11144477735', 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date,
    'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select external_customer_id into v_customer from private.billing_accounts where id = s.account_id;
  select count(*) into n_sub from private.billing_subscriptions where external_subscription_id = 'sub_r10_tax_mismatch';
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_r10_tax_mismatch';
  if r->>'outcome' is distinct from 'customer_identity_mismatch'
     or v_customer is not null or n_sub <> 0 or n_pay <> 0 then
    raise exception 'identity mismatch wrote state';
  end if;
end;
$$;

-- An existing different customer is immutable.
do $$
declare s record; r jsonb; v_customer text; n_sub int; n_pay int;
begin
  select * into s from pg_temp.seed_customer_adoption(
    'bound_conflict', 'checkout_r10_bound_conflict', 'cus_existing_r10'
  );
  r := public.apply_hosted_card_payment_with_customer_adoption(
    s.event_id, 'evt_r10_bound_conflict', 'sandbox', s.checkout_id, 'pay_r10_bound_conflict',
    'sub_r10_bound_conflict', s.customer_id, s.tax_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date,
    'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select external_customer_id into v_customer from private.billing_accounts where id = s.account_id;
  select count(*) into n_sub from private.billing_subscriptions where external_subscription_id = 'sub_r10_bound_conflict';
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_r10_bound_conflict';
  if r->>'outcome' is distinct from 'customer_binding_conflict'
     or v_customer is distinct from 'cus_existing_r10' or n_sub <> 0 or n_pay <> 0 then
    raise exception 'existing customer binding was not fail-closed';
  end if;
end;
$$;

-- Environment and clinic/contract mismatches are rejected before adoption.
do $$
declare s record; r jsonb; v_customer text;
begin
  select * into s from pg_temp.seed_customer_adoption('environment', 'checkout_r10_environment');
  r := public.apply_hosted_card_payment_with_customer_adoption(
    s.event_id, 'evt_r10_environment', 'production', s.checkout_id, 'pay_r10_environment',
    'sub_r10_environment', s.customer_id, s.tax_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date,
    'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select external_customer_id into v_customer from private.billing_accounts where id = s.account_id;
  if r->>'outcome' is distinct from 'checkout_environment_mismatch' or v_customer is not null then
    raise exception 'environment mismatch adopted customer';
  end if;

  select * into s from pg_temp.seed_customer_adoption(
    'contract', 'checkout_r10_contract', null, 'sandbox', false
  );
  r := public.apply_hosted_card_payment_with_customer_adoption(
    s.event_id, 'evt_r10_contract', 'sandbox', s.checkout_id, 'pay_r10_contract',
    'sub_r10_contract', s.customer_id, s.tax_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date,
    'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select external_customer_id into v_customer from private.billing_accounts where id = s.account_id;
  if r->>'outcome' is distinct from 'checkout_contract_mismatch' or v_customer is not null then
    raise exception 'contract mismatch adopted customer';
  end if;
end;
$$;

-- Duplicate claimed events converge on one account customer, one subscription,
-- and one canonical payment. A later SUBSCRIPTION_CREATED bind is idempotent.
do $$
declare s record; r1 jsonb; r2 jsonb; r3 jsonb; event2 uuid := gen_random_uuid(); n_sub int; n_pay int;
begin
  select * into s from pg_temp.seed_customer_adoption('duplicate', 'checkout_r10_duplicate');
  r1 := public.apply_hosted_card_payment_with_customer_adoption(
    s.event_id, 'evt_r10_duplicate_1', 'sandbox', s.checkout_id, 'pay_r10_duplicate',
    'sub_r10_duplicate', s.customer_id, s.tax_id, 'PENDING', 'pending', 'CREDIT_CARD',
    39000, 39000, null, current_date, null, null, 'PAYMENT_CREATED', clock_timestamp()
  );
  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type, payload_hash, processing_status
  ) values (
    event2, 'asaas', 'sandbox', 'evt_r10_duplicate_2', 'PAYMENT_CONFIRMED', repeat('b', 64), 'processing'
  );
  r2 := public.apply_hosted_card_payment_with_customer_adoption(
    event2, 'evt_r10_duplicate_2', 'sandbox', s.checkout_id, 'pay_r10_duplicate',
    'sub_r10_duplicate', s.customer_id, null, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date,
    'PAYMENT_CONFIRMED', clock_timestamp()
  );
  r3 := public.bind_hosted_card_checkout_subscription(s.attempt_id, 'sub_r10_duplicate');
  select count(*) into n_sub from private.billing_subscriptions where external_subscription_id = 'sub_r10_duplicate';
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_r10_duplicate';
  if r1->>'outcome' is distinct from 'applied' or r2->>'outcome' is distinct from 'applied'
     or r3->>'outcome' is distinct from 'bound' or n_sub <> 1 or n_pay <> 1 then
    raise exception 'duplicate/concurrent convergence failed';
  end if;
end;
$$;

do $$ begin raise notice 'HOSTED_CARD_CUSTOMER_ADOPTION_SQL_ASSERTIONS_PASSED'; end $$;
rollback;
