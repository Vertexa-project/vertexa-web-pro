-- =====================================================================================
-- WP-BILLING-PREPROD-02 — commercial access gate + dual-environment billing isolation.
-- LOCAL ONLY. Do not apply remotely from this file. Do not create Production accounts.
-- Do not auto-exempt no-contract clinics. Do not enable ENFORCE. Do not unlock writes.
-- =====================================================================================

-- ── A. Commercial access config / exemptions / provider write control ─────────

create table if not exists private.billing_commercial_access_config (
  id boolean primary key default true check (id),
  rollout_mode text not null default 'observe'
    check (rollout_mode in ('observe', 'enforce')),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);

comment on table private.billing_commercial_access_config is
  'PREPROD-02: singleton commercial-gate rollout. Default OBSERVE. Not a paid flag.';

insert into private.billing_commercial_access_config (id, rollout_mode)
values (true, 'observe')
on conflict (id) do nothing;

create table if not exists private.billing_commercial_access_exemptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  reason text not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  constraint billing_commercial_access_exemptions_reason_check
    check (char_length(btrim(reason)) >= 8),
  constraint billing_commercial_access_exemptions_revoke_check
    check ((revoked_at is null) = (revoked_by is null))
);

comment on table private.billing_commercial_access_exemptions is
  'PREPROD-02: PA-only clinic exemption. Not Founder, coupon, payment, or entitlement.';

create unique index if not exists billing_commercial_access_exemptions_active_clinic_uidx
  on private.billing_commercial_access_exemptions (clinic_id)
  where revoked_at is null;

create table if not exists private.billing_provider_write_config (
  id boolean primary key default true check (id),
  write_mode text not null default 'locked'
    check (write_mode in ('locked', 'canary', 'open')),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);

comment on table private.billing_provider_write_config is
  'PREPROD-02: Production provider-write kill switch. Default LOCKED.';

insert into private.billing_provider_write_config (id, write_mode)
values (true, 'locked')
on conflict (id) do nothing;

create table if not exists private.billing_provider_write_canary_clinics (
  clinic_id uuid primary key references public.clinics (id),
  allowed_operations text[] not null default array[
    'ENSURE_CUSTOMER_FROM_IDENTITY',
    'PIX_AUTOMATIC_CREATE'
  ]::text[],
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint billing_provider_write_canary_ops_check
    check (allowed_operations <@ array[
      'ENSURE_CUSTOMER_FROM_IDENTITY',
      'PIX_AUTOMATIC_CREATE'
    ]::text[])
);

comment on table private.billing_provider_write_canary_clinics is
  'PREPROD-02: empty by default. Future single-clinic Production canary allowlist.';

alter table private.billing_commercial_access_config enable row level security;
alter table private.billing_commercial_access_exemptions enable row level security;
alter table private.billing_provider_write_config enable row level security;
alter table private.billing_provider_write_canary_clinics enable row level security;

revoke all on table private.billing_commercial_access_config from public, anon, authenticated, service_role;
revoke all on table private.billing_commercial_access_exemptions from public, anon, authenticated, service_role;
revoke all on table private.billing_provider_write_config from public, anon, authenticated, service_role;
revoke all on table private.billing_provider_write_canary_clinics from public, anon, authenticated, service_role;


