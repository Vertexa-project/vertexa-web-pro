-- =====================================================================================
-- WP-ASAAS-05E0B — Pix Automatic webhook processor + reconciliation foundation.
--
-- Forward-only. NÃO edita 05A–05E0A. Sem seed. Sem HTTP. Sem entitlement. Sem Founder.
-- =====================================================================================

-- ── Authorization reconciliation metadata ─────────────────────────────────────

alter table private.billing_pix_automatic_authorizations
  add column provider_customer_id text,
  add column provider_event_at timestamptz,
  add column conciliation_identifier text,
  add column qr_expires_at timestamptz,
  add column amount_mismatch boolean not null default false;

comment on column private.billing_pix_automatic_authorizations.provider_customer_id is
  'Customer Asaas ligado à autorização. Binding falha se divergir da billing_account.';

comment on column private.billing_pix_automatic_authorizations.provider_event_at is
  'dateCreated do último evento/GET aplicado. Usado para recusar regressão stale.';

comment on column private.billing_pix_automatic_authorizations.conciliation_identifier is
  'immediateQrCode.conciliationIdentifier. Sem payload/encodedImage.';

comment on column private.billing_pix_automatic_authorizations.qr_expires_at is
  'Expiração do QR imediato. Payload copia-e-cola NÃO é persistido.';

comment on column private.billing_pix_automatic_authorizations.amount_mismatch is
  'Provider value ≠ contracted_price_cents. Nunca reescreve o contrato.';

create unique index billing_pix_automatic_authorizations_provider_uidx
  on private.billing_pix_automatic_authorizations (environment, provider_authorization_id)
  where provider_authorization_id is not null;


-- ── Provider eligibility (não é entitlement) ─────────────────────────────────

create table private.billing_pix_automatic_eligibility (
  id uuid primary key default gen_random_uuid(),
  environment text not null,
  provider_account_id text not null default '',
  status text not null,
  provider_event_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint billing_pix_automatic_eligibility_environment_check
    check (environment in ('sandbox', 'production')),
  constraint billing_pix_automatic_eligibility_status_check
    check (status in ('ELIGIBLE', 'INELIGIBLE')),
  constraint billing_pix_automatic_eligibility_env_account_key
    unique (environment, provider_account_id)
);

comment on table private.billing_pix_automatic_eligibility is
  'WP-ASAAS-05E0B: fato de elegibilidade da conta Asaas. NÃO é entitlement. Sem seed.';

alter table private.billing_pix_automatic_eligibility enable row level security;
revoke all on table private.billing_pix_automatic_eligibility
  from public, anon, authenticated, service_role;


-- ── Payment instructions (não são settlement) ────────────────────────────────

create table private.billing_pix_automatic_payment_instructions (
  id uuid primary key default gen_random_uuid(),
  pix_authorization_id uuid not null,
  environment text not null,
  provider_instruction_id text not null,
  provider_payment_id text,
  status text not null,
  due_date date,
  provider_event_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint billing_pix_automatic_instructions_auth_fkey
    foreign key (pix_authorization_id)
    references private.billing_pix_automatic_authorizations(id)
    on delete restrict,
  constraint billing_pix_automatic_instructions_environment_check
    check (environment in ('sandbox', 'production')),
  constraint billing_pix_automatic_instructions_status_check
    check (status in (
      'AWAITING_REQUEST', 'SCHEDULED', 'REFUSED', 'CANCELLED', 'DONE'
    )),
  constraint billing_pix_automatic_instructions_id_check
    check (btrim(provider_instruction_id) <> '')
);

comment on table private.billing_pix_automatic_payment_instructions is
  'WP-ASAAS-05E0B: instruções Pix Automático. Settlement continua em PAYMENT_*.';

create unique index billing_pix_automatic_instructions_provider_uidx
  on private.billing_pix_automatic_payment_instructions (environment, provider_instruction_id);

create index billing_pix_automatic_instructions_auth_idx
  on private.billing_pix_automatic_payment_instructions (pix_authorization_id);

alter table private.billing_pix_automatic_payment_instructions enable row level security;
revoke all on table private.billing_pix_automatic_payment_instructions
  from public, anon, authenticated, service_role;


-- ── Sanitized webhook facts (sem payload bruto / PII) ────────────────────────

alter table private.billing_provider_events
  add column provider_facts jsonb;

