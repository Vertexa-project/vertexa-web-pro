-- =====================================================================================
-- WP-ASAAS-03 — outbound Asaas: customer + subscription (Sandbox homologação).
--
-- NÃO edita 20260830090000. Forward migration só.
-- Sem HTTP aqui (isso é Edge Function). Sem estado comercial/entitlement.
--
-- Superfície:
--   private.billing_subscriptions               (nova tabela)
--   private.billing_outbound_operations          (ALTER pontual: + external_reference)
--   public.get_or_create_billing_account         (authenticated; auth.uid() -> conta própria)
--   private.reserve_billing_outbound_operation    + public wrapper (service_role only)
--   private.complete_billing_customer_operation   + public wrapper (service_role only)
--   private.complete_billing_subscription_operation + public wrapper (service_role only)
--   private.fail_billing_outbound_operation       + public wrapper (service_role only)
--
-- value_cents usa CHECK > 0 (regra neutra de schema). R$10,00 é só a fixture Sandbox do
-- ASAAS-03 (decidida na Edge Function, nunca no banco) — nunca um piso comercial.
--
-- subscription_scope existe para nunca precisar editar esta migration quando uma
-- reassinatura futura (troca de plano, substituição) precisar de uma segunda linha para
-- a mesma billing_account: nesta WP só 'primary' é usado; 'replacement-...'/'migration-...'
-- ficam livres para o ASAAS-04+.
--
-- get_or_create_billing_account resolve a corrida de criação concorrente da MESMA conta
-- AGORA (pg_advisory_xact_lock, namespace 90300 — dedicado, não colide com o 90202 do
-- SEC-02), e trata os 5 casos: (A) pré-onboarding clinic_id null, (B) já ligada à clínica
-- pedida, (C) reentrada concorrente, (D) liga agora uma conta pré-onboarding existente à
-- clínica, (E) clínica já ligada a OUTRA conta -> fail closed.
-- =====================================================================================

create table private.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null
    references private.billing_accounts(id) on delete restrict,
  provider text not null check (provider = 'asaas'),
  environment text not null check (environment in ('sandbox', 'production')),
  external_subscription_id text not null,
  external_reference text not null,
  subscription_scope text not null check (btrim(subscription_scope) <> ''),
  billing_type text not null
    check (billing_type in ('BOLETO', 'CREDIT_CARD', 'PIX', 'UNDEFINED')),
  billing_cycle text not null
    check (billing_cycle in (
      'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY'
    )),
  value_cents integer not null check (value_cents > 0),
  next_due_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.billing_subscriptions is
  'WP-ASAAS-03: subscription confirmada no Asaas. Só inserida no momento da conclusão da '
  'outbound operation (nunca linha "pendente" aqui — billing_outbound_operations já é o '
  'ledger de pendência). Sem status comercial/entitlement: prova só existência técnica.';

comment on column private.billing_subscriptions.value_cents is
  'CHECK > 0: regra neutra de schema. Nunca um piso comercial — a fixture Sandbox '
  '(R$10,00 no ASAAS-03) vive na Edge Function, não aqui.';

comment on column private.billing_subscriptions.subscription_scope is
  'primary (ASAAS-03) | reservado para reassinatura futura (replacement-*, migration-*). '
  'Existe para nunca precisar editar esta migration quando uma 2a subscription legítima '
  'para a mesma billing_account aparecer.';

create unique index billing_subscriptions_external_subscription_uidx
  on private.billing_subscriptions (provider, environment, external_subscription_id);

create unique index billing_subscriptions_external_reference_uidx
  on private.billing_subscriptions (provider, environment, external_reference);

-- Unicidade estrutural por scope — nunca UNIQUE(billing_account_id) isolado (bloquearia
-- reassinatura futura sem editar esta migration).
create unique index billing_subscriptions_account_scope_uidx
  on private.billing_subscriptions (provider, environment, billing_account_id, subscription_scope);

create index billing_subscriptions_billing_account_idx
  on private.billing_subscriptions (billing_account_id);

alter table private.billing_subscriptions enable row level security;

revoke all on table private.billing_subscriptions
  from public, anon, authenticated, service_role;


-- ── ALTER pontual sobre a fundação ASAAS-02 (nunca editar 20260830090000) ────────────
--
-- external_reference é o valor EXATO enviado ao Asaas no momento da reserva. Persistir
-- (em vez de recalcular sob demanda) torna auditável o que foi de fato enviado, mesmo se
-- a fórmula de derivação mudar depois — sem isso, uma operação em voo poderia passar a
-- ser reconciliada com a chave ERRADA sem qualquer sinal de erro.

