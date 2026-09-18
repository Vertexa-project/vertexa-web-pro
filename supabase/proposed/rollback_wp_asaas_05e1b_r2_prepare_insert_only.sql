-- ROLLBACK for WP-ASAAS-05E1B-R2. DO NOT APPLY unless PREPARE breaks after R2.
-- Restores private.billing_prepare_pix_automatic_authorization to the 05E0A body
-- (pix branch calls reserve_billing_outbound_operation) and drops the insert-only helper.
-- No secrets. No remote apply in this WP.

drop function if exists private.insert_prepared_pix_automatic_outbound_operation(uuid, text, text, text);
create or replace function private.billing_prepare_pix_automatic_authorization(
  p_commercial_contract_id uuid,
  p_environment text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_environment text := btrim(coalesce(p_environment, ''));
  v_clinic_id uuid;
  v_plan_version_id uuid;
  v_offer_id uuid;
  v_price integer;
  v_currency text;
  v_cycle text;
  v_status text;
  v_owner uuid;
  v_account_id uuid;
  v_account_env text;
  v_external_customer_id text;
  v_account_created boolean := false;
  v_identity_complete boolean := false;
  v_asaas_amount numeric(12, 2);
  v_activation date;
  v_recurrence date;
  v_contract_id text;
  v_auth_id uuid;
  v_customer_key text;
  v_customer_ref text;
  v_auth_key text;
  v_auth_ref text;
  v_customer_reserve jsonb;
  v_auth_reserve jsonb;
begin
  if p_commercial_contract_id is null then
    raise exception 'BILLING_CONTRACT_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CONTRACT_REQUIRED';
  end if;

  if v_environment not in ('sandbox', 'production') then
    raise exception 'BILLING_INVALID_ENVIRONMENT'
      using errcode = '22023', hint = 'BILLING_INVALID_ENVIRONMENT';
  end if;

  select
      cc.clinic_id,
      cc.plan_version_id,
      cc.commercial_offer_id,
      cc.contracted_price_cents,
      cc.contracted_currency,
      cc.billing_cycle,
      cc.status
    into
      v_clinic_id,
      v_plan_version_id,
      v_offer_id,
      v_price,
      v_currency,
      v_cycle,
      v_status
    from private.billing_commercial_contracts cc
   where cc.id = p_commercial_contract_id;

  if not found then
    raise exception 'BILLING_CONTRACT_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_CONTRACT_UNKNOWN';
  end if;

  if v_status is distinct from 'active' then
    raise exception 'BILLING_CONTRACT_INELIGIBLE'
      using errcode = '22023', hint = 'BILLING_CONTRACT_INELIGIBLE';
  end if;

  if v_price is null or v_price < 0
     or v_currency is distinct from 'BRL'
     or v_cycle is distinct from 'monthly' then
    raise exception 'BILLING_CONTRACT_SNAPSHOT_INVALID'
      using errcode = '22023', hint = 'BILLING_CONTRACT_SNAPSHOT_INVALID';
  end if;

  select c.owner_profile_id into v_owner
    from public.clinics c
   where c.id = v_clinic_id;

  if v_owner is null then
    raise exception 'BILLING_CLINIC_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_CLINIC_UNKNOWN';
  end if;

  v_identity_complete := private.billing_customer_identity_complete(v_clinic_id);

  perform pg_catalog.pg_advisory_xact_lock(90510, pg_catalog.hashtext(v_clinic_id::text));

  select a.id, a.environment, a.external_customer_id
    into v_account_id, v_account_env, v_external_customer_id
    from private.billing_accounts a
   where a.clinic_id = v_clinic_id;

  if found then
    if v_account_env is distinct from v_environment then
      raise exception 'BILLING_ENVIRONMENT_MISMATCH'
        using errcode = '42501', hint = 'BILLING_ENVIRONMENT_MISMATCH';
    end if;
  end if;

  if v_external_customer_id is null and not v_identity_complete then
    raise exception 'BILLING_CUSTOMER_IDENTITY_INCOMPLETE'
      using errcode = '22023', hint = 'BILLING_CUSTOMER_IDENTITY_INCOMPLETE';
  end if;

  if v_account_id is null then
    insert into private.billing_accounts (
      owner_profile_id, clinic_id, provider, environment
    ) values (
      v_owner, v_clinic_id, 'asaas', v_environment
    )
    returning id, external_customer_id
      into v_account_id, v_external_customer_id;
    v_account_created := true;
  end if;

  v_asaas_amount := private.billing_cents_to_asaas_amount(v_price);
  v_activation := (timezone('America/Sao_Paulo', clock_timestamp()))::date;
  v_contract_id := private.billing_pix_automatic_contract_id(p_commercial_contract_id);

  select id, recurrence_start_date
    into v_auth_id, v_recurrence
    from private.billing_pix_automatic_authorizations
   where commercial_contract_id = p_commercial_contract_id
     and environment = v_environment
     and is_primary
   for update;

  if not found then
    v_recurrence := private.billing_add_calendar_months(v_activation, 1);
    insert into private.billing_pix_automatic_authorizations (
      commercial_contract_id,
      billing_account_id,
      environment,
      provider_status,
      is_primary,
      frequency,
      payment_creation_mode,
      retry_policy,
      recurrence_start_date,
      provider_contract_id
    ) values (
      p_commercial_contract_id,
      v_account_id,
      v_environment,
      'INTENT',
      true,
      'MONTHLY',
      'SUBSCRIPTION',
      'ALLOW_THREE_IN_SEVEN_DAYS',
      v_recurrence,
      v_contract_id
    )
    returning id into v_auth_id;
  end if;

  v_customer_key := v_account_id::text || ':create_customer';
  v_customer_ref := 'vtx:' || v_environment || ':' || v_account_id::text || ':customer';
  v_auth_key :=
    v_account_id::text || ':create_pix_automatic_authorization:primary:'
    || p_commercial_contract_id::text;
  v_auth_ref :=
    'vtx:' || v_environment || ':' || v_account_id::text
    || ':pix_automatic_authorization:primary:' || p_commercial_contract_id::text;

  if v_external_customer_id is null then
    v_customer_reserve := private.reserve_billing_outbound_operation(
      v_account_id,
      'asaas',
      v_environment,
      'create_customer',
      v_customer_key,
      v_customer_ref
    );
    update private.billing_outbound_operations
       set commercial_contract_id = p_commercial_contract_id,
           updated_at = clock_timestamp()
     where id = (v_customer_reserve->>'operation_id')::uuid
       and commercial_contract_id is null;
  else
    v_auth_reserve := private.reserve_billing_outbound_operation(
      v_account_id,
      'asaas',
      v_environment,
      'create_pix_automatic_authorization',
      v_auth_key,
      v_auth_ref
    );
    update private.billing_outbound_operations
       set commercial_contract_id = p_commercial_contract_id,
           updated_at = clock_timestamp()
     where id = (v_auth_reserve->>'operation_id')::uuid
       and commercial_contract_id is null;
  end if;

  return jsonb_build_object(
    'outcome', 'prepared',
    'strategy', 'pix_automatic',
    'commercial_contract_id', p_commercial_contract_id,
    'clinic_id', v_clinic_id,
    'plan_version_id', v_plan_version_id,
    'commercial_offer_id', v_offer_id,
    'contracted_price_cents', v_price,
    'contracted_currency', v_currency,
    'billing_cycle', v_cycle,
    'asaas_amount', v_asaas_amount,
    'frequency', 'MONTHLY',
    'payment_creation_mode', 'SUBSCRIPTION',
    'retry_policy', 'ALLOW_THREE_IN_SEVEN_DAYS',
    'finish_date', null,
    'activation_date', v_activation,
    'recurrence_start_date', v_recurrence,
    'timezone', 'America/Sao_Paulo',
    'provider_contract_id', v_contract_id,
    'description', 'Vertexa - assinatura mensal',
    'authorization_id', v_auth_id,
    'provider_status', 'INTENT',
    'billing_account_id', v_account_id,
    'billing_account_created', v_account_created,
    'provider_customer_ready', (v_external_customer_id is not null),
    'identity_complete', v_identity_complete,
    'customer_operation', v_customer_reserve,
    'authorization_operation', v_auth_reserve,
    'subscription_operation', null,
    'charge_operation', null,
    'provider_eligibility', 'unconfirmed',
    'http_blocked_reason', 'ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED',
    'entitlement_granted', false
  );
end;
$$;

comment on function private.billing_prepare_pix_automatic_authorization(uuid, text) is
  'WP-ASAAS-05E0A: deriva intenÃ§Ã£o Pix AutomÃ¡tico do contrato. Sem billingType=PIX. '
  'Sem override de polÃ­tica. Sem HTTP Asaas. SECURITY INVOKER. Sem RPC pÃºblica.';

revoke all on function private.billing_prepare_pix_automatic_authorization(uuid, text)
  from public, anon, authenticated, service_role;



