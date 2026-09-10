-- =====================================================================================
-- WP-ASAAS-04 — claiming atômico de billing_provider_events para o processor.
--
-- NÃO edita migrations anteriores. Forward migration só (ALTER pontual + novas RPCs).
--
-- Superfície:
--   ALTER private.billing_provider_events  (+ attempts, claimed_at, next_attempt_at; CHECK novo)
--   private.claim_billing_provider_events    + public wrapper (service_role only)
--   private.fail_billing_provider_event      + public wrapper (service_role only)
--   private.ignore_billing_provider_event    + public wrapper (service_role only)
--
-- processing_status passa de {received,processed,failed} para
-- {received,processing,processed,ignored,failed}. Claim usa FOR UPDATE SKIP LOCKED (dois
-- workers nunca pegam o mesmo event). Backoff é DADO (next_attempt_at), não só comentário.
-- =====================================================================================

alter table private.billing_provider_events
  add column attempts integer not null default 0,
  add column claimed_at timestamptz,
  add column next_attempt_at timestamptz;

alter table private.billing_provider_events
  add constraint billing_provider_events_attempts_check check (attempts >= 0);

comment on column private.billing_provider_events.attempts is
  'WP-ASAAS-04: nº de vezes que o event foi reivindicado (claim). Incrementado no claim. '
  'Cap de retry no claim RPC — failed com attempts no cap não é reivindicado de novo.';

comment on column private.billing_provider_events.next_attempt_at is
  'WP-ASAAS-04: quando um failed retryable pode ser reivindicado de novo (backoff). '
  'NULL num failed = non-retryable (config/integridade) — nunca reivindicado automaticamente.';

comment on column private.billing_provider_events.claimed_at is
  'WP-ASAAS-04: quando o event foi reivindicado. processing preso além do timeout é '
  'reivindicável de novo (crash de worker).';

-- CHECK novo: forward-only. Todos os rows existentes estão em received|processed|failed,
-- então o novo CHECK (superconjunto) nunca falha na aplicação.
alter table private.billing_provider_events
  drop constraint billing_provider_events_status_check;

alter table private.billing_provider_events
  add constraint billing_provider_events_status_check
  check (processing_status in ('received', 'processing', 'processed', 'ignored', 'failed'));


-- ── Claim atômico (DEFINER, service_role only). FOR UPDATE SKIP LOCKED. ──────────────

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
           -- SÓ failed RETRYABLE: next_attempt_at foi setado (não-nulo) E já venceu. failed com
           -- next_attempt_at NULL é non-retryable (customer_mismatch, provider_auth_error,
           -- provider_resource_not_found_requires_review, value_not_exact_cents...) e NUNCA é
           -- reivindicado automaticamente — exige intervenção humana (fail closed).
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
      e.attempts
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
        'attempts', c.attempts
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

comment on function private.claim_billing_provider_events(text, text, integer) is
  'WP-ASAAS-04: reivindica até p_limit (clamp 1..25) events elegíveis (received | failed '
  'retryable com next_attempt_at vencido e attempts<cap | processing stale). FOR UPDATE SKIP '
  'LOCKED — dois workers nunca pegam o mesmo. Marca processing, incrementa attempts. Retorna '
  'só campos técnicos (nunca payload_hash/PII).';

revoke all on function private.claim_billing_provider_events(text, text, integer)
  from public, anon, authenticated, service_role;

create or replace function public.claim_billing_provider_events(
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
begin
  return private.claim_billing_provider_events(p_provider, p_environment, p_limit);
end;
$$;

comment on function public.claim_billing_provider_events(text, text, integer) is
  'WP-ASAAS-04: wrapper Edge. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.claim_billing_provider_events(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_billing_provider_events(text, text, integer) to service_role;


-- ── fail (retryable com backoff, ou non-retryable) ──────────────────────────────────

create or replace function private.fail_billing_provider_event(
  p_event_id uuid,
  p_error_category text,
  p_retryable boolean,
  p_backoff_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_cat text := nullif(btrim(coalesce(p_error_category, '')), '');
begin
  if v_cat is null then
    raise exception 'fail_billing_provider_event: error_category required'
      using errcode = '22023', hint = 'INVALID_CATEGORY';
  end if;

  update private.billing_provider_events
     set processing_status = 'failed',
         last_error_category = v_cat,
         next_attempt_at = case
           when coalesce(p_retryable, false)
             then clock_timestamp() + make_interval(secs => greatest(coalesce(p_backoff_seconds, 0), 0))
           else null
         end
   where id = p_event_id
     and processing_status = 'processing'
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('outcome', 'not_claimed');
  end if;
  return jsonb_build_object('outcome', 'failed');
end;
$$;

comment on function private.fail_billing_provider_event(uuid, text, boolean, integer) is
  'WP-ASAAS-04: marca um event reivindicado (processing) como failed. Retryable define '
  'next_attempt_at (backoff); non-retryable deixa NULL (config/integridade). Só transiciona '
  'de processing — nunca sobrescreve processed/ignored.';

revoke all on function private.fail_billing_provider_event(uuid, text, boolean, integer)
  from public, anon, authenticated, service_role;

create or replace function public.fail_billing_provider_event(
  p_event_id uuid,
  p_error_category text,
  p_retryable boolean,
  p_backoff_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.fail_billing_provider_event(p_event_id, p_error_category, p_retryable, p_backoff_seconds);
end;
$$;

comment on function public.fail_billing_provider_event(uuid, text, boolean, integer) is
  'WP-ASAAS-04: wrapper Edge. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.fail_billing_provider_event(uuid, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.fail_billing_provider_event(uuid, text, boolean, integer) to service_role;


-- ── ignore (não é cobrança gerenciada / não-subscription / unsupported) ──────────────

create or replace function private.ignore_billing_provider_event(
  p_event_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'ignore_billing_provider_event: reason required'
      using errcode = '22023', hint = 'INVALID_REASON';
  end if;

  update private.billing_provider_events
     set processing_status = 'ignored',
         processed_at = clock_timestamp(),
         last_error_category = v_reason,
         next_attempt_at = null
   where id = p_event_id
     and processing_status = 'processing'
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('outcome', 'not_claimed');
  end if;
  return jsonb_build_object('outcome', 'ignored');
end;
$$;

comment on function private.ignore_billing_provider_event(uuid, text) is
  'WP-ASAAS-04: marca um event reivindicado (processing) como ignored, sem mutação financeira. '
  'Razões: ignored_non_subscription_payment | ignored_unmanaged_resource | unsupported_event | '
  'missing_resource_id. Só transiciona de processing.';

revoke all on function private.ignore_billing_provider_event(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.ignore_billing_provider_event(
  p_event_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.ignore_billing_provider_event(p_event_id, p_reason);
end;
$$;

comment on function public.ignore_billing_provider_event(uuid, text) is
  'WP-ASAAS-04: wrapper Edge. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.ignore_billing_provider_event(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ignore_billing_provider_event(uuid, text) to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260910181000',
  '20260910181000_wp_asaas_04_event_claiming.sql',
  'WP-ASAAS-04: ALTER billing_provider_events (+attempts/claimed_at/next_attempt_at; status '
  'CHECK -> received|processing|processed|ignored|failed). claim (FOR UPDATE SKIP LOCKED, clamp '
  '1..25, cap 8, stale 15min, backoff via next_attempt_at) + fail + ignore RPCs (service_role only).',
  'WP-ASAAS-04'
)
on conflict (version) do nothing;
