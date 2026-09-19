-- =====================================================================================
-- WP-ASAAS-05F1-R4 — Pix Automatic payment ingestion (canonical release).
--
-- Canonical billing_payments ledger for Pix Automatic (initial QR + future cycles).
-- Correlation is deterministic provider identity only:
--   1) local instruction.provider_payment_id
--   2) observed payment authorization id
--   3) exact conciliation_identifier
--      (payment-level, or via payment.pixTransaction → GET /pix/transactions/{id})
-- No customer+environment+primary fallback.
-- payment.customer is NOT correlation authority for the initial QR.
--
-- RECORDING PAYMENT != GRANTING ENTITLEMENT.
-- apply always returns entitlement_granted=false.
-- Sem HTTP. Sem seed. Sem reparo one-off do payment live.
-- =====================================================================================

alter table private.billing_payments
  alter column billing_subscription_id drop not null,
  alter column external_subscription_id drop not null;

alter table private.billing_payments
  drop constraint if exists billing_payments_external_subscription_id_check;

alter table private.billing_payments
  add column if not exists pix_authorization_id uuid
    references private.billing_pix_automatic_authorizations(id) on delete restrict,
  add column if not exists pix_instruction_id uuid
    references private.billing_pix_automatic_payment_instructions(id) on delete restrict;

alter table private.billing_payments
  drop constraint if exists billing_payments_ledger_source_check;

alter table private.billing_payments
  add constraint billing_payments_ledger_source_check check (
    (
      billing_subscription_id is not null
      and external_subscription_id is not null
      and btrim(external_subscription_id) <> ''
      and pix_authorization_id is null
    )
    or
    (
      pix_authorization_id is not null
      and billing_subscription_id is null
      and external_subscription_id is null
    )
  );

create index if not exists billing_payments_pix_authorization_idx
  on private.billing_payments (pix_authorization_id)
  where pix_authorization_id is not null;

comment on column private.billing_payments.pix_authorization_id is
  'WP-ASAAS-05F1: correlação Pix Automático. Mutuamente exclusivo com billing_subscription_id.';

-- Live sandbox: 2 non-null conciliations, 0 duplicates. Partial unique is compatible.
create unique index if not exists billing_pix_automatic_authorizations_conciliation_uidx
  on private.billing_pix_automatic_authorizations (environment, conciliation_identifier)
  where conciliation_identifier is not null;

comment on index private.billing_pix_automatic_authorizations_conciliation_uidx is
  'WP-ASAAS-05F1-R1: conciliation_identifier is a provider identity, unique per environment.';


drop function if exists public.resolve_billing_target_by_pix_automatic_payment(text, text, text, text, text);
drop function if exists private.resolve_billing_target_by_pix_automatic_payment(text, text, text, text, text);

