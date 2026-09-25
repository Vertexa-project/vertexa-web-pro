-- WP-BILLING-MASTER-QA-03R6: complete the local/provider checkout identity.
-- Local-first only in this work package; apply remotely only in the next gate.

alter table private.billing_customer_identities
  add column billing_postal_code text,
  add column billing_province text;

alter table private.billing_customer_identities
  add constraint billing_customer_identities_postal_code_check
    check (billing_postal_code is null or billing_postal_code ~ '^[0-9]{8}$'),
  add constraint billing_customer_identities_province_check
    check (billing_province is null or btrim(billing_province) <> '');

create or replace function private.billing_normalize_postal_code(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_value, '')), '') is null then null
    when btrim(p_value) ~ '^[0-9]{5}-?[0-9]{3}$'
      then regexp_replace(btrim(p_value), '-', '', 'g')
    else btrim(p_value)
  end;
$$;

revoke all on function private.billing_normalize_postal_code(text)
  from public, anon, authenticated, service_role;

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
  new.billing_postal_code := private.billing_normalize_postal_code(new.billing_postal_code);
  new.billing_province := private.billing_normalize_optional_text(new.billing_province);

  if new.legal_name is null or new.legal_name = '' then
    raise exception 'BILLING_INVALID_LEGAL_NAME' using errcode = '22023', hint = 'BILLING_INVALID_LEGAL_NAME';
  end if;
  if not private.billing_tax_id_is_valid(new.tax_id) then
    raise exception 'BILLING_INVALID_TAX_ID' using errcode = '22023', hint = 'BILLING_INVALID_TAX_ID';
  end if;
  if not private.billing_email_is_valid(new.email) then
    raise exception 'BILLING_INVALID_EMAIL' using errcode = '22023', hint = 'BILLING_INVALID_EMAIL';
  end if;
  if not private.billing_mobile_phone_is_valid(new.mobile_phone) then
    raise exception 'BILLING_INVALID_MOBILE_PHONE' using errcode = '22023', hint = 'BILLING_INVALID_MOBILE_PHONE';
  end if;
  if new.billing_postal_code is not null and new.billing_postal_code !~ '^[0-9]{8}$' then
    raise exception 'BILLING_INVALID_POSTAL_CODE' using errcode = '22023', hint = 'BILLING_INVALID_POSTAL_CODE';
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
    when i.billing_postal_code is null then 'billing_postal_code_required'
    when i.billing_province is null then 'billing_province_required'
    else null
  end
  from private.billing_customer_identities i
  where i.clinic_id = p_clinic_id
  union all
  select 'identity_incomplete'
  where not exists (select 1 from private.billing_customer_identities i where i.clinic_id = p_clinic_id)
  limit 1;
