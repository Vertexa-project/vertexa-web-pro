-- WP-BILLING-MASTER-QA-02R12: reversible failed-event recovery assertions.
begin;
set local session_replication_role = replica;

create or replace function pg_temp.r12_event(
  p_label text,
  p_status text default 'failed',
  p_error text default 'checkout_account_mismatch',
  p_event_type text default 'PAYMENT_CONFIRMED',
  p_environment text default 'sandbox',
  p_resource_type text default 'payment',
  p_next_attempt_at timestamptz default null
)
returns uuid
language plpgsql
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type, event_created_at,
    external_resource_type, external_resource_id, payload_hash, received_at,
    processed_at, processing_status, last_error_category, attempts, claimed_at,
    next_attempt_at
  ) values (
    v_id, 'asaas', p_environment, 'evt_r12_' || p_label, p_event_type,
    clock_timestamp() - interval '2 hours', p_resource_type, 'pay_r12_' || p_label,
    repeat('a', 64), timestamptz '1900-01-01 00:00:00+00',
    clock_timestamp() - interval '1 hour', p_status, p_error, 1,
    case when p_status = 'processing' then clock_timestamp()
         else clock_timestamp() - interval '90 minutes' end,
    p_next_attempt_at
  );
  return v_id;
end;
$$;

create or replace function pg_temp.r12_full_fixture(p_label text)
returns table (
  event_id uuid,
  account_id uuid,
  contract_id uuid,
  attempt_id uuid,
  checkout_id text,
  customer_id text,
  subscription_id text,
  payment_id text,
  tax_id text,
  external_reference text
)
language plpgsql
as $$
declare
  v_profile uuid := gen_random_uuid();
  v_clinic uuid := gen_random_uuid();
begin
  event_id := gen_random_uuid();
  account_id := gen_random_uuid();
  contract_id := gen_random_uuid();
  attempt_id := gen_random_uuid();
  checkout_id := 'checkout_r12_' || p_label;
  customer_id := 'cus_r12_' || p_label;
  subscription_id := 'sub_r12_' || p_label;
  payment_id := 'pay_r12_' || p_label;
  tax_id := '52998224725';
  external_reference := 'vtx:local:r12:' || p_label;

  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (
    v_profile, gen_random_uuid(), 'professional', 'Local R12 fixture',
    p_label || '@local.invalid', 'active'
  );
  insert into public.clinics (id, name, owner_profile_id)
  values (v_clinic, 'Local R12 clinic', v_profile);
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
  values (v_clinic, 'Local R12 identity', tax_id, p_label || '@billing.invalid');
  insert into private.billing_accounts (
    id, owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (account_id, v_profile, v_clinic, 'asaas', 'sandbox', null);
  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  ) values (
    contract_id, v_clinic, gen_random_uuid(), 39000, 'BRL', 'monthly',
    'active', clock_timestamp()
  );
  insert into private.billing_hosted_card_checkout_attempts (
    id, billing_account_id, commercial_contract_id, environment, status,
    attempt_number, external_reference, provider_checkout_id, expires_at
  ) values (
    attempt_id, account_id, contract_id, 'sandbox', 'active', 1,
    external_reference, checkout_id, clock_timestamp() + interval '60 minutes'
  );
  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type, event_created_at,
    external_resource_type, external_resource_id, payload_hash, received_at,
    processed_at, processing_status, last_error_category, attempts, claimed_at
  ) values (
    event_id, 'asaas', 'sandbox', 'evt_r12_' || p_label,
    'PAYMENT_CONFIRMED', clock_timestamp() - interval '2 hours',
    'payment', payment_id, repeat('b', 64), timestamptz '1900-01-02 00:00:00+00',
    clock_timestamp() - interval '1 hour', 'failed', 'checkout_account_mismatch',
    1, clock_timestamp() - interval '90 minutes'
  );
  return next;
end;
$$;

-- R12-01: schema, RLS and authority are narrow. Platform/Clinic Admin browser
-- sessions both use authenticated, so neither can invoke the wrapper.
do $$
declare v_rls boolean;
begin
  if to_regclass('private.billing_provider_event_recovery_audit') is null
     or to_regprocedure('public.requeue_failed_billing_provider_event(uuid,text,text)') is null then
    raise exception 'R12-01 schema missing';
  end if;
  select c.relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_provider_event_recovery_audit';
  if v_rls is not true
     or has_table_privilege('anon', 'private.billing_provider_event_recovery_audit', 'select')
     or has_table_privilege('authenticated', 'private.billing_provider_event_recovery_audit', 'select')
     or has_table_privilege('service_role', 'private.billing_provider_event_recovery_audit', 'select') then
    raise exception 'R12-01 audit table authority widened';
  end if;
  if has_function_privilege('anon', 'public.requeue_failed_billing_provider_event(uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.requeue_failed_billing_provider_event(uuid,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.requeue_failed_billing_provider_event(uuid,text,text)', 'execute')
     or has_function_privilege('service_role', 'private.requeue_failed_billing_provider_event(uuid,text,text)', 'execute') then
    raise exception 'R12-01 recovery RPC authority invalid';
  end if;