create or replace function private.resolve_billing_target_by_pix_automatic_payment(
  p_provider text,
  p_environment text,
  p_external_payment_id text,
  p_external_customer_id text,
  p_provider_authorization_id text,
  p_conciliation_identifier text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider text := btrim(coalesce(p_provider, ''));
  v_env text := btrim(coalesce(p_environment, ''));
  v_pay text := btrim(coalesce(p_external_payment_id, ''));
  v_customer text := btrim(coalesce(p_external_customer_id, ''));
  v_auth_ext text := nullif(btrim(coalesce(p_provider_authorization_id, '')), '');
  v_conciliation text := nullif(btrim(coalesce(p_conciliation_identifier, '')), '');
  v_auth_id uuid;
  v_instr_id uuid;
  v_account_id uuid;
  v_account_customer text;
  v_match_count integer;
begin
  if v_provider is distinct from 'asaas' then
    raise exception 'resolve_billing_target_by_pix_automatic_payment: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_env not in ('sandbox', 'production') then
    raise exception 'resolve_billing_target_by_pix_automatic_payment: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;
  if v_pay = '' or v_customer = '' then
    return jsonb_build_object('found', false);
  end if;

  -- 1) Exact local payment-instruction match by provider payment id.
  select count(*) into v_match_count
    from private.billing_pix_automatic_payment_instructions i
   where i.environment = v_env
     and i.provider_payment_id = v_pay;
  if v_match_count > 1 then
    return jsonb_build_object('found', false, 'reason', 'instruction_ambiguous');
  end if;
  if v_match_count = 1 then
    select i.id, i.pix_authorization_id, a.billing_account_id, acc.external_customer_id
      into v_instr_id, v_auth_id, v_account_id, v_account_customer
      from private.billing_pix_automatic_payment_instructions i
      join private.billing_pix_automatic_authorizations a on a.id = i.pix_authorization_id
      join private.billing_accounts acc on acc.id = a.billing_account_id
     where i.environment = v_env
       and i.provider_payment_id = v_pay;
    return jsonb_build_object(
      'found', true,
      'billing_account_id', v_account_id,
      'pix_authorization_id', v_auth_id,
      'pix_instruction_id', v_instr_id,
      'external_customer_id', v_account_customer
    );
  end if;

  -- 2) Explicit authorization identifier observed on the provider payment.
  if v_auth_ext is not null then
    select count(*) into v_match_count
      from private.billing_pix_automatic_authorizations a
     where a.environment = v_env
       and a.provider_authorization_id = v_auth_ext;
    if v_match_count > 1 then
      return jsonb_build_object('found', false, 'reason', 'authorization_ambiguous');
    end if;
    if v_match_count = 1 then
      select a.id, a.billing_account_id, acc.external_customer_id
        into v_auth_id, v_account_id, v_account_customer
        from private.billing_pix_automatic_authorizations a
        join private.billing_accounts acc on acc.id = a.billing_account_id
       where a.environment = v_env
         and a.provider_authorization_id = v_auth_ext;
      return jsonb_build_object(
        'found', true,
        'billing_account_id', v_account_id,
        'pix_authorization_id', v_auth_id,
        'pix_instruction_id', null,
        'external_customer_id', v_account_customer
      );
    end if;
  end if;

  -- 3) Exact initial-QR conciliationIdentifier. 0 = unmatched; >1 = fail closed.
  if v_conciliation is not null then
    select count(*) into v_match_count
      from private.billing_pix_automatic_authorizations a
     where a.environment = v_env
       and a.conciliation_identifier = v_conciliation;
    if v_match_count > 1 then
      return jsonb_build_object('found', false, 'reason', 'conciliation_ambiguous');
    end if;
    if v_match_count = 1 then
      select a.id, a.billing_account_id, acc.external_customer_id
        into v_auth_id, v_account_id, v_account_customer
        from private.billing_pix_automatic_authorizations a
        join private.billing_accounts acc on acc.id = a.billing_account_id
       where a.environment = v_env
         and a.conciliation_identifier = v_conciliation;
      return jsonb_build_object(
        'found', true,
        'billing_account_id', v_account_id,
        'pix_authorization_id', v_auth_id,
        'pix_instruction_id', null,
        'external_customer_id', v_account_customer
      );
    end if;
    return jsonb_build_object('found', false, 'reason', 'conciliation_unmatched');
  end if;

  -- 4/5) Legacy subscription is resolved outside this function. No customer/primary guess.
  return jsonb_build_object('found', false);
end;
$$;

comment on function private.resolve_billing_target_by_pix_automatic_payment(text, text, text, text, text, text) is
  'WP-ASAAS-05F1-R3: correlação determinística de payment Pix Automático. '
  'Ordem: instruction payment id, authorization id observado, conciliationIdentifier. '
  'Customer NÃO é autoridade de correlação. Nunca por primary/customer.';

