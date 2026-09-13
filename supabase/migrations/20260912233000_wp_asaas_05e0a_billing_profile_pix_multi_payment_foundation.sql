-- =====================================================================================
-- WP-ASAAS-05E0A — Billing Profile + trilho multi-pagamento (fundação).
--
-- VERTEXA = autoridade comercial (contrato, preço, ciclo).
-- ASAAS = autoridade financeira (customer, Pix Automático, cobrança).
--
-- Billing Profile: superfície segura de identidade fiscal (admin da clínica).
-- PIX_AUTOMATIC: recurso de autorização distinto de billingType=PIX.
-- PIX_MANUAL: caminho ordinário (05D create_subscription / futura create_charge) permanece.
-- CREDIT_CARD: estratégia reconhecida, sem coleta de cartão.
--
-- NÃO edita 05A–05D. NÃO seed. NÃO HTTP Asaas. NÃO checkout. NÃO enforcement.
-- NÃO claim Founder. NÃO escreve payment_method no contrato comercial.
-- =====================================================================================


-- ── Normalização / validação fiscal ──────────────────────────────────────────

create or replace function private.billing_normalize_tax_id(p_tax_id text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select nullif(regexp_replace(p_tax_id, '[^0-9]', '', 'g'), '');
$$;

comment on function private.billing_normalize_tax_id(text) is
  'WP-ASAAS-05E0A: CPF/CNPJ → somente dígitos. Sem log.';

revoke all on function private.billing_normalize_tax_id(text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_tax_id_is_valid(p_tax_id text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text := private.billing_normalize_tax_id(p_tax_id);
  v_len int;
  v_i int;
  v_sum int;
  v_rest int;
  v_d1 int;
  v_d2 int;
  v_w int;
begin
  if v_digits is null then
    return false;
  end if;

  v_len := char_length(v_digits);
  if v_len not in (11, 14) then
    return false;
  end if;

  if v_digits = repeat(substr(v_digits, 1, 1), v_len) then
    return false;
  end if;

  if v_len = 11 then
    v_sum := 0;
    for v_i in 1..9 loop
      v_sum := v_sum + substr(v_digits, v_i, 1)::int * (11 - v_i);
    end loop;
    v_rest := v_sum % 11;
    v_d1 := case when v_rest < 2 then 0 else 11 - v_rest end;
    if v_d1 is distinct from substr(v_digits, 10, 1)::int then
      return false;
    end if;

    v_sum := 0;
    for v_i in 1..10 loop
      v_sum := v_sum + substr(v_digits, v_i, 1)::int * (12 - v_i);
    end loop;
    v_rest := v_sum % 11;
    v_d2 := case when v_rest < 2 then 0 else 11 - v_rest end;
    return v_d2 = substr(v_digits, 11, 1)::int;
  end if;

  v_sum := 0;
  for v_i in 1..12 loop
    v_w := case v_i
      when 1 then 5 when 2 then 4 when 3 then 3 when 4 then 2
      when 5 then 9 when 6 then 8 when 7 then 7 when 8 then 6
      when 9 then 5 when 10 then 4 when 11 then 3 else 2
    end;
    v_sum := v_sum + substr(v_digits, v_i, 1)::int * v_w;
  end loop;
  v_rest := v_sum % 11;
  v_d1 := case when v_rest < 2 then 0 else 11 - v_rest end;
  if v_d1 is distinct from substr(v_digits, 13, 1)::int then
    return false;
  end if;

  v_sum := 0;
  for v_i in 1..13 loop
    v_w := case v_i
      when 1 then 6 when 2 then 5 when 3 then 4 when 4 then 3
      when 5 then 2 when 6 then 9 when 7 then 8 when 8 then 7
      when 9 then 6 when 10 then 5 when 11 then 4 when 12 then 3
      else 2
    end;
    v_sum := v_sum + substr(v_digits, v_i, 1)::int * v_w;
  end loop;
  v_rest := v_sum % 11;
  v_d2 := case when v_rest < 2 then 0 else 11 - v_rest end;
  return v_d2 = substr(v_digits, 14, 1)::int;
end;
$$;

comment on function private.billing_tax_id_is_valid(text) is
  'WP-ASAAS-05E0A: checksum CPF (11) / CNPJ (14). Rejeita repetidos e comprimento inválido.';

revoke all on function private.billing_tax_id_is_valid(text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_mask_tax_id(p_tax_id text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text := private.billing_normalize_tax_id(p_tax_id);
begin
  if v_digits is null then
    return null;
  end if;
  if char_length(v_digits) = 11 then
    return '***.***.***-' || right(v_digits, 2);
  end if;
  if char_length(v_digits) = 14 then
    return '**.***.***/****-' || right(v_digits, 2);
  end if;
  return '****';
end;
$$;

comment on function private.billing_mask_tax_id(text) is
  'WP-ASAAS-05E0A: máscara de CPF/CNPJ. Nunca devolve o documento completo.';

revoke all on function private.billing_mask_tax_id(text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

revoke all on function private.billing_normalize_email(text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_email_is_valid(p_email text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_email text := private.billing_normalize_email(p_email);
  v_at int;
  v_local text;
  v_domain text;
begin
  if v_email is null then
    return false;
  end if;
  v_at := position('@' in v_email);
  if v_at < 2 then
    return false;
  end if;
  v_local := substr(v_email, 1, v_at - 1);
  v_domain := substr(v_email, v_at + 1);
  if v_local = '' or v_domain = '' then
    return false;
  end if;
  if position('.' in v_domain) < 2 then
    return false;
  end if;
  if position(' ' in v_email) > 0 then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function private.billing_email_is_valid(text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_phone, '')), '');
$$;

revoke all on function private.billing_normalize_phone(text)
  from public, anon, authenticated, service_role;


create or replace function private.billing_customer_identity_complete(p_clinic_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from private.billing_customer_identities i
     where i.clinic_id = p_clinic_id
       and btrim(i.legal_name) <> ''
       and private.billing_tax_id_is_valid(i.tax_id)
       and private.billing_email_is_valid(i.email)
  );
$$;

comment on function private.billing_customer_identity_complete(uuid) is
  'WP-ASAAS-05E0A: completeza derivada. Sem boolean persistido. Sem HTTP.';

revoke all on function private.billing_customer_identity_complete(uuid)
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

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_billing_protect_customer_identity_tax_id
  on private.billing_customer_identities;

create trigger trg_billing_protect_customer_identity_tax_id
  before insert or update on private.billing_customer_identities
  for each row
  execute function private.billing_protect_customer_identity_tax_id();

revoke all on function private.billing_protect_customer_identity_tax_id()
  from public, anon, authenticated, service_role;

comment on column private.billing_customer_identities.tax_id is
  'CPF (11) ou CNPJ (14), somente dígitos, checksum validado em 05E0A.';


-- ── Billing Profile — RPCs públicas admin-only ───────────────────────────────

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

  -- Platform Admin NÃO atravessa o limite da clínica.
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
      'legal_name', null,
      'tax_id', null,
      'tax_id_masked', null,
      'email', null,
      'mobile_phone', null,
      'updated_at', null
    );
  end if;

  return jsonb_build_object(
    'clinic_id', v_row.clinic_id,
    'exists', true,
    'is_complete', private.billing_customer_identity_complete(p_clinic_id),
    'legal_name', v_row.legal_name,
    'tax_id', v_row.tax_id,
    'tax_id_masked', private.billing_mask_tax_id(v_row.tax_id),
    'email', v_row.email,
    'mobile_phone', v_row.mobile_phone,
    'updated_at', v_row.updated_at
  );
end;
$$;

comment on function public.get_my_clinic_billing_identity(uuid) is
  'WP-ASAAS-05E0A: lê identidade fiscal da clínica do admin autenticado. '
  'Sem IDs de provedor. Sem preço. Sem Asaas.';

revoke all on function public.get_my_clinic_billing_identity(uuid)
  from public, anon, service_role;
grant execute on function public.get_my_clinic_billing_identity(uuid) to authenticated;


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

  insert into private.billing_customer_identities (
    clinic_id, legal_name, tax_id, email, mobile_phone
  ) values (
    p_clinic_id, v_legal, v_tax, v_email, v_phone
  )
  on conflict (clinic_id) do update
    set legal_name = excluded.legal_name,
        tax_id = excluded.tax_id,
        email = excluded.email,
        mobile_phone = excluded.mobile_phone;

  return public.get_my_clinic_billing_identity(p_clinic_id);
end;
$$;

comment on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text) is
  'WP-ASAAS-05E0A: grava identidade fiscal da clínica do admin. Sem HTTP Asaas. '
  'Sem preço/plano/offer/payment method/provider IDs.';

revoke all on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.upsert_my_clinic_billing_identity(uuid, text, text, text, text)
  to authenticated;


-- ── Estratégia de pagamento (não persistida no contrato) ─────────────────────

create or replace function private.billing_payment_strategy_canonical(p_strategy text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_strategy text := lower(btrim(coalesce(p_strategy, '')));
begin
  if v_strategy not in ('pix_automatic', 'pix_manual', 'credit_card') then
    raise exception 'BILLING_UNKNOWN_PAYMENT_STRATEGY'
      using errcode = '22023', hint = 'BILLING_UNKNOWN_PAYMENT_STRATEGY';
  end if;
  return v_strategy;
end;
$$;

comment on function private.billing_payment_strategy_canonical(text) is
  'WP-ASAAS-05E0A: discriminador de produto. NÃO é billingType Asaas. Sem persistência.';

revoke all on function private.billing_payment_strategy_canonical(text)
  from public, anon, authenticated, service_role;


-- ── Âncora mensal (America/Sao_Paulo no prepare; helper é date-puro) ─────────

create or replace function private.billing_add_calendar_months(
  p_anchor date,
  p_months integer
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_target date;
  v_last date;
  v_day int;
begin
  if p_anchor is null or p_months is null then
    raise exception 'BILLING_INVALID_MONTHLY_ANCHOR'
      using errcode = '22023', hint = 'BILLING_INVALID_MONTHLY_ANCHOR';
  end if;

  v_target := (date_trunc('month', p_anchor) + make_interval(months => p_months))::date;
  v_last := (v_target + interval '1 month' - interval '1 day')::date;
  v_day := least(extract(day from p_anchor)::int, extract(day from v_last)::int);
  return make_date(
    extract(year from v_target)::int,
    extract(month from v_target)::int,
    v_day
  );
end;
$$;

comment on function private.billing_add_calendar_months(date, integer) is
  'WP-ASAAS-05E0A: aritmética de mês civil com clamp no último dia. Sem +30 dias.';

revoke all on function private.billing_add_calendar_months(date, integer)
  from public, anon, authenticated, service_role;


create or replace function private.billing_pix_automatic_contract_id(
  p_commercial_contract_id uuid
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select replace(p_commercial_contract_id::text, '-', '');
$$;

comment on function private.billing_pix_automatic_contract_id(uuid) is
  'WP-ASAAS-05E0A: contractId Asaas = UUID sem hífens, 32 chars, sem PII.';

revoke all on function private.billing_pix_automatic_contract_id(uuid)
  from public, anon, authenticated, service_role;


-- ── Recurso Pix Automático (NÃO é billing_subscriptions) ─────────────────────

create table private.billing_pix_automatic_authorizations (
  id uuid primary key default gen_random_uuid(),
  commercial_contract_id uuid not null,
  billing_account_id uuid not null,
  environment text not null,
  provider_authorization_id text,
  provider_status text not null default 'INTENT',
  is_primary boolean not null default true,
  frequency text not null default 'MONTHLY',
  payment_creation_mode text not null default 'SUBSCRIPTION',
  retry_policy text not null default 'ALLOW_THREE_IN_SEVEN_DAYS',
  recurrence_start_date date,
  provider_contract_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_pix_automatic_authorizations_contract_fkey
    foreign key (commercial_contract_id)
    references private.billing_commercial_contracts(id)
    on delete restrict,
  constraint billing_pix_automatic_authorizations_account_fkey
    foreign key (billing_account_id)
    references private.billing_accounts(id)
    on delete restrict,
  constraint billing_pix_automatic_authorizations_environment_check
    check (environment in ('sandbox', 'production')),
  constraint billing_pix_automatic_authorizations_status_check
    check (provider_status in (
      'INTENT', 'CREATED', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'REFUSED'
    )),
  constraint billing_pix_automatic_authorizations_frequency_check
    check (frequency = 'MONTHLY'),
  constraint billing_pix_automatic_authorizations_mode_check
    check (payment_creation_mode = 'SUBSCRIPTION'),
  constraint billing_pix_automatic_authorizations_retry_check
    check (retry_policy = 'ALLOW_THREE_IN_SEVEN_DAYS'),
  constraint billing_pix_automatic_authorizations_contract_id_check
    check (provider_contract_id ~ '^[0-9a-f]{32}$'),
  constraint billing_pix_automatic_authorizations_provider_id_check
    check (
      provider_authorization_id is null
      or btrim(provider_authorization_id) <> ''
    )
);

comment on table private.billing_pix_automatic_authorizations is
  'WP-ASAAS-05E0A: fato de autorização Pix Automático. NÃO é contrato comercial. '
  'NÃO é entitlement. Sem preço/plano/offer. Sem seed.';

comment on column private.billing_pix_automatic_authorizations.provider_status is
  'INTENT = intenção local pré-HTTP. CREATED/ACTIVE/CANCELLED/EXPIRED/REFUSED = fatos Asaas.';

comment on column private.billing_pix_automatic_authorizations.provider_contract_id is
  'contractId enviado ao Asaas: UUID do contrato comercial sem hífens.';

create unique index billing_pix_automatic_authorizations_primary_uidx
  on private.billing_pix_automatic_authorizations (commercial_contract_id, environment)
  where is_primary;

create index billing_pix_automatic_authorizations_contract_idx
  on private.billing_pix_automatic_authorizations (commercial_contract_id);

create index billing_pix_automatic_authorizations_account_idx
  on private.billing_pix_automatic_authorizations (billing_account_id);

alter table private.billing_pix_automatic_authorizations enable row level security;

revoke all on table private.billing_pix_automatic_authorizations
  from public, anon, authenticated, service_role;


-- ── Ledger outbound: novo operation_type ─────────────────────────────────────

alter table private.billing_outbound_operations
  drop constraint billing_outbound_operations_type_check;

alter table private.billing_outbound_operations
  add constraint billing_outbound_operations_type_check
    check (operation_type in (
      'create_customer',
      'create_subscription',
      'create_charge',
      'create_pix_automatic_authorization'
    ));


create or replace function private.reserve_billing_outbound_operation(
  p_billing_account_id uuid,
  p_provider text,
  p_environment text,
  p_operation_type text,
  p_idempotency_key text,
  p_external_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := btrim(coalesce(p_provider, ''));
  v_environment text := btrim(coalesce(p_environment, ''));
  v_operation_type text := btrim(coalesce(p_operation_type, ''));
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_external_reference text := btrim(coalesce(p_external_reference, ''));
  v_account_environment text;
  v_account_external_customer_id text;
  v_id uuid;
  v_status text;
  v_external_object_id text;
  v_attempt_count integer;
  v_last_error_category text;
begin
  if v_provider is distinct from 'asaas' then
    raise exception 'reserve_billing_outbound_operation: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_environment not in ('sandbox', 'production') then
    raise exception 'reserve_billing_outbound_operation: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;
  if v_operation_type not in (
    'create_customer',
    'create_subscription',
    'create_charge',
    'create_pix_automatic_authorization'
  ) then
    raise exception 'reserve_billing_outbound_operation: invalid operation_type'
      using errcode = '22023', hint = 'INVALID_OPERATION_TYPE';
  end if;
  if v_idempotency_key = '' or v_external_reference = '' then
    raise exception 'reserve_billing_outbound_operation: keys required'
      using errcode = '22023', hint = 'KEYS_REQUIRED';
  end if;

  select environment, external_customer_id
    into v_account_environment, v_account_external_customer_id
    from private.billing_accounts
   where id = p_billing_account_id;

  if not found then
    raise exception 'reserve_billing_outbound_operation: billing account not found'
      using errcode = '22023', hint = 'ACCOUNT_NOT_FOUND';
  end if;

  if v_account_environment is distinct from v_environment then
    raise exception 'reserve_billing_outbound_operation: environment mismatch'
      using errcode = '42501', hint = 'ENVIRONMENT_MISMATCH';
  end if;

  if v_operation_type in ('create_subscription', 'create_pix_automatic_authorization')
     and v_account_external_customer_id is null then
    raise exception 'reserve_billing_outbound_operation: customer not provisioned'
      using errcode = '42501', hint = 'CUSTOMER_NOT_PROVISIONED';
  end if;

  begin
    insert into private.billing_outbound_operations (
      billing_account_id, provider, environment, operation_type,
      idempotency_key, external_reference, status, attempt_count
    ) values (
      p_billing_account_id, v_provider, v_environment, v_operation_type,
      v_idempotency_key, v_external_reference, 'pending', 1
    )
    returning id into v_id;

    return jsonb_build_object('outcome', 'reserved', 'operation_id', v_id, 'attempt_count', 1);
  exception
    when unique_violation then
      select id, status, external_object_id, attempt_count, last_error_category
        into v_id, v_status, v_external_object_id, v_attempt_count, v_last_error_category
        from private.billing_outbound_operations
       where provider = v_provider
         and environment = v_environment
         and operation_type = v_operation_type
         and idempotency_key = v_idempotency_key
       for update;

      if v_status = 'completed' then
        return jsonb_build_object(
          'outcome', 'already_completed',
          'operation_id', v_id,
          'external_object_id', v_external_object_id
        );
      elsif v_status = 'pending' then
        update private.billing_outbound_operations
           set attempt_count = attempt_count + 1, updated_at = clock_timestamp()
         where id = v_id
        returning attempt_count into v_attempt_count;

        return jsonb_build_object(
          'outcome', 'in_flight_retry',
          'operation_id', v_id,
          'attempt_count', v_attempt_count,
          'last_error_category', v_last_error_category
        );
      else
        update private.billing_outbound_operations
           set status = 'pending',
               attempt_count = attempt_count + 1,
               last_error_category = null,
               updated_at = clock_timestamp()
         where id = v_id
        returning attempt_count into v_attempt_count;

        return jsonb_build_object(
          'outcome', 'claimed_for_retry',
          'operation_id', v_id,
          'attempt_count', v_attempt_count,
          'last_error_category', v_last_error_category
        );
      end if;
  end;
end;
$$;

comment on function private.reserve_billing_outbound_operation(uuid, text, text, text, text, text) is
  'WP-ASAAS-05E0A: mesmo contrato 03C + create_pix_automatic_authorization. Sem HTTP.';

revoke all on function private.reserve_billing_outbound_operation(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;


-- ── Prepare Pix Automático (distinto do prepare 05D) ─────────────────────────

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
  v_recurrence date;
  v_contract_id text;
  v_auth_id uuid;
  v_customer_key text;
  v_customer_ref text;
  v_auth_key text;
  v_auth_ref text;
  v_customer_reserve jsonb;
  v_auth_reserve jsonb;
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
  v_contract_id := private.billing_pix_automatic_contract_id(p_commercial_contract_id);

  select id, recurrence_start_date
    into v_auth_id, v_recurrence
    from private.billing_pix_automatic_authorizations
   where commercial_contract_id = p_commercial_contract_id
     and environment = v_environment
     and is_primary
   for update;

  if not found then
    v_recurrence := private.billing_add_calendar_months(v_activation, 1);
    insert into private.billing_pix_automatic_authorizations (
      commercial_contract_id,
      billing_account_id,
      environment,
      provider_status,
      is_primary,
      frequency,
      payment_creation_mode,
      retry_policy,
      recurrence_start_date,
      provider_contract_id
    ) values (
      p_commercial_contract_id,
      v_account_id,
      v_environment,
      'INTENT',
      true,
      'MONTHLY',
      'SUBSCRIPTION',
      'ALLOW_THREE_IN_SEVEN_DAYS',
      v_recurrence,
      v_contract_id
    )
    returning id into v_auth_id;
  end if;

  v_customer_key := v_account_id::text || ':create_customer';
  v_customer_ref := 'vtx:' || v_environment || ':' || v_account_id::text || ':customer';
  v_auth_key :=
    v_account_id::text || ':create_pix_automatic_authorization:primary:'
    || p_commercial_contract_id::text;
  v_auth_ref :=
    'vtx:' || v_environment || ':' || v_account_id::text
    || ':pix_automatic_authorization:primary:' || p_commercial_contract_id::text;

  if v_external_customer_id is null then
    v_customer_reserve := private.reserve_billing_outbound_operation(
      v_account_id,
      'asaas',
      v_environment,
      'create_customer',
      v_customer_key,
      v_customer_ref
    );
    update private.billing_outbound_operations
       set commercial_contract_id = p_commercial_contract_id,
           updated_at = clock_timestamp()
     where id = (v_customer_reserve->>'operation_id')::uuid
       and commercial_contract_id is null;
  else
    v_auth_reserve := private.reserve_billing_outbound_operation(
      v_account_id,
      'asaas',
      v_environment,
      'create_pix_automatic_authorization',
      v_auth_key,
      v_auth_ref
    );
    update private.billing_outbound_operations
       set commercial_contract_id = p_commercial_contract_id,
           updated_at = clock_timestamp()
     where id = (v_auth_reserve->>'operation_id')::uuid
       and commercial_contract_id is null;
  end if;

  return jsonb_build_object(
    'outcome', 'prepared',
    'strategy', 'pix_automatic',
    'commercial_contract_id', p_commercial_contract_id,
    'clinic_id', v_clinic_id,
    'plan_version_id', v_plan_version_id,
    'commercial_offer_id', v_offer_id,
    'contracted_price_cents', v_price,
    'contracted_currency', v_currency,
    'billing_cycle', v_cycle,
    'asaas_amount', v_asaas_amount,
    'frequency', 'MONTHLY',
    'payment_creation_mode', 'SUBSCRIPTION',
    'retry_policy', 'ALLOW_THREE_IN_SEVEN_DAYS',
    'finish_date', null,
    'activation_date', v_activation,
    'recurrence_start_date', v_recurrence,
    'timezone', 'America/Sao_Paulo',
    'provider_contract_id', v_contract_id,
    'description', 'Vertexa - assinatura mensal',
    'authorization_id', v_auth_id,
    'provider_status', 'INTENT',
    'billing_account_id', v_account_id,
    'billing_account_created', v_account_created,
    'provider_customer_ready', (v_external_customer_id is not null),
    'identity_complete', v_identity_complete,
    'customer_operation', v_customer_reserve,
    'authorization_operation', v_auth_reserve,
    'subscription_operation', null,
    'charge_operation', null,
    'provider_eligibility', 'unconfirmed',
    'http_blocked_reason', 'ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED',
    'entitlement_granted', false
  );
end;
$$;

comment on function private.billing_prepare_pix_automatic_authorization(uuid, text) is
  'WP-ASAAS-05E0A: deriva intenção Pix Automático do contrato. Sem billingType=PIX. '
  'Sem override de política. Sem HTTP Asaas. SECURITY INVOKER. Sem RPC pública.';

revoke all on function private.billing_prepare_pix_automatic_authorization(uuid, text)
  from public, anon, authenticated, service_role;


-- ── Reconhecimento de eventos (fundação; processador = 05E0B) ─────────────

create or replace function private.billing_classify_asaas_event(p_event_type text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_event text := btrim(coalesce(p_event_type, ''));
  v_family text := 'unrecognized';
  v_recognized boolean := false;
  v_processing boolean := false;
begin
  if v_event = 'PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED' then
    v_family := 'pix_automatic_eligibility';
    v_recognized := true;
  elsif v_event in (
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED'
  ) then
    v_family := 'pix_automatic_authorization';
    v_recognized := true;
  elsif v_event in (
    'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED',
    'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED',
    'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED',
    'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CANCELLED'
  ) then
    v_family := 'pix_automatic_payment_instruction';
    v_recognized := true;
  elsif v_event like 'PAYMENT_%' then
    v_family := 'payment';
    v_recognized := true;
    v_processing := true;
  end if;

  return jsonb_build_object(
    'event_type', nullif(v_event, ''),
    'family', v_family,
    'recognized', v_recognized,
    'processing_supported', v_processing
  );
end;
$$;

comment on function private.billing_classify_asaas_event(text) is
  'WP-ASAAS-05E0A: reconhecimento de famílias Asaas. Pix Automático = recognized, '
  'processing_supported=false até ASAAS-05E0B. Sem segundo ledger.';

revoke all on function private.billing_classify_asaas_event(text)
  from public, anon, authenticated, service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260912233000',
  '20260912233000_wp_asaas_05e0a_billing_profile_pix_multi_payment_foundation.sql',
  'WP-ASAAS-05E0A: Billing Profile admin-only + validação CPF/CNPJ + recurso '
  'Pix Automático + prepare distinto de 05D. Sem HTTP, sem checkout, sem enforcement.',
  'WP-ASAAS-05E0A'
)
on conflict (version) do nothing;
