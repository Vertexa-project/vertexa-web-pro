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


-- ── PREPROD-02R1: dual-env read scoping + report/timeline environment ────────

drop function if exists private.platform_billing_payment_plan_facts();
create function private.platform_billing_payment_plan_facts()
returns table (
  payment_id uuid,
  clinic_id uuid,
  clinic_name text,
  amount_cents integer,
  currency text,
  financial_state text,
  due_date date,
  payment_date date,
  billing_type text,
  method text,
  plan_code text,
  plan_display_name text,
  plan_attribution text,
  environment text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id as payment_id,
    a.clinic_id,
    c.name as clinic_name,
    p.value_cents::integer as amount_cents,
    'BRL'::text as currency,
    p.financial_state,
    p.due_date,
    p.payment_date,
    p.billing_type,
    private.billing_hub_payment_method(p.billing_type) as method,
    pl.code as plan_code,
    pl.display_name as plan_display_name,
    case
      when cc.id is not null then 'contract'
      else 'unattributed'
    end as plan_attribution,
    a.environment
  from private.billing_payments p
  join private.billing_accounts a on a.id = p.billing_account_id
  join public.clinics c on c.id = a.clinic_id
  left join private.billing_pix_automatic_authorizations auth
    on auth.id = p.pix_authorization_id
  left join private.billing_subscriptions sub
    on sub.id = p.billing_subscription_id
  left join private.billing_commercial_contracts cc
    on cc.id = coalesce(auth.commercial_contract_id, sub.commercial_contract_id)
  left join private.billing_plan_versions pv on pv.id = cc.plan_version_id
  left join private.billing_plans pl on pl.id = pv.plan_id
  where a.clinic_id is not null
    and p.environment = a.environment
    and p.financial_state not in ('voided', 'unknown');
$$;

comment on function private.platform_billing_payment_plan_facts() is
  'WP-BILLING-PREPROD-02R1: payment facts carry provider environment. Sandbox money is never Production money.';

revoke all on function private.platform_billing_payment_plan_facts()
  from public, anon, authenticated, service_role;


drop function if exists private.platform_billing_charge_universe();
create function private.platform_billing_charge_universe()
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
  occurred_at timestamptz,
  environment text
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
      p.created_at as occurred_at,
      a.environment
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
      i.created_at as occurred_at,
      auth.environment
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
         pay.due_date, pay.paid_date, pay.display_state, pay.method, pay.occurred_at,
         pay.environment
    from pay
  union all
  select instr.clinic_id, instr.charge_id, instr.source, instr.amount_cents, instr.currency,
         instr.due_date, instr.paid_date, instr.display_state, instr.method, instr.occurred_at,
         instr.environment
    from instr;
$$;

revoke all on function private.platform_billing_charge_universe()
  from public, anon, authenticated, service_role;


-- PREPROD-02R2: provider facts are per-environment. Clinic-level columns no longer
-- select one Pix / latest pay / next charge / aging bucket by row order.
alter type private.platform_billing_clinic_facts add attribute provider_facts jsonb;

create or replace function private.platform_billing_pack_provider_env(
  p_pix_status text,
  p_pix_generation integer,
  p_latest_state text,
  p_latest_date date,
  p_next_due date,
  p_next_cents integer,
  p_next_state text,
  p_aging text,
  p_overdue_count integer,
  p_overdue_cents bigint,
  p_pending_cents bigint,
  p_charge_count integer
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'pix_status', p_pix_status,
    'pix_generation', p_pix_generation,
    'latest_payment_state', p_latest_state,
    'latest_payment_date', p_latest_date,
    'next_charge', case
      when p_next_due is null then null
      else jsonb_build_object(
        'due_date', p_next_due,
        'amount_cents', p_next_cents,
        'display_state', p_next_state
      )
    end,
    'aging_bucket', p_aging,
    'overdue_count', coalesce(p_overdue_count, 0),
    'overdue_cents', coalesce(p_overdue_cents, 0),
    'pending_cents', coalesce(p_pending_cents, 0),
    'charge_count', coalesce(p_charge_count, 0)
  );
$$;

revoke all on function private.platform_billing_pack_provider_env(
  text, integer, text, date, date, integer, text, text, integer, bigint, bigint, integer
) from public, anon, authenticated, service_role;


create or replace function private.platform_billing_aging_for_environment(
  p_environment text,
  p_today date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'd1_7', jsonb_build_object(
      'clinic_count', coalesce(count(distinct u.clinic_id) filter (
        where private.platform_billing_overdue_aging(u.due_date, p_today) = 'd1_7'
      ), 0),
      'amount_cents', coalesce(sum(u.amount_cents) filter (
        where private.platform_billing_overdue_aging(u.due_date, p_today) = 'd1_7'
      ), 0)
    ),
    'd8_15', jsonb_build_object(
      'clinic_count', coalesce(count(distinct u.clinic_id) filter (
        where private.platform_billing_overdue_aging(u.due_date, p_today) = 'd8_15'
      ), 0),
      'amount_cents', coalesce(sum(u.amount_cents) filter (
        where private.platform_billing_overdue_aging(u.due_date, p_today) = 'd8_15'
      ), 0)
    ),
    'd16_30', jsonb_build_object(
      'clinic_count', coalesce(count(distinct u.clinic_id) filter (
        where private.platform_billing_overdue_aging(u.due_date, p_today) = 'd16_30'
      ), 0),
      'amount_cents', coalesce(sum(u.amount_cents) filter (
        where private.platform_billing_overdue_aging(u.due_date, p_today) = 'd16_30'
      ), 0)
    ),
    'd31_plus', jsonb_build_object(
      'clinic_count', coalesce(count(distinct u.clinic_id) filter (
        where private.platform_billing_overdue_aging(u.due_date, p_today) = 'd31_plus'
      ), 0),
      'amount_cents', coalesce(sum(u.amount_cents) filter (
        where private.platform_billing_overdue_aging(u.due_date, p_today) = 'd31_plus'
      ), 0)
    )
  )
  from private.platform_billing_charge_universe() u
  where u.display_state = 'OVERDUE'
    and u.environment = p_environment;
$$;

revoke all on function private.platform_billing_aging_for_environment(text, date)
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_clinic_facts()
returns setof private.platform_billing_clinic_facts
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (
    select private.billing_hub_business_date() as d
  ),
  contract as (
    select distinct on (cc.clinic_id)
      cc.clinic_id,
      cc.status as contract_status,
      (timezone('America/Sao_Paulo', cc.effective_from))::date as contract_effective_from,
      p.code as plan_code,
      p.display_name as plan_display_name,
      cc.contracted_price_cents as plan_price_cents,
      cc.contracted_currency as plan_currency,
      cc.billing_cycle,
      cc.id as contract_id
    from private.billing_commercial_contracts cc
    join private.billing_plan_versions pv on pv.id = cc.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
    order by
      cc.clinic_id,
      case cc.status when 'active' then 0 when 'pending' then 1 else 2 end,
      cc.effective_from desc
  ),
  account as (
    select
      a.clinic_id,
      bool_or(a.external_customer_id is not null) as customer_bound
    from private.billing_accounts a
    where a.clinic_id is not null
    group by a.clinic_id
  ),
  pix as (
    select distinct on (cc.clinic_id, auth.environment)
      cc.clinic_id,
      auth.environment,
      auth.provider_status as pix_status,
      auth.generation as pix_generation
    from private.billing_pix_automatic_authorizations auth
    join private.billing_commercial_contracts cc
      on cc.id = auth.commercial_contract_id
    where auth.is_primary
    order by cc.clinic_id, auth.environment, auth.generation desc nulls last, auth.created_at desc
  ),
  identity as (
    select i.clinic_id
      from private.billing_customer_identities i
     where btrim(i.legal_name) <> ''
       and private.billing_tax_id_is_valid(i.tax_id)
       and private.billing_email_is_valid(i.email)
  ),
  charges as materialized (
    select * from private.platform_billing_charge_universe()
  ),
  charge_agg as (
    select
      u.clinic_id,
      u.environment,
      count(*)::integer as charge_count,
      count(*) filter (where u.display_state = 'OVERDUE')::integer as overdue_count,
      coalesce(sum(u.amount_cents) filter (where u.display_state = 'OVERDUE'), 0)::bigint as overdue_cents,
      coalesce(sum(u.amount_cents) filter (where u.display_state in ('PROGRAMMED', 'PENDING')), 0)::bigint as pending_cents,
      count(*) filter (where u.display_state in ('PROGRAMMED', 'PENDING'))::integer as open_count,
      count(*) filter (where u.display_state = 'PAID')::integer as paid_count,
      min(u.due_date) filter (where u.display_state = 'OVERDUE') as oldest_overdue_due
    from charges u
    group by u.clinic_id, u.environment
  ),
  next_charge as (
    select distinct on (u.clinic_id, u.environment)
      u.clinic_id,
      u.environment,
      u.due_date as next_charge_due,
      u.amount_cents as next_charge_cents,
      u.display_state as next_charge_state
    from charges u
    cross join today t
    where u.display_state in ('PROGRAMMED', 'PENDING')
      and u.due_date is not null
      and u.due_date >= t.d
    order by u.clinic_id, u.environment, u.due_date asc, u.occurred_at asc, u.charge_id asc
  ),
  latest_pay as (
    select distinct on (a.clinic_id, a.environment)
      a.clinic_id,
      a.environment,
      private.billing_hub_payment_display_state(p.financial_state, p.due_date, t.d) as latest_payment_state,
      coalesce(p.payment_date, p.due_date) as latest_payment_date
    from private.billing_payments p
    join private.billing_accounts a on a.id = p.billing_account_id
    cross join today t
    where a.clinic_id is not null
      and p.environment = a.environment
      and p.financial_state not in ('voided', 'unknown')
    order by a.clinic_id, a.environment, coalesce(p.payment_date, p.due_date, t.d) desc, p.created_at desc
  )
  select
    c.id as clinic_id,
    c.name as clinic_name,
    ct.plan_code,
    ct.plan_display_name,
    ct.plan_price_cents,
    ct.plan_currency,
    ct.billing_cycle,
    ct.contract_status,
    ct.contract_effective_from,
    (idn.clinic_id is not null) as identity_complete,
    coalesce(ac.customer_bound, false) as customer_bound,
    null::text as pix_status,
    null::integer as pix_generation,
    case
      when ct.contract_id is null then 'no_plan'
      when coalesce(ca_s.overdue_count, 0) + coalesce(ca_p.overdue_count, 0) > 0 then 'overdue'
      when coalesce(ca_s.open_count, 0) + coalesce(ca_p.open_count, 0) > 0 then 'pending'
      when coalesce(ca_s.paid_count, 0) + coalesce(ca_p.paid_count, 0) > 0 then 'current'
      else 'no_charges'
    end as financial_summary,
    coalesce(ca_s.overdue_count, 0) + coalesce(ca_p.overdue_count, 0) as overdue_count,
    coalesce(ca_s.overdue_cents, 0) + coalesce(ca_p.overdue_cents, 0) as overdue_cents,
    coalesce(ca_s.pending_cents, 0) + coalesce(ca_p.pending_cents, 0) as pending_cents,
    coalesce(ca_s.charge_count, 0) + coalesce(ca_p.charge_count, 0) as charge_count,
    null::date as next_charge_due,
    null::integer as next_charge_cents,
    null::text as next_charge_state,
    null::text as latest_payment_state,
    null::date as latest_payment_date,
    null::text as aging_bucket,
    (
      coalesce(ca_s.overdue_count, 0) + coalesce(ca_p.overdue_count, 0) > 0
      or (ct.contract_id is not null and idn.clinic_id is null)
      or (ct.contract_id is not null and not coalesce(ac.customer_bound, false))
      or px_s.pix_status = 'REFUSED'
      or px_p.pix_status = 'REFUSED'
      or (ct.contract_status = 'active' and px_s.pix_status is null and px_p.pix_status is null)
    ) as attention,
    case
      when coalesce(ca_s.overdue_count, 0) + coalesce(ca_p.overdue_count, 0) > 0 then 'overdue'
      when ct.contract_id is not null and idn.clinic_id is null then 'identity_incomplete'
      when ct.contract_id is not null and not coalesce(ac.customer_bound, false)
        then 'customer_unbound'
      when px_s.pix_status = 'REFUSED' or px_p.pix_status = 'REFUSED' then 'pix_refused'
      when ct.contract_status = 'active' and px_s.pix_status is null and px_p.pix_status is null
        then 'pix_absent'
      else 'none'
    end as attention_reason,
    'OFF'::text as entitlement_enforcement,
    false as entitlement_granted,
    jsonb_build_object(
      'sandbox', private.platform_billing_pack_provider_env(
        px_s.pix_status, px_s.pix_generation,
        lp_s.latest_payment_state, lp_s.latest_payment_date,
        nc_s.next_charge_due, nc_s.next_charge_cents, nc_s.next_charge_state,
        private.platform_billing_overdue_aging(ca_s.oldest_overdue_due, t.d),
        ca_s.overdue_count, ca_s.overdue_cents, ca_s.pending_cents, ca_s.charge_count
      ),
      'production', private.platform_billing_pack_provider_env(
        px_p.pix_status, px_p.pix_generation,
        lp_p.latest_payment_state, lp_p.latest_payment_date,
        nc_p.next_charge_due, nc_p.next_charge_cents, nc_p.next_charge_state,
        private.platform_billing_overdue_aging(ca_p.oldest_overdue_due, t.d),
        ca_p.overdue_count, ca_p.overdue_cents, ca_p.pending_cents, ca_p.charge_count
      )
    ) as provider_facts
  from public.clinics c
  cross join today t
  left join contract ct on ct.clinic_id = c.id
  left join account ac on ac.clinic_id = c.id
  left join pix px_s on px_s.clinic_id = c.id and px_s.environment = 'sandbox'
  left join pix px_p on px_p.clinic_id = c.id and px_p.environment = 'production'
  left join identity idn on idn.clinic_id = c.id
  left join charge_agg ca_s on ca_s.clinic_id = c.id and ca_s.environment = 'sandbox'
  left join charge_agg ca_p on ca_p.clinic_id = c.id and ca_p.environment = 'production'
  left join next_charge nc_s on nc_s.clinic_id = c.id and nc_s.environment = 'sandbox'
  left join next_charge nc_p on nc_p.clinic_id = c.id and nc_p.environment = 'production'
  left join latest_pay lp_s on lp_s.clinic_id = c.id and lp_s.environment = 'sandbox'
  left join latest_pay lp_p on lp_p.clinic_id = c.id and lp_p.environment = 'production';
$$;

comment on function private.platform_billing_clinic_facts() is
  'WP-BILLING-PREPROD-02R2: provider Pix/latest/next/aging are per environment. customer_bound remains BOOL_OR. Contract ranking stays clinic-level.';


drop function if exists private.billing_hub_timeline_rows(uuid);
create function private.billing_hub_timeline_rows(p_clinic_id uuid)
returns table (
  event_id text,
  occurred_at timestamptz,
  event_type text,
  environment text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with plan_events as (
    select
      'plan_contracted:' || cc.id::text as event_id,
      cc.created_at as occurred_at,
      'plan_contracted'::text as event_type,
      null::text as environment
    from private.billing_commercial_contracts cc
    where cc.clinic_id = p_clinic_id
  ),
  pix_events as (
    select
      case a.provider_status
        when 'INTENT' then 'pix_prepared:'
        when 'CREATED' then 'pix_created:'
        when 'ACTIVE' then 'pix_active:'
        when 'REFUSED' then 'pix_refused:'
        else null
      end || a.id::text as event_id,
      case
        when a.provider_status = 'INTENT' then a.created_at
        else coalesce(a.updated_at, a.created_at)
      end as occurred_at,
      case a.provider_status
        when 'INTENT' then 'pix_prepared'
        when 'CREATED' then 'pix_created'
        when 'ACTIVE' then 'pix_active'
        when 'REFUSED' then 'pix_refused'
        else null
      end as event_type,
      a.environment
    from private.billing_pix_automatic_authorizations a
    join private.billing_commercial_contracts cc on cc.id = a.commercial_contract_id
    where cc.clinic_id = p_clinic_id
      and a.provider_status in ('INTENT', 'CREATED', 'ACTIVE', 'REFUSED')
  ),
  programmed as (
    select
      'charge_programmed:' || i.id::text as event_id,
      i.created_at as occurred_at,
      'charge_programmed'::text as event_type,
      coalesce(i.environment, a.environment) as environment
    from private.billing_pix_automatic_payment_instructions i
    join private.billing_pix_automatic_authorizations a on a.id = i.pix_authorization_id
    join private.billing_commercial_contracts cc on cc.id = a.commercial_contract_id
    where cc.clinic_id = p_clinic_id
      and i.status in ('AWAITING_REQUEST', 'SCHEDULED')
  ),
  pay_events as (
    select
      'charge_created:' || p.id::text as event_id,
      p.created_at as occurred_at,
      'charge_created'::text as event_type,
      acc.environment
    from private.billing_payments p
    join private.billing_accounts acc on acc.id = p.billing_account_id
    where acc.clinic_id = p_clinic_id
      and p.environment = acc.environment
      and p.financial_state not in ('voided', 'unknown')
    union all
    select
      'payment_received:' || p.id::text as event_id,
      coalesce(
        (p.payment_date::timestamp at time zone 'America/Sao_Paulo'),
        p.updated_at,
        p.created_at
      ) as occurred_at,
      'payment_received'::text as event_type,
      acc.environment
    from private.billing_payments p
    join private.billing_accounts acc on acc.id = p.billing_account_id
    where acc.clinic_id = p_clinic_id
      and p.environment = acc.environment
      and p.financial_state = 'received'
    union all
    select
      'payment_overdue:' || p.id::text as event_id,
      coalesce(
        (p.due_date::timestamp at time zone 'America/Sao_Paulo'),
        p.updated_at,
        p.created_at
      ) as occurred_at,
      'payment_overdue'::text as event_type,
      acc.environment
    from private.billing_payments p
    join private.billing_accounts acc on acc.id = p.billing_account_id
    where acc.clinic_id = p_clinic_id
      and p.environment = acc.environment
      and private.billing_hub_charge_state_from_payment(
            p.financial_state,
            p.due_date,
            private.billing_hub_business_date()
          ) = 'OVERDUE'
  )
  select event_id, occurred_at, event_type, environment
    from plan_events
  union all
  select event_id, occurred_at, event_type, environment
    from pix_events
   where event_type is not null
  union all
  select event_id, occurred_at, event_type, environment
    from programmed
  union all
  select event_id, occurred_at, event_type, environment
    from pay_events;
$$;

comment on function private.billing_hub_timeline_rows(uuid) is
  'WP-BILLING-PREPROD-02R1: unified clinic timeline. Provider-backed facts carry environment. Commercial plan events remain unlabeled.';

revoke all on function private.billing_hub_timeline_rows(uuid)
  from public, anon, authenticated, service_role;


create or replace function public.list_my_clinic_billing_timeline(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_my_clinic_billing_reader(p_clinic_id);
  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.event_id,
        'occurred_at', t.occurred_at,
        'type', t.event_type,
        'environment', t.environment
      ) order by t.occurred_at desc, t.event_type desc, t.event_id desc)
      from (
        select *
          from private.billing_hub_timeline_rows(p_clinic_id)
         where event_type in (
           'plan_contracted',
           'pix_prepared',
           'pix_created',
           'pix_active',
           'pix_refused',
           'charge_programmed',
           'charge_created',
           'payment_received',
           'payment_overdue'
         )
           and occurred_at is not null
         order by occurred_at desc, event_type desc, event_id desc
         limit 40
      ) t
    ), '[]'::jsonb)
  );