end;
$$;

-- R12-02: one eligible terminal failure is queued with immutable evidence;
-- attempts are preserved and recovery itself creates no financial/domain facts.
do $$
declare
  v_event uuid := pg_temp.r12_event('eligible');
  v_result jsonb;
  v_status text;
  v_error text;
  v_attempts integer;
  v_claimed timestamptz;
  v_audit record;
  before_accounts bigint;
  before_subscriptions bigint;
  before_payments bigint;
  before_contracts bigint;
  before_attempts bigint;
begin
  select count(*) into before_accounts from private.billing_accounts;
  select count(*) into before_subscriptions from private.billing_subscriptions;
  select count(*) into before_payments from private.billing_payments;
  select count(*) into before_contracts from private.billing_commercial_contracts;
  select count(*) into before_attempts from private.billing_hosted_card_checkout_attempts;

  v_result := public.requeue_failed_billing_provider_event(
    v_event, 'sandbox', 'hosted_card_customer_adoption_upgrade'
  );
  select processing_status, last_error_category, attempts, claimed_at
    into v_status, v_error, v_attempts, v_claimed
    from private.billing_provider_events where id = v_event;
  select * into v_audit
    from private.billing_provider_event_recovery_audit where event_id = v_event;

  if v_result->>'outcome' is distinct from 'requeued'
     or (v_result->>'financial_mutations')::boolean is not false
     or v_status is distinct from 'received'
     or v_error is distinct from 'checkout_account_mismatch'
     or v_attempts <> 1
     or v_claimed is not null
     or v_audit.previous_status is distinct from 'failed'
     or v_audit.previous_error_category is distinct from 'checkout_account_mismatch'
     or v_audit.previous_attempts <> 1
     or v_audit.previous_claimed_at is null
     or v_audit.queued_attempt_number <> 2
     or (select count(*) from private.billing_accounts) <> before_accounts
     or (select count(*) from private.billing_subscriptions) <> before_subscriptions
     or (select count(*) from private.billing_payments) <> before_payments
     or (select count(*) from private.billing_commercial_contracts) <> before_contracts
     or (select count(*) from private.billing_hosted_card_checkout_attempts) <> before_attempts then
    raise exception 'R12-02 eligible recovery/audit/zero-write invariant failed';
  end if;

  if v_result ? 'event_id' or v_result ? 'external_resource_id'
     or v_result ? 'payload' or v_result ? 'provider_facts' then
    raise exception 'R12-02 sensitive identifier/payload leaked';
  end if;
end;
$$;

-- R12-03: the recovered event enters the existing claim path exactly once.
do $$
declare
  v_event uuid := (select event_id from private.billing_provider_event_recovery_audit order by recovered_at limit 1);
  v_claim jsonb;
  v_second jsonb;
  v_status text;
  v_attempts integer;
begin
  v_claim := public.claim_billing_provider_events('asaas', 'sandbox', 1);
  if jsonb_array_length(v_claim) <> 1
     or v_claim->0->>'id' is distinct from v_event::text then
    raise exception 'R12-03 recovered event was not claimed exactly';
  end if;
  select processing_status, attempts into v_status, v_attempts
    from private.billing_provider_events where id = v_event;
  if v_status is distinct from 'processing' or v_attempts <> 2 then
    raise exception 'R12-03 claim state invalid';
  end if;
  v_second := public.claim_billing_provider_events('asaas', 'sandbox', 1);
  if jsonb_array_length(v_second) <> 0 then
    raise exception 'R12-03 event was claimed twice';
  end if;
end;
$$;

-- R12-04: wrong state, wrong environment, unsupported shape, unknown ID and
-- automatic retry candidates cannot use this manual terminal path.
do $$
declare
  v_processed uuid := pg_temp.r12_event('processed', 'processed');
  v_processing uuid := pg_temp.r12_event('processing', 'processing');
  v_ignored uuid := pg_temp.r12_event('ignored', 'ignored', 'ignored_unmanaged_resource');
  v_unsupported uuid := pg_temp.r12_event('unsupported', 'failed', 'checkout_account_mismatch', 'SUBSCRIPTION_CREATED', 'sandbox', 'subscription');
  v_retryable uuid := pg_temp.r12_event('retryable', 'failed', 'checkout_account_mismatch', 'PAYMENT_CONFIRMED', 'sandbox', 'payment', clock_timestamp() + interval '5 minutes');
  r jsonb;