comment on column private.billing_provider_events.provider_facts is
  'WP-ASAAS-05E0B: fatos sanitizados (ids/status/datas). Sem payload QR, sem PII.';


-- ── Classify: Pix Automatic agora é processável ──────────────────────────────

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
    v_processing := true;
  elsif v_event in (
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED'
  ) then
    v_family := 'pix_automatic_authorization';
    v_recognized := true;
    v_processing := true;
  elsif v_event in (
    'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED',
    'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED',
    'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED',
    'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CANCELLED'
  ) then
    v_family := 'pix_automatic_payment_instruction';
    v_recognized := true;
    v_processing := true;
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
  'WP-ASAAS-05E0B: Pix Automático recognized + processing_supported. PAYMENT_* inalterado.';


-- Algoritmo de transição (autorização):
-- 1. Mesmo status => no-op permitido.
-- 2. dateCreated do evento < provider_event_at e status diferente => ignored_stale.
-- 3. Grafo permitido:
--    INTENT  → CREATED | ACTIVE | REFUSED | EXPIRED | CANCELLED
--    CREATED → ACTIVE | REFUSED | EXPIRED | CANCELLED
--    ACTIVE  → CANCELLED | EXPIRED
--    REFUSED / EXPIRED / CANCELLED → sem regressão
-- 4. ACTIVE nunca volta para CREATED por evento antigo.
-- 5. Evento inaplicável => ignored_stale / reconciliation_required, sem envenenar a fila.
-- ── Transition helper ────────────────────────────────────────────────────────

create or replace function private.billing_pix_automatic_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case btrim(coalesce(p_status, ''))
    when 'INTENT' then 0
    when 'CREATED' then 1
    when 'ACTIVE' then 2
    when 'REFUSED' then 3
    when 'EXPIRED' then 3
    when 'CANCELLED' then 4
    else -1
  end;
$$;

revoke all on function private.billing_pix_automatic_status_rank(text)
  from public, anon, authenticated, service_role;