end;
$$;


create or replace function private.platform_billing_normalize_environment(p_environment text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_env text := lower(nullif(btrim(coalesce(p_environment, '')), ''));
begin
  if v_env is null then
    return null;
  end if;
  if v_env not in ('sandbox', 'production') then
    raise exception 'BILLING_REPORT_ENVIRONMENT_INVALID'
      using errcode = '22023', hint = 'BILLING_REPORT_ENVIRONMENT_INVALID';
  end if;
  return v_env;
end;
$$;

revoke all on function private.platform_billing_normalize_environment(text)
  from public, anon, authenticated, service_role;


create or replace function private.platform_billing_env_bucket(
  p_environment text,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', p_environment,
    'received_in_period_cents', coalesce((
      select sum(f.amount_cents)
        from private.platform_billing_payment_plan_facts() f
       where f.environment = p_environment
         and f.financial_state = 'received'
         and f.payment_date between p_start and p_end
    ), 0),
    'received_in_period_count', coalesce((
      select count(*)
        from private.platform_billing_payment_plan_facts() f
       where f.environment = p_environment
         and f.financial_state = 'received'
         and f.payment_date between p_start and p_end
    ), 0),
    'pending_in_period_cents', coalesce((
      select sum(u.amount_cents)
        from private.platform_billing_charge_universe() u
       where u.environment = p_environment
         and u.display_state in ('PROGRAMMED', 'PENDING')
         and u.due_date between p_start and p_end
    ), 0),
    'pending_in_period_count', coalesce((
      select count(*)
        from private.platform_billing_charge_universe() u
       where u.environment = p_environment
         and u.display_state in ('PROGRAMMED', 'PENDING')
         and u.due_date between p_start and p_end
    ), 0),
    'overdue_in_period_cents', coalesce((
      select sum(u.amount_cents)
        from private.platform_billing_charge_universe() u
       where u.environment = p_environment
         and u.display_state = 'OVERDUE'
         and u.due_date between p_start and p_end
    ), 0),
    'overdue_in_period_count', coalesce((
      select count(*)
        from private.platform_billing_charge_universe() u
       where u.environment = p_environment
         and u.display_state = 'OVERDUE'
         and u.due_date between p_start and p_end
    ), 0)
  );
$$;

revoke all on function private.platform_billing_env_bucket(text, date, date)
  from public, anon, authenticated, service_role;


create or replace function public.get_platform_billing_report(
  p_period_start date default null,
  p_period_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.billing_hub_business_date();
  v_start date;
  v_end date;
  v_sandbox jsonb;
  v_production jsonb;
  v_by_plan jsonb := '[]'::jsonb;
  v_by_status jsonb := '[]'::jsonb;
  v_delinquent_items jsonb := '[]'::jsonb;
begin
  perform private.assert_platform_billing_reader();

  select r.period_start, r.period_end
    into v_start, v_end
    from private.platform_billing_resolve_report_period(p_period_start, p_period_end) r;

  v_sandbox := private.platform_billing_env_bucket('sandbox', v_start, v_end);
  v_production := private.platform_billing_env_bucket('production', v_start, v_end);

  select coalesce(jsonb_agg(row_obj order by environment, received_cents desc, plan_label), '[]'::jsonb)
    into v_by_plan
    from (
      select
        jsonb_build_object(
          'environment', f.environment,
          'plan_code', f.plan_code,
          'plan_display_name', f.plan_display_name,
          'plan_attribution', f.plan_attribution,
          'received_cents', sum(f.amount_cents),
          'payment_count', count(*)
        ) as row_obj,
        sum(f.amount_cents) as received_cents,
        coalesce(f.plan_code, 'unattributed') as plan_label,
        f.environment
      from private.platform_billing_payment_plan_facts() f
      where f.financial_state = 'received'
        and f.payment_date between v_start and v_end
      group by f.environment, f.plan_code, f.plan_display_name, f.plan_attribution
    ) plan_rows;

  select coalesce(jsonb_agg(row_obj order by environment, status), '[]'::jsonb)
    into v_by_status
    from (
      select
        jsonb_build_object(
          'environment', f.environment,
          'status', f.financial_state,
          'payment_count', count(*),
          'amount_cents', sum(f.amount_cents)
        ) as row_obj,
        f.financial_state as status,
        f.environment
      from private.platform_billing_payment_plan_facts() f
      where (
          f.payment_date between v_start and v_end
          or (f.payment_date is null and f.due_date between v_start and v_end)
        )
      group by f.environment, f.financial_state
    ) status_rows;

  select coalesce(
      jsonb_agg(row_obj order by overdue_cents desc, clinic_name, environment)
        filter (where overdue_count > 0),
      '[]'::jsonb
    )
    into v_delinquent_items
    from (
      select
        jsonb_build_object(
          'clinic_id', u.clinic_id,
          'clinic_name', c.name,
          'environment', u.environment,
          'overdue_count', count(*)::integer,
          'overdue_cents', coalesce(sum(u.amount_cents), 0)::bigint,
          'aging_bucket', private.platform_billing_overdue_aging(min(u.due_date), v_today),
          'pix_status', (
            select auth.provider_status
              from private.billing_pix_automatic_authorizations auth
              join private.billing_commercial_contracts cc
                on cc.id = auth.commercial_contract_id
             where cc.clinic_id = u.clinic_id
               and auth.environment = u.environment
               and auth.is_primary
             order by auth.generation desc nulls last, auth.created_at desc
             limit 1
          )
        ) as row_obj,
        count(*)::integer as overdue_count,
        coalesce(sum(u.amount_cents), 0)::bigint as overdue_cents,
        c.name as clinic_name,
        u.environment
      from private.platform_billing_charge_universe() u
      join public.clinics c on c.id = u.clinic_id
      where u.display_state = 'OVERDUE'
      group by u.clinic_id, c.name, u.environment
      order by coalesce(sum(u.amount_cents), 0) desc, c.name, u.environment
      limit 50
    ) delinq;

  return jsonb_build_object(
    'timezone', 'America/Sao_Paulo',
    'period_start', v_start,
    'period_end', v_end,
    'as_of', v_today,
    'not_mrr', true,
    'entitlement_enforcement', 'OFF',
    'financial', jsonb_build_object(
      'sandbox', coalesce(v_sandbox, '{}'::jsonb),
      'production', coalesce(v_production, '{}'::jsonb)
    ),
    'received_by_plan', coalesce(v_by_plan, '[]'::jsonb),
    'payments_by_status', coalesce(v_by_status, '[]'::jsonb),
    'active_pix_automatic_authorizations', jsonb_build_object(
      'sandbox', coalesce((
        select count(*)::integer
          from private.billing_pix_automatic_authorizations auth
         where auth.is_primary
           and auth.provider_status = 'ACTIVE'
           and auth.environment = 'sandbox'
      ), 0),
      'production', coalesce((
        select count(*)::integer
          from private.billing_pix_automatic_authorizations auth
         where auth.is_primary
           and auth.provider_status = 'ACTIVE'
           and auth.environment = 'production'
      ), 0)
    ),
    'delinquent', jsonb_build_object(
      'sandbox', coalesce((
        select count(distinct u.clinic_id)::integer
          from private.platform_billing_charge_universe() u
         where u.display_state = 'OVERDUE'
           and u.environment = 'sandbox'
      ), 0),
      'production', coalesce((
        select count(distinct u.clinic_id)::integer
          from private.platform_billing_charge_universe() u
         where u.display_state = 'OVERDUE'
           and u.environment = 'production'
      ), 0)
    ),
    'delinquent_items', coalesce(v_delinquent_items, '[]'::jsonb),
    'export_max_rows', 500,
    'commercial', private.billing_commercial_report_metrics()
  );
end;
$$;

comment on function public.get_platform_billing_report(date, date) is
  'WP-BILLING-PREPROD-02R2: environment-bucketed financials, Pix, aging and delinquency. No unlabeled Sandbox+Production total.';


drop function if exists public.list_platform_billing_report_export(date, date, text, integer, integer);
drop function if exists public.list_platform_billing_report_export(date, date, text, integer, integer, text);
create function public.list_platform_billing_report_export(
  p_period_start date default null,
  p_period_end date default null,
  p_kind text default 'payments',
  p_limit integer default 200,
  p_offset integer default 0,
  p_environment text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_end date;
  v_limit integer := private.platform_billing_clamp_export_limit(p_limit);
  v_offset integer := private.platform_billing_clamp_offset(p_offset);
  v_kind text := lower(coalesce(p_kind, 'payments'));
  v_env text := private.platform_billing_normalize_environment(p_environment);
  v_items jsonb := '[]'::jsonb;
begin
  perform private.assert_platform_billing_reader();

  select r.period_start, r.period_end
    into v_start, v_end
    from private.platform_billing_resolve_report_period(p_period_start, p_period_end) r;

  if v_kind not in ('payments', 'delinquent', 'received_by_plan') then
    raise exception 'BILLING_REPORT_KIND_INVALID'
      using errcode = '22023', hint = 'BILLING_REPORT_KIND_INVALID';
  end if;

  if v_kind = 'payments' then
    select coalesce(jsonb_agg(row_obj order by sort_date desc, clinic_name, payment_id), '[]'::jsonb)
      into v_items
      from (
        select
          jsonb_build_object(
            'row_kind', 'payment',
            'environment', f.environment,
            'clinic_name', f.clinic_name,
            'plan_code', f.plan_code,
            'plan_attribution', f.plan_attribution,
            'amount_cents', f.amount_cents,
            'currency', f.currency,
            'financial_state', f.financial_state,
            'due_date', f.due_date,
            'payment_date', f.payment_date,
            'method', f.method
          ) as row_obj,
          coalesce(f.payment_date, f.due_date) as sort_date,
          f.clinic_name,
          f.payment_id
        from private.platform_billing_payment_plan_facts() f
        where (
            f.payment_date between v_start and v_end
            or (f.payment_date is null and f.due_date between v_start and v_end)
          )
          and (v_env is null or f.environment = v_env)
        order by coalesce(f.payment_date, f.due_date) desc, f.clinic_name, f.payment_id
        limit v_limit
        offset v_offset
      ) rows;
  elsif v_kind = 'delinquent' then
    select coalesce(jsonb_agg(row_obj order by overdue_cents desc, clinic_name, environment), '[]'::jsonb)
      into v_items
      from (
        select
          jsonb_build_object(
            'row_kind', 'delinquent',
            'environment', u.environment,
            'clinic_name', c.name,
            'plan_code', null,
            'overdue_count', count(*)::integer,
            'overdue_cents', coalesce(sum(u.amount_cents), 0)::bigint,
            'aging_bucket', private.platform_billing_overdue_aging(min(u.due_date), private.billing_hub_business_date()),
            'pix_status', (
              select auth.provider_status
                from private.billing_pix_automatic_authorizations auth
                join private.billing_commercial_contracts cc
                  on cc.id = auth.commercial_contract_id
               where cc.clinic_id = u.clinic_id
                 and auth.environment = u.environment
                 and auth.is_primary
               order by auth.generation desc nulls last, auth.created_at desc
               limit 1
            )
          ) as row_obj,
          coalesce(sum(u.amount_cents), 0)::bigint as overdue_cents,
          c.name as clinic_name,
          u.environment
        from private.platform_billing_charge_universe() u
        join public.clinics c on c.id = u.clinic_id
        where u.display_state = 'OVERDUE'
          and (v_env is null or u.environment = v_env)
        group by u.clinic_id, c.name, u.environment
        order by coalesce(sum(u.amount_cents), 0) desc, c.name, u.environment
        limit v_limit
        offset v_offset
      ) rows;
  else
    select coalesce(jsonb_agg(row_obj order by environment, received_cents desc, plan_label), '[]'::jsonb)
      into v_items
      from (
        select
          jsonb_build_object(
            'row_kind', 'received_by_plan',
            'environment', f.environment,
            'plan_code', f.plan_code,
            'plan_display_name', f.plan_display_name,
            'plan_attribution', f.plan_attribution,
            'received_cents', sum(f.amount_cents),
            'payment_count', count(*)
          ) as row_obj,
          sum(f.amount_cents) as received_cents,
          coalesce(f.plan_code, 'unattributed') as plan_label,
          f.environment
        from private.platform_billing_payment_plan_facts() f
        where f.financial_state = 'received'
          and f.payment_date between v_start and v_end
          and (v_env is null or f.environment = v_env)
        group by f.environment, f.plan_code, f.plan_display_name, f.plan_attribution
        order by f.environment, sum(f.amount_cents) desc, coalesce(f.plan_code, 'unattributed')
        limit v_limit
        offset v_offset
      ) rows;
  end if;

  return jsonb_build_object(
    'timezone', 'America/Sao_Paulo',
    'period_start', v_start,
    'period_end', v_end,
    'kind', v_kind,
    'environment', v_env,
    'limit', v_limit,
    'offset', v_offset,
    'max_limit', 500,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

comment on function public.list_platform_billing_report_export(date, date, text, integer, integer, text) is
  'WP-BILLING-PREPROD-02R1: CSV source with environment column and server-side environment filter.';

revoke all on function public.list_platform_billing_report_export(date, date, text, integer, integer, text)
  from public, anon, service_role;
grant execute on function public.list_platform_billing_report_export(date, date, text, integer, integer, text)
  to authenticated;

create or replace function public.list_platform_billing_report_export(
  p_period_start date,
  p_period_end date,
  p_kind text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.list_platform_billing_report_export(
    p_period_start, p_period_end, p_kind, p_limit, p_offset, null::text
  );
$$;

revoke all on function public.list_platform_billing_report_export(date, date, text, integer, integer)
  from public, anon, service_role;
grant execute on function public.list_platform_billing_report_export(date, date, text, integer, integer)
  to authenticated;


create or replace function public.get_platform_billing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.billing_hub_business_date();
  v_start date;
  v_end date;
  v_attention integer := 0;
  v_sandbox jsonb;
  v_production jsonb;
begin
  perform private.assert_platform_billing_reader();
  v_start := date_trunc('month', v_today::timestamp)::date;
  v_end := (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date;

  select count(*) filter (where f.attention)
    into v_attention
    from private.platform_billing_clinic_facts() f;

  v_sandbox := private.platform_billing_env_bucket('sandbox', v_start, v_end);
  v_production := private.platform_billing_env_bucket('production', v_start, v_end);

  return jsonb_build_object(
    'timezone', 'America/Sao_Paulo',
    'period_start', v_start,
    'period_end', v_end,
    'financial', jsonb_build_object(
      'sandbox', coalesce(v_sandbox, '{}'::jsonb),
      'production', coalesce(v_production, '{}'::jsonb)
    ),
    'clinics_with_received', coalesce((
      select count(distinct a.clinic_id)::integer
        from private.billing_payments p
        join private.billing_accounts a on a.id = p.billing_account_id
       where a.clinic_id is not null
         and p.environment = a.environment
         and p.financial_state = 'received'
         and p.payment_date is not null
         and p.payment_date between v_start and v_end
    ), 0),
    'delinquent', jsonb_build_object(
      'sandbox', coalesce((
        select count(distinct u.clinic_id)::integer
          from private.platform_billing_charge_universe() u
         where u.display_state = 'OVERDUE'
           and u.environment = 'sandbox'
      ), 0),
      'production', coalesce((
        select count(distinct u.clinic_id)::integer
          from private.platform_billing_charge_universe() u
         where u.display_state = 'OVERDUE'
           and u.environment = 'production'
      ), 0)
    ),
    'active_commercial_contracts', coalesce((
      select count(*)::integer
        from private.billing_commercial_contracts cc
       where cc.status = 'active'
    ), 0),
    'active_pix_automatic_authorizations', jsonb_build_object(
      'sandbox', coalesce((
        select count(*)::integer
          from private.billing_pix_automatic_authorizations auth
         where auth.is_primary
           and auth.provider_status = 'ACTIVE'
           and auth.environment = 'sandbox'
      ), 0),
      'production', coalesce((
        select count(*)::integer
          from private.billing_pix_automatic_authorizations auth
         where auth.is_primary
           and auth.provider_status = 'ACTIVE'
           and auth.environment = 'production'
      ), 0)
    ),
    'payment_success_count', coalesce((
      select count(*)::integer
        from private.billing_payments p
        join private.billing_accounts a on a.id = p.billing_account_id
       where a.clinic_id is not null
         and p.environment = a.environment
         and p.financial_state = 'received'
         and p.payment_date is not null
         and p.payment_date between v_start and v_end
    ), 0),
    'attention_clinic_count', coalesce(v_attention, 0),
    'aging', jsonb_build_object(
      'sandbox', coalesce(private.platform_billing_aging_for_environment('sandbox', v_today), '{}'::jsonb),
      'production', coalesce(private.platform_billing_aging_for_environment('production', v_today), '{}'::jsonb)
    ),
    'entitlement_enforcement', 'OFF'
  );
end;
$$;


create or replace function public.get_platform_clinic_billing_detail(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.platform_billing_clinic_facts;
  v_today date := private.billing_hub_business_date();
begin
  perform private.assert_platform_billing_reader();
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;

  select f.* into v_row
    from private.platform_billing_clinic_facts() f
   where f.clinic_id = p_clinic_id
   limit 1;

  if v_row.clinic_id is null then
    return jsonb_build_object('found', false, 'clinic_id', p_clinic_id);
  end if;

  return jsonb_build_object(
    'found', true,
    'clinic', private.platform_billing_clinic_json(v_row),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.charge_id,
        'clinic_id', c.clinic_id,
        'environment', c.environment,
        'amount_cents', c.amount_cents,
        'currency', c.currency,
        'due_date', c.due_date,
        'paid_date', c.paid_date,
        'display_state', c.display_state,
        'method', c.method
      ) order by
        case c.display_state
          when 'OVERDUE' then 0
          when 'PENDING' then 1
          when 'PROGRAMMED' then 2
          else 3
        end,
        c.due_date desc nulls last,
        c.occurred_at desc,
        c.charge_id desc
      )
      from (
        select *
          from private.platform_billing_charge_universe() u
         where u.clinic_id = p_clinic_id
         order by u.occurred_at desc, u.charge_id desc
         limit 50
      ) c
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'clinic_id', a.clinic_id,
        'environment', a.environment,
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
        select bp.*, ba.clinic_id, ba.environment
          from private.billing_payments bp
          join private.billing_accounts ba on ba.id = bp.billing_account_id
         where ba.clinic_id = p_clinic_id
           and bp.environment = ba.environment
           and bp.financial_state not in ('voided', 'unknown')
         order by bp.created_at desc, bp.id desc
         limit 50
      ) p
      join private.billing_accounts a on a.id = p.billing_account_id
    ), '[]'::jsonb),
    'business_timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.event_id,
        'occurred_at', t.occurred_at,
        'type', t.event_type,
        'environment', t.environment
      ) order by t.occurred_at desc, t.event_type desc, t.event_id desc)
      from (
        select *
          from private.billing_hub_timeline_rows(p_clinic_id)
         order by occurred_at desc, event_type desc, event_id desc
         limit 50
      ) t
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'processing_status', e.processing_status,
        'received_at', e.received_at,
        'processed_at', e.processed_at,
        'failure_category', e.last_error_category,
        'clinic_id', e.clinic_id,
        'related_payment_id', e.related_payment_id,
        'related_entity_type', e.related_entity_type
      ) order by e.received_at desc, e.id desc)
      from (
        select
          ev.id,
          ev.event_type,
          ev.processing_status,
          ev.received_at,
          ev.processed_at,
          ev.last_error_category,
          coalesce(a.clinic_id, cc.clinic_id) as clinic_id,
          p.id as related_payment_id,
          case
            when p.id is not null then 'payment'
            when auth.id is not null then 'authorization'
            else 'unknown'
          end as related_entity_type
        from private.billing_provider_events ev
        left join private.billing_payments p
          on p.external_payment_id = ev.external_resource_id
        left join private.billing_accounts a
          on a.id = p.billing_account_id
        left join private.billing_pix_automatic_authorizations auth
          on auth.provider_contract_id = ev.external_resource_id
        left join private.billing_commercial_contracts cc
          on cc.id = auth.commercial_contract_id
        where coalesce(a.clinic_id, cc.clinic_id) = p_clinic_id
        order by ev.received_at desc, ev.id desc
        limit 50
      ) e
    ), '[]'::jsonb)
  );
