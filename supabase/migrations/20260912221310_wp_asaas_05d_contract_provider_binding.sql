-- =====================================================================================
-- WP-ASAAS-05D — contrato comercial → billing account → intenção de subscription Asaas.
--
-- VERTEXA = autoridade comercial (plan_version, offer, preço, moeda, ciclo).
-- ASAAS = autoridade financeira (customer, subscription, payment).
--
-- Reusa o ledger ASAAS-02/03: billing_accounts, billing_outbound_operations,
-- reserve/complete/fail. NÃO duplica HTTP client, secret lookup, nem idempotência.
-- NÃO chama Asaas. NÃO inventa billingType nem nextDueDate.
-- NÃO backfill. NÃO enforcement. NÃO claim Founder. NÃO RPC pública.
--
-- Elegibilidade de provisionamento: somente status='active'.
-- pending / ended / cancelled → rejeita. NÃO redefine 05C.
-- commercial active ≠ paid ≠ financially entitled.
-- =====================================================================================


-- ── Identidade fiscal mínima (fonte futura do customer Asaas) ─────────────────
-- clinics/profiles NÃO têm CPF/CNPJ/telefone. Não usar clinic.name como razão social.
-- Tabela vazia em produção. Fixture sintético só em teste local.

create table private.billing_customer_identities (
  clinic_id uuid primary key,
  legal_name text not null,
  tax_id text not null,
  email text not null,
  mobile_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_customer_identities_clinic_fkey
    foreign key (clinic_id) references public.clinics(id) on delete restrict,
  constraint billing_customer_identities_legal_name_check
    check (btrim(legal_name) <> ''),
  constraint billing_customer_identities_tax_id_check
    check (tax_id ~ '^[0-9]{11}$' or tax_id ~ '^[0-9]{14}$'),
  constraint billing_customer_identities_email_check
    check (btrim(email) <> '' and position('@' in email) > 1),
  constraint billing_customer_identities_phone_check
    check (mobile_phone is null or btrim(mobile_phone) <> '')
);

comment on table private.billing_customer_identities is
  'WP-ASAAS-05D: identidade fiscal/comercial mínima para customer Asaas. '
  'Não é claim Founder. Não é clínica clínica. Sem seed. Sem PII clínica/paciente.';

comment on column private.billing_customer_identities.tax_id is
  'CPF (11) ou CNPJ (14), somente dígitos. Sem dígito verificador nesta WP.';

comment on column private.billing_customer_identities.legal_name is
  'Razão social / nome legal. NÃO é public.clinics.name.';

alter table private.billing_customer_identities enable row level security;

revoke all on table private.billing_customer_identities
  from public, anon, authenticated, service_role;


-- ── Binding nullable: subscription → contrato (legado permanece NULL) ─────────

alter table private.billing_subscriptions
  add column commercial_contract_id uuid;

alter table private.billing_subscriptions
  add constraint billing_subscriptions_commercial_contract_fkey
    foreign key (commercial_contract_id)
    references private.billing_commercial_contracts(id)
    on delete restrict;

comment on column private.billing_subscriptions.commercial_contract_id is
  'WP-ASAAS-05D: contrato comercial que originou este fato de subscription. '
  'NULL = legado/sandbox pré-05D ou ainda não reconciliado. Sem backfill.';

-- 0 ou 1 primary por contrato. Replacement scopes futuros podem coexistir.
-- NÃO unique irrestrito: arquitetura 03 reserva replacement-*/migration-*.
create unique index billing_subscriptions_contract_primary_uidx
  on private.billing_subscriptions (commercial_contract_id)
  where commercial_contract_id is not null
    and subscription_scope = 'primary';

create index billing_subscriptions_commercial_contract_idx
  on private.billing_subscriptions (commercial_contract_id)
  where commercial_contract_id is not null;


alter table private.billing_outbound_operations
  add column commercial_contract_id uuid;

