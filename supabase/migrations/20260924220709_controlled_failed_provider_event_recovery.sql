-- WP-BILLING-MASTER-QA-02R12: controlled recovery for one terminal
-- provider event after the hosted-card customer-adoption code upgrade.
--
-- The recovery operation is deliberately not a financial processor. It only
-- performs one audited failed -> received transition. The existing processor
-- remains responsible for authoritative provider GETs and every customer,
-- subscription, payment, contract, or entitlement decision.

create table private.billing_provider_event_recovery_audit (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references private.billing_provider_events(id) on delete restrict,
  provider text not null check (provider = 'asaas'),
  environment text not null check (environment in ('sandbox', 'production')),
  recovery_code text not null
    check (recovery_code = 'hosted_card_customer_adoption_upgrade'),
  initiated_by text not null check (initiated_by = 'service_role'),
  previous_status text not null check (previous_status = 'failed'),
  previous_error_category text not null check (btrim(previous_error_category) <> ''),
  previous_attempts integer not null check (previous_attempts >= 0),
  previous_claimed_at timestamptz,
  previous_processed_at timestamptz,
  previous_next_attempt_at timestamptz,
  queued_attempt_number integer not null,
  recovered_at timestamptz not null default clock_timestamp(),
  constraint billing_provider_event_recovery_attempt_number_check
    check (queued_attempt_number = previous_attempts + 1),
  constraint billing_provider_event_recovery_once_uidx
    unique (event_id, recovery_code)
);

comment on table private.billing_provider_event_recovery_audit is
  'R12 append-only audit for a service-role-only, single-event failed -> received recovery. '
  'Stores no provider payload, resource ID, customer PII, or free text.';

create index billing_provider_event_recovery_event_time_idx
  on private.billing_provider_event_recovery_audit (event_id, recovered_at desc);

alter table private.billing_provider_event_recovery_audit enable row level security;
revoke all on table private.billing_provider_event_recovery_audit
  from public, anon, authenticated, service_role;


