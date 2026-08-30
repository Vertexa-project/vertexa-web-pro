-- =====================================================================================
-- WP-ASAAS-02 — fundação de billing (Asaas), schema privado.
--
-- NÃO chama API Asaas. NÃO cria customer/subscription/charge.
-- NÃO cria grant source=asaas. NÃO altera SEC-02 nem acesso de produto.
-- NÃO backfill das clínicas existentes.
--
-- Superfície:
--   private.billing_accounts
--   private.billing_provider_events      (ledger inbound, idempotente)
--   private.billing_outbound_operations  (prepara ASAAS-03; sem HTTP)
--   private.ingest_billing_provider_event
--   public.ingest_billing_provider_event (wrapper; EXECUTE só service_role)
-- =====================================================================================

create table private.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null,
  clinic_id uuid,
  provider text not null,
  environment text not null,
  external_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_accounts_owner_profile_id_fkey
    foreign key (owner_profile_id) references public.profiles(id) on delete restrict,
  constraint billing_accounts_clinic_id_fkey
    foreign key (clinic_id) references public.clinics(id) on delete set null,
  constraint billing_accounts_provider_check
    check (provider = 'asaas'),
  constraint billing_accounts_environment_check
    check (environment in ('sandbox', 'production'))
);

comment on table private.billing_accounts is
  'WP-ASAAS-02: conta comercial Vertexa. Identidade própria (id). '
  'owner_profile_id NÃO é UNIQUE — 1 owner pode ter N clínicas no futuro. '
  'clinic_id NULL até o onboarding. Sem status comercial nesta WP.';

comment on column private.billing_accounts.owner_profile_id is
  'Profile do pagador/futuro owner. NÃO unique permanente.';

comment on column private.billing_accounts.clinic_id is
  'NULL antes de create_clinic_with_owner. Unique só quando NOT NULL.';

comment on column private.billing_accounts.external_customer_id is
  'ID do customer no provedor. Unique com (provider, environment) quando NOT NULL.';

comment on column private.billing_accounts.environment is
  'sandbox | production. Nunca misturar IDs externos entre ambientes.';

create unique index billing_accounts_external_customer_uidx
  on private.billing_accounts (provider, environment, external_customer_id)
  where external_customer_id is not null;

create unique index billing_accounts_clinic_uidx
  on private.billing_accounts (clinic_id)
  where clinic_id is not null;

create index billing_accounts_owner_idx
  on private.billing_accounts (owner_profile_id);


create table private.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null,
  external_event_id text not null,
  event_type text not null,
  event_created_at timestamptz,
  external_resource_type text,
  external_resource_id text,
  payload_hash text not null,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  processing_status text not null,
  last_error_category text,
  constraint billing_provider_events_provider_check
    check (provider = 'asaas'),
  constraint billing_provider_events_environment_check
    check (environment in ('sandbox', 'production')),
  constraint billing_provider_events_status_check
    check (processing_status in ('received', 'processed', 'failed')),
  constraint billing_provider_events_hash_check
    check (char_length(payload_hash) >= 32),
  constraint billing_provider_events_event_id_check
    check (btrim(external_event_id) <> ''),
  constraint billing_provider_events_event_type_check
    check (btrim(event_type) <> '')
);

comment on table private.billing_provider_events is
  'WP-ASAAS-02: ledger inbound de webhooks. Sem payload JSONB bruto. '
  'processing_status é técnico (received/processed/failed), NÃO comercial. '
  'ASAAS-04 processa; esta WP só persiste.';

comment on column private.billing_provider_events.external_event_id is
  'Asaas body.id. Chave oficial de idempotência. UNIQUE com (provider, environment). At-least-once.';

comment on column private.billing_provider_events.payload_hash is
  'SHA-256 hex do body bruto. Controle de integridade/auditoria. NÃO substitui external_event_id. '
  'Mesmo id + hash diferente = last_error_category=payload_hash_mismatch; row original intacta.';

comment on column private.billing_provider_events.processing_status is
  'received | processed | failed. Sem active/past_due/suspended.';

create unique index billing_provider_events_idempotency_uidx
  on private.billing_provider_events (provider, environment, external_event_id);