begin
  r := public.requeue_failed_billing_provider_event(v_processed, 'sandbox', 'hosted_card_customer_adoption_upgrade');
  if r->>'outcome' <> 'status_not_recoverable' then raise exception 'R12-04 processed accepted'; end if;
  r := public.requeue_failed_billing_provider_event(v_processing, 'sandbox', 'hosted_card_customer_adoption_upgrade');
  if r->>'outcome' <> 'status_not_recoverable' then raise exception 'R12-04 claimed accepted'; end if;
  r := public.requeue_failed_billing_provider_event(v_ignored, 'sandbox', 'hosted_card_customer_adoption_upgrade');
  if r->>'outcome' <> 'status_not_recoverable' then raise exception 'R12-04 ignored accepted'; end if;
  r := public.requeue_failed_billing_provider_event(v_unsupported, 'sandbox', 'hosted_card_customer_adoption_upgrade');
  if r->>'outcome' <> 'event_not_supported' then raise exception 'R12-04 unsupported accepted'; end if;
  r := public.requeue_failed_billing_provider_event(v_retryable, 'sandbox', 'hosted_card_customer_adoption_upgrade');
  if r->>'outcome' <> 'automatic_retry_pending' then raise exception 'R12-04 automatic retry stolen'; end if;
  r := public.requeue_failed_billing_provider_event(v_processed, 'production', 'hosted_card_customer_adoption_upgrade');
  if r->>'outcome' <> 'environment_mismatch' then raise exception 'R12-04 wrong environment accepted'; end if;
  r := public.requeue_failed_billing_provider_event(gen_random_uuid(), 'sandbox', 'hosted_card_customer_adoption_upgrade');
  if r->>'outcome' <> 'event_not_found' then raise exception 'R12-04 unknown accepted'; end if;
  r := public.requeue_failed_billing_provider_event(v_processed, 'sandbox', 'free_text');
  if r->>'outcome' <> 'recovery_code_not_allowed' then raise exception 'R12-04 free-text code accepted'; end if;
end;
$$;

-- R12-05: security, identity, tenant and contract categories are not on the
-- allowlist. The legacy ignored-event recovery remains independent.
do $$
declare
  category text;
  v_event uuid;
  v_ignored uuid := pg_temp.r12_event('legacy_ignored', 'ignored', 'ignored_unmanaged_resource');
  r jsonb;
  claim jsonb;
begin
  foreach category in array array[
    'customer_binding_conflict',
    'customer_identity_mismatch',
    'tax_id_mismatch',
    'checkout_environment_mismatch',
    'cross_clinic',
    'cross_account',
    'checkout_contract_mismatch'
  ] loop
    v_event := pg_temp.r12_event('denied_' || category, 'failed', category);
    r := public.requeue_failed_billing_provider_event(v_event, 'sandbox', 'hosted_card_customer_adoption_upgrade');
    if r->>'outcome' <> 'error_not_recoverable' then
      raise exception 'R12-05 category % became recoverable', category;
    end if;
  end loop;

  r := public.requeue_ignored_billing_provider_event(v_ignored);
  if r->>'outcome' <> 'requeued' then
    raise exception 'R12-05 ignored recovery regressed';
  end if;
  claim := public.claim_billing_provider_events('asaas', 'sandbox', 1);
  if jsonb_array_length(claim) <> 1
     or claim->0->>'id' is distinct from v_ignored::text then
    raise exception 'R12-05 ignored event did not re-enter canonical claim';
  end if;
  perform public.ignore_billing_provider_event(v_ignored, 'ignored_unmanaged_resource');
end;
$$;

-- R12-06: full synthetic equivalent of the remote event. Recovery queues it,
-- claim increments the preserved attempt, and authoritative mocked facts are
-- applied only through the existing customer-adoption processor RPC boundary.
do $$
declare
  s record;
  recovery jsonb;
  claim jsonb;
  applied jsonb;
  v_customer text;
  n_sub integer;
  n_pay integer;
  v_event_status text;
begin
  select * into s from pg_temp.r12_full_fixture('full');
  recovery := public.requeue_failed_billing_provider_event(
    s.event_id, 'sandbox', 'hosted_card_customer_adoption_upgrade'
  );
  claim := public.claim_billing_provider_events('asaas', 'sandbox', 1);
  if recovery->>'outcome' <> 'requeued'
     or jsonb_array_length(claim) <> 1
     or claim->0->>'id' is distinct from s.event_id::text then
    raise exception 'R12-06 recovery/claim failed';
  end if;

  applied := public.apply_hosted_card_payment_with_customer_adoption(
    s.event_id, 'evt_r12_full', 'sandbox', s.checkout_id, s.payment_id,
    s.subscription_id, s.customer_id, s.tax_id,
    'CONFIRMED', 'confirmed', 'CREDIT_CARD', 39000, 39000, null,
    current_date, current_date, current_date,
    'PAYMENT_CONFIRMED', clock_timestamp()
  );
  select external_customer_id into v_customer
    from private.billing_accounts where id = s.account_id;
  select count(*) into n_sub from private.billing_subscriptions
   where external_subscription_id = s.subscription_id;
  select count(*) into n_pay from private.billing_payments
   where external_payment_id = s.payment_id;
  select processing_status into v_event_status
    from private.billing_provider_events where id = s.event_id;
  if applied->>'outcome' <> 'applied'
     or v_customer is distinct from s.customer_id
     or n_sub <> 1 or n_pay <> 1
     or v_event_status <> 'processed' then
    raise exception 'R12-06 canonical adoption did not converge';
  end if;
