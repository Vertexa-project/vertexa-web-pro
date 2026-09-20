-- =====================================================================================
-- WP-BILLING-PRODUCT-03 — Clinic Pix Automatic checkout wrappers.
--
-- Reuses private PREPARE / REISSUE engines. No new core tables. No QR columns.
-- Environment is sandbox-only for Clinic Admin product paths.
-- NOT APPLIED REMOTELY in this WP.
-- =====================================================================================

alter table private.billing_pix_automatic_reissue_events
  add column if not exists actor_authority text not null default 'platform_admin';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'billing_pix_reissue_events_actor_authority_check'
  ) then
    alter table private.billing_pix_automatic_reissue_events
      add constraint billing_pix_reissue_events_actor_authority_check
      check (actor_authority in ('platform_admin', 'clinic_admin'));
  end if;
end;
$$;

comment on column private.billing_pix_automatic_reissue_events.actor_authority is
  'WP-BILLING-PRODUCT-03: platform_admin (PA wrapper) or clinic_admin (own-clinic wrapper). '
  'Does not replace actor_profile_id.';


create or replace function private.billing_clinic_pix_next_action(
  p_identity_complete boolean,
  p_account_sandbox boolean,
  p_customer_bound boolean,
  p_has_active_contract boolean,
  p_pix_status text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not coalesce(p_has_active_contract, false) then 'none'
    when not coalesce(p_identity_complete, false) then 'complete_identity'
    when not coalesce(p_account_sandbox, false) then 'none'
    when not coalesce(p_customer_bound, false) then 'ensure_customer'
    when p_pix_status is null or p_pix_status = 'INTENT' then 'prepare_execute'
    when p_pix_status = 'CREATED' then 'await_bank'
    when p_pix_status = 'ACTIVE' then 'done'
    when p_pix_status = 'REFUSED' then 'reissue'
    else 'none'
  end;
$$;

comment on function private.billing_clinic_pix_next_action(boolean, boolean, boolean, boolean, text) is
  'WP-BILLING-PRODUCT-03: product next-action projection. No provider ids. No QR.';

revoke all on function private.billing_clinic_pix_next_action(boolean, boolean, boolean, boolean, text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_clinic_checkout_snapshot(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_identity_exists boolean := false;
  v_identity_complete boolean := false;
  v_account_exists boolean := false;
  v_account_sandbox boolean := false;
  v_customer_bound boolean := false;
  v_contract record;
  v_pix_status text;
  v_pix_generation integer;
begin
  select exists(
    select 1 from private.billing_customer_identities i where i.clinic_id = p_clinic_id
  ) into v_identity_exists;
  v_identity_complete := private.billing_customer_identity_complete(p_clinic_id);

  select
    true,
    a.environment = 'sandbox',
    a.external_customer_id is not null
    into v_account_exists, v_account_sandbox, v_customer_bound
    from private.billing_accounts a
   where a.clinic_id = p_clinic_id
   limit 1;

  v_account_exists := coalesce(v_account_exists, false);
  v_account_sandbox := coalesce(v_account_sandbox, false);
  v_customer_bound := coalesce(v_customer_bound, false);

  select
    cc.id,
    cc.status,
    p.id as plan_id,
    cc.plan_version_id,
    p.code as plan_code,
    p.display_name as plan_display_name,
    cc.contracted_price_cents as price_cents,
    cc.contracted_currency as currency,
    cc.billing_cycle
    into v_contract
    from private.billing_commercial_contracts cc
    join private.billing_plan_versions pv on pv.id = cc.plan_version_id
    join private.billing_plans p on p.id = pv.plan_id
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;

  if v_contract.id is not null then
    select a.provider_status, a.generation
      into v_pix_status, v_pix_generation
      from private.billing_pix_automatic_authorizations a
     where a.commercial_contract_id = v_contract.id
       and a.is_primary
     limit 1;
  end if;

  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'founder_checkout', 'OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY',
    'identity_exists', v_identity_exists,
    'identity_complete', v_identity_complete,
    'local_billing_account_exists', v_account_exists,
    'local_billing_account_sandbox', v_account_sandbox,
    'provider_customer_bound', v_customer_bound,
    'commercial_contract', case
      when v_contract.id is null then null
      else jsonb_build_object(
        'id', v_contract.id,
        'status', v_contract.status,
        'plan_id', v_contract.plan_id,
        'plan_version_id', v_contract.plan_version_id,
        'plan_code', v_contract.plan_code,
        'plan_display_name', v_contract.plan_display_name,
        'price_cents', v_contract.price_cents,
        'currency', v_contract.currency,
        'billing_cycle', v_contract.billing_cycle
      )
    end,
    'pix_authorization_status', v_pix_status,
    'pix_generation', v_pix_generation,
    'pix_next_action', private.billing_clinic_pix_next_action(
      v_identity_complete,
      v_account_sandbox,
      v_customer_bound,
      v_contract.id is not null,
      v_pix_status
    ),
    'qr_available_now', false,
    'entitlement_enforcement', 'OFF',
    'entitlement_granted', false
  );
end;
$$;

comment on function private.billing_clinic_checkout_snapshot(uuid) is
  'WP-BILLING-PRODUCT-03: commercial + Pix product snapshot. No provider ids. No QR payload.';


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
begin
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;

  select * into v_identity
    from private.billing_customer_identities i
   where i.clinic_id = p_clinic_id;

  select * into v_account
    from private.billing_accounts a
   where a.clinic_id = p_clinic_id;

  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'identity_complete', private.billing_customer_identity_complete(p_clinic_id),
    'legal_name', v_identity.legal_name,
    'tax_id', v_identity.tax_id,
    'email', v_identity.email,
    'mobile_phone', v_identity.mobile_phone,
    'billing_account_id', v_account.id,
    'environment', v_account.environment,
    'external_customer_id', v_account.external_customer_id
  );
end;
$$;

comment on function public.billing_load_provider_customer_context_outbound(uuid) is
  'WP-BILLING-PRODUCT-03: Edge/service_role identity loader. Never granted to anon/authenticated.';

revoke all on function public.billing_load_provider_customer_context_outbound(uuid)
  from public, anon, authenticated;
grant execute on function public.billing_load_provider_customer_context_outbound(uuid)
  to service_role;


create or replace function public.am_i_clinic_admin_for_billing_account(p_billing_account_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  if p_billing_account_id is null or private.current_profile_id() is null then
    return false;
  end if;
  select a.clinic_id into v_clinic
    from private.billing_accounts a
   where a.id = p_billing_account_id;
  if v_clinic is null then
    return false;
  end if;
  return private.is_clinic_admin(v_clinic);
end;
$$;

comment on function public.am_i_clinic_admin_for_billing_account(uuid) is
  'WP-BILLING-PRODUCT-03: boolean only. Own-clinic admin of the account clinic.';

revoke all on function public.am_i_clinic_admin_for_billing_account(uuid)
  from public, anon, service_role;
grant execute on function public.am_i_clinic_admin_for_billing_account(uuid)
  to authenticated;


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

  select * into v_account
    from private.billing_accounts a
   where a.clinic_id = p_clinic_id;

  if not found then
    raise exception 'BILLING_ACCOUNT_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_ACCOUNT_UNKNOWN';
  end if;
  if v_account.environment is distinct from 'sandbox' then
    raise exception 'BILLING_PRODUCTION_LOCKED'
      using errcode = '42501', hint = 'BILLING_PRODUCTION_LOCKED';
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

  v_result := private.billing_prepare_pix_automatic_authorization(v_contract_id, 'sandbox');
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

comment on function public.prepare_my_clinic_pix_automatic_authorization(uuid) is
  'WP-BILLING-PRODUCT-03: Clinic Admin PREPARE. Sandbox only. Server price. No HTTP. No QR.';

revoke all on function public.prepare_my_clinic_pix_automatic_authorization(uuid)
  from public, anon, service_role;
grant execute on function public.prepare_my_clinic_pix_automatic_authorization(uuid)
  to authenticated;


create or replace function public.reissue_my_clinic_pix_automatic_authorization(
  p_clinic_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_profile_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_account private.billing_accounts%rowtype;
  v_contract_id uuid;
  v_auth private.billing_pix_automatic_authorizations%rowtype;
  v_result jsonb;
  v_outcome text;
  v_new_id uuid;
  v_new_gen integer;
  v_new_status text;
  v_op_id uuid;
begin
  if v_actor is null then
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

  if v_reason is not null and char_length(v_reason) > 500 then
    v_reason := left(v_reason, 500);
  end if;

  select * into v_account
    from private.billing_accounts a
   where a.clinic_id = p_clinic_id;

  if not found or v_account.environment is distinct from 'sandbox' then
    raise exception 'BILLING_PRODUCTION_LOCKED'
      using errcode = '42501', hint = 'BILLING_PRODUCTION_LOCKED';
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

  select * into v_auth
    from private.billing_pix_automatic_authorizations a
   where a.commercial_contract_id = v_contract_id
     and a.is_primary;

  if not found then
    raise exception 'BILLING_AUTHORIZATION_UNKNOWN'
      using errcode = 'P0002', hint = 'BILLING_AUTHORIZATION_UNKNOWN';
  end if;
  if v_auth.provider_status is distinct from 'REFUSED' then
    raise exception 'BILLING_REISSUE_NOT_REFUSED'
      using errcode = '22023', hint = 'BILLING_REISSUE_NOT_REFUSED';
  end if;

  v_result := private.billing_reissue_pix_automatic_authorization(v_contract_id, 'sandbox');
  v_outcome := v_result->>'outcome';
  v_new_id := (v_result->>'authorization_id')::uuid;
  v_new_gen := (v_result->>'generation')::integer;
  v_new_status := v_result->>'provider_status';
  v_op_id := (v_result->'authorization_operation'->>'operation_id')::uuid;

  if v_outcome is distinct from 'reissued'
     and v_outcome is distinct from 'already_reissued' then
    raise exception 'BILLING_REISSUE_UNEXPECTED_OUTCOME'
      using errcode = '22023', hint = 'BILLING_REISSUE_UNEXPECTED_OUTCOME';
  end if;

  if v_outcome = 'reissued' then
    insert into private.billing_pix_automatic_reissue_events (
      actor_profile_id,
      clinic_id,
      commercial_contract_id,
      old_authorization_id,
      new_authorization_id,
      old_generation,
      new_generation,
      old_status,
      new_status,
      outcome,
      environment,
      reason,
      actor_authority
    ) values (
      v_actor,
      p_clinic_id,
      v_contract_id,
      v_auth.id,
      v_new_id,
      v_auth.generation,
      v_new_gen,
      'REFUSED',
      'INTENT',
      'reissued',
      'sandbox',
      v_reason,
      'clinic_admin'
    );
  else
    insert into private.billing_pix_automatic_reissue_events (
      actor_profile_id,
      clinic_id,
      commercial_contract_id,
      old_authorization_id,
      new_authorization_id,
      old_generation,
      new_generation,
      old_status,
      new_status,
      outcome,
      environment,
      reason,
      actor_authority
    ) values (
      v_actor,
      p_clinic_id,
      v_contract_id,
      v_new_id,
      v_new_id,
      v_new_gen,
      v_new_gen,
      coalesce(v_new_status, 'INTENT'),
      coalesce(v_new_status, 'INTENT'),
      'already_reissued',
      'sandbox',
      v_reason,
      'clinic_admin'
    );
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'old_authorization_id',
      case when v_outcome = 'reissued' then v_auth.id else v_new_id end,
    'new_authorization_id', v_new_id,
    'old_generation',
      case when v_outcome = 'reissued' then v_auth.generation else v_new_gen end,
    'new_generation', v_new_gen,
    'new_status', v_new_status,
    'operation_id', v_op_id
  );
end;
$$;

comment on function public.reissue_my_clinic_pix_automatic_authorization(uuid, text) is
  'WP-BILLING-PRODUCT-03: Clinic Admin own-clinic REFUSED recovery. Local only. No HTTP. No QR.';

revoke all on function public.reissue_my_clinic_pix_automatic_authorization(uuid, text)
  from public, anon, service_role;
grant execute on function public.reissue_my_clinic_pix_automatic_authorization(uuid, text)
  to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260920180000',
  '20260920180000_wp_billing_product_03_clinic_pix_checkout.sql',
  'WP-BILLING-PRODUCT-03: clinic Pix checkout wrappers, identity loader for Edge, '
  'reissue actor_authority. No QR columns. Not applied remotely in this WP.',
  'billing-product-03'
)
on conflict (version) do nothing;
