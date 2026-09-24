-- Reconciles an authoritative hosted-card payment when Asaas did not deliver
-- SUBSCRIPTION_CREATED.  The checkout session is accepted only as an exact,
-- server-derived key to an existing Vertexa checkout attempt; it never creates
-- a contract, changes entitlement, or trusts browser/PII fields.

create or replace function public.apply_hosted_card_payment_with_checkout_fallback(
  p_event_id uuid,
  p_external_event_id text,
  p_environment text,
  p_provider_checkout_id text,
  p_external_payment_id text,
  p_external_subscription_id text,
  p_external_customer_id text,
  p_provider_status text,
  p_financial_state text,
  p_billing_type text,
  p_value_cents bigint,
  p_net_value_cents bigint,
  p_refunded_value_cents bigint,
  p_due_date date,
  p_payment_date date,
  p_confirmed_date date,
  p_event_type text,
  p_event_created_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_environment text := nullif(btrim(coalesce(p_environment, '')), '');
  v_checkout_id text := nullif(btrim(coalesce(p_provider_checkout_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_external_subscription_id, '')), '');
  v_customer_id text := nullif(btrim(coalesce(p_external_customer_id, '')), '');
  v_event_status text;
  v_attempt private.billing_hosted_card_checkout_attempts%rowtype;
  v_account private.billing_accounts%rowtype;
  v_contract private.billing_commercial_contracts%rowtype;
  v_reference_subscription private.billing_subscriptions%rowtype;
  v_provider_subscription private.billing_subscriptions%rowtype;
  v_binding jsonb;
begin
  if v_environment not in ('sandbox', 'production')
     or v_checkout_id is null
     or v_subscription_id is null
     or v_customer_id is null then
    return jsonb_build_object('outcome', 'invalid_fallback_input');
  end if;

  -- Serializes duplicate payments and adversarial cross-attempt subscriptions.
  perform pg_catalog.pg_advisory_xact_lock(
    90402,
    pg_catalog.hashtext('hosted-card-checkout:' || v_environment || ':' || v_checkout_id)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    90402,
    pg_catalog.hashtext('hosted-card-subscription:' || v_environment || ':' || v_subscription_id)
  );

  select processing_status into v_event_status
    from private.billing_provider_events
   where id = p_event_id
   for update;
  if not found or v_event_status is distinct from 'processing' then
    return jsonb_build_object('outcome', 'event_not_claimed');
  end if;

  -- provider_checkout_id is globally unique. Looking it up without an
  -- environment predicate lets us distinguish unknown from cross-environment.
  select * into v_attempt
    from private.billing_hosted_card_checkout_attempts
   where provider_checkout_id = v_checkout_id
   for update;
  if v_attempt.id is null then
    return jsonb_build_object('outcome', 'unmanaged_checkout_session');
  end if;
  if v_attempt.environment is distinct from v_environment then
    return jsonb_build_object('outcome', 'checkout_environment_mismatch');
  end if;
  if v_attempt.status not in ('active', 'paid') then
    return jsonb_build_object('outcome', 'checkout_terminal_incompatible');
  end if;

  select * into v_account
    from private.billing_accounts
   where id = v_attempt.billing_account_id
   for update;
  if v_account.id is null
     or v_account.provider is distinct from 'asaas'
     or v_account.environment is distinct from v_environment
     or v_account.clinic_id is null
     or v_account.external_customer_id is distinct from v_customer_id then
    return jsonb_build_object('outcome', 'checkout_account_mismatch');
  end if;

  select * into v_contract
    from private.billing_commercial_contracts
   where id = v_attempt.commercial_contract_id
   for update;
  if v_contract.id is null
     or v_contract.clinic_id is distinct from v_account.clinic_id
     or v_contract.status is distinct from 'active'
     or v_contract.billing_cycle is distinct from 'monthly'
     or v_contract.contracted_currency is distinct from 'BRL'
     or v_contract.contracted_price_cents <= 0 then
    return jsonb_build_object('outcome', 'checkout_contract_mismatch');
  end if;

  if v_attempt.provider_subscription_id is not null
     and v_attempt.provider_subscription_id is distinct from v_subscription_id then
    return jsonb_build_object('outcome', 'checkout_subscription_conflict');
  end if;

  select * into v_reference_subscription
    from private.billing_subscriptions
   where provider = 'asaas'
     and environment = v_environment
     and external_reference = v_attempt.external_reference
   for update;
  select * into v_provider_subscription
    from private.billing_subscriptions
   where provider = 'asaas'
     and environment = v_environment
     and external_subscription_id = v_subscription_id
   for update;

  if v_reference_subscription.id is not null and (
       v_reference_subscription.external_subscription_id is distinct from v_subscription_id
       or v_reference_subscription.billing_account_id is distinct from v_attempt.billing_account_id
       or v_reference_subscription.commercial_contract_id is distinct from v_attempt.commercial_contract_id
     ) then
    return jsonb_build_object('outcome', 'checkout_subscription_conflict');
  end if;
  if v_provider_subscription.id is not null and (
       v_provider_subscription.external_reference is distinct from v_attempt.external_reference
       or v_provider_subscription.billing_account_id is distinct from v_attempt.billing_account_id
       or v_provider_subscription.commercial_contract_id is distinct from v_attempt.commercial_contract_id
     ) then
    return jsonb_build_object('outcome', 'provider_subscription_conflict');
  end if;

  -- The existing binder has the same immutable contract/account invariants and
  -- runs in this transaction. A duplicate invocation is idempotent.
  perform public.bind_hosted_card_checkout_subscription(v_attempt.id, v_subscription_id);

  v_binding := private.apply_billing_payment_snapshot(
    p_event_id,
    p_external_event_id,
    'asaas',
    v_environment,
    p_external_payment_id,
    v_subscription_id,
    v_customer_id,
    p_provider_status,
    p_financial_state,
    p_billing_type,
    p_value_cents,
    p_net_value_cents,
    p_refunded_value_cents,
    p_due_date,
    p_payment_date,
    p_confirmed_date,
    p_event_type,
    p_event_created_at
  );

  if v_binding->>'outcome' is distinct from 'applied' then
    return v_binding;
  end if;
  return jsonb_build_object(
    'outcome', 'applied',
    'billing_payment_id', v_binding->'billing_payment_id',
    'financial_state', v_binding->'financial_state',
    'fallback', 'checkout_session'
  );
end;
$$;

comment on function public.apply_hosted_card_payment_with_checkout_fallback(
  uuid, text, text, text, text, text, text, text, text, text, bigint, bigint,
  bigint, date, date, date, text, timestamptz
) is
  'Hosted card fallback: atomically binds a provider subscription from an exact '
  'authoritative payment.checkoutSession then applies its canonical payment snapshot. '
  'Unknown, mismatched, terminal, or conflicting correlations return structured outcomes with zero financial writes.';

revoke all on function public.apply_hosted_card_payment_with_checkout_fallback(
  uuid, text, text, text, text, text, text, text, text, text, bigint, bigint,
  bigint, date, date, date, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_hosted_card_payment_with_checkout_fallback(
  uuid, text, text, text, text, text, text, text, text, text, bigint, bigint,
  bigint, date, date, date, text, timestamptz
) to service_role;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260924133837',
  '20260924133837_hosted_card_payment_checkout_fallback.sql',
  'Atomically reconcile hosted card payment snapshots through exact checkout sessions when subscription events arrive late or never.',
  'WP-BILLING-MASTER-QA-02R7'
)
on conflict (version) do nothing;