create table private.billing_outbound_operations (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid,
  provider text not null,
  environment text not null,
  operation_type text not null,
  idempotency_key text not null,
  status text not null,
  external_object_id text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error_category text,
  constraint billing_outbound_operations_billing_account_id_fkey
    foreign key (billing_account_id) references private.billing_accounts(id) on delete set null,
  constraint billing_outbound_operations_provider_check
    check (provider = 'asaas'),
  constraint billing_outbound_operations_environment_check
    check (environment in ('sandbox', 'production')),
  constraint billing_outbound_operations_status_check
    check (status in ('pending', 'completed', 'failed')),
  constraint billing_outbound_operations_type_check
    check (operation_type in ('create_customer', 'create_subscription', 'create_charge')),
  constraint billing_outbound_operations_key_check
    check (btrim(idempotency_key) <> ''),
  constraint billing_outbound_operations_attempts_check
    check (attempt_count >= 0)
);

comment on table private.billing_outbound_operations is
  'WP-ASAAS-02: ledger outbound. Impede double customer/subscription/charge no ASAAS-03. '
  'Sem HTTP nesta WP. Unique (provider, environment, operation_type, idempotency_key).';

comment on column private.billing_outbound_operations.idempotency_key is
  'Chave lógica Vertexa (ex.: billing_account_id + operação). Não vem do frontend.';

create unique index billing_outbound_operations_idempotency_uidx
  on private.billing_outbound_operations (provider, environment, operation_type, idempotency_key);


alter table private.billing_accounts enable row level security;
alter table private.billing_provider_events enable row level security;
alter table private.billing_outbound_operations enable row level security;

revoke all on table private.billing_accounts from public, anon, authenticated, service_role;
revoke all on table private.billing_provider_events from public, anon, authenticated, service_role;
revoke all on table private.billing_outbound_operations from public, anon, authenticated, service_role;


-- ── Ingest idempotente (DEFINER). Sem processamento financeiro. ─────────────

create or replace function private.ingest_billing_provider_event(
  p_provider text,
  p_environment text,
  p_external_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_external_resource_type text,
  p_external_resource_id text,
  p_payload_hash text
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

      -- ACK de transporte (conflict). Não sobrescreve o original.
      -- processing_status permanece received: o payload original ainda é a verdade
      -- a processar; last_error_category marca integridade fail-closed para ASAAS-04.
      -- Reentrega do mesmo conflito só regrava a mesma categoria (sem crescimento).
      update private.billing_provider_events
         set last_error_category = 'payload_hash_mismatch'
       where id = v_id;

      return jsonb_build_object('outcome', 'conflict', 'id', v_id);
  end;
end;
$$;

comment on function private.ingest_billing_provider_event(text, text, text, text, timestamptz, text, text, text) is
  'WP-ASAAS-02: persiste webhook Asaas. inserted | duplicate | conflict. '
  'external_event_id (body.id) = chave oficial de idempotência. payload_hash = integridade. '
  'conflict = mesmo id + hash diferente: last_error_category=payload_hash_mismatch; '
  'original intacto; processing_status inalterado. EXECUTE só via wrapper service_role.';

revoke all on function private.ingest_billing_provider_event(text, text, text, text, timestamptz, text, text, text)
  from public, anon, authenticated, service_role;


create or replace function public.ingest_billing_provider_event(
  p_provider text,
  p_environment text,
  p_external_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_external_resource_type text,
  p_external_resource_id text,
  p_payload_hash text
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
    p_payload_hash
  );
end;
$$;

comment on function public.ingest_billing_provider_event(text, text, text, text, timestamptz, text, text, text) is
  'WP-ASAAS-02: wrapper PostgREST/Edge. EXECUTE só service_role. '
  'authenticated/anon = false. Sem processamento financeiro.';

revoke all on function public.ingest_billing_provider_event(text, text, text, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_billing_provider_event(text, text, text, text, timestamptz, text, text, text)
  to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260830090000',
  '20260830090000_wp_asaas_02_billing_foundation.sql',
  'WP-ASAAS-02: billing_accounts + provider events + outbound operations (private, '
  'RLS ON, 0 policies). Ingest webhook idempotente. Sem Asaas HTTP, sem grant, sem backfill.',
  'WP-ASAAS-02'
)
on conflict (version) do nothing;