alter table private.billing_outbound_operations
  add column external_reference text;

comment on column private.billing_outbound_operations.external_reference is
  'WP-ASAAS-03: valor EXATO enviado como externalReference ao Asaas nesta operação. '
  'Lido de volta na reconciliação — nunca recalculado. customer e subscription:<scope> '
  'usam referências diferentes mesmo para a mesma billing_account.';

create unique index billing_outbound_operations_external_reference_uidx
  on private.billing_outbound_operations (provider, environment, external_reference)
  where external_reference is not null;


-- ── Identidade: authenticated resolve a PRÓPRIA billing account (Padrão B) ───────────

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
  v_linked_id uuid;
  v_linked_owner uuid;
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

  -- Não distingue "não existe" de "existe mas não é sua": nao vaza para o caller se um
  -- clinic_id arbitrário é real ou não.
  if p_clinic_id is not null and not exists (
    select 1 from public.clinics c
     where c.id = p_clinic_id and c.owner_profile_id = v_me
  ) then
    raise exception 'get_or_create_billing_account: clinic not owned by caller'
      using errcode = '42501', hint = 'CLINIC_NOT_OWNED';
  end if;

  -- Caso C (reentrada concorrente): serializa por profile. Namespace 90300 dedicado ao
  -- ASAAS-03 (SEC-02 já usa 90202 para create_clinic_with_owner — nunca reusar).
  perform pg_catalog.pg_advisory_xact_lock(90300, pg_catalog.hashtext(v_me::text));

  if p_clinic_id is not null then
    select a.id, a.owner_profile_id, a.external_customer_id, a.clinic_id
      into v_linked_id, v_linked_owner, v_external_customer_id, v_clinic_id
      from private.billing_accounts a
     where a.clinic_id = p_clinic_id;

    if found and v_linked_owner is distinct from v_me then
      -- Caso E: clínica já ligada a outra billing account.
      raise exception 'get_or_create_billing_account: clinic already linked to another billing account'
        using errcode = '42501', hint = 'CLINIC_ALREADY_LINKED_TO_OTHER_ACCOUNT';
    end if;

    if found then
      -- Caso B: já é a própria conta desta clínica.
      v_id := v_linked_id;
    else
      -- Caso D: existe conta pré-onboarding (clinic_id null) do mesmo owner? Liga agora.
      select id, external_customer_id
        into v_id, v_external_customer_id
        from private.billing_accounts
       where owner_profile_id = v_me
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
        -- Caso A-novo: nenhuma conta ainda. Cria já ligada à clínica pedida.
        begin
          insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
          values (v_me, p_clinic_id, v_provider, v_environment)
          returning id, external_customer_id, clinic_id
            into v_id, v_external_customer_id, v_clinic_id;
          v_created := true;
        exception
          when unique_violation then
            raise exception 'get_or_create_billing_account: clinic already linked to another billing account'
              using errcode = '42501', hint = 'CLINIC_ALREADY_LINKED_TO_OTHER_ACCOUNT';
        end;
      end if;
    end if;
  else
    -- Sem clínica ainda. Prefere conta já ligada a alguma clínica (mais completa);
    -- senão reusa a pré-onboarding; senão cria nova pré-onboarding (Caso A).
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
  'WP-ASAAS-03: resolve/cria a billing_account do PRÓPRIO caller (auth.uid() -> '
  'current_profile_id()). Nunca recebe owner_profile_id do cliente. clinic_id opcional: '
  'exige ownership real (public.clinics.owner_profile_id = caller); clínica já ligada a '
  'OUTRA conta -> 42501 CLINIC_ALREADY_LINKED_TO_OTHER_ACCOUNT (fail-closed). Concorrência '
  'do mesmo profile serializada via pg_advisory_xact_lock(90300, hashtext(profile_id)). '
  'Nunca toca Asaas nem billing_outbound_operations — só identidade.';

-- Nota: este schema tem ALTER DEFAULT PRIVILEGES concedendo EXECUTE em novas funções de
-- public a anon/authenticated/service_role automaticamente na criação. Por isso o revoke
-- abaixo lista os 3 papéis explicitamente (não basta "from public, anon" — service_role
-- herdaria o grant padrão e ficaria com acesso não pretendido a uma RPC authenticated-only).
revoke all on function public.get_or_create_billing_account(text, text, uuid) from public, anon, service_role;
grant execute on function public.get_or_create_billing_account(text, text, uuid) to authenticated;


