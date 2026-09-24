-- WP-BILLING-CARD-01 local regression: a checkout expiry is terminal only for
-- its attempt, replay is idempotent, and a later attempt has a new correlation.
begin;
set local session_replication_role = replica;

insert into private.billing_accounts (id, owner_profile_id, clinic_id, provider, environment)
values (
  '22222222-2222-4222-8222-222222222222',
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888', 'asaas', 'sandbox'
);
insert into private.billing_commercial_contracts (
  id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
  billing_cycle, status, effective_from
) values (
  '33333333-3333-4333-8333-333333333333',
  '88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999',
  12990, 'BRL', 'monthly', 'active', clock_timestamp()
);

insert into private.billing_hosted_card_checkout_attempts (
  id, billing_account_id, commercial_contract_id, environment, status,
  attempt_number, external_reference, provider_checkout_id, expires_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'sandbox', 'active', 1, 'vtx:hosted-card:test-1', 'checkout_test_1',
  clock_timestamp() + interval '60 minutes'
);
insert into private.billing_provider_events (
  id, provider, environment, external_event_id, event_type, payload_hash, processing_status
) values (
  '44444444-4444-4444-8444-444444444444', 'asaas', 'sandbox', 'evt_checkout_expired',
  'CHECKOUT_EXPIRED', repeat('a', 64), 'processing'
);

do $$
declare
  v_first jsonb;
  v_second jsonb;
  v_status text;
  v_contract_status text;
  v_contract_price integer;
begin
  v_first := public.reconcile_hosted_card_checkout_event(
    '44444444-4444-4444-8444-444444444444', 'sandbox', 'CHECKOUT_EXPIRED', 'checkout_test_1', null, null
  );
  v_second := public.reconcile_hosted_card_checkout_event(
    '44444444-4444-4444-8444-444444444444', 'sandbox', 'CHECKOUT_EXPIRED', 'checkout_test_1', null, null
  );
  select status into v_status from private.billing_hosted_card_checkout_attempts
   where id = '11111111-1111-4111-8111-111111111111';
  select status, contracted_price_cents into v_contract_status, v_contract_price
    from private.billing_commercial_contracts where id = '33333333-3333-4333-8333-333333333333';
  if v_first->>'outcome' <> 'reconciled' or v_second->>'outcome' <> 'reconciled' or v_status <> 'expired' then
    raise exception 'hosted checkout expiry must be idempotently terminal';
  end if;
  if v_contract_status <> 'active' or v_contract_price <> 12990 then
    raise exception 'checkout expiry must not mutate a contract';
  end if;
end;
$$;

-- The historical attempt stays intact; a retry is a separate opaque attempt.
insert into private.billing_hosted_card_checkout_attempts (
  id, billing_account_id, commercial_contract_id, environment, status,
  attempt_number, external_reference, expires_at
) values (
  '55555555-5555-4555-8555-555555555555',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'sandbox', 'creating', 2, 'vtx:hosted-card:test-2', clock_timestamp() + interval '60 minutes'
);

do $$
declare v_count integer; v_distinct integer;
begin
  select count(*), count(distinct external_reference) into v_count, v_distinct
    from private.billing_hosted_card_checkout_attempts
   where commercial_contract_id = '33333333-3333-4333-8333-333333333333';
  if v_count <> 2 or v_distinct <> 2 then raise exception 'retry must preserve history and use new correlation'; end if;
end;
$$;

-- SUBSCRIPTION_CREATED binds the processor correlation only; it does not alter
-- the commercial contract, payment facts, entitlements or founder admission.
insert into private.billing_provider_events (
  id, provider, environment, external_event_id, event_type, payload_hash, processing_status
) values (
  '66666666-6666-4666-8666-666666666666', 'asaas', 'sandbox', 'evt_subscription_created',
  'SUBSCRIPTION_CREATED', repeat('b', 64), 'processing'
);
do $$
declare v_result jsonb; v_bound integer;
begin
  v_result := public.reconcile_hosted_card_checkout_event(
    '66666666-6666-4666-8666-666666666666', 'sandbox', 'SUBSCRIPTION_CREATED',
    'checkout_test_1', 'sub_test_1', 'vtx:hosted-card:test-1'
  );
  select count(*) into v_bound from private.billing_subscriptions
   where external_subscription_id = 'sub_test_1' and external_reference = 'vtx:hosted-card:test-1';
  if v_result->>'outcome' <> 'reconciled' or v_bound <> 1 then
    raise exception 'subscription created must bind exactly one canonical processor correlation';
  end if;
end;
$$;

rollback;
