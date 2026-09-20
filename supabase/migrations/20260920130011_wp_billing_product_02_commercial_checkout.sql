-- =====================================================================================
-- WP-BILLING-PRODUCT-02 — clinic commercial checkout foundation.
--
-- Catalog read + billing identity reuse + local billing account + commercial contract.
-- ZERO Asaas / provider HTTP. ZERO Pix PREPARE/EXECUTE. ZERO QR. ZERO entitlement.
-- FOUNDER_CHECKOUT = OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY. Do not invent eligibility.
--
-- NOT APPLIED REMOTELY in this WP. Do not deploy Edge. Do not merge from this file alone.
-- =====================================================================================


-- ── Local billing account: clinic admin (own clinic) + clinic-owner row owner ─

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
    if v_environment = 'production' then
      raise exception 'BILLING_PRODUCTION_LOCKED'
        using errcode = '42501', hint = 'BILLING_PRODUCTION_LOCKED';
    end if;

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

    perform pg_catalog.pg_advisory_xact_lock(90300, pg_catalog.hashtext(p_clinic_id::text));

    select a.id, a.external_customer_id, a.clinic_id, a.environment
      into v_linked_id, v_external_customer_id, v_clinic_id, v_existing_env
      from private.billing_accounts a
     where a.clinic_id = p_clinic_id;

    if found then
      if v_existing_env is distinct from 'sandbox' then
        raise exception 'BILLING_PRODUCTION_LOCKED'
          using errcode = '42501', hint = 'BILLING_PRODUCTION_LOCKED';
      end if;
      return jsonb_build_object(
        'billing_account_id', v_linked_id,
        'external_customer_id', v_external_customer_id,
        'clinic_id', v_clinic_id,
        'created', false
      );
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
         where id = v_id;
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
      'created', v_created
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90300, pg_catalog.hashtext(v_me::text));

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
    'created', v_created
  );
end;
$$;

comment on function public.get_or_create_billing_account(text, text, uuid) is
  'WP-BILLING-PRODUCT-02: local billing account only. Clinic path: owner OR clinic_role=admin '
  'for own clinic; owner_profile_id is the clinic owner. No provider HTTP. No test customer fixture. '
  'Environment remains an engine argument — Clinic Admin checkout must use ensure_my_clinic_billing_account.';

revoke all on function public.get_or_create_billing_account(text, text, uuid)
  from public, anon, service_role;
grant execute on function public.get_or_create_billing_account(text, text, uuid) to authenticated;


create or replace function public.ensure_my_clinic_billing_account(p_clinic_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_raw jsonb;
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

  -- Sandbox is forced server-side. Browser cannot choose production.
  v_raw := public.get_or_create_billing_account('asaas', 'sandbox', p_clinic_id);

  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'exists', true,
    'created', coalesce((v_raw ->> 'created')::boolean, false)
  );
end;
$$;

comment on function public.ensure_my_clinic_billing_account(uuid) is
  'WP-BILLING-PRODUCT-02: local sandbox billing account for Clinic Admin checkout. '
  'No environment argument. No provider customer id in the response. No Asaas HTTP.';

revoke all on function public.ensure_my_clinic_billing_account(uuid)
  from public, anon, service_role;
grant execute on function public.ensure_my_clinic_billing_account(uuid) to authenticated;


-- ── Safe catalog (no founder, no provider ids) ───────────────────────────────

create or replace function public.list_sellable_billing_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_plans jsonb;
begin
  if v_me is null then
    raise exception 'BILLING_NOT_AUTHENTICATED'
      using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;

  select coalesce(jsonb_agg(plan_row order by sort_order), '[]'::jsonb)
    into v_plans
    from (
      select p.sort_order, jsonb_build_object(
        'plan_id', p.id,
        'plan_version_id', pv.id,
        'code', p.code,
        'display_name', p.display_name,
        'price_cents', pv.standard_price_cents,
        'currency', pv.currency_code,
        'billing_cycle', 'monthly',
        'tagline', pv.tagline,
        'marketing_message', pv.marketing_message,
        'features', coalesce((
          select jsonb_agg(f.display_name order by f.sort_order)
            from private.billing_plan_version_features pvf
            join private.billing_features f on f.id = pvf.feature_id
           where pvf.plan_version_id = pv.id
        ), '[]'::jsonb),
        'sellable', true
      ) as plan_row
        from private.billing_plans p
        join private.billing_plan_versions pv
          on pv.plan_id = p.id
         and pv.version = (
           select max(pv2.version)
             from private.billing_plan_versions pv2
            where pv2.plan_id = p.id
         )
       where p.status = 'active'
    ) catalog;

  return jsonb_build_object(
    'plans', coalesce(v_plans, '[]'::jsonb),
    'founder_checkout', 'OUT_OF_SCOPE_BLOCKED_BY_ELIGIBILITY'
  );
end;
$$;

comment on function public.list_sellable_billing_plans() is
  'WP-BILLING-PRODUCT-02: product-facing catalog. Current version of active plans only. '
  'List price from catalog — never founder promo. No provider ids. Authenticated read.';

revoke all on function public.list_sellable_billing_plans()
  from public, anon, service_role;
grant execute on function public.list_sellable_billing_plans() to authenticated;