end;
$$;


create or replace function private.platform_billing_clinic_json(p_row private.platform_billing_clinic_facts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'clinic_id', p_row.clinic_id,
    'clinic_name', p_row.clinic_name,
    'plan_code', p_row.plan_code,
    'plan_display_name', p_row.plan_display_name,
    'plan_price_cents', p_row.plan_price_cents,
    'plan_currency', coalesce(p_row.plan_currency, 'BRL'),
    'billing_cycle', p_row.billing_cycle,
    'contract_status', p_row.contract_status,
    'contract_effective_from', p_row.contract_effective_from,
    'identity_complete', p_row.identity_complete,
    'customer_bound', p_row.customer_bound,
    'provider', coalesce(p_row.provider_facts, jsonb_build_object(
      'sandbox', private.platform_billing_pack_provider_env(
        null, null, null, null, null, null, null, null, 0, 0, 0, 0
      ),
      'production', private.platform_billing_pack_provider_env(
        null, null, null, null, null, null, null, null, 0, 0, 0, 0
      )
    )),
    'financial_summary', p_row.financial_summary,
    'attention', p_row.attention,
    'attention_reason', p_row.attention_reason,
    'entitlement_enforcement', 'OFF',
    'entitlement_granted', false
  );
$$;

comment on function private.platform_billing_clinic_json(private.platform_billing_clinic_facts) is
  'WP-BILLING-PREPROD-02R2: clinic JSON carries per-environment provider facts. Unlabeled Pix/latest/next/aging are omitted.';

