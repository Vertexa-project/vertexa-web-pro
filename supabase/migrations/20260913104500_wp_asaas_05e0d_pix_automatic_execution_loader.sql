-- =====================================================================================
-- WP-ASAAS-05E0D1 — trusted loader for prepared Pix Automatic outbound execution.
--
-- Forward-only. NÃO edita 05A–05E0B. Sem seed. Sem HTTP. Sem reserve/claim/complete.
-- Sem customer. Sem authorization. Sem mutação de status. Sem PII de Billing Profile.
--
-- Edge (asaas-outbound) já chama public.load_prepared_pix_automatic_authorization(uuid).
-- Input: só p_operation_id. Fatos vêm do ledger privado existente.
-- =====================================================================================

create or replace function private.load_prepared_pix_automatic_authorization(
  p_operation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op private.billing_outbound_operations%rowtype;
  v_account private.billing_accounts%rowtype;
  v_contract private.billing_commercial_contracts%rowtype;
  v_auth private.billing_pix_automatic_authorizations%rowtype;
  v_expected_contract_id text;
  v_load_state text;
  v_actionable boolean;
  v_err text;
  v_unknown boolean;
begin
  if p_operation_id is null then
    return jsonb_build_object('found', false, 'error', 'operation_not_found');
  end if;

  select * into v_op
    from private.billing_outbound_operations
   where id = p_operation_id;

  if not found then
    return jsonb_build_object('found', false, 'error', 'operation_not_found');
  end if;

  if v_op.provider is distinct from 'asaas' then
    return jsonb_build_object('found', false, 'error', 'operation_provider_mismatch');
  end if;

  if v_op.operation_type is distinct from 'create_pix_automatic_authorization' then
    return jsonb_build_object('found', false, 'error', 'operation_type_mismatch');
  end if;

  if v_op.environment is distinct from 'sandbox'
     and v_op.environment is distinct from 'production' then
    return jsonb_build_object('found', false, 'error', 'invalid_operation_environment');
  end if;

  if v_op.billing_account_id is null then
    return jsonb_build_object('found', false, 'error', 'missing_billing_account');
  end if;

  select * into v_account
    from private.billing_accounts
   where id = v_op.billing_account_id;

  if not found then
    return jsonb_build_object('found', false, 'error', 'missing_billing_account');
  end if;

  if v_account.environment is distinct from v_op.environment then
    return jsonb_build_object('found', false, 'error', 'environment_mismatch');
  end if;

  if v_op.commercial_contract_id is null then
    return jsonb_build_object('found', false, 'error', 'missing_commercial_contract');
  end if;

  select * into v_contract
    from private.billing_commercial_contracts
   where id = v_op.commercial_contract_id;

  if not found then
    return jsonb_build_object('found', false, 'error', 'missing_commercial_contract');
  end if;

  if v_account.clinic_id is distinct from v_contract.clinic_id then
    return jsonb_build_object('found', false, 'error', 'relationship_mismatch');
  end if;

  if v_contract.contracted_price_cents is null
     or v_contract.contracted_price_cents < 0
     or v_contract.contracted_currency is distinct from 'BRL' then
    return jsonb_build_object('found', false, 'error', 'contract_snapshot_invalid');
  end if;

  select * into v_auth
    from private.billing_pix_automatic_authorizations
   where commercial_contract_id = v_op.commercial_contract_id
     and environment = v_op.environment
     and is_primary;

  if not found then
    return jsonb_build_object('found', false, 'error', 'missing_authorization_intent');
  end if;

  if v_auth.billing_account_id is distinct from v_op.billing_account_id
     or v_auth.commercial_contract_id is distinct from v_op.commercial_contract_id
     or v_auth.environment is distinct from v_op.environment then
    return jsonb_build_object('found', false, 'error', 'relationship_mismatch');
  end if;

  v_expected_contract_id := replace(v_op.commercial_contract_id::text, '-', '');
  if v_auth.provider_contract_id is distinct from v_expected_contract_id then
    return jsonb_build_object('found', false, 'error', 'relationship_mismatch');
  end if;

  if v_auth.recurrence_start_date is null then
    return jsonb_build_object('found', false, 'error', 'missing_authorization_intent');
  end if;

  v_unknown := v_op.last_error_category is null
    or v_op.last_error_category not in ('http_4xx', 'rate_limited');

  if v_op.status = 'completed' then
    v_load_state := 'already_completed';
    v_actionable := true;
  elsif v_op.status = 'pending' then
    v_load_state := 'actionable';
    v_actionable := true;
  elsif v_op.status = 'failed' and v_unknown then
    v_load_state := 'outcome_unknown_requires_reconciliation';
    v_actionable := true;
  elsif v_op.status = 'failed' then
    v_load_state := 'actionable';
    v_actionable := true;
  else
    v_load_state := 'not_actionable';
    v_actionable := false;
  end if;

  v_err := null;

  return jsonb_build_object(
    'found', true,
    'error', v_err,
    'operation_id', v_op.id,
    'operation_type', v_op.operation_type,
    'operation_status', v_op.status,
    'last_error_category', v_op.last_error_category,
    'load_state', v_load_state,
    'actionable', v_actionable,
    'provider', v_op.provider,
    'environment', v_op.environment,
    'billing_account_id', v_op.billing_account_id,
    'commercial_contract_id', v_op.commercial_contract_id,
    'external_customer_id', v_account.external_customer_id,
    'contracted_price_cents', v_contract.contracted_price_cents,
    'contracted_currency', v_contract.contracted_currency,
    'recurrence_start_date', to_char(v_auth.recurrence_start_date, 'YYYY-MM-DD'),
    'authorization_id', v_auth.id,
    'authorization_provider_status', v_auth.provider_status,
    'provider_contract_id', v_auth.provider_contract_id
  );
end;
$$;

comment on function private.load_prepared_pix_automatic_authorization(uuid) is
  'WP-ASAAS-05E0D1: leitura/validação da operação Pix Automatic já preparada. '
  'Sem HTTP, sem reserve, sem mutação, sem PII. SECURITY DEFINER search_path locked.';

revoke all on function private.load_prepared_pix_automatic_authorization(uuid)
  from public, anon, authenticated, service_role;


create or replace function public.load_prepared_pix_automatic_authorization(
  p_operation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.load_prepared_pix_automatic_authorization(p_operation_id);
end;
$$;

comment on function public.load_prepared_pix_automatic_authorization(uuid) is
  'WP-ASAAS-05E0D1: wrapper Edge. EXECUTE só service_role. authenticated/anon/PUBLIC = false. '
  'Browser nunca chama. Platform Admin vive em asaas-outbound antes deste RPC.';

revoke all on function public.load_prepared_pix_automatic_authorization(uuid)
  from public, anon, authenticated;
grant execute on function public.load_prepared_pix_automatic_authorization(uuid)
  to service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260913104500',
  '20260913104500_wp_asaas_05e0d_pix_automatic_execution_loader.sql',
  'WP-ASAAS-05E0D1: loader read-only de operação Pix Automatic preparada. Sem HTTP, sem mutate.',
  'asaas-05e0d1'
);