end;
$$;

-- R12-07: an existing-like next-cycle PENDING payment uses the same customer
-- and subscription. Replay of the recovered event is permanently idempotent.
do $$
declare
  s record;
  v_event uuid := gen_random_uuid();
  v_replay uuid := gen_random_uuid();
  r jsonb;
  n_accounts integer;
  n_subscriptions integer;
  n_initial integer;
  n_future integer;
begin
  select a.id account_id, a.external_customer_id customer_id,
         sub.id subscription_pk, sub.external_subscription_id subscription_id,
         sub.external_reference, sub.commercial_contract_id,
         e.id event_id, e.external_resource_id payment_id
    into s
    from private.billing_provider_event_recovery_audit audit
    join private.billing_provider_events e on e.id = audit.event_id
    join private.billing_payments p on p.external_payment_id = e.external_resource_id
    join private.billing_accounts a on a.id = p.billing_account_id
    join private.billing_subscriptions sub on sub.id = p.billing_subscription_id
   where e.external_event_id = 'evt_r12_full';

  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type, event_created_at,
    external_resource_type, external_resource_id, payload_hash, processing_status
  ) values (
    v_event, 'asaas', 'sandbox', 'evt_r12_future', 'PAYMENT_CREATED', clock_timestamp(),
    'payment', 'pay_r12_future', repeat('c', 64), 'processing'
  );
  r := public.apply_billing_payment_snapshot(
    v_event, 'evt_r12_future', 'asaas', 'sandbox', 'pay_r12_future',
    s.subscription_id, s.customer_id, 'PENDING', 'pending', 'CREDIT_CARD',
    39000, 39000, null, current_date + 30, null, null,
    'PAYMENT_CREATED', clock_timestamp()
  );
  if r->>'outcome' <> 'applied' then raise exception 'R12-07 future cycle failed'; end if;

  select count(*) into n_accounts from private.billing_accounts
   where id = s.account_id and external_customer_id = s.customer_id;
  select count(*) into n_subscriptions from private.billing_subscriptions
   where billing_account_id = s.account_id and external_subscription_id = s.subscription_id;
  select count(*) into n_initial from private.billing_payments
   where billing_account_id = s.account_id and external_payment_id = s.payment_id
     and financial_state = 'confirmed';
  select count(*) into n_future from private.billing_payments
   where billing_account_id = s.account_id and external_payment_id = 'pay_r12_future'
     and financial_state = 'pending';
  if n_accounts <> 1 or n_subscriptions <> 1 or n_initial <> 1 or n_future <> 1 then
    raise exception 'R12-07 next-cycle duplicated or lost canonical facts';
  end if;

  r := public.requeue_failed_billing_provider_event(
    s.event_id, 'sandbox', 'hosted_card_customer_adoption_upgrade'
  );
  if r->>'outcome' <> 'already_requeued'
     or (select count(*) from private.billing_provider_event_recovery_audit where event_id = s.event_id) <> 1
     or (select count(*) from private.billing_subscriptions where billing_account_id = s.account_id) <> 1
     or (select count(*) from private.billing_payments where billing_account_id = s.account_id) <> 2 then
    raise exception 'R12-07 replay was not idempotent';
  end if;

  insert into private.billing_provider_events (
    id, provider, environment, external_event_id, event_type, event_created_at,
    external_resource_type, external_resource_id, payload_hash, processing_status,
    last_error_category, attempts
  ) values (
    v_replay, 'asaas', 'sandbox', 'evt_r12_existing_fact', 'PAYMENT_CONFIRMED', clock_timestamp(),
    'payment', s.payment_id, repeat('d', 64), 'failed', 'checkout_account_mismatch', 1
  );
  r := public.requeue_failed_billing_provider_event(
    v_replay, 'sandbox', 'hosted_card_customer_adoption_upgrade'
  );
  if r->>'outcome' <> 'canonical_financial_fact_exists' then
    raise exception 'R12-07 existing canonical fact became recoverable';
  end if;
end;
$$;

do $$ begin raise notice 'FAILED_PROVIDER_EVENT_RECOVERY_SQL_ASSERTIONS_PASSED'; end $$;
rollback;
