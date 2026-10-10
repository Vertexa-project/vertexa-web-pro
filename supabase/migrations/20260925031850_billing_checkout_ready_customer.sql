-- =============================================================================
-- WP-BILLING-MASTER-QA-03R4: checkout-ready canonical customer identity.
-- Local source only in this WP. No remote apply, provider call, or data backfill.
-- Existing identities remain valid for non-card flows; hosted card requires the
-- billing phone, billing address, and billing address number explicitly.
-- =============================================================================

alter table private.billing_customer_identities
  add column billing_address text,
  add column billing_address_number text;

alter table private.billing_customer_identities
  add constraint billing_customer_identities_address_check
    check (billing_address is null or btrim(billing_address) <> ''),
  add constraint billing_customer_identities_address_number_check
    check (billing_address_number is null or btrim(billing_address_number) <> '');

comment on column private.billing_customer_identities.billing_address is
  'R4: billing-specific street/address used to make the canonical provider customer checkout-ready.';
comment on column private.billing_customer_identities.billing_address_number is
  'R4: billing-specific address number. Kept as text for valid Brazilian representations such as S/N.';

create or replace function private.billing_normalize_optional_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_value, '')), '');
$$;

revoke all on function private.billing_normalize_optional_text(text)
  from public, anon, authenticated, service_role;


-- Preserve all CNPJ/mobile validation introduced by QA-01 while extending the
-- trusted normalization boundary to the two new billing address fields.
create or replace function private.billing_protect_customer_identity_tax_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.legal_name := btrim(new.legal_name);
  new.tax_id := private.billing_normalize_tax_id(new.tax_id);
  new.email := private.billing_normalize_email(new.email);
  new.mobile_phone := private.billing_normalize_phone(new.mobile_phone);
  new.billing_address := private.billing_normalize_optional_text(new.billing_address);
  new.billing_address_number := private.billing_normalize_optional_text(new.billing_address_number);

  if new.legal_name is null or new.legal_name = '' then
    raise exception 'BILLING_INVALID_LEGAL_NAME'
      using errcode = '22023', hint = 'BILLING_INVALID_LEGAL_NAME';
  end if;
  if not private.billing_tax_id_is_valid(new.tax_id) then
    raise exception 'BILLING_INVALID_TAX_ID'
      using errcode = '22023', hint = 'BILLING_INVALID_TAX_ID';
  end if;
  if not private.billing_email_is_valid(new.email) then
    raise exception 'BILLING_INVALID_EMAIL'
      using errcode = '22023', hint = 'BILLING_INVALID_EMAIL';
  end if;
  if not private.billing_mobile_phone_is_valid(new.mobile_phone) then
    raise exception 'BILLING_INVALID_MOBILE_PHONE'
      using errcode = '22023', hint = 'BILLING_INVALID_MOBILE_PHONE';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.billing_protect_customer_identity_tax_id()
  from public, anon, authenticated, service_role;