alter table private.billing_outbound_operations
  add constraint billing_outbound_operations_commercial_contract_fkey
    foreign key (commercial_contract_id)
    references private.billing_commercial_contracts(id)
    on delete restrict;

comment on column private.billing_outbound_operations.commercial_contract_id is
  'WP-ASAAS-05D: contrato que originou a intenção outbound. NULL no legado. Sem backfill.';

create index billing_outbound_operations_commercial_contract_idx
  on private.billing_outbound_operations (commercial_contract_id)
  where commercial_contract_id is not null;


-- ── Imutabilidade do bind (A→B proibido; NULL→contrato permitido) ─────────────

create or replace function private.billing_protect_commercial_contract_bind()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.commercial_contract_id is not null
     and new.commercial_contract_id is distinct from old.commercial_contract_id then
    raise exception 'BILLING_CONTRACT_REBIND_FORBIDDEN'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function private.billing_protect_commercial_contract_bind() is
  'WP-ASAAS-05D: após o bind, commercial_contract_id não troca de contrato. '
  'NULL→valor permitido na via confiável. SECURITY INVOKER.';

revoke all on function private.billing_protect_commercial_contract_bind()
  from public, anon, authenticated, service_role;

create trigger billing_subscriptions_protect_contract_bind
  before update on private.billing_subscriptions
  for each row
  execute function private.billing_protect_commercial_contract_bind();

create trigger billing_outbound_operations_protect_contract_bind
  before update on private.billing_outbound_operations
  for each row
  execute function private.billing_protect_commercial_contract_bind();


-- ── Conversão determinística centavos → decimal Asaas (numeric, sem float) ───

create or replace function private.billing_cents_to_asaas_amount(
  p_cents integer
)
returns numeric(12, 2)
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_cents is null or p_cents < 0 then
    raise exception 'BILLING_INVALID_CENTS'
      using errcode = '22023';
  end if;
  return (p_cents::numeric / 100.0);
end;
$$;

comment on function private.billing_cents_to_asaas_amount(integer) is
  'WP-ASAAS-05D: centavos inteiros → numeric(12,2). Sem float. '
  '39000 → 390.00. Autoridade do valor continua sendo o snapshot do contrato.';

revoke all on function private.billing_cents_to_asaas_amount(integer)
  from public, anon, authenticated, service_role;


-- ── Read model de provisionamento (fatos existentes; sem 2ª máquina de estado) ─