-- ── Checkout read model ──────────────────────────────────────────────────────

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
  v_contract record;
  v_pix_status text;
begin
  select exists(
    select 1 from private.billing_customer_identities i where i.clinic_id = p_clinic_id
  ) into v_identity_exists;
  v_identity_complete := private.billing_customer_identity_complete(p_clinic_id);

  select exists(
    select 1 from private.billing_accounts a where a.clinic_id = p_clinic_id
  ) into v_account_exists;

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
    select a.provider_status into v_pix_status
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
    'entitlement_enforcement', 'OFF',
    'entitlement_granted', false
  );
end;
$$;

comment on function private.billing_clinic_checkout_snapshot(uuid) is
  'WP-BILLING-PRODUCT-02: commercial checkout snapshot. No provider ids. No QR. INVOKER.';

revoke all on function private.billing_clinic_checkout_snapshot(uuid)
  from public, anon, authenticated, service_role;


create or replace function public.get_my_clinic_commercial_checkout(p_clinic_id uuid)
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
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'BILLING_NOT_CLINIC_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_CLINIC_ADMIN';
  end if;
  return private.billing_clinic_checkout_snapshot(p_clinic_id);
end;
$$;

comment on function public.get_my_clinic_commercial_checkout(uuid) is
  'WP-BILLING-PRODUCT-02: Clinic Admin commercial checkout read model. Own clinic only.';

revoke all on function public.get_my_clinic_commercial_checkout(uuid)
  from public, anon, service_role;
grant execute on function public.get_my_clinic_commercial_checkout(uuid) to authenticated;


create or replace function public.create_my_clinic_commercial_contract(
  p_clinic_id uuid,
  p_plan_version_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_existing_id uuid;
  v_existing_version uuid;
  v_created_id uuid;
begin
  if v_me is null then
    raise exception 'BILLING_NOT_AUTHENTICATED'
      using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED';
  end if;
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED'
      using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED';
  end if;
  if p_plan_version_id is null then
    raise exception 'BILLING_PLAN_VERSION_REQUIRED'
      using errcode = '22023', hint = 'BILLING_PLAN_VERSION_REQUIRED';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'BILLING_NOT_CLINIC_ADMIN'
      using errcode = '42501', hint = 'BILLING_NOT_CLINIC_ADMIN';
  end if;
  if not private.billing_customer_identity_complete(p_clinic_id) then
    raise exception 'BILLING_IDENTITY_INCOMPLETE'
      using errcode = '22023', hint = 'BILLING_IDENTITY_INCOMPLETE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90301, pg_catalog.hashtext(p_clinic_id::text));

  select cc.id, cc.plan_version_id
    into v_existing_id, v_existing_version
    from private.billing_commercial_contracts cc
   where cc.clinic_id = p_clinic_id
     and cc.status = 'active'
   limit 1;

  if v_existing_id is not null then
    if v_existing_version is not distinct from p_plan_version_id then
      perform public.ensure_my_clinic_billing_account(p_clinic_id);
      return private.billing_clinic_checkout_snapshot(p_clinic_id);
    end if;
    raise exception 'BILLING_ACTIVE_CONTRACT_EXISTS'
      using errcode = '23505', hint = 'BILLING_ACTIVE_CONTRACT_EXISTS';
  end if;

  begin
    v_created_id := private.billing_create_commercial_contract(
      p_clinic_id,
      p_plan_version_id,
      null,
      null,
      null
    );
  exception
    when unique_violation then
      select cc.id, cc.plan_version_id
        into v_existing_id, v_existing_version
        from private.billing_commercial_contracts cc
       where cc.clinic_id = p_clinic_id
         and cc.status = 'active'
       limit 1;
      if v_existing_version is not distinct from p_plan_version_id then
        perform public.ensure_my_clinic_billing_account(p_clinic_id);
        return private.billing_clinic_checkout_snapshot(p_clinic_id);
      end if;
      raise exception 'BILLING_ACTIVE_CONTRACT_EXISTS'
        using errcode = '23505', hint = 'BILLING_ACTIVE_CONTRACT_EXISTS';
  end;

  if v_created_id is null then
    raise exception 'BILLING_ACTIVE_CONTRACT_EXISTS'
      using errcode = '23505', hint = 'BILLING_ACTIVE_CONTRACT_EXISTS';
  end if;

  perform public.ensure_my_clinic_billing_account(p_clinic_id);
  return private.billing_clinic_checkout_snapshot(p_clinic_id);
end;
$$;

comment on function public.create_my_clinic_commercial_contract(uuid, uuid) is
  'WP-BILLING-PRODUCT-02: Clinic Admin commercial contract. Server snapshots catalog price. '
  'No offer/founder. No client price. No Pix. No entitlement. Same-plan retry is idempotent.';

revoke all on function public.create_my_clinic_commercial_contract(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.create_my_clinic_commercial_contract(uuid, uuid) to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260920130011',
  '20260920130011_wp_billing_product_02_commercial_checkout.sql',
  'WP-BILLING-PRODUCT-02: catalog RPC + clinic-admin billing account + commercial checkout. '
  'No Asaas HTTP. Founder checkout blocked. Not applied remotely in this WP.',
  'WP-BILLING-PRODUCT-02'
)
on conflict (version) do nothing;