create or replace function private.billing_pix_automatic_transition_allowed(
  p_from text,
  p_to text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_from text := btrim(coalesce(p_from, ''));
  v_to text := btrim(coalesce(p_to, ''));
begin
  if v_from = v_to then
    return true;
  end if;
  if v_to not in ('CREATED', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'REFUSED') then
    return false;
  end if;
  if v_from = 'INTENT' then
    return true;
  end if;
  if v_from = 'CREATED' then
    return v_to in ('ACTIVE', 'REFUSED', 'EXPIRED', 'CANCELLED');
  end if;
  if v_from = 'ACTIVE' then
    return v_to in ('CANCELLED', 'EXPIRED');
  end if;
  return false;
end;
$$;

revoke all on function private.billing_pix_automatic_transition_allowed(text, text)
  from public, anon, authenticated, service_role;


-- ── Ingest: optional sanitized facts ─────────────────────────────────────────
-- Uma única assinatura (9 args, último default null).
-- Manter o overload de 8 args tornaria chamadas de 8 argumentos ambíguas.

drop function if exists public.ingest_billing_provider_event(text, text, text, text, timestamptz, text, text, text);
drop function if exists private.ingest_billing_provider_event(text, text, text, text, timestamptz, text, text, text);

create or replace function private.ingest_billing_provider_event(
  p_provider text,
  p_environment text,
  p_external_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_external_resource_type text,
  p_external_resource_id text,
  p_payload_hash text,
  p_provider_facts jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_hash text;
  v_provider text := btrim(coalesce(p_provider, ''));
  v_env text := btrim(coalesce(p_environment, ''));
  v_event_id text := btrim(coalesce(p_external_event_id, ''));
  v_event_type text := btrim(coalesce(p_event_type, ''));
  v_hash_in text := btrim(coalesce(p_payload_hash, ''));
begin
  if v_provider is distinct from 'asaas' then
    raise exception 'ingest_billing_provider_event: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_env not in ('sandbox', 'production') then
    raise exception 'ingest_billing_provider_event: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;
  if v_event_id = '' or v_event_type = '' or char_length(v_hash_in) < 32 then
    raise exception 'ingest_billing_provider_event: envelope incomplete'
      using errcode = '22023', hint = 'INVALID_ENVELOPE';
  end if;

  begin
    insert into private.billing_provider_events (
      provider,
      environment,
      external_event_id,
      event_type,
      event_created_at,
      external_resource_type,
      external_resource_id,
      payload_hash,
      provider_facts,
      processing_status
    ) values (
      v_provider,
      v_env,
      v_event_id,
      v_event_type,
      p_event_created_at,
      nullif(btrim(coalesce(p_external_resource_type, '')), ''),
      nullif(btrim(coalesce(p_external_resource_id, '')), ''),
      v_hash_in,
      p_provider_facts,
      'received'
    )
    returning id into v_id;

    return jsonb_build_object('outcome', 'inserted', 'id', v_id);
  exception
    when unique_violation then
      select e.id, e.payload_hash
        into v_id, v_hash
        from private.billing_provider_events e
       where e.provider = v_provider
         and e.environment = v_env
         and e.external_event_id = v_event_id;

      if v_hash is not distinct from v_hash_in then
        return jsonb_build_object('outcome', 'duplicate', 'id', v_id);
      end if;

      update private.billing_provider_events
         set last_error_category = 'payload_hash_mismatch'
       where id = v_id;

      return jsonb_build_object('outcome', 'conflict', 'id', v_id);
  end;
end;
$$;

create or replace function public.ingest_billing_provider_event(
  p_provider text,
  p_environment text,
  p_external_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_external_resource_type text,
  p_external_resource_id text,
  p_payload_hash text,
  p_provider_facts jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.ingest_billing_provider_event(
    p_provider,
    p_environment,
    p_external_event_id,
    p_event_type,
    p_event_created_at,
    p_external_resource_type,
    p_external_resource_id,
    p_payload_hash,
    p_provider_facts
  );
end;
$$;

revoke all on function public.ingest_billing_provider_event(
  text, text, text, text, timestamptz, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_billing_provider_event(
  text, text, text, text, timestamptz, text, text, text, jsonb
) to service_role;


-- ── Claim also returns provider_facts ────────────────────────────────────────

create or replace function private.claim_billing_provider_events(
  p_provider text,
  p_environment text,
  p_limit integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := btrim(coalesce(p_provider, ''));
  v_env text := btrim(coalesce(p_environment, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 25);
  v_cap constant integer := 8;
  v_stale constant interval := interval '15 minutes';
  v_rows jsonb;
begin
  if v_provider is distinct from 'asaas' then
    raise exception 'claim_billing_provider_events: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_env not in ('sandbox', 'production') then
    raise exception 'claim_billing_provider_events: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;

  with claimable as (
    select e.id
      from private.billing_provider_events e
     where e.provider = v_provider
       and e.environment = v_env
       and (
         e.processing_status = 'received'
         or (
           e.processing_status = 'failed'
           and e.attempts < v_cap
           and e.next_attempt_at is not null
           and e.next_attempt_at <= clock_timestamp()
         )
         or (
           e.processing_status = 'processing'
           and e.claimed_at is not null
           and e.claimed_at <= clock_timestamp() - v_stale
         )
       )
     order by e.received_at asc
     for update skip locked
     limit v_limit
  ),
  claimed as (
    update private.billing_provider_events e
       set processing_status = 'processing',
           attempts = e.attempts + 1,
           claimed_at = clock_timestamp(),
           next_attempt_at = null
      from claimable c
     where e.id = c.id
    returning
      e.id,
      e.external_event_id,
      e.event_type,
      e.event_created_at,
      e.external_resource_type,
      e.external_resource_id,
      e.environment,
      e.attempts,
      e.provider_facts
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'external_event_id', c.external_event_id,
        'event_type', c.event_type,
        'event_created_at', c.event_created_at,
        'external_resource_type', c.external_resource_type,
        'external_resource_id', c.external_resource_id,
        'environment', c.environment,
        'attempts', c.attempts,
        'provider_facts', c.provider_facts
      )
      order by c.event_created_at asc nulls first
    ),
    '[]'::jsonb
  )
  into v_rows
  from claimed c;

  return v_rows;
end;
$$;


-- ── Complete authorization outbound ──────────────────────────────────────────

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
         commercial_contract_id
    into v_account, v_env, v_type, v_status, v_existing, v_contract
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

  select id into v_auth
    from private.billing_pix_automatic_authorizations
   where commercial_contract_id = v_contract
     and environment = v_env
     and is_primary
   for update;

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

create or replace function public.complete_billing_pix_automatic_authorization_operation(
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
begin
  return private.complete_billing_pix_automatic_authorization_operation(
    p_operation_id,
    p_provider_authorization_id,
    p_provider_status,
    p_provider_customer_id,
    p_conciliation_identifier,
    p_qr_expires_at
  );
end;
$$;

revoke all on function public.complete_billing_pix_automatic_authorization_operation(
  uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_billing_pix_automatic_authorization_operation(
  uuid, text, text, text, text, timestamptz
) to service_role;


-- ── Apply authorization event (GET/webhook facts) ────────────────────────────

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
       and is_primary
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
     and commercial_contract_id = v_auth.commercial_contract_id;

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

create or replace function public.apply_billing_pix_automatic_authorization_event(
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
begin
  return private.apply_billing_pix_automatic_authorization_event(
    p_event_id, p_environment, p_provider_authorization_id, p_provider_status,
    p_provider_customer_id, p_provider_contract_id, p_provider_value_cents,
    p_event_created_at, p_conciliation_identifier, p_qr_expires_at
  );
end;
$$;

revoke all on function public.apply_billing_pix_automatic_authorization_event(
  uuid, text, text, text, text, text, integer, timestamptz, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_billing_pix_automatic_authorization_event(
  uuid, text, text, text, text, text, integer, timestamptz, text, timestamptz
) to service_role;


-- ── Eligibility ──────────────────────────────────────────────────────────────

create or replace function private.apply_billing_pix_automatic_eligibility_event(
  p_event_id uuid,
  p_environment text,
  p_provider_account_id text,
  p_status text,
  p_event_created_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env text := btrim(coalesce(p_environment, ''));
  v_status text := btrim(coalesce(p_status, ''));
  v_account text := coalesce(nullif(btrim(coalesce(p_provider_account_id, '')), ''), '');
  v_existing timestamptz;
  v_event_status text;
begin
  if v_env not in ('sandbox', 'production') or v_status not in ('ELIGIBLE', 'INELIGIBLE') then
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

  select provider_event_at into v_existing
    from private.billing_pix_automatic_eligibility
   where environment = v_env
     and provider_account_id = v_account;

  if v_existing is not null
     and p_event_created_at is not null
     and p_event_created_at < v_existing then
    update private.billing_provider_events
       set processing_status = 'ignored',
           processed_at = clock_timestamp(),
           last_error_category = 'ignored_stale'
     where id = p_event_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'ignored_stale');
  end if;

  insert into private.billing_pix_automatic_eligibility (
    environment, provider_account_id, status, provider_event_at
  ) values (
    v_env, v_account, v_status, p_event_created_at
  )
  on conflict (environment, provider_account_id) do update
    set status = excluded.status,
        provider_event_at = excluded.provider_event_at,
        updated_at = clock_timestamp();

  update private.billing_provider_events
     set processing_status = 'processed',
         processed_at = clock_timestamp()
   where id = p_event_id;

  return jsonb_build_object(
    'outcome', 'applied',
    'status', v_status,
    'entitlement_granted', false
  );
end;
$$;

revoke all on function private.apply_billing_pix_automatic_eligibility_event(
  uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.apply_billing_pix_automatic_eligibility_event(
  p_event_id uuid,
  p_environment text,
  p_provider_account_id text,
  p_status text,
  p_event_created_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.apply_billing_pix_automatic_eligibility_event(
    p_event_id, p_environment, p_provider_account_id, p_status, p_event_created_at
  );
end;
$$;

revoke all on function public.apply_billing_pix_automatic_eligibility_event(
  uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_billing_pix_automatic_eligibility_event(
  uuid, text, text, text, timestamptz
) to service_role;


-- ── Instructions ─────────────────────────────────────────────────────────────

create or replace function private.billing_pix_automatic_instruction_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case btrim(coalesce(p_status, ''))
    when 'AWAITING_REQUEST' then 1
    when 'SCHEDULED' then 2
    when 'DONE' then 3
    when 'REFUSED' then 4
    when 'CANCELLED' then 4
    else 0
  end;
$$;

revoke all on function private.billing_pix_automatic_instruction_rank(text)
  from public, anon, authenticated, service_role;

create or replace function private.apply_billing_pix_automatic_instruction_event(
  p_event_id uuid,
  p_environment text,
  p_provider_instruction_id text,
  p_instruction_status text,
  p_provider_authorization_id text,
  p_provider_payment_id text,
  p_due_date date,
  p_event_created_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env text := btrim(coalesce(p_environment, ''));
  v_iid text := btrim(coalesce(p_provider_instruction_id, ''));
  v_status text := btrim(coalesce(p_instruction_status, ''));
  v_auth_ext text := btrim(coalesce(p_provider_authorization_id, ''));
  v_pay text := nullif(btrim(coalesce(p_provider_payment_id, '')), '');
  v_auth_id uuid;
  v_row private.billing_pix_automatic_payment_instructions%rowtype;
  v_event_status text;
begin
  if v_env not in ('sandbox', 'production')
     or v_iid = ''
     or v_status not in ('AWAITING_REQUEST', 'SCHEDULED', 'REFUSED', 'CANCELLED', 'DONE') then
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

  select id into v_auth_id
    from private.billing_pix_automatic_authorizations
   where environment = v_env
     and provider_authorization_id = v_auth_ext;

  if v_auth_id is null then
    update private.billing_provider_events
       set processing_status = 'ignored',
           processed_at = clock_timestamp(),
           last_error_category = 'ignored_unmanaged_resource'
     where id = p_event_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'ignored_unmanaged_resource');
  end if;

  select * into v_row
    from private.billing_pix_automatic_payment_instructions
   where environment = v_env
     and provider_instruction_id = v_iid
   for update;

  if found then
    if p_event_created_at is not null
       and v_row.provider_event_at is not null
       and p_event_created_at < v_row.provider_event_at
       and v_status is distinct from v_row.status then
      update private.billing_provider_events
         set processing_status = 'ignored',
             processed_at = clock_timestamp(),
             last_error_category = 'ignored_stale'
       where id = p_event_id;
      return jsonb_build_object('outcome', 'ignored', 'reason', 'ignored_stale');
    end if;
    if private.billing_pix_automatic_instruction_rank(v_status)
         < private.billing_pix_automatic_instruction_rank(v_row.status)
       and v_status is distinct from v_row.status then
      update private.billing_provider_events
         set processing_status = 'ignored',
             processed_at = clock_timestamp(),
             last_error_category = 'ignored_stale'
       where id = p_event_id;
      return jsonb_build_object('outcome', 'ignored', 'reason', 'ignored_stale');
    end if;

    update private.billing_pix_automatic_payment_instructions
       set status = v_status,
           provider_payment_id = coalesce(v_pay, provider_payment_id),
           due_date = coalesce(p_due_date, due_date),
           provider_event_at = coalesce(p_event_created_at, provider_event_at),
           updated_at = clock_timestamp()
     where id = v_row.id;
  else
    insert into private.billing_pix_automatic_payment_instructions (
      pix_authorization_id, environment, provider_instruction_id,
      provider_payment_id, status, due_date, provider_event_at
    ) values (
      v_auth_id, v_env, v_iid, v_pay, v_status, p_due_date, p_event_created_at
    );
  end if;

  update private.billing_provider_events
     set processing_status = 'processed',
         processed_at = clock_timestamp()
   where id = p_event_id;

  return jsonb_build_object(
    'outcome', 'applied',
    'status', v_status,
    'financial_authority', 'PAYMENT_EVENTS'
  );
end;
$$;

revoke all on function private.apply_billing_pix_automatic_instruction_event(
  uuid, text, text, text, text, text, date, timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.apply_billing_pix_automatic_instruction_event(
  p_event_id uuid,
  p_environment text,
  p_provider_instruction_id text,
  p_instruction_status text,
  p_provider_authorization_id text,
  p_provider_payment_id text,
  p_due_date date,
  p_event_created_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.apply_billing_pix_automatic_instruction_event(
    p_event_id, p_environment, p_provider_instruction_id, p_instruction_status,
    p_provider_authorization_id, p_provider_payment_id, p_due_date, p_event_created_at
  );
end;
$$;

revoke all on function public.apply_billing_pix_automatic_instruction_event(
  uuid, text, text, text, text, text, date, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_billing_pix_automatic_instruction_event(
  uuid, text, text, text, text, text, date, timestamptz
) to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260913021500',
  '20260913021500_wp_asaas_05e0b_pix_automatic_webhook_processor.sql',
  'WP-ASAAS-05E0B: Pix Automatic adapter reconciliation + webhook processor primitives.',
  'asaas-05e0b'
);