create or replace function private.requeue_failed_billing_provider_event(
  p_event_id uuid,
  p_environment text,
  p_recovery_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_environment text := nullif(btrim(coalesce(p_environment, '')), '');
  v_recovery_code text := nullif(btrim(coalesce(p_recovery_code, '')), '');
  v_event private.billing_provider_events%rowtype;
  v_queued_attempt integer;
begin
  if p_event_id is null then
    raise exception 'requeue_failed_billing_provider_event: event id required'
      using errcode = '22023', hint = 'INVALID_IDENTIFIERS';
  end if;
  if v_environment not in ('sandbox', 'production') then
    return jsonb_build_object('outcome', 'invalid_environment');
  end if;
  if v_recovery_code is distinct from 'hosted_card_customer_adoption_upgrade' then
    return jsonb_build_object('outcome', 'recovery_code_not_allowed');
  end if;

  -- The advisory lock makes duplicate manual calls serialize before the row
  -- lock. The normal claim RPC uses FOR UPDATE SKIP LOCKED, so it cannot claim
  -- this event halfway through the recovery transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    90412,
    pg_catalog.hashtext('billing-failed-recovery:' || p_event_id::text)
  );

  select * into v_event
    from private.billing_provider_events
   where id = p_event_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'event_not_found');
  end if;

  -- One recovery for this event/code is permanently idempotent, including if
  -- the later processor attempt reaches another terminal outcome.
  if exists (
    select 1
      from private.billing_provider_event_recovery_audit a
     where a.event_id = p_event_id
       and a.recovery_code = v_recovery_code
  ) then
    return jsonb_build_object(
      'outcome', 'already_requeued',
      'recovery_code', v_recovery_code,
      'financial_mutations', false
    );
  end if;

  if v_event.provider is distinct from 'asaas' then
    return jsonb_build_object('outcome', 'provider_not_supported');
  end if;
  if v_event.environment is distinct from v_environment then
    return jsonb_build_object('outcome', 'environment_mismatch');
  end if;
  if v_event.processing_status is distinct from 'failed' then
    return jsonb_build_object('outcome', 'status_not_recoverable');
  end if;
  if v_event.next_attempt_at is not null then
    return jsonb_build_object('outcome', 'automatic_retry_pending');
  end if;
  if v_event.event_type is distinct from 'PAYMENT_CONFIRMED'
     or v_event.external_resource_type is distinct from 'payment'
     or nullif(btrim(coalesce(v_event.external_resource_id, '')), '') is null then
    return jsonb_build_object('outcome', 'event_not_supported');
  end if;
  if nullif(btrim(coalesce(v_event.external_event_id, '')), '') is null
     or char_length(btrim(coalesce(v_event.payload_hash, ''))) < 32 then
    return jsonb_build_object('outcome', 'event_evidence_incomplete');
  end if;

  -- This is the only terminal error whose cause was specifically repaired by
  -- migration 160000 plus processor v22. Security and identity conflicts stay
  -- terminal and cannot be selected by caller-provided free text.
  if v_event.last_error_category is distinct from 'checkout_account_mismatch' then
    return jsonb_build_object('outcome', 'error_not_recoverable');
  end if;
  if pg_catalog.to_regprocedure(
       'public.load_hosted_card_customer_adoption_context(text,text,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.apply_hosted_card_payment_with_customer_adoption(uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,date,date,date,text,timestamp with time zone)'
     ) is null then
    return jsonb_build_object('outcome', 'required_runtime_schema_missing');
  end if;

  -- This recovery is only for an absent canonical fact. Existing payment rows
  -- are never resurrected through this code-upgrade path.
  if exists (
    select 1
      from private.billing_payments p
     where p.provider = v_event.provider
       and p.environment = v_event.environment
       and p.external_payment_id = v_event.external_resource_id
  ) then
    return jsonb_build_object('outcome', 'canonical_financial_fact_exists');
  end if;

  v_queued_attempt := v_event.attempts + 1;
  insert into private.billing_provider_event_recovery_audit (
    event_id,
    provider,
    environment,
    recovery_code,
    initiated_by,
    previous_status,
    previous_error_category,
    previous_attempts,
    previous_claimed_at,
    previous_processed_at,
    previous_next_attempt_at,
    queued_attempt_number
  ) values (
    v_event.id,
    v_event.provider,
    v_event.environment,
    v_recovery_code,
    'service_role',
    v_event.processing_status,
    v_event.last_error_category,
    v_event.attempts,
    v_event.claimed_at,
    v_event.processed_at,
    v_event.next_attempt_at,
    v_queued_attempt
  );

  update private.billing_provider_events
     set processing_status = 'received',
         processed_at = null,
         claimed_at = null,
         next_attempt_at = null
   where id = v_event.id
     and processing_status = 'failed'
     and next_attempt_at is null;
  if not found then
    raise exception 'requeue_failed_billing_provider_event: concurrent state change'
      using errcode = '40001', hint = 'RETRY_OPERATION';
  end if;

  return jsonb_build_object(
    'outcome', 'requeued',
    'recovery_code', v_recovery_code,
    'queued_attempt_number', v_queued_attempt,
    'previous_error_preserved', true,
    'financial_mutations', false
  );
end;
$$;

comment on function private.requeue_failed_billing_provider_event(uuid, text, text) is
  'R12 atomic, one-time recovery of a terminal PAYMENT_CONFIRMED/checkout_account_mismatch '
  'after the hosted-card adoption upgrade. It records append-only evidence and queues only; '
  'the canonical processor must re-fetch authoritative provider facts.';

revoke all on function private.requeue_failed_billing_provider_event(uuid, text, text)
  from public, anon, authenticated, service_role;


create or replace function public.requeue_failed_billing_provider_event(
  p_event_id uuid,
  p_environment text,
  p_recovery_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.requeue_failed_billing_provider_event(
    p_event_id,
    p_environment,
    p_recovery_code
  );
end;
$$;

comment on function public.requeue_failed_billing_provider_event(uuid, text, text) is
  'R12 service-role-only wrapper. Single-event, environment-aware, allowlisted and audited. '
  'Returns no provider identifier, payload, PII, or free text.';

revoke all on function public.requeue_failed_billing_provider_event(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.requeue_failed_billing_provider_event(uuid, text, text)
  to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260924220709',
  '20260924220709_controlled_failed_provider_event_recovery.sql',
  'Service-role-only, audited and allowlisted recovery of one terminal hosted-card provider event.',
  'WP-BILLING-MASTER-QA-02R12'
)
on conflict (version) do nothing;