-- ── Outbound ledger: reservar / completar / falhar (Padrão A, service_role only) ─────

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
begin
  if v_provider is distinct from 'asaas' then
    raise exception 'reserve_billing_outbound_operation: invalid provider'
      using errcode = '22023', hint = 'INVALID_PROVIDER';
  end if;
  if v_environment not in ('sandbox', 'production') then
    raise exception 'reserve_billing_outbound_operation: invalid environment'
      using errcode = '22023', hint = 'INVALID_ENVIRONMENT';
  end if;
  if v_operation_type not in ('create_customer', 'create_subscription', 'create_charge') then
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

  if v_operation_type = 'create_subscription' and v_account_external_customer_id is null then
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
      select id, status, external_object_id, attempt_count
        into v_id, v_status, v_external_object_id, v_attempt_count
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

        return jsonb_build_object('outcome', 'in_flight_retry', 'operation_id', v_id, 'attempt_count', v_attempt_count);
      else
        update private.billing_outbound_operations
           set status = 'pending',
               attempt_count = attempt_count + 1,
               last_error_category = null,
               updated_at = clock_timestamp()
         where id = v_id
        returning attempt_count into v_attempt_count;

        return jsonb_build_object('outcome', 'claimed_for_retry', 'operation_id', v_id, 'attempt_count', v_attempt_count);
      end if;
  end;
end;
$$;

comment on function private.reserve_billing_outbound_operation(uuid, text, text, text, text, text) is
  'WP-ASAAS-03: reserva atômica pré-HTTP. unique_violation -> lê a linha existente FOR '
  'UPDATE e ramifica: completed (zero retry) | pending -> in_flight_retry | failed -> '
  'claimed_for_retry (reclama sob o mesmo lock de linha — sem essa lock a corrida de dois '
  'retries do mesmo failed poderia ambos se considerarem donos). create_subscription exige '
  'billing_accounts.external_customer_id já preenchido (CUSTOMER_NOT_PROVISIONED se não).';

