-- WP-BILLING-MASTER-QA-02R7: local-only transaction tests for the hosted-card
-- payment fallback. All fixtures are rolled back; no provider IDs are used.
begin;
set local session_replication_role = replica;

create or replace function pg_temp.seed_fallback(
  p_label text,
  p_checkout_id text,
  p_environment text default 'sandbox',
  p_matching_clinic boolean default true
)
returns table (
  event_id uuid,
  account_id uuid,
  contract_id uuid,
  attempt_id uuid,
  checkout_id text,
  customer_id text,
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
  customer_id := 'cus_fallback_' || p_label;
  reference := 'vtx:local:fallback:' || p_label;

  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (v_profile, gen_random_uuid(), 'professional', 'Local fallback fixture',
          p_label || '@local.invalid', 'active');
  insert into public.clinics (id, name, owner_profile_id)
  values (v_clinic, 'Local fallback clinic', v_profile);
  insert into private.billing_accounts (
    id, owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (account_id, v_profile, v_clinic, 'asaas', p_environment, customer_id);
  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  ) values (
    contract_id, v_contract_clinic, gen_random_uuid(), 39000, 'BRL', 'monthly', 'active', clock_timestamp()
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
    event_id, 'asaas', p_environment, 'evt_fallback_' || p_label,
    'PAYMENT_CONFIRMED', repeat('f', 64), 'processing'
  );
  return next;
end;
$$;

-- Valid checkout: subscription binding, payment snapshot, and event completion
-- must all happen in the same transaction.
do $$
declare s record; r jsonb; n_sub int; n_pay int; v_event text;
begin
  select * into s from pg_temp.seed_fallback('valid', 'checkout_fallback_valid');
  r := public.apply_hosted_card_payment_with_checkout_fallback(
    s.event_id, 'evt_fallback_valid', 'sandbox', s.checkout_id, 'pay_fallback_valid',
    'sub_fallback_valid', s.customer_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date, 'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select count(*) into n_sub from private.billing_subscriptions
   where external_subscription_id = 'sub_fallback_valid';
  select count(*) into n_pay from private.billing_payments
   where external_payment_id = 'pay_fallback_valid';
  select processing_status into v_event from private.billing_provider_events where id = s.event_id;
  if r->>'outcome' is distinct from 'applied' or n_sub <> 1 or n_pay <> 1 or v_event <> 'processed' then
    raise exception 'fallback valid path was not atomic: %, %, %, %', r, n_sub, n_pay, v_event;
  end if;
end;
$$;

-- Unknown checkout is a no-op: it must not bind a subscription or create a payment.
do $$
declare s record; r jsonb; n_sub int; n_pay int;
begin
  select * into s from pg_temp.seed_fallback('unknown_event', 'checkout_fallback_known_for_event');
  r := public.apply_hosted_card_payment_with_checkout_fallback(
    s.event_id, 'evt_fallback_unknown', 'sandbox', 'checkout_fallback_unknown', 'pay_fallback_unknown',
    'sub_fallback_unknown', s.customer_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date, 'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select count(*) into n_sub from private.billing_subscriptions where external_subscription_id = 'sub_fallback_unknown';
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_fallback_unknown';
  if r->>'outcome' is distinct from 'unmanaged_checkout_session' or n_sub <> 0 or n_pay <> 0 then
    raise exception 'unknown checkout wrote data: %, %, %', r, n_sub, n_pay;
  end if;
end;
$$;

-- A checkout from another environment is rejected before any financial write.
do $$
declare s record; r jsonb; n_sub int; n_pay int;
begin
  select * into s from pg_temp.seed_fallback('environment', 'checkout_fallback_environment');
  r := public.apply_hosted_card_payment_with_checkout_fallback(
    s.event_id, 'evt_fallback_environment', 'production', s.checkout_id, 'pay_fallback_environment',
    'sub_fallback_environment', s.customer_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date, 'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select count(*) into n_sub from private.billing_subscriptions where external_subscription_id = 'sub_fallback_environment';
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_fallback_environment';
  if r->>'outcome' is distinct from 'checkout_environment_mismatch' or n_sub <> 0 or n_pay <> 0 then
    raise exception 'environment mismatch wrote data: %, %, %', r, n_sub, n_pay;
  end if;
end;
$$;

-- An account/contract clinic mismatch fails closed with zero financial writes.
do $$
declare s record; r jsonb; n_sub int; n_pay int;
begin
  select * into s from pg_temp.seed_fallback('clinic', 'checkout_fallback_clinic', 'sandbox', false);
  r := public.apply_hosted_card_payment_with_checkout_fallback(
    s.event_id, 'evt_fallback_clinic', 'sandbox', s.checkout_id, 'pay_fallback_clinic',
    'sub_fallback_clinic', s.customer_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date, 'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select count(*) into n_sub from private.billing_subscriptions where external_subscription_id = 'sub_fallback_clinic';
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_fallback_clinic';
  if r->>'outcome' is distinct from 'checkout_contract_mismatch' or n_sub <> 0 or n_pay <> 0 then
    raise exception 'clinic mismatch wrote data: %, %, %', r, n_sub, n_pay;
  end if;
end;
$$;

-- A pre-existing subscription for the same checkout reference with another
-- provider subscription is a correlation conflict, never a replacement.
do $$
declare s record; r jsonb; n_sub int; n_pay int;
begin
  select * into s from pg_temp.seed_fallback('conflict', 'checkout_fallback_conflict');
  insert into private.billing_subscriptions (
    billing_account_id, provider, environment, external_subscription_id, external_reference,
    subscription_scope, billing_type, billing_cycle, value_cents, next_due_date, commercial_contract_id
  ) values (
    s.account_id, 'asaas', 'sandbox', 'sub_fallback_existing', s.reference,
    'hosted-card:' || s.contract_id::text, 'CREDIT_CARD', 'MONTHLY', 39000, current_date, s.contract_id
  );
  r := public.apply_hosted_card_payment_with_checkout_fallback(
    s.event_id, 'evt_fallback_conflict', 'sandbox', s.checkout_id, 'pay_fallback_conflict',
    'sub_fallback_requested', s.customer_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date, 'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select count(*) into n_sub from private.billing_subscriptions where external_reference = s.reference;
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_fallback_conflict';
  if r->>'outcome' is distinct from 'checkout_subscription_conflict' or n_sub <> 1 or n_pay <> 0 then
    raise exception 'subscription conflict was not fail-closed: %, %, %', r, n_sub, n_pay;
  end if;
end;
$$;

-- Replaying the same authoritative checkout with a second claimed event keeps
-- exactly one subscription and one canonical payment snapshot.
do $$
declare s record; r1 jsonb; r2 jsonb; event2 uuid := gen_random_uuid(); n_sub int; n_pay int;
begin
  select * into s from pg_temp.seed_fallback('duplicate', 'checkout_fallback_duplicate');
  r1 := public.apply_hosted_card_payment_with_checkout_fallback(
    s.event_id, 'evt_fallback_duplicate_1', 'sandbox', s.checkout_id, 'pay_fallback_duplicate',
    'sub_fallback_duplicate', s.customer_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date, 'PAYMENT_CONFIRMED', clock_timestamp()
  );
  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type, payload_hash, processing_status
  ) values (event2, 'asaas', 'sandbox', 'evt_fallback_duplicate_2', 'PAYMENT_CONFIRMED', repeat('e', 64), 'processing');
  r2 := public.apply_hosted_card_payment_with_checkout_fallback(
    event2, 'evt_fallback_duplicate_2', 'sandbox', s.checkout_id, 'pay_fallback_duplicate',
    'sub_fallback_duplicate', s.customer_id, 'CONFIRMED', 'confirmed', 'CREDIT_CARD',
    39000, 39000, null, current_date, current_date, current_date, 'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select count(*) into n_sub from private.billing_subscriptions where external_subscription_id = 'sub_fallback_duplicate';
  select count(*) into n_pay from private.billing_payments where external_payment_id = 'pay_fallback_duplicate';
  if r1->>'outcome' is distinct from 'applied' or r2->>'outcome' is distinct from 'applied' or n_sub <> 1 or n_pay <> 1 then
    raise exception 'duplicate fallback was not canonical: %, %, %, %', r1, r2, n_sub, n_pay;
  end if;
end;
$$;

do $$ begin raise notice 'HOSTED_CARD_CHECKOUT_FALLBACK_SQL_ASSERTIONS_PASSED'; end $$;
rollback;