$$;

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
    raise exception 'BILLING_NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_clinic_id is null then
    raise exception 'BILLING_CLINIC_REQUIRED' using errcode = '22023';
  end if;
  if not private.is_clinic_admin(p_clinic_id) then
    raise exception 'BILLING_NOT_CLINIC_ADMIN' using errcode = '42501';
  end if;

  select * into v_row from private.billing_customer_identities where clinic_id = p_clinic_id;
  if not found then
    return jsonb_build_object(
      'clinic_id', p_clinic_id, 'exists', false, 'is_complete', false,
      'is_checkout_ready', false, 'checkout_readiness_error', 'identity_incomplete',
      'legal_name', null, 'tax_id', null, 'tax_id_masked', null, 'email', null,
      'mobile_phone', null, 'billing_address', null, 'billing_address_number', null,
      'billing_postal_code', null, 'billing_province', null, 'updated_at', null
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
    'billing_postal_code', v_row.billing_postal_code,
    'billing_province', v_row.billing_province,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_my_clinic_billing_identity(uuid)
  from public, anon, service_role;
grant execute on function public.get_my_clinic_billing_identity(uuid) to authenticated;

create or replace function public.upsert_my_clinic_billing_identity(
  p_clinic_id uuid,
  p_legal_name text,
  p_tax_id text,
  p_email text,
  p_mobile_phone text,
  p_billing_address text,
  p_billing_address_number text,
  p_billing_postal_code text,
  p_billing_province text
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
  v_postal_code text := private.billing_normalize_postal_code(p_billing_postal_code);
  v_province text := private.billing_normalize_optional_text(p_billing_province);
begin
  v_caller := private.current_profile_id();
  if v_caller is null then raise exception 'BILLING_NOT_AUTHENTICATED' using errcode = '42501', hint = 'BILLING_NOT_AUTHENTICATED'; end if;
  if p_clinic_id is null then raise exception 'BILLING_CLINIC_REQUIRED' using errcode = '22023', hint = 'BILLING_CLINIC_REQUIRED'; end if;
  if not private.is_clinic_admin(p_clinic_id) then raise exception 'BILLING_NOT_CLINIC_ADMIN' using errcode = '42501', hint = 'BILLING_NOT_CLINIC_ADMIN'; end if;
  if char_length(v_legal) < 2 or char_length(v_legal) > 180 then raise exception 'BILLING_INVALID_LEGAL_NAME' using errcode = '22023', hint = 'BILLING_INVALID_LEGAL_NAME'; end if;
  if not private.billing_tax_id_is_valid(v_tax) then raise exception 'BILLING_INVALID_TAX_ID' using errcode = '22023', hint = 'BILLING_INVALID_TAX_ID'; end if;
  if not private.billing_email_is_valid(v_email) then raise exception 'BILLING_INVALID_EMAIL' using errcode = '22023', hint = 'BILLING_INVALID_EMAIL'; end if;
  if v_phone is null then raise exception 'BILLING_PHONE_REQUIRED' using errcode = '22023', hint = 'BILLING_PHONE_REQUIRED'; end if;
  if not private.billing_mobile_phone_is_valid(v_phone) then raise exception 'BILLING_INVALID_MOBILE_PHONE' using errcode = '22023', hint = 'BILLING_INVALID_MOBILE_PHONE'; end if;
  if v_address is null then raise exception 'BILLING_ADDRESS_REQUIRED' using errcode = '22023', hint = 'BILLING_ADDRESS_REQUIRED'; end if;
  if v_address_number is null then raise exception 'BILLING_ADDRESS_NUMBER_REQUIRED' using errcode = '22023', hint = 'BILLING_ADDRESS_NUMBER_REQUIRED'; end if;
  if v_postal_code is null or v_postal_code !~ '^[0-9]{8}$' then raise exception 'BILLING_INVALID_POSTAL_CODE' using errcode = '22023', hint = 'BILLING_INVALID_POSTAL_CODE'; end if;
  if v_province is null then raise exception 'BILLING_PROVINCE_REQUIRED' using errcode = '22023', hint = 'BILLING_PROVINCE_REQUIRED'; end if;

  insert into private.billing_customer_identities (
    clinic_id, legal_name, tax_id, email, mobile_phone, billing_address,
    billing_address_number, billing_postal_code, billing_province
  ) values (
    p_clinic_id, v_legal, v_tax, v_email, v_phone, v_address,
    v_address_number, v_postal_code, v_province
  )
  on conflict (clinic_id) do update set
    legal_name = excluded.legal_name,
    tax_id = excluded.tax_id,
    email = excluded.email,
    mobile_phone = excluded.mobile_phone,
    billing_address = excluded.billing_address,
    billing_address_number = excluded.billing_address_number,
    billing_postal_code = excluded.billing_postal_code,
    billing_province = excluded.billing_province;

  return public.get_my_clinic_billing_identity(p_clinic_id);
end;
$$;

revoke all on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text, text, text, text, text)
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
  if p_clinic_id is null then raise exception 'BILLING_CLINIC_REQUIRED' using errcode = '22023'; end if;
  v_env := private.billing_clinic_provider_environment(p_clinic_id);
  select * into v_identity from private.billing_customer_identities where clinic_id = p_clinic_id;
  v_account := private.billing_account_for_clinic(p_clinic_id, v_env);
  return jsonb_build_object(
    'clinic_id', p_clinic_id,
    'identity_complete', private.billing_customer_identity_complete(p_clinic_id),
    'checkout_ready', private.billing_customer_identity_checkout_ready(p_clinic_id),
    'checkout_readiness_error', private.billing_customer_identity_checkout_readiness_error(p_clinic_id),
    'legal_name', v_identity.legal_name, 'tax_id', v_identity.tax_id, 'email', v_identity.email,
    'mobile_phone', v_identity.mobile_phone, 'billing_address', v_identity.billing_address,
    'billing_address_number', v_identity.billing_address_number,
    'billing_postal_code', v_identity.billing_postal_code, 'billing_province', v_identity.billing_province,
    'billing_account_id', v_account.id, 'environment', coalesce(v_account.environment, v_env),
    'external_customer_id', v_account.external_customer_id
  );
end;
$$;

revoke all on function public.billing_load_provider_customer_context_outbound(uuid)
  from public, anon, authenticated;
grant execute on function public.billing_load_provider_customer_context_outbound(uuid) to service_role;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260925143000',
  '20260925143000_billing_customer_postal_province.sql',
  'WP-BILLING-MASTER-QA-03R6: local CEP/bairro checkout identity and provider city fail-closed contract.',
  'WP-BILLING-MASTER-QA-03R6'
)
on conflict (version) do nothing;
