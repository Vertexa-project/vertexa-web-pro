-- WP-BILLING-MASTER-QA-02R10: canonical hosted-card customer lifecycle.
-- Future checkouts bind an ensured customer before provider checkout creation;
-- historical checkouts may adopt only an authoritative, identity-matched
-- customer through exact checkout ownership. No provider HTTP occurs in SQL.

-- Harden the existing canonical create-customer completion against a race that
-- could otherwise replace customer A with customer B on the same account.
create or replace function private.complete_billing_customer_operation(
  p_operation_id uuid,
  p_external_customer_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_billing_account_id uuid;
  v_operation_type text;
  v_status text;
  v_existing_external_object_id text;
  v_account_customer_id text;
  v_external_customer_id text := btrim(coalesce(p_external_customer_id, ''));
begin
  if v_external_customer_id = '' then
    raise exception 'complete_billing_customer_operation: external id required'
      using errcode = '22023', hint = 'EXTERNAL_ID_REQUIRED';
  end if;

  select billing_account_id, operation_type, status, external_object_id
    into v_billing_account_id, v_operation_type, v_status, v_existing_external_object_id
    from private.billing_outbound_operations
   where id = p_operation_id
   for update;
  if not found then
    raise exception 'complete_billing_customer_operation: operation not found'
      using errcode = '22023', hint = 'OPERATION_NOT_FOUND';
  end if;
  if v_operation_type is distinct from 'create_customer' then
    raise exception 'complete_billing_customer_operation: operation type mismatch'
      using errcode = '22023', hint = 'OPERATION_TYPE_MISMATCH';
  end if;
  if v_status = 'completed' then
    if v_existing_external_object_id is distinct from v_external_customer_id then
      return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id);
    end if;
    return jsonb_build_object(
      'outcome', 'already_completed',
      'billing_account_id', v_billing_account_id,
      'external_customer_id', v_existing_external_object_id
    );
  end if;

  select external_customer_id into v_account_customer_id
    from private.billing_accounts
   where id = v_billing_account_id
   for update;
  if not found then
    raise exception 'complete_billing_customer_operation: billing account not found'
      using errcode = 'P0002', hint = 'BILLING_ACCOUNT_NOT_FOUND';
  end if;
  if v_account_customer_id is not null
     and v_account_customer_id is distinct from v_external_customer_id then
    update private.billing_outbound_operations
       set status = 'failed', last_error_category = 'external_id_conflict', updated_at = clock_timestamp()
     where id = p_operation_id;
    return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id);
  end if;

  begin
    update private.billing_accounts
       set external_customer_id = coalesce(external_customer_id, v_external_customer_id),
           updated_at = clock_timestamp()
     where id = v_billing_account_id;
  exception
    when unique_violation then
      update private.billing_outbound_operations
         set status = 'failed', last_error_category = 'external_id_conflict', updated_at = clock_timestamp()
       where id = p_operation_id;
      return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id);
  end;

  update private.billing_outbound_operations
     set status = 'completed', external_object_id = v_external_customer_id,
         completed_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = p_operation_id;
  return jsonb_build_object(
    'outcome', 'completed',
    'billing_account_id', v_billing_account_id,
    'external_customer_id', v_external_customer_id
  );
end;
$$;

revoke all on function private.complete_billing_customer_operation(uuid, text)
  from public, anon, authenticated, service_role;


