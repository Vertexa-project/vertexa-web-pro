-- ============================================================================
-- WP-BILLING-MASTER-QA-01 — CNPJ alfanumérico e telefone canônico.
-- Source-only migration: no provider HTTP, no catalog, no payment or entitlement
-- mutation. The server remains the authority for normalisation and checksums.
-- ============================================================================

create or replace function private.billing_normalize_tax_id(p_tax_id text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select nullif(regexp_replace(upper(btrim(p_tax_id)), '[-./[:space:]]', '', 'g'), '');
$$;

comment on function private.billing_normalize_tax_id(text) is
  'WP-BILLING-MASTER-QA-01: CPF 11 dígitos ou CNPJ 14 chars; preserva A-Z e remove somente pontuação/espaço.';

revoke all on function private.billing_normalize_tax_id(text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_tax_id_is_valid(p_tax_id text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tax text := private.billing_normalize_tax_id(p_tax_id);
  v_i int;
  v_sum int;
  v_rest int;
  v_d1 int;
  v_d2 int;
  v_weight int;
begin
  if v_tax is null then
    return false;
  end if;

  if v_tax ~ '^[0-9]{11}$' then
    if v_tax = repeat(substr(v_tax, 1, 1), 11) then
      return false;
    end if;
    v_sum := 0;
    for v_i in 1..9 loop
      v_sum := v_sum + substr(v_tax, v_i, 1)::int * (11 - v_i);
    end loop;
    v_rest := v_sum % 11;
    v_d1 := case when v_rest < 2 then 0 else 11 - v_rest end;
    if v_d1 is distinct from substr(v_tax, 10, 1)::int then
      return false;
    end if;
    v_sum := 0;
    for v_i in 1..10 loop
      v_sum := v_sum + substr(v_tax, v_i, 1)::int * (12 - v_i);
    end loop;
    v_rest := v_sum % 11;
    v_d2 := case when v_rest < 2 then 0 else 11 - v_rest end;
    return v_d2 = substr(v_tax, 11, 1)::int;
  end if;

  -- Receita Federal CNPJ alfanumérico: 12 [0-9A-Z] positions plus 2 numeric DVs.
  if v_tax !~ '^[0-9A-Z]{12}[0-9]{2}$' or v_tax = repeat('0', 14) then
    return false;
  end if;

  v_sum := 0;
  for v_i in 1..12 loop
    v_weight := case v_i
      when 1 then 5 when 2 then 4 when 3 then 3 when 4 then 2
      when 5 then 9 when 6 then 8 when 7 then 7 when 8 then 6
      when 9 then 5 when 10 then 4 when 11 then 3 else 2
    end;
    v_sum := v_sum + (ascii(substr(v_tax, v_i, 1)) - 48) * v_weight;
  end loop;
  v_rest := v_sum % 11;
  v_d1 := case when v_rest < 2 then 0 else 11 - v_rest end;
  if v_d1 is distinct from substr(v_tax, 13, 1)::int then
    return false;
  end if;

  v_sum := 0;
  for v_i in 1..13 loop
    v_weight := case v_i
      when 1 then 6 when 2 then 5 when 3 then 4 when 4 then 3
      when 5 then 2 when 6 then 9 when 7 then 8 when 8 then 7
      when 9 then 6 when 10 then 5 when 11 then 4 when 12 then 3
      else 2
    end;
    v_sum := v_sum + (ascii(substr(v_tax, v_i, 1)) - 48) * v_weight;
  end loop;
  v_rest := v_sum % 11;
  v_d2 := case when v_rest < 2 then 0 else 11 - v_rest end;
  return v_d2 = substr(v_tax, 14, 1)::int;
end;
$$;

comment on function private.billing_tax_id_is_valid(text) is
  'WP-BILLING-MASTER-QA-01: CPF and legacy/alphanumeric CNPJ DV validation; ASCII character value minus 48.';

revoke all on function private.billing_tax_id_is_valid(text)
  from public, anon, authenticated, service_role;


-- The prior table CHECK admitted only numeric CPF/CNPJ values. Keep the
-- database boundary consistent with the canonical validator before writes
-- reach the trigger, so valid alphanumeric CNPJ values can persist.
alter table private.billing_customer_identities
  drop constraint if exists billing_customer_identities_tax_id_check;

alter table private.billing_customer_identities
  add constraint billing_customer_identities_tax_id_check
  check (private.billing_tax_id_is_valid(tax_id));


create or replace function private.billing_normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw text := btrim(coalesce(p_phone, ''));
  v_digits text;
begin
  if v_raw = '' then
    return null;
  end if;
  -- Retain an invalid input for the validator instead of silently removing letters.
  if v_raw !~ '^[0-9+().[:space:]-]+$' then
    return v_raw;
  end if;
  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  if char_length(v_digits) = 13 and left(v_digits, 2) = '55' then
    v_digits := substr(v_digits, 3);
  end if;
  return nullif(v_digits, '');
end;
$$;

create or replace function private.billing_mobile_phone_is_valid(p_phone text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_phone text := private.billing_normalize_phone(p_phone);
  v_ddd int;
begin
  if v_phone is null then
    return true;
  end if;
  if v_phone !~ '^[0-9]{11}$' then
    return false;
  end if;
  v_ddd := substr(v_phone, 1, 2)::int;
  return v_ddd between 11 and 99 and substr(v_phone, 3, 1) = '9';
end;
$$;

comment on function private.billing_mobile_phone_is_valid(text) is
  'WP-BILLING-MASTER-QA-01: optional Brazilian mobile; canonical national 11 digits (DDD + 9-digit mobile).';

revoke all on function private.billing_normalize_phone(text), private.billing_mobile_phone_is_valid(text)
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


create or replace function public.upsert_my_clinic_billing_identity(
  p_clinic_id uuid,
  p_legal_name text,
  p_tax_id text,
  p_email text,
  p_mobile_phone text default null
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
  if not private.billing_mobile_phone_is_valid(v_phone) then
    raise exception 'BILLING_INVALID_MOBILE_PHONE'
      using errcode = '22023', hint = 'BILLING_INVALID_MOBILE_PHONE';
  end if;

  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email, mobile_phone)
  values (p_clinic_id, v_legal, v_tax, v_email, v_phone)
  on conflict (clinic_id) do update
    set legal_name = excluded.legal_name,
        tax_id = excluded.tax_id,
        email = excluded.email,
        mobile_phone = excluded.mobile_phone;

  return public.get_my_clinic_billing_identity(p_clinic_id);
end;
$$;

comment on column private.billing_customer_identities.tax_id is
  'CPF (11 digits) or CNPJ (14 chars; legacy numeric or alphanumeric); canonical punctuation-free value with DV validated.';

revoke all on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text)
  to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260924000723',
  '20260924000723_billing_master_qa_cnpj_alphanumeric_identity.sql',
  'WP-BILLING-MASTER-QA-01: CNPJ alphanumeric and canonical Brazilian mobile validation. Local source only.',
  'WP-BILLING-MASTER-QA-01'
)
on conflict (version) do nothing;