create or replace function private.billing_commercial_contract_provider_state(
  p_commercial_contract_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_status text;
  v_account_id uuid;
  v_customer_id text;
  v_identity_exists boolean := false;
  v_subscription_id uuid;
  v_customer_op_status text;
  v_customer_op_error text;
  v_subscription_op_status text;
  v_subscription_op_error text;
  v_state text;
begin
  if p_commercial_contract_id is null then
    raise exception 'BILLING_CONTRACT_REQUIRED'
      using errcode = '22023';
  end if;

  select clinic_id, status
    into v_clinic_id, v_status
    from private.billing_commercial_contracts
   where id = p_commercial_contract_id;

  if not found then
    raise exception 'BILLING_CONTRACT_UNKNOWN'
      using errcode = 'P0002';
  end if;

  select a.id, a.external_customer_id
    into v_account_id, v_customer_id
    from private.billing_accounts a
   where a.clinic_id = v_clinic_id;

  select exists(
    select 1
      from private.billing_customer_identities i
     where i.clinic_id = v_clinic_id
  ) into v_identity_exists;

  select s.id
    into v_subscription_id
    from private.billing_subscriptions s
   where s.commercial_contract_id = p_commercial_contract_id
   order by s.created_at desc
   limit 1;

  if v_account_id is not null then
    select o.status, o.last_error_category
      into v_customer_op_status, v_customer_op_error
      from private.billing_outbound_operations o
     where o.billing_account_id = v_account_id
       and o.operation_type = 'create_customer'
     order by o.created_at desc
     limit 1;

    select o.status, o.last_error_category
      into v_subscription_op_status, v_subscription_op_error
      from private.billing_outbound_operations o
     where o.commercial_contract_id = p_commercial_contract_id
       and o.operation_type = 'create_subscription'
     order by o.created_at desc
     limit 1;
  end if;

  if v_status is distinct from 'active' then
    v_state := 'ineligible';
  elsif v_subscription_id is not null then
    v_state := 'provisioned';
  elsif v_subscription_op_status = 'pending' then
    v_state := 'subscription_pending';
  elsif v_subscription_op_status = 'failed'
        and v_subscription_op_error is distinct from 'http_4xx'
        and v_subscription_op_error is distinct from 'rate_limited' then
    v_state := 'failed_retryable';
  elsif v_customer_id is not null then
    v_state := 'customer_ready';
  elsif v_customer_op_status = 'pending' then
    v_state := 'customer_pending';
  elsif v_customer_op_status = 'failed'
        and v_customer_op_error is distinct from 'http_4xx'
        and v_customer_op_error is distinct from 'rate_limited' then
    v_state := 'failed_retryable';
  elsif v_customer_id is null and not v_identity_exists then
    v_state := 'identity_incomplete';
  else
    v_state := 'not_provisioned';
  end if;

  return jsonb_build_object(
    'commercial_contract_id', p_commercial_contract_id,
    'clinic_id', v_clinic_id,
    'contract_status', v_status,
    'billing_account_id', v_account_id,
    'provider_customer_ready', (v_customer_id is not null),
    'identity_complete', v_identity_exists,
    'billing_subscription_id', v_subscription_id,
    'provider_subscription_ready', (v_subscription_id is not null),
    'provisioning_state', v_state
  );
end;
$$;

comment on function private.billing_commercial_contract_provider_state(uuid) is
  'WP-ASAAS-05D: estado derivado de contas/ops/subscriptions existentes. '
  'Sem IDs Asaas. Sem segredo. Sem RPC pública. SECURITY INVOKER.';

revoke all on function private.billing_commercial_contract_provider_state(uuid)
  from public, anon, authenticated, service_role;


-- ── Bind confiável: NULL→contrato, com consistência de preço ──────────────────

create or replace function private.billing_bind_subscription_to_contract(
  p_billing_subscription_id uuid,
  p_commercial_contract_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sub_contract uuid;
  v_sub_account uuid;
  v_sub_value integer;
  v_sub_cycle text;
  v_sub_clinic uuid;
  v_contract_clinic uuid;
  v_contract_price integer;
  v_contract_cycle text;
begin
  if p_billing_subscription_id is null or p_commercial_contract_id is null then
    raise exception 'BILLING_BIND_REQUIRED'
      using errcode = '22023';
  end if;

  select s.commercial_contract_id, s.billing_account_id, s.value_cents, s.billing_cycle, a.clinic_id
    into v_sub_contract, v_sub_account, v_sub_value, v_sub_cycle, v_sub_clinic
    from private.billing_subscriptions s
    join private.billing_accounts a on a.id = s.billing_account_id
   where s.id = p_billing_subscription_id;

  if not found then
    raise exception 'BILLING_SUBSCRIPTION_UNKNOWN'
      using errcode = 'P0002';
  end if;

  select clinic_id, contracted_price_cents, billing_cycle
    into v_contract_clinic, v_contract_price, v_contract_cycle
    from private.billing_commercial_contracts
   where id = p_commercial_contract_id;

  if not found then
    raise exception 'BILLING_CONTRACT_UNKNOWN'
      using errcode = 'P0002';
  end if;

  if v_sub_contract is not null then
    if v_sub_contract = p_commercial_contract_id then
      return jsonb_build_object(
        'outcome', 'already_bound',
        'billing_subscription_id', p_billing_subscription_id,
        'commercial_contract_id', p_commercial_contract_id
      );
    end if;
    raise exception 'BILLING_CONTRACT_REBIND_FORBIDDEN'
      using errcode = '22023';
  end if;

  if v_sub_clinic is distinct from v_contract_clinic then
    raise exception 'BILLING_BIND_CLINIC_MISMATCH'
      using errcode = '22023';
  end if;

  if v_sub_value is distinct from v_contract_price then
    raise exception 'BILLING_PRICE_MISMATCH'
      using errcode = '22023';
  end if;

  if v_contract_cycle is distinct from 'monthly'
     or v_sub_cycle is distinct from 'MONTHLY' then
    raise exception 'BILLING_CYCLE_MISMATCH'
      using errcode = '22023';
  end if;

  update private.billing_subscriptions
     set commercial_contract_id = p_commercial_contract_id,
         updated_at = clock_timestamp()
   where id = p_billing_subscription_id;

  return jsonb_build_object(
    'outcome', 'bound',
    'billing_subscription_id', p_billing_subscription_id,
    'commercial_contract_id', p_commercial_contract_id
  );
end;
$$;

comment on function private.billing_bind_subscription_to_contract(uuid, uuid) is
  'WP-ASAAS-05D: liga subscription existente a um contrato. '
  'NULL→contrato somente. Rebind A→B proibido. Preço/ciclo devem bater. '
  'Não reescreve legado. SECURITY INVOKER. Sem RPC pública.';

revoke all on function private.billing_bind_subscription_to_contract(uuid, uuid)
  from public, anon, authenticated, service_role;


-- ── Preparação server-side: contrato é a autoridade; sem HTTP ─────────────────

create or replace function private.billing_prepare_contract_provider_provisioning(
  p_commercial_contract_id uuid,
  p_environment text,
  p_billing_type text,
  p_next_due_date date
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_environment text := btrim(coalesce(p_environment, ''));
  v_billing_type text := nullif(btrim(coalesce(p_billing_type, '')), '');
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
  v_identity_exists boolean := false;
  v_asaas_amount numeric(12, 2);
  v_customer_key text;
  v_customer_ref text;
  v_subscription_key text;
  v_subscription_ref text;
  v_customer_reserve jsonb;
  v_subscription_reserve jsonb;
  v_blocked text;
  v_state jsonb;
begin
  if p_commercial_contract_id is null then
    raise exception 'BILLING_CONTRACT_REQUIRED'
      using errcode = '22023';
  end if;

  if v_environment not in ('sandbox', 'production') then
    raise exception 'BILLING_INVALID_ENVIRONMENT'
      using errcode = '22023';
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
      using errcode = 'P0002';
  end if;

  -- Somente active. pending não tem checkout. ended/cancelled não reprovisionam.
  if v_status is distinct from 'active' then
    raise exception 'BILLING_CONTRACT_INELIGIBLE'
      using errcode = '22023';
  end if;

  if v_price is null or v_price < 0 or v_currency is distinct from 'BRL' or v_cycle is distinct from 'monthly' then
    raise exception 'BILLING_CONTRACT_SNAPSHOT_INVALID'
      using errcode = '22023';
  end if;

  if v_billing_type is not null
     and v_billing_type not in ('BOLETO', 'CREDIT_CARD', 'PIX', 'UNDEFINED') then
    raise exception 'BILLING_INVALID_BILLING_TYPE'
      using errcode = '22023';
  end if;

  select c.owner_profile_id into v_owner
    from public.clinics c
   where c.id = v_clinic_id;

  if v_owner is null then
    raise exception 'BILLING_CLINIC_UNKNOWN'
      using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(90500, pg_catalog.hashtext(v_clinic_id::text));

  select a.id, a.environment, a.external_customer_id
    into v_account_id, v_account_env, v_external_customer_id
    from private.billing_accounts a
   where a.clinic_id = v_clinic_id;

  if found then
    if v_account_env is distinct from v_environment then
      raise exception 'BILLING_ENVIRONMENT_MISMATCH'
        using errcode = '42501';
    end if;
  end if;

  select exists(
    select 1
      from private.billing_customer_identities i
     where i.clinic_id = v_clinic_id
  ) into v_identity_exists;

  -- Sem customer no provedor e sem identidade fiscal: falha ANTES de qualquer outbound.
  if v_external_customer_id is null and not v_identity_exists then
    raise exception 'BILLING_CUSTOMER_IDENTITY_INCOMPLETE'
      using errcode = '22023';
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
  v_customer_key := v_account_id::text || ':create_customer';
  v_customer_ref := 'vtx:' || v_environment || ':' || v_account_id::text || ':customer';
  v_subscription_key :=
    v_account_id::text || ':create_subscription:primary:' || p_commercial_contract_id::text;
  v_subscription_ref :=
    'vtx:' || v_environment || ':' || v_account_id::text
    || ':subscription:primary:' || p_commercial_contract_id::text;

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
  end if;

  if v_external_customer_id is not null and (v_billing_type is null or p_next_due_date is null) then
    if v_billing_type is null then
      v_blocked := 'SUBSCRIPTION_BILLING_TYPE_POLICY_REQUIRED';
    else
      v_blocked := 'SUBSCRIPTION_DUE_DATE_POLICY_REQUIRED';
    end if;
  elsif v_external_customer_id is not null then
    v_subscription_reserve := private.reserve_billing_outbound_operation(
      v_account_id,
      'asaas',
      v_environment,
      'create_subscription',
      v_subscription_key,
      v_subscription_ref
    );
    update private.billing_outbound_operations
       set commercial_contract_id = p_commercial_contract_id,
           updated_at = clock_timestamp()
     where id = (v_subscription_reserve->>'operation_id')::uuid
       and commercial_contract_id is null;
  end if;

  v_state := private.billing_commercial_contract_provider_state(p_commercial_contract_id);

  return jsonb_build_object(
    'outcome', case when v_blocked is null then 'prepared' else 'blocked' end,
    'blocked_reason', v_blocked,
    'commercial_contract_id', p_commercial_contract_id,
    'clinic_id', v_clinic_id,
    'plan_version_id', v_plan_version_id,
    'commercial_offer_id', v_offer_id,
    'contracted_price_cents', v_price,
    'contracted_currency', v_currency,
    'billing_cycle', v_cycle,
    'asaas_cycle', 'MONTHLY',
    'asaas_amount', v_asaas_amount,
    'intended_billing_type', v_billing_type,
    'intended_next_due_date', p_next_due_date,
    'billing_account_id', v_account_id,
    'billing_account_created', v_account_created,
    'provider_customer_ready', (v_external_customer_id is not null),
    'identity_complete', v_identity_exists,
    'customer_idempotency_key', v_customer_key,
    'customer_external_reference', v_customer_ref,
    'subscription_idempotency_key', v_subscription_key,
    'subscription_external_reference', v_subscription_ref,
    'customer_operation', v_customer_reserve,
    'subscription_operation', v_subscription_reserve,
    'provisioning_state', v_state->>'provisioning_state'
  );
end;
$$;

comment on function private.billing_prepare_contract_provider_provisioning(uuid, text, text, date) is
  'WP-ASAAS-05D: deriva conta/customer/subscription intent a partir do contrato. '
  'Preço só do snapshot. Sem preço do caller. Sem HTTP Asaas. '
  'billing_type e next_due_date são inputs operacionais — sem default de produto. '
  'SECURITY INVOKER. Sem RPC pública.';

revoke all on function private.billing_prepare_contract_provider_provisioning(uuid, text, text, date)
  from public, anon, authenticated, service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260912221310',
  '20260912221310_wp_asaas_05d_contract_provider_binding.sql',
  'WP-ASAAS-05D: binding contrato→subscription/outbound + identidade fiscal mínima '
  '+ prepare/state/bind privados. Sem backfill, sem Asaas HTTP, sem enforcement, '
  'sem claim Founder, sem RPC pública.',
  'WP-ASAAS-05D'
)
on conflict (version) do nothing;
