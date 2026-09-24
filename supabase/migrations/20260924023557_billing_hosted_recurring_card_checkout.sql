-- =============================================================================
-- WP-BILLING-CARD-01: hosted recurring card Checkout attempts.
-- The checkout journey is deliberately separate from contract, subscription,
-- payment and entitlement facts. No card data is stored by Vertexa.
-- =============================================================================

create table private.billing_hosted_card_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references private.billing_accounts(id) on delete restrict,
  commercial_contract_id uuid not null references private.billing_commercial_contracts(id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'production')),
  status text not null check (status in ('creating', 'active', 'paid', 'canceled', 'expired', 'failed')),
  attempt_number integer not null check (attempt_number > 0),
  external_reference text not null unique check (char_length(external_reference) between 1 and 200),
  provider_checkout_id text unique,
  provider_subscription_id text unique,
  hosted_url text,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  terminal_at timestamptz,
  last_error_category text,
  constraint billing_hosted_card_checkout_attempts_contract_environment_unique
    unique (commercial_contract_id, environment, attempt_number)
);

comment on table private.billing_hosted_card_checkout_attempts is
  'WP-BILLING-CARD-01: audit trail for Asaas hosted recurring CREDIT_CARD Checkout attempts. '
  'A checkout is not a contract, subscription, payment, or entitlement.';

create unique index billing_hosted_card_checkout_one_open_per_contract_uidx
  on private.billing_hosted_card_checkout_attempts (commercial_contract_id, environment)
  where status in ('creating', 'active');

create index billing_hosted_card_checkout_provider_id_idx
  on private.billing_hosted_card_checkout_attempts (environment, provider_checkout_id)
  where provider_checkout_id is not null;

alter table private.billing_hosted_card_checkout_attempts enable row level security;
revoke all on table private.billing_hosted_card_checkout_attempts from public, anon, authenticated, service_role;


create or replace function public.prepare_my_clinic_hosted_card_checkout(p_clinic_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_env text;
  v_account private.billing_accounts%rowtype;
  v_contract private.billing_commercial_contracts%rowtype;
  v_attempt private.billing_hosted_card_checkout_attempts%rowtype;
  v_plan_name text;
  v_next_number integer;
  v_can_create boolean := false;
begin
  if v_me is null then
    raise exception 'BILLING_NOT_AUTHENTICATED' using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED' using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'BILLING_NOT_CLINIC_ADMIN' using errcode = '42501', hint = 'BILLING_NOT_CLINIC_ADMIN';
  end if;

  -- Serialize retries per clinic so a double-click cannot create two open attempts.
  perform pg_advisory_xact_lock(hashtextextended(p_clinic_id::text, 20260924023557));
  v_env := private.billing_clinic_provider_environment(p_clinic_id);
  v_account := private.billing_account_for_clinic(p_clinic_id, v_env);
  if v_account.id is null or v_account.environment is distinct from v_env then
    raise exception 'BILLING_ACCOUNT_UNKNOWN' using errcode = 'P0002', hint = 'BILLING_ACCOUNT_UNKNOWN';
  end if;

  select cc.* into v_contract
    from private.billing_commercial_contracts cc
   where cc.clinic_id = p_clinic_id and cc.status = 'active'
   order by cc.created_at desc
   limit 1;
  if v_contract.id is null then
    raise exception 'BILLING_CONTRACT_REQUIRED' using errcode = '22023', hint = 'BILLING_CONTRACT_REQUIRED';
  end if;
  if v_contract.billing_cycle <> 'monthly' or v_contract.contracted_currency <> 'BRL' or v_contract.contracted_price_cents <= 0 then
    raise exception 'BILLING_CARD_CONTRACT_UNSUPPORTED' using errcode = '22023', hint = 'BILLING_CARD_CONTRACT_UNSUPPORTED';
  end if;

  -- Expiration ends only this payment journey. It never mutates the contract.
  update private.billing_hosted_card_checkout_attempts
     set status = 'expired', terminal_at = clock_timestamp()
   where commercial_contract_id = v_contract.id and environment = v_env
     and status in ('creating', 'active') and expires_at <= clock_timestamp();

  select * into v_attempt
    from private.billing_hosted_card_checkout_attempts a
   where a.commercial_contract_id = v_contract.id and a.environment = v_env
     and a.status in ('creating', 'active') and a.expires_at > clock_timestamp()
   order by a.created_at desc
   limit 1;

  if v_attempt.id is null then
    -- A paid checkout is awaiting canonical subscription/payment processing.
    -- It is not a retryable expiration or cancellation.
    select * into v_attempt
      from private.billing_hosted_card_checkout_attempts a
     where a.commercial_contract_id = v_contract.id and a.environment = v_env
       and a.status = 'paid'
     order by a.created_at desc
     limit 1;
  end if;

  if v_attempt.id is null then
    select coalesce(max(a.attempt_number), 0) + 1 into v_next_number
      from private.billing_hosted_card_checkout_attempts a
     where a.commercial_contract_id = v_contract.id and a.environment = v_env;
    insert into private.billing_hosted_card_checkout_attempts (
      billing_account_id, commercial_contract_id, environment, status, attempt_number,
      external_reference, expires_at
    ) values (
      v_account.id, v_contract.id, v_env, 'creating', v_next_number,
      'vtx:hosted-card:' || gen_random_uuid()::text,
      clock_timestamp() + interval '60 minutes'
    ) returning * into v_attempt;
    v_can_create := true;
  end if;

  select p.display_name into v_plan_name
    from private.billing_plan_versions pv join private.billing_plans p on p.id = pv.plan_id
   where pv.id = v_contract.plan_version_id;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', upper(v_attempt.status),
    'provider_checkout_id', v_attempt.provider_checkout_id,
    'hosted_url', v_attempt.hosted_url,
    'expires_at', v_attempt.expires_at,
    'environment', v_env,
    'billing_account_id', v_account.id,
    'external_customer_id', v_account.external_customer_id,
    'commercial_contract_id', v_contract.id,
    'price_cents', v_contract.contracted_price_cents,
    'currency', v_contract.contracted_currency,
    'plan_name', coalesce(v_plan_name, 'Plano Vertexa'),
    'external_reference', v_attempt.external_reference,
    -- A reused `creating` attempt may follow an unknown provider outcome.  It
    -- must be reconciled by operations rather than replayed blindly.
    'can_create', v_can_create
  );
