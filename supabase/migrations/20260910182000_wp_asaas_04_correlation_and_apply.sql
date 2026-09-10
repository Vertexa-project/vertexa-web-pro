-- =====================================================================================
-- WP-ASAAS-04 — correlação subscription->tenant, apply atômico do snapshot, política de 404
-- e diagnostics read-only.
--
-- NÃO edita migrations anteriores. Forward migration só.
--
-- Superfície:
--   private.resolve_billing_target_by_subscription  + wrapper (service_role only)
--   private.apply_billing_payment_snapshot          + wrapper (service_role only)
--   private.handle_missing_payment_on_get           + wrapper (service_role only)
--   private.billing_processing_diagnostics          + wrapper (service_role only)
--
-- Tenant correlation é SEMPRE derivada server-side dos IDs Asaas já persistidos
-- (external_subscription_id -> billing_subscriptions -> billing_account -> external_customer_id).
-- NUNCA por nome/email/CPF/value/externalReference vindo do client. customer mismatch =
-- FAIL CLOSED (zero snapshot). Advisory lock (namespace 90400, dedicado ASAAS-04) serializa
-- por payment. GET atual é a autoridade do snapshot; event_created_at só governa audit
-- metadata (monotonicidade), nunca regride o snapshot.
-- =====================================================================================

-- ── Correlação reversa: external_subscription_id -> tenant ───────────────────────────

create or replace function private.resolve_billing_target_by_subscription(
  p_provider text,
  p_environment text,
  p_external_subscription_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider text := btrim(coalesce(p_provider, ''));
  v_env text := btrim(coalesce(p_environment, ''));
  v_sub text := btrim(coalesce(p_external_subscription_id, ''));
  v_sub_id uuid;
  v_account_id uuid;
  v_customer text;
begin
  if v_provider is distinct from 'asaas' then
    raise exception 'resolve_billing_target_by_subscription: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_env not in ('sandbox', 'production') then
    raise exception 'resolve_billing_target_by_subscription: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;
  if v_sub = '' then
    return jsonb_build_object('found', false);
  end if;

  select s.id, s.billing_account_id, a.external_customer_id
    into v_sub_id, v_account_id, v_customer
    from private.billing_subscriptions s
    join private.billing_accounts a on a.id = s.billing_account_id
   where s.provider = v_provider
     and s.environment = v_env
     and s.external_subscription_id = v_sub;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'billing_subscription_id', v_sub_id,
    'billing_account_id', v_account_id,
    'external_customer_id', v_customer
  );
end;
$$;

comment on function private.resolve_billing_target_by_subscription(text, text, text) is
  'WP-ASAAS-04: leitura só. Resolve o tenant Vertexa a partir do external_subscription_id do '
  'payment Asaas. found=false quando a subscription não pertence ao Vertexa '
  '(ignored_unmanaged_resource). Nunca correlaciona por PII/value/externalReference do client.';

