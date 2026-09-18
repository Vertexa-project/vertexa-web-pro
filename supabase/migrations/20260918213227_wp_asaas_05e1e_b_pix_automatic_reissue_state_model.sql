-- =====================================================================================
-- WP-ASAAS-05E1E-B — Pix Automatic authorization reissue state model.
--
-- Local only. Do not apply remotely in this WP.
-- No HTTP. No provider CREATE. No entitlement. No public mutation path.
--
-- THIS WP reissues only after REFUSED.
-- CANCELLED / EXPIRED are explicitly unsupported (BILLING_REISSUE_STATUS_UNSUPPORTED).
-- There is no REFUSED → INTENT transition.
-- =====================================================================================

-- ── Schema ───────────────────────────────────────────────────────────────────

alter table private.billing_pix_automatic_authorizations
  add column if not exists generation integer;

update private.billing_pix_automatic_authorizations
   set generation = 1
 where generation is null;

alter table private.billing_pix_automatic_authorizations
  alter column generation set default 1,
  alter column generation set not null;

alter table private.billing_pix_automatic_authorizations
  drop constraint if exists billing_pix_automatic_authorizations_generation_check;

alter table private.billing_pix_automatic_authorizations
  add constraint billing_pix_automatic_authorizations_generation_check
    check (generation >= 1);

comment on column private.billing_pix_automatic_authorizations.generation is
  'WP-ASAAS-05E1E-B: monotonic authorization attempt per commercial contract + environment. '
  'Never reused. Generation 1 is the first attempt, including historical QA #1.';

comment on column private.billing_pix_automatic_authorizations.provider_contract_id is
  'Asaas contractId (<=35). Historical generation 1 may be the commercial-contract compact UUID. '
  'New attempts persist the authorization-row compact UUID. Never rewritten after provider reservation.';

create unique index if not exists billing_pix_automatic_authorizations_generation_uidx
  on private.billing_pix_automatic_authorizations (
    commercial_contract_id,
    environment,
    generation
  );

create unique index if not exists billing_pix_automatic_authorizations_provider_contract_uidx
  on private.billing_pix_automatic_authorizations (environment, provider_contract_id);

alter table private.billing_outbound_operations
  add column if not exists pix_authorization_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'billing_outbound_operations_pix_authorization_fkey'
  ) then
    alter table private.billing_outbound_operations
      add constraint billing_outbound_operations_pix_authorization_fkey
        foreign key (pix_authorization_id)
        references private.billing_pix_automatic_authorizations(id)
        on delete restrict;
  end if;
end $$;

comment on column private.billing_outbound_operations.pix_authorization_id is
  'WP-ASAAS-05E1E-B: outbound create_pix_automatic_authorization binds to one authorization attempt. '
  'Immutable after first set.';

create index if not exists billing_outbound_operations_pix_authorization_idx
  on private.billing_outbound_operations (pix_authorization_id)
  where pix_authorization_id is not null;

-- Historical #1: keep REFUSED, provider id, events, is_primary, provider_contract_id.
-- Bind the existing completed outbound row to that authorization. Do not create #2.
update private.billing_outbound_operations o
   set pix_authorization_id = a.id,
       updated_at = o.updated_at
  from private.billing_pix_automatic_authorizations a
 where o.pix_authorization_id is null
   and o.operation_type = 'create_pix_automatic_authorization'
   and o.commercial_contract_id = a.commercial_contract_id
   and o.environment = a.environment
   and a.is_primary
   and a.generation = 1;

create or replace function private.billing_protect_pix_authorization_bind()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.pix_authorization_id is not null
     and new.pix_authorization_id is distinct from old.pix_authorization_id then
    raise exception 'BILLING_PIX_AUTHORIZATION_REBIND_FORBIDDEN'
      using errcode = '22023', hint = 'BILLING_PIX_AUTHORIZATION_REBIND_FORBIDDEN';
  end if;
  return new;
end;
$$;

revoke all on function private.billing_protect_pix_authorization_bind()
  from public, anon, authenticated, service_role;

drop trigger if exists billing_outbound_operations_protect_pix_authorization_bind
  on private.billing_outbound_operations;

create trigger billing_outbound_operations_protect_pix_authorization_bind
  before update on private.billing_outbound_operations
  for each row
  execute function private.billing_protect_pix_authorization_bind();


-- ── Key helpers ──────────────────────────────────────────────────────────────