end;
$$;

revoke all on function public.prepare_my_clinic_hosted_card_checkout(uuid) from public, anon, service_role;
grant execute on function public.prepare_my_clinic_hosted_card_checkout(uuid) to authenticated;


create or replace function public.complete_my_clinic_hosted_card_checkout(
  p_attempt_id uuid,
  p_provider_checkout_id text,
  p_hosted_url text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt private.billing_hosted_card_checkout_attempts%rowtype;
begin
  select * into v_attempt from private.billing_hosted_card_checkout_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then
    raise exception 'BILLING_CARD_ATTEMPT_NOT_FOUND' using errcode = 'P0002', hint = 'BILLING_CARD_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.status = 'expired' or v_attempt.expires_at <= clock_timestamp() then
    update private.billing_hosted_card_checkout_attempts
       set status = 'expired', terminal_at = coalesce(terminal_at, clock_timestamp())
     where id = v_attempt.id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  if v_attempt.status = 'active' then
    return jsonb_build_object('outcome', 'already_active', 'hosted_url', v_attempt.hosted_url, 'expires_at', v_attempt.expires_at);
  end if;
  if v_attempt.status <> 'creating' then
    return jsonb_build_object('outcome', 'terminal');
  end if;
  if nullif(btrim(coalesce(p_provider_checkout_id, '')), '') is null
     or nullif(btrim(coalesce(p_hosted_url, '')), '') is null then
    raise exception 'BILLING_CARD_PROVIDER_RESPONSE_INVALID'
      using errcode = '22023', hint = 'BILLING_CARD_PROVIDER_RESPONSE_INVALID';
  end if;
  update private.billing_hosted_card_checkout_attempts
     set status = 'active', provider_checkout_id = btrim(p_provider_checkout_id), hosted_url = btrim(p_hosted_url), activated_at = clock_timestamp()
   where id = v_attempt.id;
  return jsonb_build_object('outcome', 'active', 'hosted_url', btrim(p_hosted_url), 'expires_at', v_attempt.expires_at);
end;
$$;

revoke all on function public.complete_my_clinic_hosted_card_checkout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_my_clinic_hosted_card_checkout(uuid, text, text) to service_role;


-- A confirmed provider rejection is terminal for this attempt only.  Unknown
-- transport outcomes intentionally remain `creating`: retrying them could
-- create a second provider checkout for the same opaque reference.
create or replace function public.fail_my_clinic_hosted_card_checkout(
  p_attempt_id uuid,
  p_error_category text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_error text := nullif(btrim(coalesce(p_error_category, '')), '');
begin
  if v_error is null then
    raise exception 'BILLING_CARD_ERROR_CATEGORY_REQUIRED' using errcode = '22023', hint = 'BILLING_CARD_ERROR_CATEGORY_REQUIRED';
  end if;
  update private.billing_hosted_card_checkout_attempts
     set status = 'failed', terminal_at = clock_timestamp(), last_error_category = v_error
   where id = p_attempt_id and status = 'creating';
  get diagnostics v_count = row_count;
  return jsonb_build_object('outcome', case when v_count = 1 then 'failed' else 'not_creating' end);
end;
$$;

revoke all on function public.fail_my_clinic_hosted_card_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_my_clinic_hosted_card_checkout(uuid, text) to service_role;


-- Webhook reconciliation changes only the checkout-attempt journey.  It does
-- not write contracts, commercial offers, founder admission, payment facts or
-- entitlements. The event ledger itself deduplicates provider event IDs.
create or replace function public.reconcile_hosted_card_checkout_event(
  p_event_id uuid,
  p_environment text,
  p_event_type text,
  p_provider_checkout_id text,
  p_provider_subscription_id text default null,
  p_external_reference text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt private.billing_hosted_card_checkout_attempts%rowtype;
  v_status text;
  v_event text := btrim(coalesce(p_event_type, ''));
  v_checkout_id text := nullif(btrim(coalesce(p_provider_checkout_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_provider_subscription_id, '')), '');
  v_reference text := nullif(btrim(coalesce(p_external_reference, '')), '');
begin
  if p_environment not in ('sandbox', 'production') or v_event not in ('CHECKOUT_CREATED', 'CHECKOUT_PAID', 'CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED', 'SUBSCRIPTION_CREATED') then
    raise exception 'BILLING_CARD_WEBHOOK_INVALID' using errcode = '22023', hint = 'BILLING_CARD_WEBHOOK_INVALID';
  end if;

  if v_checkout_id is not null then
    select * into v_attempt from private.billing_hosted_card_checkout_attempts
     where environment = p_environment and provider_checkout_id = v_checkout_id for update;
  elsif v_reference is not null then
    select * into v_attempt from private.billing_hosted_card_checkout_attempts
     where environment = p_environment and external_reference = v_reference for update;
  end if;

  if v_attempt.id is null then
    perform private.ignore_billing_provider_event(p_event_id, 'ignored_unmanaged_hosted_card_checkout');
    return jsonb_build_object('outcome', 'ignored');
  end if;

  if v_event = 'SUBSCRIPTION_CREATED' then
    if v_subscription_id is null then
      raise exception 'BILLING_CARD_SUBSCRIPTION_ID_REQUIRED' using errcode = '22023', hint = 'BILLING_CARD_SUBSCRIPTION_ID_REQUIRED';
    end if;
    -- Dynamic invocation permits this first migration to be applied before the
    -- binding function introduced by the immediately following migration.
    execute 'select public.bind_hosted_card_checkout_subscription($1, $2)'
      using v_attempt.id, v_subscription_id;
  else
    v_status := case v_event
      when 'CHECKOUT_CREATED' then 'active'
      when 'CHECKOUT_PAID' then 'paid'
      when 'CHECKOUT_CANCELED' then 'canceled'
      when 'CHECKOUT_EXPIRED' then 'expired'
    end;
    -- Terminal states never regress. Duplicate event effects are therefore
    -- idempotent even before considering the event ledger's unique key.
    if v_attempt.status in ('creating', 'active') then
      update private.billing_hosted_card_checkout_attempts
         set status = v_status,
             terminal_at = case when v_status in ('paid', 'canceled', 'expired') then coalesce(terminal_at, clock_timestamp()) else terminal_at end,
             activated_at = case when v_status = 'active' then coalesce(activated_at, clock_timestamp()) else activated_at end
       where id = v_attempt.id;
    end if;
  end if;
  perform private.ignore_billing_provider_event(p_event_id, 'hosted_card_checkout_reconciled');
  return jsonb_build_object('outcome', 'reconciled');
end;
$$;

revoke all on function public.reconcile_hosted_card_checkout_event(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.reconcile_hosted_card_checkout_event(uuid, text, text, text, text, text) to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values ('20260924023557', '20260924023557_billing_hosted_recurring_card_checkout.sql',
  'WP-BILLING-CARD-01: local hosted recurring card checkout attempts; 60-minute journey expiry.', 'WP-BILLING-CARD-01')
on conflict (version) do nothing;