create or replace function private.billing_customer_identity_checkout_readiness_error(p_clinic_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when not private.billing_customer_identity_complete(p_clinic_id) then 'identity_incomplete'
    when i.mobile_phone is null then 'billing_phone_required'
    when i.billing_address is null then 'billing_address_required'
    when i.billing_address_number is null then 'billing_address_number_required'
    else null
  end
  from private.billing_customer_identities i
  where i.clinic_id = p_clinic_id
  union all
  select 'identity_incomplete'
  where not exists (
    select 1 from private.billing_customer_identities i where i.clinic_id = p_clinic_id
  )
  limit 1;
$$;

comment on function private.billing_customer_identity_checkout_readiness_error(uuid) is
  'R4: deterministic local hosted-card readiness category. No provider call and no provider IDs.';

revoke all on function private.billing_customer_identity_checkout_readiness_error(uuid)
  from public, anon, authenticated, service_role;


create or replace function private.billing_customer_identity_checkout_ready(p_clinic_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.billing_customer_identity_checkout_readiness_error(p_clinic_id) is null;
$$;

comment on function private.billing_customer_identity_checkout_ready(uuid) is
  'R4: CUSTOMER_BOUND is distinct from CUSTOMER_CHECKOUT_READY.';

revoke all on function private.billing_customer_identity_checkout_ready(uuid)
  from public, anon, authenticated, service_role;


create or replace function public.get_my_clinic_billing_identity(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_row private.billing_customer_identities%rowtype;
begin
  v_caller := private.current_profile_id();
  if v_caller is null then
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

  select * into v_row
    from private.billing_customer_identities i
   where i.clinic_id = p_clinic_id;

  if not found then
    return jsonb_build_object(
      'clinic_id', p_clinic_id,
      'exists', false,
      'is_complete', false,
      'is_checkout_ready', false,
      'checkout_readiness_error', 'identity_incomplete',
      'legal_name', null,
      'tax_id', null,
      'tax_id_masked', null,
      'email', null,
      'mobile_phone', null,
      'billing_address', null,
      'billing_address_number', null,
      'updated_at', null
    );
  end if;

  return jsonb_build_object(
    'clinic_id', v_row.clinic_id,
    'exists', true,
    'is_complete', private.billing_customer_identity_complete(p_clinic_id),
    'is_checkout_ready', private.billing_customer_identity_checkout_ready(p_clinic_id),
    'checkout_readiness_error', private.billing_customer_identity_checkout_readiness_error(p_clinic_id),
    'legal_name', v_row.legal_name,
    'tax_id', v_row.tax_id,
    'tax_id_masked', private.billing_mask_tax_id(v_row.tax_id),
    'email', v_row.email,
    'mobile_phone', v_row.mobile_phone,
    'billing_address', v_row.billing_address,
    'billing_address_number', v_row.billing_address_number,
    'updated_at', v_row.updated_at
  );
end;
$$;

comment on function public.get_my_clinic_billing_identity(uuid) is
  'R4: clinic-admin billing identity read, including checkout readiness. No provider IDs.';

revoke all on function public.get_my_clinic_billing_identity(uuid)
  from public, anon, service_role;
grant execute on function public.get_my_clinic_billing_identity(uuid) to authenticated;


-- New explicit signature. The historical 5-argument RPC remains available for
-- non-card callers and preserves the new nullable fields on update.
create or replace function public.upsert_my_clinic_billing_identity(
  p_clinic_id uuid,
  p_legal_name text,
  p_tax_id text,
  p_email text,
  p_mobile_phone text,
  p_billing_address text,
  p_billing_address_number text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_legal text := btrim(coalesce(p_legal_name, ''));
  v_tax text := private.billing_normalize_tax_id(p_tax_id);
  v_email text := private.billing_normalize_email(p_email);
  v_phone text := private.billing_normalize_phone(p_mobile_phone);
  v_address text := private.billing_normalize_optional_text(p_billing_address);
  v_address_number text := private.billing_normalize_optional_text(p_billing_address_number);
begin
  v_caller := private.current_profile_id();
  if v_caller is null then
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
  if char_length(v_legal) < 2 or char_length(v_legal) > 180 then
    raise exception 'BILLING_INVALID_LEGAL_NAME'
      using errcode = '22023', hint = 'BILLING_INVALID_LEGAL_NAME';
  end if;
  if not private.billing_tax_id_is_valid(v_tax) then
    raise exception 'BILLING_INVALID_TAX_ID'
      using errcode = '22023', hint = 'BILLING_INVALID_TAX_ID';
  end if;
  if not private.billing_email_is_valid(v_email) then
    raise exception 'BILLING_INVALID_EMAIL'
      using errcode = '22023', hint = 'BILLING_INVALID_EMAIL';
  end if;
  if v_phone is null then
    raise exception 'BILLING_PHONE_REQUIRED'
      using errcode = '22023', hint = 'BILLING_PHONE_REQUIRED';
  end if;
  if not private.billing_mobile_phone_is_valid(v_phone) then
    raise exception 'BILLING_INVALID_MOBILE_PHONE'
      using errcode = '22023', hint = 'BILLING_INVALID_MOBILE_PHONE';
  end if;
  if v_address is null then
    raise exception 'BILLING_ADDRESS_REQUIRED'
      using errcode = '22023', hint = 'BILLING_ADDRESS_REQUIRED';
  end if;
  if v_address_number is null then
    raise exception 'BILLING_ADDRESS_NUMBER_REQUIRED'
      using errcode = '22023', hint = 'BILLING_ADDRESS_NUMBER_REQUIRED';
  end if;

  insert into private.billing_customer_identities (
    clinic_id, legal_name, tax_id, email, mobile_phone,
    billing_address, billing_address_number
  ) values (
    p_clinic_id, v_legal, v_tax, v_email, v_phone,
    v_address, v_address_number
  )
  on conflict (clinic_id) do update
    set legal_name = excluded.legal_name,
        tax_id = excluded.tax_id,
        email = excluded.email,
        mobile_phone = excluded.mobile_phone,
        billing_address = excluded.billing_address,
        billing_address_number = excluded.billing_address_number;

  return public.get_my_clinic_billing_identity(p_clinic_id);
end;
$$;

comment on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text, text, text) is
  'R4: checkout-ready clinic billing identity write. Clinic owner/admin only; no provider IDs.';

revoke all on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text, text, text)
  to authenticated;


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
    'checkout_ready', private.billing_customer_identity_checkout_ready(p_clinic_id),
    'checkout_readiness_error', private.billing_customer_identity_checkout_readiness_error(p_clinic_id),
    'legal_name', v_identity.legal_name,
    'tax_id', v_identity.tax_id,
    'email', v_identity.email,
    'mobile_phone', v_identity.mobile_phone,
    'billing_address', v_identity.billing_address,
    'billing_address_number', v_identity.billing_address_number,
    'billing_account_id', v_account.id,
    'environment', coalesce(v_account.environment, v_env),
    'external_customer_id', v_account.external_customer_id
  );
end;
$$;

comment on function public.billing_load_provider_customer_context_outbound(uuid) is
  'R4: service-role customer context with checkout readiness. Never browser-callable.';

revoke all on function public.billing_load_provider_customer_context_outbound(uuid)
  from public, anon, authenticated;
grant execute on function public.billing_load_provider_customer_context_outbound(uuid)
  to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260925031850',
  '20260925031850_billing_checkout_ready_customer.sql',
  'WP-BILLING-MASTER-QA-03R4: checkout-ready billing phone/address identity. Local source only.',
  'WP-BILLING-MASTER-QA-03R4'
)
on conflict (version) do nothing;