create or replace function private.billing_exemption_is_active(
  p_revoked_at timestamptz,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_revoked_at is null
     and (p_expires_at is null or p_expires_at > p_now);
$$;

revoke all on function private.billing_exemption_is_active(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;


create or replace function private.billing_resolve_commercial_access(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_has_contract boolean := false;
  v_exempt boolean := false;
begin
  if p_clinic_id is null or not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'BILLING_CLINIC_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_CLINIC_UNKNOWN';
  end if;

  select rollout_mode into v_mode from private.billing_commercial_access_config where id;
  v_mode := coalesce(v_mode, 'observe');

  select exists(
    select 1
      from private.billing_commercial_contracts cc
     where cc.clinic_id = p_clinic_id
       and cc.status = 'active'
  ) into v_has_contract;

  select exists(
    select 1
      from private.billing_commercial_access_exemptions e
     where e.clinic_id = p_clinic_id
       and private.billing_exemption_is_active(e.revoked_at, e.expires_at, clock_timestamp())
  ) into v_exempt;

  if v_has_contract then
    return jsonb_build_object(
      'clinic_id', p_clinic_id,
      'access_class', 'FULL',
      'reason', 'ACTIVE_CONTRACT',
      'product_allowed', true,
      'rollout_mode', upper(v_mode)
    );
  end if;
  if v_exempt then
    return jsonb_build_object(
      'clinic_id', p_clinic_id,
      'access_class', 'EXEMPT',
      'reason', 'PLATFORM_EXEMPTION',
      'product_allowed', true,
      'rollout_mode', upper(v_mode)
    );
  end if;
  if v_mode = 'observe' then
    return jsonb_build_object(
      'clinic_id', p_clinic_id,
      'access_class', 'PRE_CONTRACT',
      'reason', 'OBSERVE_ONLY',
      'product_allowed', true,
      'rollout_mode', 'OBSERVE'
    );
  end if;
  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'access_class', 'PRE_CONTRACT',
    'reason', 'NO_ACTIVE_CONTRACT',
    'product_allowed', false,
    'rollout_mode', 'ENFORCE'
  );
end;
$$;

comment on function private.billing_resolve_commercial_access(uuid) is
  'PREPROD-02: server access class. Contract != Pix != payment != entitlement.';

revoke all on function private.billing_resolve_commercial_access(uuid)
  from public, anon, authenticated;


create or replace function private.billing_clinical_product_permitted(p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
begin
  if p_clinic_id is null then
    return false;
  end if;
  v_access := private.billing_resolve_commercial_access(p_clinic_id);
  return coalesce((v_access->>'product_allowed')::boolean, false);
end;
$$;

revoke all on function private.billing_clinical_product_permitted(uuid)
  from public, anon, authenticated;


create or replace function private.billing_assert_clinic_commercial_access(p_clinic_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
begin
  v_access := private.billing_resolve_commercial_access(p_clinic_id);
  if not coalesce((v_access->>'product_allowed')::boolean, false) then
    raise exception 'BILLING_PRE_CONTRACT_REQUIRED'
      using errcode = '42501', hint = 'BILLING_PRE_CONTRACT_REQUIRED';
  end if;
end;
$$;

revoke all on function private.billing_assert_clinic_commercial_access(uuid)
  from public, anon, authenticated;


create or replace function private.billing_production_write_allowed(
  p_clinic_id uuid,
  p_operation_type text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_ops text[];
begin
  if btrim(coalesce(p_operation_type, '')) not in (
    'ENSURE_CUSTOMER_FROM_IDENTITY',
    'PIX_AUTOMATIC_CREATE'
  ) then
    return false;
  end if;
  select write_mode into v_mode from private.billing_provider_write_config where id;
  v_mode := coalesce(v_mode, 'locked');
  if v_mode = 'locked' then
    return false;
  end if;
  if v_mode = 'open' then
    return true;
  end if;
  if p_clinic_id is null then
    return false;
  end if;
  select allowed_operations into v_ops
    from private.billing_provider_write_canary_clinics
   where clinic_id = p_clinic_id;
  if v_ops is null then
    return false;
  end if;
  return p_operation_type = any (v_ops);
end;
$$;

revoke all on function private.billing_production_write_allowed(uuid, text)
  from public, anon, authenticated;


create or replace function private.billing_clinic_provider_environment(p_clinic_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_has_prod boolean := false;
  v_canary boolean := false;
begin
  select write_mode into v_mode from private.billing_provider_write_config where id;
  v_mode := coalesce(v_mode, 'locked');
  select exists(
    select 1 from private.billing_accounts a
     where a.clinic_id = p_clinic_id and a.environment = 'production'
  ) into v_has_prod;
  if v_mode = 'locked' or not v_has_prod then
    return 'sandbox';
  end if;
  if v_mode = 'open' then
    return 'production';
  end if;
  select exists(
    select 1 from private.billing_provider_write_canary_clinics c
     where c.clinic_id = p_clinic_id
  ) into v_canary;
  if v_canary then
    return 'production';
  end if;
  return 'sandbox';
end;
$$;

revoke all on function private.billing_clinic_provider_environment(uuid)
  from public, anon, authenticated;


create or replace function private.billing_account_for_clinic(p_clinic_id uuid, p_environment text)
returns private.billing_accounts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account private.billing_accounts%rowtype;
  v_env text := btrim(coalesce(p_environment, ''));
begin
  if v_env not in ('sandbox', 'production') then
    raise exception 'INVALID_ENVIRONMENT'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;
  select * into v_account
    from private.billing_accounts a
   where a.clinic_id = p_clinic_id
     and a.environment = v_env;
  return v_account;
end;
$$;

revoke all on function private.billing_account_for_clinic(uuid, text)
  from public, anon, authenticated;


-- ── B. Dual-environment uniqueness + immutability ────────────────────────────

drop index if exists private.billing_accounts_clinic_uidx;

create unique index if not exists billing_accounts_clinic_environment_uidx
  on private.billing_accounts (clinic_id, environment)
  where clinic_id is not null;

create or replace function private.billing_accounts_environment_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.environment is distinct from old.environment then
    raise exception 'BILLING_ACCOUNT_ENVIRONMENT_IMMUTABLE'
      using errcode = '42501', hint = 'BILLING_ACCOUNT_ENVIRONMENT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_accounts_environment_immutable on private.billing_accounts;
create trigger billing_accounts_environment_immutable
  before update on private.billing_accounts
  for each row
  execute function private.billing_accounts_environment_immutable();


-- ── C. get_or_create by clinic + environment ─────────────────────────────────

create or replace function public.get_or_create_billing_account(
  p_provider text,
  p_environment text,
  p_clinic_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_provider text := btrim(coalesce(p_provider, ''));
  v_environment text := btrim(coalesce(p_environment, ''));
  v_clinic_owner uuid;
  v_linked_id uuid;
  v_existing_env text;
  v_id uuid;
  v_external_customer_id text;
  v_clinic_id uuid;
  v_created boolean := false;
begin
  if v_me is null then
    raise exception 'get_or_create_billing_account: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;
  if v_provider is distinct from 'asaas' then
    raise exception 'get_or_create_billing_account: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_environment not in ('sandbox', 'production') then
    raise exception 'get_or_create_billing_account: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;

  if p_clinic_id is not null then
    if not private.is_clinic_admin(p_clinic_id) then
      raise exception 'get_or_create_billing_account: clinic not owned by caller'
        using errcode = '42501', hint = 'CLINIC_NOT_OWNED';
    end if;

    select c.owner_profile_id into v_clinic_owner
      from public.clinics c
     where c.id = p_clinic_id;
    if v_clinic_owner is null then
      raise exception 'get_or_create_billing_account: clinic not owned by caller'
        using errcode = '42501', hint = 'CLINIC_NOT_OWNED';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      90300,
      pg_catalog.hashtext(p_clinic_id::text || ':' || v_environment)
    );

    select a.id, a.external_customer_id, a.clinic_id, a.environment
      into v_linked_id, v_external_customer_id, v_clinic_id, v_existing_env
      from private.billing_accounts a
     where a.clinic_id = p_clinic_id
       and a.environment = v_environment;

    if found then
      return jsonb_build_object(
        'billing_account_id', v_linked_id,
        'external_customer_id', v_external_customer_id,
        'clinic_id', v_clinic_id,
        'environment', v_existing_env,
        'created', false
      );
    end if;

    if v_environment = 'production'
       and not private.billing_production_write_allowed(p_clinic_id, 'ENSURE_CUSTOMER_FROM_IDENTITY') then
      raise exception 'BILLING_PRODUCTION_LOCKED'
        using errcode = '42501', hint = 'BILLING_PRODUCTION_LOCKED';
    end if;

    select id, external_customer_id
      into v_id, v_external_customer_id
      from private.billing_accounts
     where owner_profile_id = v_clinic_owner
       and provider = v_provider
       and environment = v_environment
       and clinic_id is null
     order by created_at asc
     limit 1;

    if found then
      begin
        update private.billing_accounts
           set clinic_id = p_clinic_id, updated_at = clock_timestamp()
         where id = v_id
           and environment = v_environment;
        v_clinic_id := p_clinic_id;
      exception
        when unique_violation then
          raise exception 'get_or_create_billing_account: clinic already linked to another billing account'
            using errcode = '42501', hint = 'CLINIC_ALREADY_LINKED_TO_OTHER_ACCOUNT';
      end;
    else
      begin
        insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
        values (v_clinic_owner, p_clinic_id, v_provider, v_environment)
        returning id, external_customer_id, clinic_id
          into v_id, v_external_customer_id, v_clinic_id;
        v_created := true;
      exception
        when unique_violation then
          raise exception 'get_or_create_billing_account: clinic already linked to another billing account'
            using errcode = '42501', hint = 'CLINIC_ALREADY_LINKED_TO_OTHER_ACCOUNT';
      end;
    end if;

    return jsonb_build_object(
      'billing_account_id', v_id,
      'external_customer_id', v_external_customer_id,
      'clinic_id', v_clinic_id,
      'environment', v_environment,
      'created', v_created
    );
  end if;

  if v_environment = 'production' then
    raise exception 'BILLING_PRODUCTION_LOCKED'
      using errcode = '42501', hint = 'BILLING_PRODUCTION_LOCKED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90300, pg_catalog.hashtext(v_me::text || ':' || v_environment));

  select id, external_customer_id, clinic_id
    into v_id, v_external_customer_id, v_clinic_id
    from private.billing_accounts
   where owner_profile_id = v_me
     and provider = v_provider
     and environment = v_environment
   order by (clinic_id is not null) desc, created_at asc
   limit 1;

  if not found then
    insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
    values (v_me, null, v_provider, v_environment)
    returning id, external_customer_id, clinic_id
      into v_id, v_external_customer_id, v_clinic_id;
    v_created := true;
  end if;

  return jsonb_build_object(
    'billing_account_id', v_id,
    'external_customer_id', v_external_customer_id,
    'clinic_id', v_clinic_id,
    'environment', v_environment,
    'created', v_created
  );
end;
$$;


create or replace function public.billing_load_provider_customer_context_outbound(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity private.billing_customer_identities%rowtype;
  v_account private.billing_accounts%rowtype;
  v_env text;
begin
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  v_env := private.billing_clinic_provider_environment(p_clinic_id);
  select * into v_identity
    from private.billing_customer_identities i
   where i.clinic_id = p_clinic_id;
  v_account := private.billing_account_for_clinic(p_clinic_id, v_env);
  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'identity_complete', private.billing_customer_identity_complete(p_clinic_id),
    'legal_name', v_identity.legal_name,
    'tax_id', v_identity.tax_id,
    'email', v_identity.email,
    'mobile_phone', v_identity.mobile_phone,
    'billing_account_id', v_account.id,
    'environment', coalesce(v_account.environment, v_env),
    'external_customer_id', v_account.external_customer_id
  );
end;
$$;


create or replace function public.prepare_my_clinic_pix_automatic_authorization(p_clinic_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_account private.billing_accounts%rowtype;
  v_contract_id uuid;
  v_result jsonb;
  v_status text;
  v_env text;
begin
  if v_me is null then
    raise exception 'BILLING_NOT_AUTHENTICATED'
      using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'BILLING_NOT_CLINIC_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_CLINIC_ADMIN';
  end if;
  if not private.billing_customer_identity_complete(p_clinic_id) then
    raise exception 'BILLING_IDENTITY_INCOMPLETE'
      using errcode = '22023', hint = 'BILLING_IDENTITY_INCOMPLETE';
  end if;

  v_env := private.billing_clinic_provider_environment(p_clinic_id);
  v_account := private.billing_account_for_clinic(p_clinic_id, v_env);
  if v_account.id is null then
    raise exception 'BILLING_ACCOUNT_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_ACCOUNT_UNKNOWN';
  end if;
  if v_account.environment is distinct from v_env then
    raise exception 'BILLING_ENVIRONMENT_MISMATCH'
      using errcode = '42501', hint = 'BILLING_ENVIRONMENT_MISMATCH';
  end if;
  if v_account.external_customer_id is null then
    raise exception 'BILLING_CUSTOMER_NOT_BOUND'
      using errcode = '22023', hint = 'BILLING_CUSTOMER_NOT_BOUND';
  end if;

  select cc.id into v_contract_id
    from private.billing_commercial_contracts cc
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;
  if v_contract_id is null then
    raise exception 'BILLING_CONTRACT_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CONTRACT_REQUIRED';
  end if;

  v_result := private.billing_prepare_pix_automatic_authorization(v_contract_id, v_env);
  v_status := v_result->>'outcome';
  if v_status = 'refused_requires_reissue' then
    raise exception 'BILLING_PIX_REFUSED_REQUIRES_REISSUE'
      using errcode = '22023', hint = 'BILLING_PIX_REFUSED_REQUIRES_REISSUE';
  end if;
  if v_status = 'terminal_reissue_unsupported' then
    raise exception 'BILLING_PIX_TERMINAL_UNSUPPORTED'
      using errcode = '22023', hint = 'BILLING_PIX_TERMINAL_UNSUPPORTED';
  end if;
  if v_status is distinct from 'prepared' then
    raise exception 'BILLING_PIX_PREPARE_FAILED'
      using errcode = '22023', hint = 'BILLING_PIX_PREPARE_FAILED';
  end if;

  return jsonb_build_object(
    'outcome', 'prepared',
    'authorization_id', v_result->>'authorization_id',
    'provider_status', v_result->>'provider_status',
    'generation', (v_result->>'generation')::integer,
    'operation_id', v_result->'authorization_operation'->>'operation_id',
    'retry_policy', 'ALLOW_THREE_IN_SEVEN_DAYS',
    'payment_creation_mode', 'SUBSCRIPTION'
  );
end;
$$;


create or replace function private.billing_hub_charge_rows(p_clinic_id uuid)
returns table (
  charge_id uuid,
  source text,
  amount_cents integer,
  currency text,
  due_date date,
  paid_date date,
  display_state text,
  method text,
  occurred_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (
    select private.billing_hub_business_date() as d
  ),
  env as (
    select private.billing_clinic_provider_environment(p_clinic_id) as environment
  ),
  pay as (
    select
      p.id as charge_id,
      'payment'::text as source,
      p.value_cents::integer as amount_cents,
      'BRL'::text as currency,
      p.due_date,
      p.payment_date as paid_date,
      private.billing_hub_charge_state_from_payment(p.financial_state, p.due_date, t.d) as display_state,
      private.billing_hub_payment_method(p.billing_type) as method,
      p.created_at as occurred_at
    from private.billing_payments p
    join private.billing_accounts a on a.id = p.billing_account_id
    cross join today t
    cross join env e
    where a.clinic_id = p_clinic_id
      and a.environment = e.environment
      and p.environment = e.environment
      and p.financial_state not in ('voided', 'unknown')
  ),
  instr as (
    select
      i.id as charge_id,
      'instruction'::text as source,
      cc.contracted_price_cents as amount_cents,
      cc.contracted_currency as currency,
      i.due_date,
      null::date as paid_date,
      'PROGRAMMED'::text as display_state,
      'PIX'::text as method,
      i.created_at as occurred_at
    from private.billing_pix_automatic_payment_instructions i
    join private.billing_pix_automatic_authorizations auth
      on auth.id = i.pix_authorization_id
    join private.billing_commercial_contracts cc
      on cc.id = auth.commercial_contract_id
    cross join env e
    where cc.clinic_id = p_clinic_id
      and auth.environment = e.environment
      and i.environment = e.environment
      and i.status in ('AWAITING_REQUEST', 'SCHEDULED')
      and not exists (
        select 1
          from private.billing_payments p
         where p.pix_instruction_id = i.id
           and p.financial_state not in ('voided', 'unknown')
      )
  )
  select pay.charge_id, pay.source, pay.amount_cents, pay.currency, pay.due_date,
         pay.paid_date, pay.display_state, pay.method, pay.occurred_at
    from pay
  union all
  select instr.charge_id, instr.source, instr.amount_cents, instr.currency, instr.due_date,
         instr.paid_date, instr.display_state, instr.method, instr.occurred_at
    from instr;
$$;


create or replace function private.platform_billing_charge_universe()
returns table (
  clinic_id uuid,
  charge_id uuid,
  source text,
  amount_cents integer,
  currency text,
  due_date date,
  paid_date date,
  display_state text,
  method text,
  occurred_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (
    select private.billing_hub_business_date() as d
  ),
  pay as (
    select
      a.clinic_id,
      p.id as charge_id,
      'payment'::text as source,
      p.value_cents::integer as amount_cents,
      'BRL'::text as currency,
      p.due_date,
      p.payment_date as paid_date,
      private.billing_hub_charge_state_from_payment(p.financial_state, p.due_date, t.d) as display_state,
      private.billing_hub_payment_method(p.billing_type) as method,
      p.created_at as occurred_at
    from private.billing_payments p
    join private.billing_accounts a on a.id = p.billing_account_id
    cross join today t
    where a.clinic_id is not null
      and p.environment = a.environment
      and p.financial_state not in ('voided', 'unknown')
  ),
  instr as (
    select
      cc.clinic_id,
      i.id as charge_id,
      'instruction'::text as source,
      cc.contracted_price_cents as amount_cents,
      cc.contracted_currency as currency,
      i.due_date,
      null::date as paid_date,
      'PROGRAMMED'::text as display_state,
      'PIX'::text as method,
      i.created_at as occurred_at
    from private.billing_pix_automatic_payment_instructions i
    join private.billing_pix_automatic_authorizations auth
      on auth.id = i.pix_authorization_id
    join private.billing_commercial_contracts cc
      on cc.id = auth.commercial_contract_id
    where cc.clinic_id is not null
      and i.environment = auth.environment
      and i.status in ('AWAITING_REQUEST', 'SCHEDULED')
      and not exists (
        select 1
          from private.billing_payments p
         where p.pix_instruction_id = i.id
           and p.financial_state not in ('voided', 'unknown')
      )
  )
  select pay.clinic_id, pay.charge_id, pay.source, pay.amount_cents, pay.currency,
         pay.due_date, pay.paid_date, pay.display_state, pay.method, pay.occurred_at
    from pay
  union all
  select instr.clinic_id, instr.charge_id, instr.source, instr.amount_cents, instr.currency,
         instr.due_date, instr.paid_date, instr.display_state, instr.method, instr.occurred_at
    from instr;
$$;


-- ── D. Clinical enforcement ──────────────────────────────────────────────────

create or replace function private.billing_patients_commercial_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.billing_assert_clinic_commercial_access(new.clinic_id);
  return new;
end;
$$;

drop trigger if exists billing_patients_commercial_guard on public.patients;
create trigger billing_patients_commercial_guard
  before insert or update of clinic_id on public.patients
  for each row
  execute function private.billing_patients_commercial_guard();

create or replace function private.billing_professionals_commercial_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select c.owner_profile_id into v_owner from public.clinics c where c.id = new.clinic_id;
  if v_owner is not null and new.profile_id is not distinct from v_owner then
    return new;
  end if;
  perform private.billing_assert_clinic_commercial_access(new.clinic_id);
  return new;
end;
$$;

drop trigger if exists billing_professionals_commercial_guard on public.professionals;
create trigger billing_professionals_commercial_guard
  before insert or update of clinic_id, profile_id, status on public.professionals
  for each row
  execute function private.billing_professionals_commercial_guard();

do $policies$
declare
  t text;
begin
  foreach t in array array['patients', 'appointments', 'patient_documents']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists billing_preprod_clinical_access on public.%I', t);
      execute format(
        'create policy billing_preprod_clinical_access on public.%I as restrictive for all to authenticated using (private.billing_clinical_product_permitted(clinic_id)) with check (private.billing_clinical_product_permitted(clinic_id))',
        t
      );
    end if;
  end loop;
  if to_regclass('public.professional_patient_links') is not null then
    drop policy if exists billing_preprod_clinical_access on public.professional_patient_links;
    create policy billing_preprod_clinical_access on public.professional_patient_links
      as restrictive
      for all
      to authenticated
      using (
        private.billing_clinical_product_permitted(
          (select pat.clinic_id from public.patients pat where pat.id = patient_id)
        )
      )
      with check (
        private.billing_clinical_product_permitted(
          (select pat.clinic_id from public.patients pat where pat.id = patient_id)
        )
      );
  end if;
end
$policies$;


-- ── E. Public RPCs ───────────────────────────────────────────────────────────

create or replace function public.get_my_clinic_commercial_access(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
begin
  if v_me is null then
    raise exception 'BILLING_NOT_AUTHENTICATED'
      using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  if not (
    private.is_clinic_admin(p_clinic_id)
    or exists (
      select 1 from public.professionals pr
       where pr.clinic_id = p_clinic_id
         and pr.profile_id = v_me
         and coalesce(pr.status, 'active') = 'active'
    )
  ) then
    raise exception 'BILLING_NOT_CLINIC_MEMBER'
      using errcode = '42501', hint = 'BILLING_NOT_CLINIC_MEMBER';
  end if;
  return private.billing_resolve_commercial_access(p_clinic_id);
end;
$$;

revoke all on function public.get_my_clinic_commercial_access(uuid) from public, anon, service_role;
grant execute on function public.get_my_clinic_commercial_access(uuid) to authenticated;


create or replace function public.list_platform_commercial_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_write text;
begin
  if private.current_profile_id() is null then
    raise exception 'BILLING_NOT_AUTHENTICATED'
      using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;
  if not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  select rollout_mode into v_mode from private.billing_commercial_access_config where id;
  select write_mode into v_write from private.billing_provider_write_config where id;
  return jsonb_build_object(
    'rollout_mode', upper(coalesce(v_mode, 'observe')),
    'provider_write_mode', upper(coalesce(v_write, 'locked')),
    'entitlement_enforcement', 'OFF',
    'clinics', coalesce((
      select jsonb_agg(row_to_json(x) order by x.clinic_name)
      from (
        select
          c.id as clinic_id,
          c.name as clinic_name,
          c.status as clinic_status,
          (a->>'access_class') as access_class,
          (a->>'reason') as reason,
          (a->>'product_allowed')::boolean as product_allowed,
          exists (
            select 1 from private.billing_commercial_contracts cc
             where cc.clinic_id = c.id and cc.status = 'active'
          ) as has_active_contract,
          exists (
            select 1 from private.billing_commercial_access_exemptions e
             where e.clinic_id = c.id
               and private.billing_exemption_is_active(e.revoked_at, e.expires_at, clock_timestamp())
          ) as has_active_exemption,
          exists (
            select 1 from private.billing_accounts ba
             where ba.clinic_id = c.id and ba.environment = 'sandbox'
          ) as has_sandbox_account,
          exists (
            select 1 from private.billing_accounts ba
             where ba.clinic_id = c.id and ba.environment = 'production'
          ) as has_production_account
        from public.clinics c
        cross join lateral private.billing_resolve_commercial_access(c.id) a
      ) x
    ), '[]'::jsonb),
    'exemptions', coalesce((
      select jsonb_agg(row_to_json(e) order by e.created_at desc)
      from (
        select
          x.id,
          x.clinic_id,
          c.name as clinic_name,
          x.reason,
          x.created_at,
          x.expires_at,
          x.revoked_at,
          private.billing_exemption_is_active(x.revoked_at, x.expires_at, clock_timestamp()) as active
        from private.billing_commercial_access_exemptions x
        join public.clinics c on c.id = x.clinic_id
      ) e
    ), '[]'::jsonb),
    'canary_clinics', coalesce((
      select jsonb_agg(row_to_json(k)) from (
        select clinic_id, allowed_operations from private.billing_provider_write_canary_clinics
      ) k
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_platform_commercial_access() from public, anon, service_role;
grant execute on function public.list_platform_commercial_access() to authenticated;


create or replace function public.set_platform_commercial_access_mode(p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_mode text := lower(btrim(coalesce(p_mode, '')));
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  if v_mode not in ('observe', 'enforce') then
    raise exception 'BILLING_INVALID_ACCESS_MODE'
      using errcode = '22023', hint = 'BILLING_INVALID_ACCESS_MODE';
  end if;
  update private.billing_commercial_access_config
     set rollout_mode = v_mode, updated_at = clock_timestamp(), updated_by = v_me
   where id;
  insert into private.billing_commercial_governance_events (actor_id, actor_authority, action, payload)
  values (v_me, 'platform_admin', 'commercial_access_mode_set', jsonb_build_object('mode', v_mode));
  return jsonb_build_object('rollout_mode', upper(v_mode));
end;
$$;

revoke all on function public.set_platform_commercial_access_mode(text) from public, anon, service_role;
grant execute on function public.set_platform_commercial_access_mode(text) to authenticated;


create or replace function public.grant_platform_commercial_access_exemption(
  p_clinic_id uuid,
  p_reason text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  if char_length(v_reason) < 8 then
    raise exception 'BILLING_EXEMPTION_REASON_REQUIRED'
      using errcode = '22023', hint = 'BILLING_EXEMPTION_REASON_REQUIRED';
  end if;
  update private.billing_commercial_access_exemptions
     set revoked_at = clock_timestamp(), revoked_by = v_me
   where clinic_id = p_clinic_id
     and revoked_at is null
     and expires_at is not null
     and expires_at <= clock_timestamp();
  insert into private.billing_commercial_access_exemptions (
    clinic_id, reason, created_by, expires_at
  ) values (p_clinic_id, v_reason, v_me, p_expires_at)
  returning id into v_id;
  insert into private.billing_commercial_governance_events (actor_id, actor_authority, action, payload)
  values (
    v_me, 'platform_admin', 'commercial_exemption_grant',
    jsonb_build_object('clinic_id', p_clinic_id, 'exemption_id', v_id)
  );
  return jsonb_build_object('exemption_id', v_id, 'clinic_id', p_clinic_id);
end;
$$;

revoke all on function public.grant_platform_commercial_access_exemption(uuid, text, timestamptz)
  from public, anon, service_role;
grant execute on function public.grant_platform_commercial_access_exemption(uuid, text, timestamptz)
  to authenticated;


create or replace function public.revoke_platform_commercial_access_exemption(p_exemption_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_clinic uuid;
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  update private.billing_commercial_access_exemptions
     set revoked_at = clock_timestamp(), revoked_by = v_me
   where id = p_exemption_id
     and revoked_at is null
  returning clinic_id into v_clinic;
  if v_clinic is null then
    raise exception 'BILLING_EXEMPTION_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_EXEMPTION_UNKNOWN';
  end if;
  insert into private.billing_commercial_governance_events (actor_id, actor_authority, action, payload)
  values (
    v_me, 'platform_admin', 'commercial_exemption_revoke',
    jsonb_build_object('exemption_id', p_exemption_id, 'clinic_id', v_clinic)
  );
  return jsonb_build_object('exemption_id', p_exemption_id, 'revoked', true);
end;
$$;

revoke all on function public.revoke_platform_commercial_access_exemption(uuid)
  from public, anon, service_role;
grant execute on function public.revoke_platform_commercial_access_exemption(uuid)
  to authenticated;


create or replace function public.set_platform_provider_write_mode(p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_mode text := lower(btrim(coalesce(p_mode, '')));
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  if v_mode not in ('locked', 'canary', 'open') then
    raise exception 'BILLING_INVALID_WRITE_MODE'
      using errcode = '22023', hint = 'BILLING_INVALID_WRITE_MODE';
  end if;
  update private.billing_provider_write_config
     set write_mode = v_mode, updated_at = clock_timestamp(), updated_by = v_me
   where id;
  insert into private.billing_commercial_governance_events (actor_id, actor_authority, action, payload)
  values (v_me, 'platform_admin', 'provider_write_mode_set', jsonb_build_object('mode', v_mode));
  return jsonb_build_object('provider_write_mode', upper(v_mode));
end;
$$;

revoke all on function public.set_platform_provider_write_mode(text) from public, anon, service_role;
grant execute on function public.set_platform_provider_write_mode(text) to authenticated;


create or replace function public.set_platform_provider_write_canary(
  p_clinic_id uuid,
  p_allowed_operations text[] default array['ENSURE_CUSTOMER_FROM_IDENTITY','PIX_AUTOMATIC_CREATE']::text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_ops text[] := coalesce(p_allowed_operations, array[]::text[]);
begin
  if v_me is null or not private.is_platform_admin() then
    raise exception 'BILLING_NOT_PLATFORM_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_PLATFORM_ADMIN';
  end if;
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  if exists (
    select 1 from unnest(v_ops) op
     where op not in ('ENSURE_CUSTOMER_FROM_IDENTITY', 'PIX_AUTOMATIC_CREATE')
  ) then
    raise exception 'BILLING_INVALID_CANARY_OPERATION'
      using errcode = '22023', hint = 'BILLING_INVALID_CANARY_OPERATION';
  end if;
  insert into private.billing_provider_write_canary_clinics (clinic_id, allowed_operations, created_by)
  values (p_clinic_id, v_ops, v_me)
  on conflict (clinic_id) do update
    set allowed_operations = excluded.allowed_operations;
  insert into private.billing_commercial_governance_events (actor_id, actor_authority, action, payload)
  values (
    v_me, 'platform_admin', 'provider_write_canary_set',
    jsonb_build_object('clinic_id', p_clinic_id, 'operations', v_ops)
  );
  return jsonb_build_object('clinic_id', p_clinic_id, 'allowed_operations', v_ops);
end;
$$;

revoke all on function public.set_platform_provider_write_canary(uuid, text[])
  from public, anon, service_role;
grant execute on function public.set_platform_provider_write_canary(uuid, text[])
  to authenticated;


create or replace function public.assert_billing_production_provider_write(
  p_clinic_id uuid,
  p_operation_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.billing_production_write_allowed(p_clinic_id, btrim(coalesce(p_operation_type, ''))) then
    return jsonb_build_object('allowed', true);
  end if;
  raise exception 'BILLING_PRODUCTION_LOCKED'
    using errcode = '42501', hint = 'BILLING_PRODUCTION_LOCKED';
end;
$$;

revoke all on function public.assert_billing_production_provider_write(uuid, text)
  from public, anon, authenticated;
grant execute on function public.assert_billing_production_provider_write(uuid, text)
  to service_role;


create or replace function public.assert_billing_production_provider_write_for_account(
  p_billing_account_id uuid,
  p_operation_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_env text;
begin
  select a.clinic_id, a.environment
    into v_clinic, v_env
    from private.billing_accounts a
   where a.id = p_billing_account_id;
  if v_clinic is null then
    raise exception 'BILLING_ACCOUNT_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_ACCOUNT_UNKNOWN';
  end if;
  if v_env is distinct from 'production' then
    return jsonb_build_object('allowed', true, 'environment', v_env);
  end if;
  return public.assert_billing_production_provider_write(v_clinic, p_operation_type);
end;
$$;

revoke all on function public.assert_billing_production_provider_write_for_account(uuid, text)
  from public, anon, authenticated;
grant execute on function public.assert_billing_production_provider_write_for_account(uuid, text)
  to service_role;


create or replace function public.list_my_clinic_billing_payments(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.billing_hub_business_date();
  v_env text := private.billing_clinic_provider_environment(p_clinic_id);
begin
  perform private.assert_my_clinic_billing_reader(p_clinic_id);
  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'amount_cents', p.value_cents,
        'currency', 'BRL',
        'due_date', p.due_date,
        'received_date', p.payment_date,
        'display_state', private.billing_hub_payment_display_state(
          p.financial_state, p.due_date, v_today
        ),
        'method', private.billing_hub_payment_method(p.billing_type)
      ) order by coalesce(p.payment_date, p.due_date) desc nulls last, p.created_at desc)
      from (
        select bp.*
          from private.billing_payments bp
          join private.billing_accounts a on a.id = bp.billing_account_id
         where a.clinic_id = p_clinic_id
           and a.environment = v_env
           and bp.environment = a.environment
           and bp.financial_state not in ('voided', 'unknown')
         order by bp.created_at desc, bp.id desc
         limit 50
      ) p
    ), '[]'::jsonb)
  );
end;
$$;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260921120000',
  '20260921120000_wp_billing_preprod_02_commercial_gate_env_isolation.sql',
  'WP-BILLING-PREPROD-02: commercial access OBSERVE default, PA exemption, unique(clinic, environment), Production write LOCKED. Local only.',
  'WP-BILLING-PREPROD-02'
)
on conflict (version) do nothing;