revoke all on function private.resolve_billing_target_by_subscription(text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_billing_target_by_subscription(
  p_provider text,
  p_environment text,
  p_external_subscription_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.resolve_billing_target_by_subscription(p_provider, p_environment, p_external_subscription_id);
end;
$$;

comment on function public.resolve_billing_target_by_subscription(text, text, text) is
  'WP-ASAAS-04: wrapper Edge. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.resolve_billing_target_by_subscription(text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_billing_target_by_subscription(text, text, text) to service_role;


-- ── Apply atômico do snapshot + complete do event ───────────────────────────────────

create or replace function private.apply_billing_payment_snapshot(
  p_event_id uuid,
  p_external_event_id text,
  p_provider text,
  p_environment text,
  p_external_payment_id text,
  p_external_subscription_id text,
  p_external_customer_id text,
  p_provider_status text,
  p_financial_state text,
  p_billing_type text,
  p_value_cents bigint,
  p_net_value_cents bigint,
  p_refunded_value_cents bigint,
  p_due_date date,
  p_payment_date date,
  p_confirmed_date date,
  p_event_type text,
  p_event_created_at timestamptz
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
  v_payment text := btrim(coalesce(p_external_payment_id, ''));
  v_sub text := btrim(coalesce(p_external_subscription_id, ''));
  v_customer_in text := btrim(coalesce(p_external_customer_id, ''));
  v_event_id_ext text := nullif(btrim(coalesce(p_external_event_id, '')), '');
  v_event_type text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_sub_id uuid;
  v_account_id uuid;
  v_account_customer text;
  v_event_status text;
  v_payment_id uuid;
begin
  if v_provider is distinct from 'asaas' then
    raise exception 'apply_billing_payment_snapshot: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_env not in ('sandbox', 'production') then
    raise exception 'apply_billing_payment_snapshot: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;
  if v_payment = '' or v_sub = '' or v_customer_in = '' then
    raise exception 'apply_billing_payment_snapshot: missing identifiers'
      using errcode = '22023', hint = 'INVALID_IDENTIFIERS';
  end if;

  -- Serializa por payment (namespace 90400 dedicado ASAAS-04; 90300=ASAAS-03, 90202=SEC-02).
  perform pg_catalog.pg_advisory_xact_lock(
    90400,
    pg_catalog.hashtext(v_provider || ':' || v_env || ':' || v_payment)
  );

  -- Event precisa estar reivindicado por nós (processing). Row-lock para completar atômico.
  select processing_status into v_event_status
    from private.billing_provider_events
   where id = p_event_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'event_not_found');
  end if;
  if v_event_status is distinct from 'processing' then
    return jsonb_build_object('outcome', 'event_not_claimed', 'status', v_event_status);
  end if;

  -- Correlação server-side (nunca confia em account id vindo do caller).
  select s.id, s.billing_account_id, a.external_customer_id
    into v_sub_id, v_account_id, v_account_customer
    from private.billing_subscriptions s
    join private.billing_accounts a on a.id = s.billing_account_id
   where s.provider = v_provider
     and s.environment = v_env
     and s.external_subscription_id = v_sub;
  if not found then
    -- Subscription não é do Vertexa: NÃO escreve snapshot; deixa o event para o caller ignorar.
    return jsonb_build_object('outcome', 'unmanaged_subscription');
  end if;

  -- Integridade de tenant: customer do payment DEVE bater com o da conta. FAIL CLOSED.
  if v_account_customer is distinct from v_customer_in then
    return jsonb_build_object('outcome', 'customer_mismatch');
  end if;

  -- Upsert do snapshot: campos financeiros sempre = GET atual (autoridade). Trio de audit
  -- last_provider_event_* é monotônico (nunca regride para um event mais antigo).
  insert into private.billing_payments (
    billing_account_id, billing_subscription_id, provider, environment,
    external_payment_id, external_customer_id, external_subscription_id,
    provider_status, financial_state, billing_type,
    value_cents, net_value_cents, refunded_value_cents,
    due_date, payment_date, confirmed_date,
    last_provider_event_id, last_provider_event_type, last_provider_event_created_at,
    created_at, updated_at
  ) values (
    v_account_id, v_sub_id, v_provider, v_env,
    v_payment, v_customer_in, v_sub,
    p_provider_status, p_financial_state, nullif(btrim(coalesce(p_billing_type, '')), ''),
    p_value_cents, p_net_value_cents, p_refunded_value_cents,
    p_due_date, p_payment_date, p_confirmed_date,
    v_event_id_ext, v_event_type, p_event_created_at,
    clock_timestamp(), clock_timestamp()
  )
  on conflict (provider, environment, external_payment_id) do update set
    provider_status = excluded.provider_status,
    financial_state = excluded.financial_state,
    billing_type = excluded.billing_type,
    value_cents = excluded.value_cents,
    net_value_cents = excluded.net_value_cents,
    refunded_value_cents = excluded.refunded_value_cents,
    due_date = excluded.due_date,
    payment_date = excluded.payment_date,
    confirmed_date = excluded.confirmed_date,
    updated_at = clock_timestamp(),
    last_provider_event_id = case
      when private.billing_payments.last_provider_event_created_at is null
        or (excluded.last_provider_event_created_at is not null
            and excluded.last_provider_event_created_at >= private.billing_payments.last_provider_event_created_at)
      then excluded.last_provider_event_id
      else private.billing_payments.last_provider_event_id
    end,
    last_provider_event_type = case
      when private.billing_payments.last_provider_event_created_at is null
        or (excluded.last_provider_event_created_at is not null
            and excluded.last_provider_event_created_at >= private.billing_payments.last_provider_event_created_at)
      then excluded.last_provider_event_type
      else private.billing_payments.last_provider_event_type
    end,
    last_provider_event_created_at = case
      when private.billing_payments.last_provider_event_created_at is null
        or (excluded.last_provider_event_created_at is not null
            and excluded.last_provider_event_created_at >= private.billing_payments.last_provider_event_created_at)
      then excluded.last_provider_event_created_at
      else private.billing_payments.last_provider_event_created_at
    end
  returning id into v_payment_id;

  -- Completa o event atomicamente na mesma tx.
  update private.billing_provider_events
     set processing_status = 'processed',
         processed_at = clock_timestamp(),
         last_error_category = null,
         next_attempt_at = null
   where id = p_event_id
     and processing_status = 'processing';

  return jsonb_build_object(
    'outcome', 'applied',
    'billing_payment_id', v_payment_id,
    'financial_state', p_financial_state
  );
end;
$$;

comment on function private.apply_billing_payment_snapshot(uuid, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz) is
  'WP-ASAAS-04: numa única tx sob advisory lock por payment — valida claim, re-resolve tenant '
  'server-side, exige customer match (senão customer_mismatch, zero write), upsert do snapshot '
  '(campos financeiros = GET atual; audit last_provider_event_* monotônico) e marca o event '
  'processed. Atômico: falha => nenhum snapshot parcial nem event inconsistente.';

revoke all on function private.apply_billing_payment_snapshot(uuid, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.apply_billing_payment_snapshot(
  p_event_id uuid,
  p_external_event_id text,
  p_provider text,
  p_environment text,
  p_external_payment_id text,
  p_external_subscription_id text,
  p_external_customer_id text,
  p_provider_status text,
  p_financial_state text,
  p_billing_type text,
  p_value_cents bigint,
  p_net_value_cents bigint,
  p_refunded_value_cents bigint,
  p_due_date date,
  p_payment_date date,
  p_confirmed_date date,
  p_event_type text,
  p_event_created_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.apply_billing_payment_snapshot(
    p_event_id, p_external_event_id, p_provider, p_environment, p_external_payment_id,
    p_external_subscription_id, p_external_customer_id, p_provider_status, p_financial_state,
    p_billing_type, p_value_cents, p_net_value_cents, p_refunded_value_cents,
    p_due_date, p_payment_date, p_confirmed_date, p_event_type, p_event_created_at
  );
end;
$$;

comment on function public.apply_billing_payment_snapshot(uuid, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz) is
  'WP-ASAAS-04: wrapper Edge. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.apply_billing_payment_snapshot(uuid, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_billing_payment_snapshot(uuid, text, text, text, text, text, text, text, text, text, bigint, bigint, bigint, date, date, date, text, timestamptz) to service_role;


-- ── Política de GET 404 (CORREÇÃO OBRIGATÓRIA 3): 404 NÃO é voided genérico ──────────

create or replace function private.handle_missing_payment_on_get(
  p_event_id uuid,
  p_provider text,
  p_environment text,
  p_external_payment_id text,
  p_event_type text,
  p_event_created_at timestamptz
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
  v_payment text := btrim(coalesce(p_external_payment_id, ''));
  v_event_status text;
  v_existing_id uuid;
begin
  if v_provider is distinct from 'asaas' or v_env not in ('sandbox', 'production') or v_payment = '' then
    raise exception 'handle_missing_payment_on_get: invalid arguments'
      using errcode = '22023', hint = 'INVALID_ARGS';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    90400,
    pg_catalog.hashtext(v_provider || ':' || v_env || ':' || v_payment)
  );

  select processing_status into v_event_status
    from private.billing_provider_events
   where id = p_event_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'event_not_found');
  end if;
  if v_event_status is distinct from 'processing' then
    return jsonb_build_object('outcome', 'event_not_claimed', 'status', v_event_status);
  end if;

  select id into v_existing_id
    from private.billing_payments
   where provider = v_provider and environment = v_env and external_payment_id = v_payment
   for update;

  if v_existing_id is null then
    -- CASE A: nunca foi um payment gerenciado do Vertexa. NÃO cria nada. ignored.
    update private.billing_provider_events
       set processing_status = 'ignored',
           processed_at = clock_timestamp(),
           last_error_category = 'ignored_unmanaged_resource',
           next_attempt_at = null
     where id = p_event_id and processing_status = 'processing';
    return jsonb_build_object('outcome', 'ignored', 'reason', 'ignored_unmanaged_resource');
  end if;

  -- CASE B: já existe billing_payment gerenciado.
  if btrim(coalesce(p_event_type, '')) = 'PAYMENT_DELETED' then
    -- Transição controlada para voided (managed + evento de deleção + correlação prévia íntegra).
    -- financial_state='voided' é correto independente de ordem (um 404 atual = recurso sumiu).
    -- Mas o trio de audit last_provider_event_* move JUNTO e é monotônico: um PAYMENT_DELETED
    -- fora de ordem (mais antigo) não sobrescreve id/type/created_at de um evento mais novo.
    update private.billing_payments
       set financial_state = 'voided',
           updated_at = clock_timestamp(),
           last_provider_event_type = case
             when last_provider_event_created_at is null
               or (p_event_created_at is not null and p_event_created_at >= last_provider_event_created_at)
             then 'PAYMENT_DELETED' else last_provider_event_type end,
           last_provider_event_id = case
             when last_provider_event_created_at is null
               or (p_event_created_at is not null and p_event_created_at >= last_provider_event_created_at)
             then (select external_event_id from private.billing_provider_events where id = p_event_id)
             else last_provider_event_id end,
           last_provider_event_created_at = case
             when last_provider_event_created_at is null
               or (p_event_created_at is not null and p_event_created_at >= last_provider_event_created_at)
             then p_event_created_at else last_provider_event_created_at end
     where id = v_existing_id;

    update private.billing_provider_events
       set processing_status = 'processed', processed_at = clock_timestamp(),
           last_error_category = null, next_attempt_at = null
     where id = p_event_id and processing_status = 'processing';
    return jsonb_build_object('outcome', 'voided');
  end if;

  -- Managed mas 404 sem PAYMENT_DELETED: NÃO assume voided pelo HTTP. Fail closed p/ review.
  update private.billing_provider_events
     set processing_status = 'failed',
         last_error_category = 'provider_resource_not_found_requires_review',
         next_attempt_at = null
   where id = p_event_id and processing_status = 'processing';
  return jsonb_build_object('outcome', 'failed', 'reason', 'provider_resource_not_found_requires_review');
end;
$$;

comment on function private.handle_missing_payment_on_get(uuid, text, text, text, text, timestamptz) is
  'WP-ASAAS-04 (Correção 3): GET 404 NUNCA vira voided genérico. Sem billing_payment prévio => '
  'ignored_unmanaged_resource. Com billing_payment gerenciado + event PAYMENT_DELETED => voided '
  'controlado. Caso contrário => failed non-retryable provider_resource_not_found_requires_review.';

revoke all on function private.handle_missing_payment_on_get(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.handle_missing_payment_on_get(
  p_event_id uuid,
  p_provider text,
  p_environment text,
  p_external_payment_id text,
  p_event_type text,
  p_event_created_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.handle_missing_payment_on_get(p_event_id, p_provider, p_environment, p_external_payment_id, p_event_type, p_event_created_at);
end;
$$;

comment on function public.handle_missing_payment_on_get(uuid, text, text, text, text, timestamptz) is
  'WP-ASAAS-04: wrapper Edge. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.handle_missing_payment_on_get(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.handle_missing_payment_on_get(uuid, text, text, text, text, timestamptz) to service_role;


-- ── Diagnostics read-only (sem PII, sem payload_hash) ────────────────────────────────

create or replace function private.billing_processing_diagnostics(
  p_provider text,
  p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider text := btrim(coalesce(p_provider, ''));
  v_env text := btrim(coalesce(p_environment, ''));
  v_events jsonb;
  v_failed jsonb;
  v_states jsonb;
  v_oldest timestamptz;
begin
  if v_provider is distinct from 'asaas' or v_env not in ('sandbox', 'production') then
    raise exception 'billing_processing_diagnostics: invalid arguments'
      using errcode = '22023', hint = 'INVALID_ARGS';
  end if;

  select
    jsonb_build_object(
      'received', count(*) filter (where processing_status = 'received'),
      'processing', count(*) filter (where processing_status = 'processing'),
      'processed', count(*) filter (where processing_status = 'processed'),
      'ignored', count(*) filter (where processing_status = 'ignored'),
      'failed', count(*) filter (where processing_status = 'failed')
    ),
    min(received_at) filter (where processing_status in ('received', 'processing'))
    into v_events, v_oldest
    from private.billing_provider_events
   where provider = v_provider and environment = v_env;

  select coalesce(jsonb_object_agg(cat, n), '{}'::jsonb)
    into v_failed
    from (
      select coalesce(last_error_category, '_uncategorized') as cat, count(*) as n
        from private.billing_provider_events
       where provider = v_provider and environment = v_env and processing_status = 'failed'
       group by 1
    ) t;

  select coalesce(jsonb_object_agg(financial_state, n), '{}'::jsonb)
    into v_states
    from (
      select financial_state, count(*) as n
        from private.billing_payments
       where provider = v_provider and environment = v_env
       group by 1
    ) t;

  return jsonb_build_object(
    'provider', v_provider,
    'environment', v_env,
    'events', v_events,
    'failed_by_category', v_failed,
    'oldest_unprocessed_received_at', v_oldest,
    'oldest_unprocessed_age_seconds',
      case when v_oldest is null then null
           else floor(extract(epoch from (clock_timestamp() - v_oldest)))::bigint end,
    'processing_lag_seconds',
      case when v_oldest is null then 0
           else floor(extract(epoch from (clock_timestamp() - v_oldest)))::bigint end,
    'billing_payments_total', (
      select count(*) from private.billing_payments
       where provider = v_provider and environment = v_env
    ),
    'billing_payments_by_state', v_states
  );
end;
$$;

comment on function private.billing_processing_diagnostics(text, text) is
  'WP-ASAAS-04: diagnóstico operacional read-only. Só contagens/agregados técnicos '
  '(received/processing/processed/ignored/failed, oldest unprocessed, lag, failed by category, '
  'payments by financial_state). NUNCA CPF/email/nome/payload_hash/API key/external ids do payer.';

revoke all on function private.billing_processing_diagnostics(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.billing_processing_diagnostics(
  p_provider text,
  p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.billing_processing_diagnostics(p_provider, p_environment);
end;
$$;

comment on function public.billing_processing_diagnostics(text, text) is
  'WP-ASAAS-04: wrapper Edge. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.billing_processing_diagnostics(text, text)
  from public, anon, authenticated;
grant execute on function public.billing_processing_diagnostics(text, text) to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260910182000',
  '20260910182000_wp_asaas_04_correlation_and_apply.sql',
  'WP-ASAAS-04: resolve_billing_target_by_subscription (reverse correlation), '
  'apply_billing_payment_snapshot (advisory lock 90400, tenant re-resolve, customer_mismatch '
  'fail-closed, monotonic audit, atomic event complete), handle_missing_payment_on_get (404 '
  'policy: never generic voided), billing_processing_diagnostics (no PII). service_role only.',
  'WP-ASAAS-04'
)
on conflict (version) do nothing;