revoke all on function private.resolve_billing_target_by_pix_automatic_payment(text, text, text, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_billing_target_by_pix_automatic_payment(
  p_provider text,
  p_environment text,
  p_external_payment_id text,
  p_external_customer_id text,
  p_provider_authorization_id text,
  p_conciliation_identifier text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.resolve_billing_target_by_pix_automatic_payment(
    p_provider, p_environment, p_external_payment_id, p_external_customer_id,
    p_provider_authorization_id, p_conciliation_identifier
  );
end;
$$;

revoke all on function public.resolve_billing_target_by_pix_automatic_payment(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_billing_target_by_pix_automatic_payment(text, text, text, text, text, text)
  to service_role;


create or replace function private.apply_billing_pix_automatic_payment_snapshot(
  p_event_id uuid,
  p_external_event_id text,
  p_provider text,
  p_environment text,
  p_external_payment_id text,
  p_external_customer_id text,
  p_pix_authorization_id uuid,
  p_pix_instruction_id uuid,
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
  v_provider text := btrim(coalesce(p_provider, ''));
  v_env text := btrim(coalesce(p_environment, ''));
  v_payment text := btrim(coalesce(p_external_payment_id, ''));
  v_customer_in text := btrim(coalesce(p_external_customer_id, ''));
  v_event_id_ext text := nullif(btrim(coalesce(p_external_event_id, '')), '');
  v_event_type text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_auth private.billing_pix_automatic_authorizations%rowtype;
  v_account_customer text;
  v_event_status text;
  v_payment_id uuid;
  v_instr_id uuid;
begin
  if v_provider is distinct from 'asaas' then
    raise exception 'apply_billing_pix_automatic_payment_snapshot: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_env not in ('sandbox', 'production') then
    raise exception 'apply_billing_pix_automatic_payment_snapshot: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;
  if v_payment = '' or v_customer_in = '' or p_pix_authorization_id is null then
    raise exception 'apply_billing_pix_automatic_payment_snapshot: missing identifiers'
      using errcode = '22023', hint = 'INVALID_IDENTIFIERS';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    90400,
    pg_catalog.hashtext(v_provider || ':' || v_env || ':' || v_payment)
  );

  select processing_status into v_event_status
    from private.billing_provider_events
   where id = p_event_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'event_not_found', 'entitlement_granted', false);
  end if;
  if v_event_status is distinct from 'processing' then
    return jsonb_build_object('outcome', 'event_not_claimed', 'status', v_event_status, 'entitlement_granted', false);
  end if;

  select * into v_auth
    from private.billing_pix_automatic_authorizations
   where id = p_pix_authorization_id
     and environment = v_env;
  if not found then
    return jsonb_build_object('outcome', 'unmanaged_pix_automatic_payment', 'entitlement_granted', false);
  end if;

  select external_customer_id into v_account_customer
    from private.billing_accounts
   where id = v_auth.billing_account_id;

  -- R3: payment.customer on the initial QR is an Asaas-generated payer representation
  -- and is not correlation authority. Ledger tenant remains the authorization account.
  v_instr_id := p_pix_instruction_id;
  if v_instr_id is not null then
    if not exists (
      select 1
        from private.billing_pix_automatic_payment_instructions i
       where i.id = v_instr_id
         and i.pix_authorization_id = v_auth.id
         and i.environment = v_env
    ) then
      return jsonb_build_object('outcome', 'unmanaged_pix_automatic_payment', 'entitlement_granted', false);
    end if;
  end if;

  insert into private.billing_payments (
    billing_account_id, billing_subscription_id, provider, environment,
    external_payment_id, external_customer_id, external_subscription_id,
    pix_authorization_id, pix_instruction_id,
    provider_status, financial_state, billing_type,
    value_cents, net_value_cents, refunded_value_cents,
    due_date, payment_date, confirmed_date,
    last_provider_event_id, last_provider_event_type, last_provider_event_created_at,
    created_at, updated_at
  ) values (
    v_auth.billing_account_id, null, v_provider, v_env,
    v_payment, v_customer_in, null,
    v_auth.id, v_instr_id,
    p_provider_status, p_financial_state, nullif(btrim(coalesce(p_billing_type, '')), ''),
    p_value_cents, p_net_value_cents, p_refunded_value_cents,
    p_due_date, p_payment_date, p_confirmed_date,
    v_event_id_ext, v_event_type, p_event_created_at,
    clock_timestamp(), clock_timestamp()
  )
  on conflict (provider, environment, external_payment_id) do update set
    provider_status = excluded.provider_status,
    financial_state = excluded.financial_state,
    billing_type = excluded.billing_type,
    value_cents = excluded.value_cents,
    net_value_cents = excluded.net_value_cents,
    refunded_value_cents = excluded.refunded_value_cents,
    due_date = excluded.due_date,
    payment_date = excluded.payment_date,
    confirmed_date = excluded.confirmed_date,
    pix_authorization_id = coalesce(private.billing_payments.pix_authorization_id, excluded.pix_authorization_id),
    pix_instruction_id = coalesce(excluded.pix_instruction_id, private.billing_payments.pix_instruction_id),
    updated_at = clock_timestamp(),
    last_provider_event_id = case
      when private.billing_payments.last_provider_event_created_at is null
        or (excluded.last_provider_event_created_at is not null
            and excluded.last_provider_event_created_at >= private.billing_payments.last_provider_event_created_at)
      then excluded.last_provider_event_id
      else private.billing_payments.last_provider_event_id
    end,
    last_provider_event_type = case
      when private.billing_payments.last_provider_event_created_at is null
        or (excluded.last_provider_event_created_at is not null
            and excluded.last_provider_event_created_at >= private.billing_payments.last_provider_event_created_at)
      then excluded.last_provider_event_type
      else private.billing_payments.last_provider_event_type
    end,
    last_provider_event_created_at = case
      when private.billing_payments.last_provider_event_created_at is null
        or (excluded.last_provider_event_created_at is not null
            and excluded.last_provider_event_created_at >= private.billing_payments.last_provider_event_created_at)
      then excluded.last_provider_event_created_at
      else private.billing_payments.last_provider_event_created_at
    end
  returning id into v_payment_id;

  update private.billing_provider_events
     set processing_status = 'processed',
         processed_at = clock_timestamp(),
         last_error_category = null,
         next_attempt_at = null
   where id = p_event_id
     and processing_status = 'processing';

  return jsonb_build_object(
    'outcome', 'applied',
    'billing_payment_id', v_payment_id,
    'financial_state', p_financial_state,
    'entitlement_granted', false
  );
end;
$$;

comment on function private.apply_billing_pix_automatic_payment_snapshot(uuid, text, text, text, text, text, uuid, uuid, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz) is
  'WP-ASAAS-05F1: upsert canônico em billing_payments para Pix Automático. Sempre '
  'entitlement_granted=false. GET é autoridade do snapshot; audit monotônico.';

revoke all on function private.apply_billing_pix_automatic_payment_snapshot(uuid, text, text, text, text, text, uuid, uuid, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.apply_billing_pix_automatic_payment_snapshot(
  p_event_id uuid,
  p_external_event_id text,
  p_provider text,
  p_environment text,
  p_external_payment_id text,
  p_external_customer_id text,
  p_pix_authorization_id uuid,
  p_pix_instruction_id uuid,
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
begin
  return private.apply_billing_pix_automatic_payment_snapshot(
    p_event_id, p_external_event_id, p_provider, p_environment, p_external_payment_id,
    p_external_customer_id, p_pix_authorization_id, p_pix_instruction_id,
    p_provider_status, p_financial_state, p_billing_type, p_value_cents, p_net_value_cents,
    p_refunded_value_cents, p_due_date, p_payment_date, p_confirmed_date, p_event_type,
    p_event_created_at
  );
end;
$$;

revoke all on function public.apply_billing_pix_automatic_payment_snapshot(uuid, text, text, text, text, text, uuid, uuid, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_billing_pix_automatic_payment_snapshot(uuid, text, text, text, text, text, uuid, uuid, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz)
  to service_role;


-- Administrative requeue for ignored events after this ingestion ships.
-- Does NOT insert billing_payments. Does NOT grant entitlement. Do not execute in 05F1-R1.
create or replace function private.requeue_ignored_billing_provider_event(
  p_event_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_reason text;
begin
  if p_event_id is null then
    raise exception 'requeue_ignored_billing_provider_event: event id required'
      using errcode = '22023', hint = 'INVALID_IDENTIFIERS';
  end if;

  select processing_status, last_error_category
    into v_status, v_reason
    from private.billing_provider_events
   where id = p_event_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'event_not_found');
  end if;
  if v_status is distinct from 'ignored' then
    return jsonb_build_object('outcome', 'not_ignored', 'status', v_status);
  end if;
  if v_reason not in ('ignored_non_subscription_payment', 'ignored_unmanaged_resource') then
    return jsonb_build_object('outcome', 'reason_not_requeueable', 'reason', v_reason);
  end if;

  update private.billing_provider_events
     set processing_status = 'received',
         processed_at = null,
         claimed_at = null,
         last_error_category = null,
         next_attempt_at = null,
         attempts = 0
   where id = p_event_id
     and processing_status = 'ignored';

  return jsonb_build_object(
    'outcome', 'requeued',
    'previous_reason', v_reason,
    'entitlement_granted', false
  );
end;
$$;

comment on function private.requeue_ignored_billing_provider_event(uuid) is
  'WP-ASAAS-05F1-R1: admin replay of ignored PAYMENT_* into received. service_role only. '
  'No financial insert. No entitlement.';

revoke all on function private.requeue_ignored_billing_provider_event(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.requeue_ignored_billing_provider_event(p_event_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.requeue_ignored_billing_provider_event(p_event_id);
end;
$$;

revoke all on function public.requeue_ignored_billing_provider_event(uuid)
  from public, anon, authenticated;
grant execute on function public.requeue_ignored_billing_provider_event(uuid)
  to service_role;