revoke all on function private.reserve_billing_outbound_operation(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;


create or replace function public.reserve_billing_outbound_operation(
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
begin
  return private.reserve_billing_outbound_operation(
    p_billing_account_id, p_provider, p_environment, p_operation_type,
    p_idempotency_key, p_external_reference
  );
end;
$$;

comment on function public.reserve_billing_outbound_operation(uuid, text, text, text, text, text) is
  'WP-ASAAS-03: wrapper Edge Function. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.reserve_billing_outbound_operation(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_billing_outbound_operation(uuid, text, text, text, text, text)
  to service_role;


create or replace function private.complete_billing_customer_operation(
  p_operation_id uuid,
  p_external_customer_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_billing_account_id uuid;
  v_operation_type text;
  v_status text;
  v_existing_external_object_id text;
  v_external_customer_id text := btrim(coalesce(p_external_customer_id, ''));
begin
  if v_external_customer_id = '' then
    raise exception 'complete_billing_customer_operation: external id required'
      using errcode = '22023', hint = 'EXTERNAL_ID_REQUIRED';
  end if;

  select billing_account_id, operation_type, status, external_object_id
    into v_billing_account_id, v_operation_type, v_status, v_existing_external_object_id
    from private.billing_outbound_operations
   where id = p_operation_id
   for update;

  if not found then
    raise exception 'complete_billing_customer_operation: operation not found'
      using errcode = '22023', hint = 'OPERATION_NOT_FOUND';
  end if;

  if v_operation_type is distinct from 'create_customer' then
    raise exception 'complete_billing_customer_operation: operation type mismatch'
      using errcode = '22023', hint = 'OPERATION_TYPE_MISMATCH';
  end if;

  if v_status = 'completed' then
    if v_existing_external_object_id is distinct from v_external_customer_id then
      return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id);
    end if;
    return jsonb_build_object(
      'outcome', 'already_completed',
      'billing_account_id', v_billing_account_id,
      'external_customer_id', v_existing_external_object_id
    );
  end if;

  begin
    update private.billing_accounts
       set external_customer_id = v_external_customer_id, updated_at = clock_timestamp()
     where id = v_billing_account_id;
  exception
    when unique_violation then
      update private.billing_outbound_operations
         set status = 'failed', last_error_category = 'external_id_conflict', updated_at = clock_timestamp()
       where id = p_operation_id;
      return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id);
  end;

  update private.billing_outbound_operations
     set status = 'completed',
         external_object_id = v_external_customer_id,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_operation_id;

  return jsonb_build_object(
    'outcome', 'completed',
    'billing_account_id', v_billing_account_id,
    'external_customer_id', v_external_customer_id
  );
end;
$$;

comment on function private.complete_billing_customer_operation(uuid, text) is
  'WP-ASAAS-03: conclui create_customer atomicamente (operation + billing_accounts.'
  'external_customer_id juntos). Idempotente (completed repetido com mesmo id = no-op). '
  'external_customer_id divergente de outra conta -> failed/external_id_conflict, nunca '
  'sobrescreve silenciosamente.';

revoke all on function private.complete_billing_customer_operation(uuid, text)
  from public, anon, authenticated, service_role;


create or replace function public.complete_billing_customer_operation(
  p_operation_id uuid,
  p_external_customer_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.complete_billing_customer_operation(p_operation_id, p_external_customer_id);
end;
$$;

comment on function public.complete_billing_customer_operation(uuid, text) is
  'WP-ASAAS-03: wrapper Edge Function. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.complete_billing_customer_operation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_billing_customer_operation(uuid, text) to service_role;


create or replace function private.complete_billing_subscription_operation(
  p_operation_id uuid,
  p_external_subscription_id text,
  p_subscription_scope text,
  p_billing_type text,
  p_billing_cycle text,
  p_value_cents integer,
  p_next_due_date date,
  p_external_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_billing_account_id uuid;
  v_operation_type text;
  v_status text;
  v_existing_external_object_id text;
  v_provider text;
  v_environment text;
  v_external_subscription_id text := btrim(coalesce(p_external_subscription_id, ''));
  v_subscription_scope text := btrim(coalesce(p_subscription_scope, ''));
  v_external_reference text := btrim(coalesce(p_external_reference, ''));
  v_subscription_id uuid;
begin
  if v_external_subscription_id = '' or v_subscription_scope = '' or v_external_reference = '' then
    raise exception 'complete_billing_subscription_operation: fields required'
      using errcode = '22023', hint = 'FIELDS_REQUIRED';
  end if;
  if p_billing_type not in ('BOLETO', 'CREDIT_CARD', 'PIX', 'UNDEFINED') then
    raise exception 'complete_billing_subscription_operation: invalid billing_type'
      using errcode = '22023', hint = 'INVALID_BILLING_TYPE';
  end if;
  if p_billing_cycle not in (
    'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY'
  ) then
    raise exception 'complete_billing_subscription_operation: invalid billing_cycle'
      using errcode = '22023', hint = 'INVALID_BILLING_CYCLE';
  end if;
  if p_value_cents is null or p_value_cents <= 0 then
    raise exception 'complete_billing_subscription_operation: invalid value'
      using errcode = '22023', hint = 'INVALID_VALUE';
  end if;
  if p_next_due_date is null then
    raise exception 'complete_billing_subscription_operation: next_due_date required'
      using errcode = '22023', hint = 'NEXT_DUE_DATE_REQUIRED';
  end if;

  select billing_account_id, provider, environment, operation_type, status, external_object_id
    into v_billing_account_id, v_provider, v_environment, v_operation_type, v_status, v_existing_external_object_id
    from private.billing_outbound_operations
   where id = p_operation_id
   for update;

  if not found then
    raise exception 'complete_billing_subscription_operation: operation not found'
      using errcode = '22023', hint = 'OPERATION_NOT_FOUND';
  end if;

  if v_operation_type is distinct from 'create_subscription' then
    raise exception 'complete_billing_subscription_operation: operation type mismatch'
      using errcode = '22023', hint = 'OPERATION_TYPE_MISMATCH';
  end if;

  if v_status = 'completed' then
    if v_existing_external_object_id is distinct from v_external_subscription_id then
      return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id);
    end if;
    select id into v_subscription_id
      from private.billing_subscriptions
     where provider = v_provider
       and environment = v_environment
       and external_subscription_id = v_external_subscription_id;
    return jsonb_build_object(
      'outcome', 'already_completed',
      'billing_subscription_id', v_subscription_id,
      'external_subscription_id', v_external_subscription_id
    );
  end if;

  begin
    insert into private.billing_subscriptions (
      billing_account_id, provider, environment, external_subscription_id,
      external_reference, subscription_scope, billing_type, billing_cycle,
      value_cents, next_due_date
    ) values (
      v_billing_account_id, v_provider, v_environment, v_external_subscription_id,
      v_external_reference, v_subscription_scope, p_billing_type, p_billing_cycle,
      p_value_cents, p_next_due_date
    )
    returning id into v_subscription_id;
  exception
    when unique_violation then
      update private.billing_outbound_operations
         set status = 'failed', last_error_category = 'external_id_conflict', updated_at = clock_timestamp()
       where id = p_operation_id;
      return jsonb_build_object('outcome', 'conflict', 'operation_id', p_operation_id);
  end;

  update private.billing_outbound_operations
     set status = 'completed',
         external_object_id = v_external_subscription_id,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_operation_id;

  return jsonb_build_object(
    'outcome', 'completed',
    'billing_subscription_id', v_subscription_id,
    'external_subscription_id', v_external_subscription_id
  );
end;
$$;

comment on function private.complete_billing_subscription_operation(
  uuid, text, text, text, text, integer, date, text
) is
  'WP-ASAAS-03: conclui create_subscription atomicamente (operation + insert em '
  'billing_subscriptions juntos, com subscription_scope). Idempotente. '
  'external_subscription_id divergente -> failed/external_id_conflict.';

revoke all on function private.complete_billing_subscription_operation(
  uuid, text, text, text, text, integer, date, text
) from public, anon, authenticated, service_role;


create or replace function public.complete_billing_subscription_operation(
  p_operation_id uuid,
  p_external_subscription_id text,
  p_subscription_scope text,
  p_billing_type text,
  p_billing_cycle text,
  p_value_cents integer,
  p_next_due_date date,
  p_external_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.complete_billing_subscription_operation(
    p_operation_id, p_external_subscription_id, p_subscription_scope, p_billing_type,
    p_billing_cycle, p_value_cents, p_next_due_date, p_external_reference
  );
end;
$$;

comment on function public.complete_billing_subscription_operation(
  uuid, text, text, text, text, integer, date, text
) is 'WP-ASAAS-03: wrapper Edge Function. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.complete_billing_subscription_operation(
  uuid, text, text, text, text, integer, date, text
) from public, anon, authenticated;
grant execute on function public.complete_billing_subscription_operation(
  uuid, text, text, text, text, integer, date, text
) to service_role;


create or replace function private.fail_billing_outbound_operation(
  p_operation_id uuid,
  p_error_category text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_category text := btrim(coalesce(p_error_category, ''));
begin
  if v_category = '' then
    raise exception 'fail_billing_outbound_operation: error category required'
      using errcode = '22023', hint = 'ERROR_CATEGORY_REQUIRED';
  end if;

  select status into v_status
    from private.billing_outbound_operations
   where id = p_operation_id
   for update;

  if not found then
    raise exception 'fail_billing_outbound_operation: operation not found'
      using errcode = '22023', hint = 'OPERATION_NOT_FOUND';
  end if;

  if v_status = 'completed' then
    raise exception 'fail_billing_outbound_operation: cannot fail a completed operation'
      using errcode = '42501', hint = 'CANNOT_FAIL_COMPLETED_OPERATION';
  end if;

  update private.billing_outbound_operations
     set status = 'failed', last_error_category = v_category, updated_at = clock_timestamp()
   where id = p_operation_id;

  return jsonb_build_object('outcome', 'failed', 'operation_id', p_operation_id, 'last_error_category', v_category);
end;
$$;

comment on function private.fail_billing_outbound_operation(uuid, text) is
  'WP-ASAAS-03: marca failed só a partir de pending (nunca rebaixa completed -> failed). '
  'last_error_category livre (mesmo estilo de billing_outbound_operations): timeout | '
  'network_error | http_4xx | http_5xx | invalid_response | '
  'reconciliation_ambiguous_multiple | external_id_conflict.';

revoke all on function private.fail_billing_outbound_operation(uuid, text)
  from public, anon, authenticated, service_role;


create or replace function public.fail_billing_outbound_operation(
  p_operation_id uuid,
  p_error_category text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.fail_billing_outbound_operation(p_operation_id, p_error_category);
end;
$$;

comment on function public.fail_billing_outbound_operation(uuid, text) is
  'WP-ASAAS-03: wrapper Edge Function. EXECUTE só service_role. authenticated/anon = false.';

revoke all on function public.fail_billing_outbound_operation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_billing_outbound_operation(uuid, text) to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260909090000',
  '20260909090000_wp_asaas_03_outbound_subscriptions.sql',
  'WP-ASAAS-03: private.billing_subscriptions (RLS ON, 0 policies, REVOKE total, '
  'subscription_scope, value_cents > 0 neutro) + ALTER billing_outbound_operations '
  '(+ external_reference) + get_or_create_billing_account (authenticated, advisory lock '
  'ns 90300, 5 casos de billing account resolvidos) + reserve/complete_customer/'
  'complete_subscription/fail (service_role only). Sem HTTP. Sem apply remoto nesta etapa.',
  'WP-ASAAS-03'
)
on conflict (version) do nothing;