create or replace function private.billing_pix_automatic_attempt_idempotency_key(
  p_billing_account_id uuid,
  p_authorization_id uuid
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select p_billing_account_id::text
      || ':create_pix_automatic_authorization:'
      || p_authorization_id::text;
$$;

create or replace function private.billing_pix_automatic_attempt_external_reference(
  p_environment text,
  p_billing_account_id uuid,
  p_authorization_id uuid
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'vtx:' || p_environment
      || ':' || p_billing_account_id::text
      || ':pix_automatic_authorization:'
      || p_authorization_id::text;
$$;

revoke all on function private.billing_pix_automatic_attempt_idempotency_key(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.billing_pix_automatic_attempt_external_reference(text, uuid, uuid)
  from public, anon, authenticated, service_role;


-- ── Shared commercial lock + eligibility ─────────────────────────────────────

create or replace function private.billing_pix_automatic_lock_commercial_context(
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

  return jsonb_build_object(
    'clinic_id', v_clinic_id,
    'plan_version_id', v_plan_version_id,
    'commercial_offer_id', v_offer_id,
    'contracted_price_cents', v_price,
    'contracted_currency', v_currency,
    'billing_cycle', v_cycle,
    'billing_account_id', v_account_id,
    'billing_account_created', v_account_created,
    'external_customer_id', v_external_customer_id,
    'identity_complete', v_identity_complete,
    'asaas_amount', v_asaas_amount,
    'activation_date', v_activation
  );
end;
$$;

comment on function private.billing_pix_automatic_lock_commercial_context(uuid, text) is
  'WP-ASAAS-05E1E-B: shared PREPARE/REISSUE eligibility + clinic advisory lock. No HTTP.';

revoke all on function private.billing_pix_automatic_lock_commercial_context(uuid, text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_pix_automatic_lock_contract_authorizations(
  p_commercial_contract_id uuid,
  p_environment text
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform 1
    from private.billing_pix_automatic_authorizations a
   where a.commercial_contract_id = p_commercial_contract_id
     and a.environment = p_environment
   order by a.generation, a.id
   for update;
end;
$$;

revoke all on function private.billing_pix_automatic_lock_contract_authorizations(uuid, text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_pix_automatic_existing_outbound_keys(
  p_authorization_id uuid,
  p_commercial_contract_id uuid,
  p_environment text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_ref text;
begin
  select o.idempotency_key, o.external_reference
    into v_key, v_ref
    from private.billing_outbound_operations o
   where o.operation_type = 'create_pix_automatic_authorization'
     and o.environment = p_environment
     and (
       o.pix_authorization_id = p_authorization_id
       or (
         o.pix_authorization_id is null
         and o.commercial_contract_id = p_commercial_contract_id
       )
     )
   order by case when o.pix_authorization_id = p_authorization_id then 0 else 1 end,
            o.created_at
   limit 1;

  if v_key is null then
    return null;
  end if;

  return jsonb_build_object(
    'idempotency_key', v_key,
    'external_reference', v_ref
  );
end;
$$;

revoke all on function private.billing_pix_automatic_existing_outbound_keys(uuid, uuid, text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_pix_automatic_bind_prepared_operation(
  p_operation_id uuid,
  p_commercial_contract_id uuid,
  p_authorization_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_operation_id is null then
    return;
  end if;

  update private.billing_outbound_operations
     set commercial_contract_id = coalesce(commercial_contract_id, p_commercial_contract_id),
         pix_authorization_id = coalesce(pix_authorization_id, p_authorization_id),
         updated_at = clock_timestamp()
   where id = p_operation_id;
end;
$$;

revoke all on function private.billing_pix_automatic_bind_prepared_operation(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;


create or replace function private.billing_pix_automatic_prepare_response(
  p_outcome text,
  p_context jsonb,
  p_commercial_contract_id uuid,
  p_authorization_id uuid,
  p_provider_status text,
  p_provider_contract_id text,
  p_generation integer,
  p_is_primary boolean,
  p_recurrence date,
  p_customer_reserve jsonb,
  p_auth_reserve jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'outcome', p_outcome,
    'strategy', 'pix_automatic',
    'commercial_contract_id', p_commercial_contract_id,
    'clinic_id', p_context->>'clinic_id',
    'plan_version_id', p_context->>'plan_version_id',
    'commercial_offer_id', p_context->'commercial_offer_id',
    'contracted_price_cents', (p_context->>'contracted_price_cents')::integer,
    'contracted_currency', p_context->>'contracted_currency',
    'billing_cycle', p_context->>'billing_cycle',
    'asaas_amount', (p_context->>'asaas_amount')::numeric,
    'frequency', 'MONTHLY',
    'payment_creation_mode', 'SUBSCRIPTION',
    'retry_policy', 'ALLOW_THREE_IN_SEVEN_DAYS',
    'finish_date', null,
    'activation_date', (p_context->>'activation_date')::date,
    'recurrence_start_date', p_recurrence,
    'timezone', 'America/Sao_Paulo',
    'provider_contract_id', p_provider_contract_id,
    'description', 'Vertexa - assinatura mensal',
    'authorization_id', p_authorization_id,
    'provider_status', p_provider_status,
    'generation', p_generation,
    'is_primary', p_is_primary,
    'billing_account_id', (p_context->>'billing_account_id')::uuid,
    'billing_account_created', (p_context->>'billing_account_created')::boolean,
    'provider_customer_ready', (p_context->>'external_customer_id' is not null),
    'identity_complete', (p_context->>'identity_complete')::boolean,
    'customer_operation', p_customer_reserve,
    'authorization_operation', p_auth_reserve,
    'subscription_operation', null,
    'charge_operation', null,
    'provider_eligibility', 'unconfirmed',
    'http_blocked_reason', 'ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED',
    'entitlement_granted', false
  );
$$;

revoke all on function private.billing_pix_automatic_prepare_response(
  text, jsonb, uuid, uuid, text, text, integer, boolean, date, jsonb, jsonb
) from public, anon, authenticated, service_role;


create or replace function private.billing_pix_automatic_prepare_authorization_operation(
  p_context jsonb,
  p_environment text,
  p_commercial_contract_id uuid,
  p_authorization_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid := (p_context->>'billing_account_id')::uuid;
  v_customer_id text := p_context->>'external_customer_id';
  v_existing jsonb;
  v_key text;
  v_ref text;
  v_customer_reserve jsonb;
  v_auth_reserve jsonb;
begin
  v_existing := private.billing_pix_automatic_existing_outbound_keys(
    p_authorization_id,
    p_commercial_contract_id,
    p_environment
  );
  if v_existing is not null then
    v_key := v_existing->>'idempotency_key';
    v_ref := v_existing->>'external_reference';
  else
    v_key := private.billing_pix_automatic_attempt_idempotency_key(
      v_account_id,
      p_authorization_id
    );
    v_ref := private.billing_pix_automatic_attempt_external_reference(
      p_environment,
      v_account_id,
      p_authorization_id
    );
  end if;

  if v_customer_id is null then
    v_customer_reserve := private.reserve_billing_outbound_operation(
      v_account_id,
      'asaas',
      p_environment,
      'create_customer',
      v_account_id::text || ':create_customer',
      'vtx:' || p_environment || ':' || v_account_id::text || ':customer'
    );
    perform private.billing_pix_automatic_bind_prepared_operation(
      (v_customer_reserve->>'operation_id')::uuid,
      p_commercial_contract_id,
      null
    );
    return jsonb_build_object(
      'customer_operation', v_customer_reserve,
      'authorization_operation', null
    );
  end if;

  v_auth_reserve := private.insert_prepared_pix_automatic_outbound_operation(
    v_account_id,
    p_environment,
    v_key,
    v_ref
  );
  perform private.billing_pix_automatic_bind_prepared_operation(
    (v_auth_reserve->>'operation_id')::uuid,
    p_commercial_contract_id,
    p_authorization_id
  );

  return jsonb_build_object(
    'customer_operation', null,
    'authorization_operation', v_auth_reserve
  );
end;
$$;

revoke all on function private.billing_pix_automatic_prepare_authorization_operation(
  jsonb, text, uuid, uuid
) from public, anon, authenticated, service_role;


-- ── PREPARE: never silently reissue REFUSED ──────────────────────────────────

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
  v_ctx jsonb;
  v_activation date;
  v_recurrence date;
  v_auth private.billing_pix_automatic_authorizations%rowtype;
  v_auth_id uuid;
  v_provider_ref text;
  v_ops jsonb;
begin
  v_ctx := private.billing_pix_automatic_lock_commercial_context(
    p_commercial_contract_id,
    v_environment
  );
  v_activation := (v_ctx->>'activation_date')::date;

  perform private.billing_pix_automatic_lock_contract_authorizations(
    p_commercial_contract_id,
    v_environment
  );

  select * into v_auth
    from private.billing_pix_automatic_authorizations
   where commercial_contract_id = p_commercial_contract_id
     and environment = v_environment
     and is_primary;

  if found then
    if v_auth.provider_status = 'REFUSED' then
      return private.billing_pix_automatic_prepare_response(
        'refused_requires_reissue',
        v_ctx,
        p_commercial_contract_id,
        v_auth.id,
        v_auth.provider_status,
        v_auth.provider_contract_id,
        v_auth.generation,
        v_auth.is_primary,
        v_auth.recurrence_start_date,
        null,
        null
      );
    end if;

    if v_auth.provider_status in ('CANCELLED', 'EXPIRED') then
      return private.billing_pix_automatic_prepare_response(
        'terminal_reissue_unsupported',
        v_ctx,
        p_commercial_contract_id,
        v_auth.id,
        v_auth.provider_status,
        v_auth.provider_contract_id,
        v_auth.generation,
        v_auth.is_primary,
        v_auth.recurrence_start_date,
        null,
        null
      );
    end if;

    v_ops := private.billing_pix_automatic_prepare_authorization_operation(
      v_ctx,
      v_environment,
      p_commercial_contract_id,
      v_auth.id
    );

    return private.billing_pix_automatic_prepare_response(
      'prepared',
      v_ctx,
      p_commercial_contract_id,
      v_auth.id,
      v_auth.provider_status,
      v_auth.provider_contract_id,
      v_auth.generation,
      v_auth.is_primary,
      v_auth.recurrence_start_date,
      v_ops->'customer_operation',
      v_ops->'authorization_operation'
    );
  end if;

  v_auth_id := gen_random_uuid();
  v_provider_ref := private.billing_pix_automatic_contract_id(v_auth_id);
  v_recurrence := private.billing_add_calendar_months(v_activation, 1);

  insert into private.billing_pix_automatic_authorizations (
    id,
    commercial_contract_id,
    billing_account_id,
    environment,
    provider_status,
    is_primary,
    generation,
    frequency,
    payment_creation_mode,
    retry_policy,
    recurrence_start_date,
    provider_contract_id
  ) values (
    v_auth_id,
    p_commercial_contract_id,
    (v_ctx->>'billing_account_id')::uuid,
    v_environment,
    'INTENT',
    true,
    1,
    'MONTHLY',
    'SUBSCRIPTION',
    'ALLOW_THREE_IN_SEVEN_DAYS',
    v_recurrence,
    v_provider_ref
  );

  v_ops := private.billing_pix_automatic_prepare_authorization_operation(
    v_ctx,
    v_environment,
    p_commercial_contract_id,
    v_auth_id
  );

  return private.billing_pix_automatic_prepare_response(
    'prepared',
    v_ctx,
    p_commercial_contract_id,
    v_auth_id,
    'INTENT',
    v_provider_ref,
    1,
    true,
    v_recurrence,
    v_ops->'customer_operation',
    v_ops->'authorization_operation'
  );
end;
$$;

comment on function private.billing_prepare_pix_automatic_authorization(uuid, text) is
  'WP-ASAAS-05E1E-B: PREPARE current authorization only. REFUSED returns '
  'refused_requires_reissue and does not create a new attempt. Insert-only outbound. No HTTP.';

revoke all on function private.billing_prepare_pix_automatic_authorization(uuid, text)
  from public, anon, authenticated, service_role;


-- ── Explicit REISSUE after REFUSED ───────────────────────────────────────────

create or replace function private.billing_reissue_pix_automatic_authorization(
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
  v_ctx jsonb;
  v_activation date;
  v_recurrence date;
  v_primary private.billing_pix_automatic_authorizations%rowtype;
  v_next integer;
  v_auth_id uuid;
  v_provider_ref text;
  v_ops jsonb;
begin
  v_ctx := private.billing_pix_automatic_lock_commercial_context(
    p_commercial_contract_id,
    v_environment
  );
  v_activation := (v_ctx->>'activation_date')::date;

  perform private.billing_pix_automatic_lock_contract_authorizations(
    p_commercial_contract_id,
    v_environment
  );

  select * into v_primary
    from private.billing_pix_automatic_authorizations
   where commercial_contract_id = p_commercial_contract_id
     and environment = v_environment
     and is_primary;

  if not found then
    raise exception 'BILLING_REISSUE_NO_PRIMARY'
      using errcode = 'P0002', hint = 'BILLING_REISSUE_NO_PRIMARY';
  end if;

  if v_primary.provider_status = 'INTENT' then
    v_ops := private.billing_pix_automatic_prepare_authorization_operation(
      v_ctx,
      v_environment,
      p_commercial_contract_id,
      v_primary.id
    );
    return private.billing_pix_automatic_prepare_response(
      'already_reissued',
      v_ctx,
      p_commercial_contract_id,
      v_primary.id,
      v_primary.provider_status,
      v_primary.provider_contract_id,
      v_primary.generation,
      v_primary.is_primary,
      v_primary.recurrence_start_date,
      v_ops->'customer_operation',
      v_ops->'authorization_operation'
    );
  end if;

  if v_primary.provider_status in ('CREATED', 'ACTIVE') then
    raise exception 'BILLING_REISSUE_NOT_REFUSED'
      using errcode = '22023', hint = 'BILLING_REISSUE_NOT_REFUSED';
  end if;

  if v_primary.provider_status in ('CANCELLED', 'EXPIRED') then
    raise exception 'BILLING_REISSUE_STATUS_UNSUPPORTED'
      using errcode = '22023', hint = 'BILLING_REISSUE_STATUS_UNSUPPORTED';
  end if;

  if v_primary.provider_status is distinct from 'REFUSED' then
    raise exception 'BILLING_REISSUE_NOT_REFUSED'
      using errcode = '22023', hint = 'BILLING_REISSUE_NOT_REFUSED';
  end if;

  select coalesce(max(a.generation), 0) + 1
    into v_next
    from private.billing_pix_automatic_authorizations a
   where a.commercial_contract_id = p_commercial_contract_id
     and a.environment = v_environment;

  v_auth_id := gen_random_uuid();
  v_provider_ref := private.billing_pix_automatic_contract_id(v_auth_id);
  v_recurrence := private.billing_add_calendar_months(v_activation, 1);

  update private.billing_pix_automatic_authorizations
     set is_primary = false,
         updated_at = clock_timestamp()
   where id = v_primary.id
     and is_primary
     and provider_status = 'REFUSED';

  if not found then
    raise exception 'BILLING_REISSUE_PRIMARY_RACE'
      using errcode = '40001', hint = 'BILLING_REISSUE_PRIMARY_RACE';
  end if;

  insert into private.billing_pix_automatic_authorizations (
    id,
    commercial_contract_id,
    billing_account_id,
    environment,
    provider_status,
    is_primary,
    generation,
    frequency,
    payment_creation_mode,
    retry_policy,
    recurrence_start_date,
    provider_contract_id
  ) values (
    v_auth_id,
    p_commercial_contract_id,
    (v_ctx->>'billing_account_id')::uuid,
    v_environment,
    'INTENT',
    true,
    v_next,
    'MONTHLY',
    'SUBSCRIPTION',
    'ALLOW_THREE_IN_SEVEN_DAYS',
    v_recurrence,
    v_provider_ref
  );

  v_ops := private.billing_pix_automatic_prepare_authorization_operation(
    v_ctx,
    v_environment,
    p_commercial_contract_id,
    v_auth_id
  );

  return private.billing_pix_automatic_prepare_response(
    'reissued',
    v_ctx,
    p_commercial_contract_id,
    v_auth_id,
    'INTENT',
    v_provider_ref,
    v_next,
    true,
    v_recurrence,
    v_ops->'customer_operation',
    v_ops->'authorization_operation'
  );
end;
$$;

comment on function private.billing_reissue_pix_automatic_authorization(uuid, text) is
  'WP-ASAAS-05E1E-B: explicit REISSUE after REFUSED. Demotes historical primary and inserts '
  'a new INTENT generation. Concurrent loser returns already_reissued. No HTTP. No public RPC.';

revoke all on function private.billing_reissue_pix_automatic_authorization(uuid, text)
  from public, anon, authenticated, service_role;


-- ── Loader binds operation → authorization attempt ───────────────────────────

create or replace function private.load_prepared_pix_automatic_authorization(
  p_operation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op private.billing_outbound_operations%rowtype;
  v_account private.billing_accounts%rowtype;
  v_contract private.billing_commercial_contracts%rowtype;
  v_auth private.billing_pix_automatic_authorizations%rowtype;
  v_load_state text;
  v_actionable boolean;
  v_err text;
  v_unknown boolean;
begin
  if p_operation_id is null then
    return jsonb_build_object('found', false, 'error', 'operation_not_found');
  end if;

  select * into v_op
    from private.billing_outbound_operations
   where id = p_operation_id;

  if not found then
    return jsonb_build_object('found', false, 'error', 'operation_not_found');
  end if;

  if v_op.provider is distinct from 'asaas' then
    return jsonb_build_object('found', false, 'error', 'operation_provider_mismatch');
  end if;

  if v_op.operation_type is distinct from 'create_pix_automatic_authorization' then
    return jsonb_build_object('found', false, 'error', 'operation_type_mismatch');
  end if;

  if v_op.environment is distinct from 'sandbox'
     and v_op.environment is distinct from 'production' then
    return jsonb_build_object('found', false, 'error', 'invalid_operation_environment');
  end if;

  if v_op.billing_account_id is null then
    return jsonb_build_object('found', false, 'error', 'missing_billing_account');
  end if;

  select * into v_account
    from private.billing_accounts
   where id = v_op.billing_account_id;

  if not found then
    return jsonb_build_object('found', false, 'error', 'missing_billing_account');
  end if;

  if v_account.environment is distinct from v_op.environment then
    return jsonb_build_object('found', false, 'error', 'environment_mismatch');
  end if;

  if v_op.commercial_contract_id is null then
    return jsonb_build_object('found', false, 'error', 'missing_commercial_contract');
  end if;

  select * into v_contract
    from private.billing_commercial_contracts
   where id = v_op.commercial_contract_id;

  if not found then
    return jsonb_build_object('found', false, 'error', 'missing_commercial_contract');
  end if;

  if v_account.clinic_id is distinct from v_contract.clinic_id then
    return jsonb_build_object('found', false, 'error', 'relationship_mismatch');
  end if;

  if v_contract.contracted_price_cents is null
     or v_contract.contracted_price_cents < 0
     or v_contract.contracted_currency is distinct from 'BRL' then
    return jsonb_build_object('found', false, 'error', 'contract_snapshot_invalid');
  end if;

  if v_op.pix_authorization_id is not null then
    select * into v_auth
      from private.billing_pix_automatic_authorizations
     where id = v_op.pix_authorization_id;
  else
    select * into v_auth
      from private.billing_pix_automatic_authorizations
     where commercial_contract_id = v_op.commercial_contract_id
       and environment = v_op.environment
       and is_primary;
  end if;

  if not found then
    return jsonb_build_object('found', false, 'error', 'missing_authorization_intent');
  end if;

  if v_auth.billing_account_id is distinct from v_op.billing_account_id
     or v_auth.commercial_contract_id is distinct from v_op.commercial_contract_id
     or v_auth.environment is distinct from v_op.environment then
    return jsonb_build_object('found', false, 'error', 'relationship_mismatch');
  end if;

  if v_op.pix_authorization_id is not null
     and v_auth.id is distinct from v_op.pix_authorization_id then
    return jsonb_build_object('found', false, 'error', 'relationship_mismatch');
  end if;

  if v_auth.provider_contract_id is null
     or v_auth.provider_contract_id !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('found', false, 'error', 'relationship_mismatch');
  end if;

  if v_auth.recurrence_start_date is null then
    return jsonb_build_object('found', false, 'error', 'missing_authorization_intent');
  end if;

  v_unknown := v_op.last_error_category is null
    or v_op.last_error_category not in ('http_4xx', 'rate_limited');

  if v_op.status = 'completed' then
    v_load_state := 'already_completed';
    v_actionable := true;
  elsif v_op.status = 'pending' then
    v_load_state := 'actionable';
    v_actionable := true;
  elsif v_op.status = 'failed' and v_unknown then
    v_load_state := 'outcome_unknown_requires_reconciliation';
    v_actionable := true;
  elsif v_op.status = 'failed' then
    v_load_state := 'actionable';
    v_actionable := true;
  else
    v_load_state := 'not_actionable';
    v_actionable := false;
  end if;

  v_err := null;

  return jsonb_build_object(
    'found', true,
    'error', v_err,
    'operation_id', v_op.id,
    'operation_type', v_op.operation_type,
    'operation_status', v_op.status,
    'last_error_category', v_op.last_error_category,
    'load_state', v_load_state,
    'actionable', v_actionable,
    'provider', v_op.provider,
    'environment', v_op.environment,
    'billing_account_id', v_op.billing_account_id,
    'commercial_contract_id', v_op.commercial_contract_id,
    'external_customer_id', v_account.external_customer_id,
    'contracted_price_cents', v_contract.contracted_price_cents,
    'contracted_currency', v_contract.contracted_currency,
    'recurrence_start_date', to_char(v_auth.recurrence_start_date, 'YYYY-MM-DD'),
    'authorization_id', v_auth.id,
    'authorization_provider_status', v_auth.provider_status,
    'provider_contract_id', v_auth.provider_contract_id,
    'generation', v_auth.generation,
    'idempotency_key', v_op.idempotency_key,
    'external_reference', v_op.external_reference
  );
end;
$$;

comment on function private.load_prepared_pix_automatic_authorization(uuid) is
  'WP-ASAAS-05E1E-B: load the authorization attempt bound to the outbound operation. '
  'Does not select "whatever is primary" when pix_authorization_id is present.';

revoke all on function private.load_prepared_pix_automatic_authorization(uuid)
  from public, anon, authenticated, service_role;


-- ── Complete binds to the operation's authorization, not current primary ─────

create or replace function private.complete_billing_pix_automatic_authorization_operation(
  p_operation_id uuid,
  p_provider_authorization_id text,
  p_provider_status text,
  p_provider_customer_id text,
  p_conciliation_identifier text,
  p_qr_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_env text;
  v_type text;
  v_status text;
  v_existing text;
  v_contract uuid;
  v_bound uuid;
  v_auth uuid;
  v_auth_id text := btrim(coalesce(p_provider_authorization_id, ''));
  v_prov_status text := btrim(coalesce(p_provider_status, 'CREATED'));
begin
  if v_auth_id = '' then
    raise exception 'complete_pix_automatic_authorization: provider id required'
      using errcode = '22023', hint = 'EXTERNAL_ID_REQUIRED';
  end if;
  if v_prov_status not in ('CREATED', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'REFUSED') then
    v_prov_status := 'CREATED';
  end if;

  select billing_account_id, environment, operation_type, status, external_object_id,
         commercial_contract_id, pix_authorization_id
    into v_account, v_env, v_type, v_status, v_existing, v_contract, v_bound
    from private.billing_outbound_operations
   where id = p_operation_id
   for update;

  if not found then
    raise exception 'complete_pix_automatic_authorization: operation not found'
      using errcode = 'P0002', hint = 'OPERATION_NOT_FOUND';
  end if;
  if v_type is distinct from 'create_pix_automatic_authorization' then
    raise exception 'complete_pix_automatic_authorization: type mismatch'
      using errcode = '22023', hint = 'OPERATION_TYPE_MISMATCH';
  end if;

  if v_status = 'completed' then
    if v_existing is distinct from v_auth_id then
      return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id);
    end if;
    return jsonb_build_object(
      'outcome', 'already_completed',
      'provider_authorization_id', v_existing
    );
  end if;

  if v_bound is not null then
    select id into v_auth
      from private.billing_pix_automatic_authorizations
     where id = v_bound
     for update;
  else
    select id into v_auth
      from private.billing_pix_automatic_authorizations
     where commercial_contract_id = v_contract
       and environment = v_env
       and is_primary
     for update;
  end if;

  if v_auth is null then
    raise exception 'complete_pix_automatic_authorization: intent missing'
      using errcode = 'P0002', hint = 'AUTHORIZATION_INTENT_MISSING';
  end if;

  update private.billing_pix_automatic_authorizations
     set provider_authorization_id = v_auth_id,
         provider_status = v_prov_status,
         provider_customer_id = nullif(btrim(coalesce(p_provider_customer_id, '')), ''),
         conciliation_identifier = nullif(btrim(coalesce(p_conciliation_identifier, '')), ''),
         qr_expires_at = p_qr_expires_at,
         updated_at = clock_timestamp()
   where id = v_auth;

  update private.billing_outbound_operations
     set status = 'completed',
         external_object_id = v_auth_id,
         pix_authorization_id = coalesce(pix_authorization_id, v_auth),
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_operation_id;

  return jsonb_build_object(
    'outcome', 'completed',
    'authorization_id', v_auth,
    'provider_authorization_id', v_auth_id,
    'provider_status', v_prov_status
  );
end;
$$;

revoke all on function private.complete_billing_pix_automatic_authorization_operation(
  uuid, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;


-- ── Apply: provider id first; contractId fallback never uses is_primary ───────

create or replace function private.apply_billing_pix_automatic_authorization_event(
  p_event_id uuid,
  p_environment text,
  p_provider_authorization_id text,
  p_provider_status text,
  p_provider_customer_id text,
  p_provider_contract_id text,
  p_provider_value_cents integer,
  p_event_created_at timestamptz,
  p_conciliation_identifier text,
  p_qr_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env text := btrim(coalesce(p_environment, ''));
  v_pid text := btrim(coalesce(p_provider_authorization_id, ''));
  v_status text := btrim(coalesce(p_provider_status, ''));
  v_cust text := btrim(coalesce(p_provider_customer_id, ''));
  v_contract_id text := btrim(coalesce(p_provider_contract_id, ''));
  v_auth private.billing_pix_automatic_authorizations%rowtype;
  v_account_customer text;
  v_price integer;
  v_mismatch boolean := false;
  v_event_status text;
begin
  if v_env not in ('sandbox', 'production') then
    return jsonb_build_object('outcome', 'ignored', 'reason', 'invalid_environment');
  end if;
  if v_pid = '' or v_status not in ('CREATED', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'REFUSED') then
    return jsonb_build_object('outcome', 'ignored', 'reason', 'invalid_provider_facts');
  end if;

  select processing_status into v_event_status
    from private.billing_provider_events
   where id = p_event_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'event_not_found');
  end if;
  if v_event_status is distinct from 'processing' then
    return jsonb_build_object('outcome', 'event_not_claimed');
  end if;

  select * into v_auth
    from private.billing_pix_automatic_authorizations
   where environment = v_env
     and provider_authorization_id = v_pid
   for update;

  if not found and v_contract_id ~ '^[0-9a-f]{32}$' then
    select * into v_auth
      from private.billing_pix_automatic_authorizations
     where environment = v_env
       and provider_contract_id = v_contract_id
     for update;
  end if;

  if v_auth.id is null then
    update private.billing_provider_events
       set processing_status = 'ignored',
           processed_at = clock_timestamp(),
           last_error_category = 'ignored_unmanaged_resource'
     where id = p_event_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'ignored_unmanaged_resource');
  end if;

  if v_auth.environment is distinct from v_env then
    update private.billing_provider_events
       set processing_status = 'failed',
           last_error_category = 'environment_mismatch',
           next_attempt_at = null
     where id = p_event_id;
    return jsonb_build_object('outcome', 'failed', 'reason', 'environment_mismatch');
  end if;

  select a.external_customer_id into v_account_customer
    from private.billing_accounts a
   where a.id = v_auth.billing_account_id;

  if v_cust <> '' and v_account_customer is not null
     and v_cust is distinct from v_account_customer then
    update private.billing_provider_events
       set processing_status = 'failed',
           last_error_category = 'customer_mismatch',
           next_attempt_at = null
     where id = p_event_id;
    return jsonb_build_object('outcome', 'failed', 'reason', 'customer_mismatch');
  end if;

  if p_event_created_at is not null
     and v_auth.provider_event_at is not null
     and p_event_created_at < v_auth.provider_event_at
     and v_status is distinct from v_auth.provider_status then
    update private.billing_provider_events
       set processing_status = 'ignored',
           processed_at = clock_timestamp(),
           last_error_category = 'ignored_stale'
     where id = p_event_id;
    return jsonb_build_object(
      'outcome', 'ignored',
      'reason', 'ignored_stale',
      'provider_status', v_auth.provider_status
    );
  end if;

  if not private.billing_pix_automatic_transition_allowed(v_auth.provider_status, v_status) then
    update private.billing_provider_events
       set processing_status = 'ignored',
           processed_at = clock_timestamp(),
           last_error_category = 'ignored_stale'
     where id = p_event_id;
    return jsonb_build_object(
      'outcome', 'ignored',
      'reason', 'ignored_stale',
      'provider_status', v_auth.provider_status
    );
  end if;

  select cc.contracted_price_cents into v_price
    from private.billing_commercial_contracts cc
   where cc.id = v_auth.commercial_contract_id;

  if p_provider_value_cents is not null and v_price is not null
     and p_provider_value_cents is distinct from v_price then
    v_mismatch := true;
  end if;

  update private.billing_pix_automatic_authorizations
     set provider_authorization_id = v_pid,
         provider_status = v_status,
         provider_customer_id = nullif(v_cust, ''),
         provider_event_at = coalesce(p_event_created_at, provider_event_at, clock_timestamp()),
         conciliation_identifier = coalesce(
           nullif(btrim(coalesce(p_conciliation_identifier, '')), ''),
           conciliation_identifier
         ),
         qr_expires_at = coalesce(p_qr_expires_at, qr_expires_at),
         amount_mismatch = (amount_mismatch or v_mismatch),
         updated_at = clock_timestamp()
   where id = v_auth.id;

  update private.billing_outbound_operations
     set status = 'completed',
         external_object_id = coalesce(external_object_id, v_pid),
         completed_at = coalesce(completed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where billing_account_id = v_auth.billing_account_id
     and environment = v_env
     and operation_type = 'create_pix_automatic_authorization'
     and status = 'pending'
     and (
       pix_authorization_id = v_auth.id
       or (
         pix_authorization_id is null
         and commercial_contract_id = v_auth.commercial_contract_id
       )
     );

  update private.billing_provider_events
     set processing_status = 'processed',
         processed_at = clock_timestamp(),
         last_error_category = case when v_mismatch then 'PROVIDER_AMOUNT_MISMATCH' else null end
   where id = p_event_id;

  return jsonb_build_object(
    'outcome', 'applied',
    'authorization_id', v_auth.id,
    'provider_status', v_status,
    'amount_mismatch', v_mismatch,
    'commercial_mutated', false,
    'entitlement_granted', false
  );
end;
$$;

revoke all on function private.apply_billing_pix_automatic_authorization_event(
  uuid, text, text, text, text, text, integer, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260918213227',
  '20260918213227_wp_asaas_05e1e_b_pix_automatic_reissue_state_model.sql',
  'WP-ASAAS-05E1E-B: Pix Automatic reissue after REFUSED. generation + unique provider_contract_id '
  '+ explicit REISSUE. Historical #1 stays REFUSED. No HTTP, no entitlement, no public RPC.',
  'WP-ASAAS-05E1E-B'
)
on conflict (version) do nothing;