revoke all on function private.platform_billing_clinic_json(private.platform_billing_clinic_facts)
  from public, anon, authenticated, service_role;


create or replace function public.list_platform_billing_clinics(
  p_clinic_query text default null,
  p_plan_code text default null,
  p_contract_status text default null,
  p_pix_status text default null,
  p_financial_status text default null,
  p_needs_attention boolean default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.platform_billing_clamp_limit(p_limit);
  v_offset integer := private.platform_billing_clamp_offset(p_offset);
  v_query text := nullif(btrim(coalesce(p_clinic_query, '')), '');
  v_plan text := nullif(btrim(coalesce(p_plan_code, '')), '');
  v_contract text := nullif(btrim(coalesce(p_contract_status, '')), '');
  v_pix text := nullif(btrim(coalesce(p_pix_status, '')), '');
  v_fin text := nullif(btrim(coalesce(p_financial_status, '')), '');
begin
  perform private.assert_platform_billing_reader();

  return jsonb_build_object(
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(private.platform_billing_clinic_json(x) order by
        x.attention desc,
        x.overdue_cents desc,
        x.clinic_name asc,
        x.clinic_id asc
      )
      from (
        select f.*
          from private.platform_billing_clinic_facts() f
         where (v_query is null
                or f.clinic_name ilike '%' || v_query || '%'
                or f.clinic_id::text = v_query)
           and (v_plan is null or f.plan_code = v_plan)
           and (v_contract is null or f.contract_status = v_contract)
           and (
             v_pix is null
             or (
               v_pix = 'absent'
               and f.provider_facts#>>'{sandbox,pix_status}' is null
               and f.provider_facts#>>'{production,pix_status}' is null
             )
             or f.provider_facts#>>'{sandbox,pix_status}' = v_pix
             or f.provider_facts#>>'{production,pix_status}' = v_pix
           )
           and (v_fin is null or f.financial_summary = v_fin)
           and (p_needs_attention is null or f.attention = p_needs_attention)
         order by f.attention desc, f.overdue_cents desc, f.clinic_name asc, f.clinic_id asc
         limit v_limit
         offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.list_platform_billing_clinics(text, text, text, text, text, boolean, integer, integer) is
  'WP-BILLING-PREPROD-02R2: Pix filter matches either environment without collapsing statuses.';


create or replace function private.billing_hub_next_charge(p_clinic_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when x.charge_id is null then null
    else jsonb_build_object(
      'amount_cents', x.amount_cents,
      'currency', x.currency,
      'due_date', x.due_date,
      'display_state', x.display_state,
      'environment', private.billing_clinic_provider_environment(p_clinic_id)
    )
  end
  from (
    select c.charge_id, c.amount_cents, c.currency, c.due_date, c.display_state
      from private.billing_hub_charge_rows(p_clinic_id) c
     where c.display_state in ('PROGRAMMED', 'PENDING')
       and c.due_date is not null
       and c.due_date >= private.billing_hub_business_date()
     order by c.due_date asc, c.occurred_at asc, c.charge_id asc
     limit 1
  ) x;
$$;

comment on function private.billing_hub_next_charge(uuid) is
  'WP-BILLING-PREPROD-02R2: next charge is scoped to the clinic write environment and labeled.';


create or replace function public.get_my_clinic_billing_overview(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_checkout jsonb;
  v_next jsonb;
  v_overdue_count integer := 0;
  v_overdue_cents bigint := 0;
  v_open_count integer := 0;
  v_paid_count integer := 0;
  v_charge_count integer := 0;
  v_summary text;
  v_latest_payment text;
  v_pix_status text;
  v_pix_generation integer;
  v_today date := private.billing_hub_business_date();
  v_env text := private.billing_clinic_provider_environment(p_clinic_id);
begin
  perform private.assert_my_clinic_billing_reader(p_clinic_id);
  v_checkout := private.billing_clinic_checkout_snapshot(p_clinic_id);
  v_next := private.billing_hub_next_charge(p_clinic_id);

  select
    count(*)::integer,
    count(*) filter (where c.display_state = 'OVERDUE')::integer,
    coalesce(sum(c.amount_cents) filter (where c.display_state = 'OVERDUE'), 0),
    count(*) filter (where c.display_state in ('PROGRAMMED', 'PENDING'))::integer,
    count(*) filter (where c.display_state = 'PAID')::integer
    into v_charge_count, v_overdue_count, v_overdue_cents, v_open_count, v_paid_count
    from private.billing_hub_charge_rows(p_clinic_id) c;

  select private.billing_hub_payment_display_state(p.financial_state, p.due_date, v_today)
    into v_latest_payment
    from private.billing_payments p
    join private.billing_accounts a on a.id = p.billing_account_id
   where a.clinic_id = p_clinic_id
     and a.environment = v_env
     and p.environment = a.environment
     and p.financial_state not in ('voided', 'unknown')
   order by coalesce(p.payment_date, p.due_date, v_today) desc, p.created_at desc
   limit 1;

  select a.provider_status, a.generation
    into v_pix_status, v_pix_generation
    from private.billing_pix_automatic_authorizations a
    join private.billing_commercial_contracts cc on cc.id = a.commercial_contract_id
   where cc.clinic_id = p_clinic_id
     and a.environment = v_env
     and a.is_primary
   order by a.generation desc nulls last, a.created_at desc
   limit 1;

  if v_checkout->'commercial_contract' is null
     or v_checkout->>'commercial_contract' = 'null' then
    v_summary := 'no_plan';
  elsif v_overdue_count > 0 then
    v_summary := 'overdue';
  elsif v_open_count > 0 then
    v_summary := 'pending';
  elsif v_paid_count > 0 then
    v_summary := 'current';
  else
    v_summary := 'no_charges';
  end if;

  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'environment', v_env,
    'plan', case
      when v_checkout->'commercial_contract' is null
           or v_checkout->>'commercial_contract' = 'null' then null
      else jsonb_build_object(
        'status', v_checkout#>>'{commercial_contract,status}',
        'plan_display_name', v_checkout#>>'{commercial_contract,plan_display_name}',
        'price_cents', (v_checkout#>>'{commercial_contract,price_cents}')::integer,
        'currency', v_checkout#>>'{commercial_contract,currency}',
        'billing_cycle', v_checkout#>>'{commercial_contract,billing_cycle}'
      )
    end,
    'pix_authorization_status', to_jsonb(v_pix_status),
    'pix_generation', to_jsonb(v_pix_generation),
    'identity_complete', coalesce((v_checkout->>'identity_complete')::boolean, false),
    'next_charge', v_next,
    'financial_situation', jsonb_build_object(
      'summary_code', v_summary,
      'attention', v_summary = 'overdue',
      'overdue_count', v_overdue_count,
      'overdue_cents', case when v_overdue_count > 0 then v_overdue_cents else null end
    ),
    'latest_payment_display_state', v_latest_payment,
    'charge_count', v_charge_count,
    'entitlement_enforcement', 'OFF',
    'entitlement_granted', false
  );
end;
$$;

comment on function public.get_my_clinic_billing_overview(uuid) is
  'WP-BILLING-PREPROD-02R2: clinic hub reads the write environment only and labels it. Latest pay cannot hide the other environment.';


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260921120000',
  '20260921120000_wp_billing_preprod_02_commercial_gate_env_isolation.sql',
  'WP-BILLING-PREPROD-02/R2: commercial gate, BOOL_OR customer_bound, environment-safe Pix/latest/next/aging. Local only.',
  'WP-BILLING-PREPROD-02'
)
on conflict (version) do nothing;

