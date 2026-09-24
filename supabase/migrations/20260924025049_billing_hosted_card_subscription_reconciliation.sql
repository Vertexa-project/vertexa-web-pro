-- WP-BILLING-CARD-01: bind an Asaas subscription created by a hosted card
-- checkout to the existing financial processor. This is correlation only; it
-- creates no contract, offer, founder admission, payment fact or entitlement.

create or replace function public.bind_hosted_card_checkout_subscription(
  p_attempt_id uuid,
  p_provider_subscription_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt private.billing_hosted_card_checkout_attempts%rowtype;
  v_contract private.billing_commercial_contracts%rowtype;
  v_existing private.billing_subscriptions%rowtype;
  v_subscription_id text := nullif(btrim(coalesce(p_provider_subscription_id, '')), '');
  v_scope text;
begin
  if v_subscription_id is null then
    raise exception 'BILLING_CARD_SUBSCRIPTION_ID_REQUIRED' using errcode = '22023', hint = 'BILLING_CARD_SUBSCRIPTION_ID_REQUIRED';
  end if;
  select * into v_attempt from private.billing_hosted_card_checkout_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then
    raise exception 'BILLING_CARD_ATTEMPT_NOT_FOUND' using errcode = 'P0002', hint = 'BILLING_CARD_ATTEMPT_NOT_FOUND';
  end if;
  select * into v_contract from private.billing_commercial_contracts where id = v_attempt.commercial_contract_id;
  if v_contract.id is null or v_contract.billing_cycle <> 'monthly' or v_contract.contracted_currency <> 'BRL' then
    raise exception 'BILLING_CARD_CONTRACT_INVALID' using errcode = '22023', hint = 'BILLING_CARD_CONTRACT_INVALID';
  end if;

  select * into v_existing from private.billing_subscriptions
   where provider = 'asaas' and environment = v_attempt.environment and external_reference = v_attempt.external_reference
   for update;
  if v_existing.id is not null then
    if v_existing.external_subscription_id <> v_subscription_id
       or v_existing.billing_account_id <> v_attempt.billing_account_id
       or v_existing.commercial_contract_id <> v_attempt.commercial_contract_id then
      raise exception 'BILLING_CARD_SUBSCRIPTION_CORRELATION_CONFLICT' using errcode = '22023', hint = 'BILLING_CARD_SUBSCRIPTION_CORRELATION_CONFLICT';
    end if;
  else
    v_scope := 'hosted-card:' || v_attempt.commercial_contract_id::text;
    insert into private.billing_subscriptions (
      billing_account_id, provider, environment, external_subscription_id,
      external_reference, subscription_scope, billing_type, billing_cycle,
      value_cents, next_due_date, commercial_contract_id
    ) values (
      v_attempt.billing_account_id, 'asaas', v_attempt.environment, v_subscription_id,
      v_attempt.external_reference, v_scope, 'CREDIT_CARD', 'MONTHLY',
      v_contract.contracted_price_cents, v_attempt.created_at::date, v_attempt.commercial_contract_id
    );
  end if;
  update private.billing_hosted_card_checkout_attempts
     set provider_subscription_id = coalesce(provider_subscription_id, v_subscription_id)
   where id = v_attempt.id;
  return jsonb_build_object('outcome', 'bound');
end;
$$;

revoke all on function public.bind_hosted_card_checkout_subscription(uuid, text) from public, anon, authenticated;
grant execute on function public.bind_hosted_card_checkout_subscription(uuid, text) to service_role;

-- Refresh the event function for databases that applied the first checkout
-- migration before this binding migration. The dynamic call keeps the two
-- migrations forward-only and the full operation transactional.
create or replace function public.reconcile_hosted_card_checkout_event(
  p_event_id uuid, p_environment text, p_event_type text,
  p_provider_checkout_id text, p_provider_subscription_id text default null,
  p_external_reference text default null
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
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
    select * into v_attempt from private.billing_hosted_card_checkout_attempts where environment = p_environment and provider_checkout_id = v_checkout_id for update;
  elsif v_reference is not null then
    select * into v_attempt from private.billing_hosted_card_checkout_attempts where environment = p_environment and external_reference = v_reference for update;
  end if;
  if v_attempt.id is null then
    perform private.ignore_billing_provider_event(p_event_id, 'ignored_unmanaged_hosted_card_checkout');
    return jsonb_build_object('outcome', 'ignored');
  end if;
  if v_event = 'SUBSCRIPTION_CREATED' then
    if v_subscription_id is null then
      raise exception 'BILLING_CARD_SUBSCRIPTION_ID_REQUIRED' using errcode = '22023', hint = 'BILLING_CARD_SUBSCRIPTION_ID_REQUIRED';
    end if;
    perform public.bind_hosted_card_checkout_subscription(v_attempt.id, v_subscription_id);
  else
    v_status := case v_event when 'CHECKOUT_CREATED' then 'active' when 'CHECKOUT_PAID' then 'paid' when 'CHECKOUT_CANCELED' then 'canceled' when 'CHECKOUT_EXPIRED' then 'expired' end;
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


insert into public.schema_migration_log (version, filename, description, session)
values ('20260924025049', '20260924025049_billing_hosted_card_subscription_reconciliation.sql',
  'WP-BILLING-CARD-01: bind hosted CARD checkout subscription to canonical payment processor correlation.', 'WP-BILLING-CARD-01')
on conflict (version) do nothing;