-- Read-only correlation gate. It proves the checkout/account/clinic/contract
-- chain before the processor performs an authoritative provider customer GET.
create or replace function public.load_hosted_card_customer_adoption_context(
  p_environment text,
  p_provider_checkout_id text,
  p_external_subscription_id text,
  p_external_customer_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_environment text := nullif(btrim(coalesce(p_environment, '')), '');
  v_checkout_id text := nullif(btrim(coalesce(p_provider_checkout_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_external_subscription_id, '')), '');
  v_customer_id text := nullif(btrim(coalesce(p_external_customer_id, '')), '');
  v_attempt private.billing_hosted_card_checkout_attempts%rowtype;
  v_account private.billing_accounts%rowtype;
  v_contract private.billing_commercial_contracts%rowtype;
  v_identity private.billing_customer_identities%rowtype;
  v_conflict_id uuid;
begin
  if v_environment not in ('sandbox', 'production')
     or v_checkout_id is null or v_subscription_id is null or v_customer_id is null then
    return jsonb_build_object('outcome', 'invalid_adoption_input');
  end if;

  select * into v_attempt
    from private.billing_hosted_card_checkout_attempts
   where provider_checkout_id = v_checkout_id;
  if v_attempt.id is null then
    return jsonb_build_object('outcome', 'unmanaged_checkout_session');
  end if;
  if v_attempt.environment is distinct from v_environment then
    return jsonb_build_object('outcome', 'checkout_environment_mismatch');
  end if;
  if v_attempt.status not in ('active', 'paid') then
    return jsonb_build_object('outcome', 'checkout_terminal_incompatible');
  end if;

  select * into v_account from private.billing_accounts where id = v_attempt.billing_account_id;
  if v_account.id is null
     or v_account.provider is distinct from 'asaas'
     or v_account.environment is distinct from v_environment
     or v_account.clinic_id is null then
    return jsonb_build_object('outcome', 'checkout_account_mismatch');
  end if;

  select * into v_contract from private.billing_commercial_contracts where id = v_attempt.commercial_contract_id;
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

  if v_account.external_customer_id is not null then
    if v_account.external_customer_id is distinct from v_customer_id then
      return jsonb_build_object('outcome', 'customer_binding_conflict');
    end if;
    return jsonb_build_object('outcome', 'ready', 'customer_adoption_required', false);
  end if;

  select id into v_conflict_id
    from private.billing_accounts
   where provider = 'asaas'
     and environment = v_environment
     and external_customer_id = v_customer_id
     and id <> v_account.id;
  if v_conflict_id is not null then
    return jsonb_build_object('outcome', 'customer_binding_conflict');
  end if;

  select * into v_identity
    from private.billing_customer_identities
   where clinic_id = v_account.clinic_id;
  if v_identity.clinic_id is null
     or not private.billing_tax_id_is_valid(v_identity.tax_id) then
    return jsonb_build_object('outcome', 'customer_identity_unavailable');
  end if;

  return jsonb_build_object(
    'outcome', 'customer_adoption_required',
    'customer_adoption_required', true,
    'canonical_tax_id', private.billing_normalize_tax_id(v_identity.tax_id)
  );
end;
$$;

revoke all on function public.load_hosted_card_customer_adoption_context(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.load_hosted_card_customer_adoption_context(text, text, text, text)
  to service_role;


create or replace function public.apply_hosted_card_payment_with_customer_adoption(
  p_event_id uuid,
  p_external_event_id text,
  p_environment text,
  p_provider_checkout_id text,
  p_external_payment_id text,
  p_external_subscription_id text,
  p_external_customer_id text,
  p_provider_customer_tax_id text,
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
  v_payment_id text := nullif(btrim(coalesce(p_external_payment_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_external_subscription_id, '')), '');
  v_customer_id text := nullif(btrim(coalesce(p_external_customer_id, '')), '');
  v_provider_tax_id text := private.billing_normalize_tax_id(p_provider_customer_tax_id);
  v_event_status text;
  v_attempt private.billing_hosted_card_checkout_attempts%rowtype;
  v_account private.billing_accounts%rowtype;
  v_contract private.billing_commercial_contracts%rowtype;
  v_identity private.billing_customer_identities%rowtype;
  v_reference_subscription private.billing_subscriptions%rowtype;
  v_provider_subscription private.billing_subscriptions%rowtype;
  v_existing_payment private.billing_payments%rowtype;
  v_conflicting_account uuid;
  v_binding jsonb;
  v_rollback_outcome text;
begin
  if v_environment not in ('sandbox', 'production')
     or v_checkout_id is null or v_payment_id is null
     or v_subscription_id is null or v_customer_id is null then
    return jsonb_build_object('outcome', 'invalid_adoption_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    90402, pg_catalog.hashtext('hosted-card-checkout:' || v_environment || ':' || v_checkout_id)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    90402, pg_catalog.hashtext('hosted-card-subscription:' || v_environment || ':' || v_subscription_id)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    90402, pg_catalog.hashtext('hosted-card-customer:' || v_environment || ':' || v_customer_id)
  );

  select processing_status into v_event_status
    from private.billing_provider_events
   where id = p_event_id
   for update;
  if not found or v_event_status is distinct from 'processing' then
    return jsonb_build_object('outcome', 'event_not_claimed');
  end if;

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
     or v_account.clinic_id is null then
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
   where provider = 'asaas' and environment = v_environment
     and external_reference = v_attempt.external_reference
   for update;
  select * into v_provider_subscription
    from private.billing_subscriptions
   where provider = 'asaas' and environment = v_environment
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

  select * into v_existing_payment
    from private.billing_payments
   where provider = 'asaas' and environment = v_environment
     and external_payment_id = v_payment_id
   for update;
  if v_existing_payment.id is not null and (
       v_existing_payment.billing_account_id is distinct from v_attempt.billing_account_id
       or v_existing_payment.external_subscription_id is distinct from v_subscription_id
       or v_existing_payment.external_customer_id is distinct from v_customer_id
     ) then
    return jsonb_build_object('outcome', 'payment_mapping_conflict');
  end if;

  if v_account.external_customer_id is not null then
    if v_account.external_customer_id is distinct from v_customer_id then
      return jsonb_build_object('outcome', 'customer_binding_conflict');
    end if;
  else
    select id into v_conflicting_account
      from private.billing_accounts
     where provider = 'asaas' and environment = v_environment
       and external_customer_id = v_customer_id and id <> v_account.id
     for update;
    if v_conflicting_account is not null then
      return jsonb_build_object('outcome', 'customer_binding_conflict');
    end if;

    select * into v_identity
      from private.billing_customer_identities
     where clinic_id = v_account.clinic_id
     for update;
    if v_identity.clinic_id is null
       or not private.billing_tax_id_is_valid(v_identity.tax_id)
       or v_provider_tax_id is null
       or private.billing_normalize_tax_id(v_identity.tax_id) is distinct from v_provider_tax_id then
      return jsonb_build_object('outcome', 'customer_identity_mismatch');
    end if;
  end if;

  -- This subtransaction ensures any downstream non-applied outcome also rolls
  -- back the newly adopted customer and subscription bindings.
  begin
    if v_account.external_customer_id is null then
      update private.billing_accounts
         set external_customer_id = v_customer_id, updated_at = clock_timestamp()
       where id = v_account.id and external_customer_id is null;
      if not found then
        raise exception using errcode = 'P0010', message = 'customer_binding_conflict';
      end if;
    end if;

    perform public.bind_hosted_card_checkout_subscription(v_attempt.id, v_subscription_id);
    v_binding := private.apply_billing_payment_snapshot(
      p_event_id, p_external_event_id, 'asaas', v_environment,
      v_payment_id, v_subscription_id, v_customer_id,
      p_provider_status, p_financial_state, p_billing_type,
      p_value_cents, p_net_value_cents, p_refunded_value_cents,
      p_due_date, p_payment_date, p_confirmed_date,
      p_event_type, p_event_created_at
    );
    if v_binding->>'outcome' is distinct from 'applied' then
      raise exception using errcode = 'P0010', message = coalesce(v_binding->>'outcome', 'atomic_apply_rejected');
    end if;
  exception
    when sqlstate 'P0010' then
      get stacked diagnostics v_rollback_outcome = message_text;
      return jsonb_build_object('outcome', v_rollback_outcome);
    when unique_violation then
      return jsonb_build_object('outcome', 'customer_binding_conflict');
  end;

  return jsonb_build_object(
    'outcome', 'applied',
    'billing_payment_id', v_binding->'billing_payment_id',
    'financial_state', v_binding->'financial_state',
    'fallback', 'checkout_customer_adoption'
  );
end;
$$;

comment on function public.apply_hosted_card_payment_with_customer_adoption(
  uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, date, date, date, text, timestamptz
) is
  'R10 service-role recovery: exact checkout correlation plus authoritative customer tax identity; '
  'atomically adopts only NULL customer bindings, binds one subscription, and applies one payment snapshot.';

revoke all on function public.apply_hosted_card_payment_with_customer_adoption(
  uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, date, date, date, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_hosted_card_payment_with_customer_adoption(
  uuid, text, text, text, text, text, text, text, text, text, text,
  bigint, bigint, bigint, date, date, date, text, timestamptz
) to service_role;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260924160000',
  '20260924160000_hosted_card_customer_binding_adoption.sql',
  'Canonical hosted-card customer binding and atomic historical NULL-to-customer adoption.',
  'WP-BILLING-MASTER-QA-02R10'
)
on conflict (version) do nothing;
