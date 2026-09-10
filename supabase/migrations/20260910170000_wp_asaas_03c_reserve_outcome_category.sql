-- =====================================================================================
-- WP-ASAAS-03C — pre-merge hardening: reserve_billing_outbound_operation passa a devolver
-- last_error_category nos ramos in_flight_retry/claimed_for_retry.
--
-- NÃO edita 20260909090000, 20260910150000 nem 20260910160000. Forward migration só.
-- CREATE OR REPLACE da MESMA função (mesma assinatura) — não é alteração do arquivo já
-- aplicado, é uma nova versão da função via um novo arquivo de migration, exatamente o
-- padrão pedido pelo Tech Lead ("criar SOMENTE forward migration nova").
--
-- Motivo: Edge Function precisa decidir, quando o lookup-first de uma reconciliation acha 0
-- resultados, se é seguro tentar POST de novo. Só é seguro quando a tentativa anterior teve
-- uma REJEIÇÃO DETERMINÍSTICA comprovada (4xx/429 — a Asaas nunca chegou a criar o recurso).
-- Qualquer outra categoria (timeout, 5xx, 2xx vazio/malformado/sem id, ou nenhuma categoria
-- ainda registrada) significa "outcome desconhecido" e bloqueia novo POST — ver
-- isOutcomeUnknownCategory em supabase/functions/_shared/asaas/client.ts. Sem essa
-- informação, a Edge Function não tem como diferenciar os dois casos.
--
-- Comportamento inalterado em tudo o mais: mesma validação, mesmo lock via unique_violation,
-- mesma transição de status. Só o jsonb de retorno ganha um campo a mais nos dois ramos de
-- retry (o valor é lido ANTES do claimed_for_retry zerar last_error_category — reflete
-- sempre a categoria da tentativa anterior, nunca a nova).
-- =====================================================================================

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
  'WP-ASAAS-03C: reserva atômica pré-HTTP (mesmo comportamento de 20260909090000). '
  'in_flight_retry/claimed_for_retry agora também devolvem last_error_category (lido antes '
  'de claimed_for_retry zerá-lo) — a Edge Function usa isso para decidir se um lookup com 0 '
  'resultados autoriza novo POST (só quando a categoria anterior é uma rejeição '
  'determinística comprovada) ou exige ficar bloqueado em outcome desconhecido.';

-- Mesma topologia da migration original: a private fica sem NENHUM grant (nem service_role);
-- é a public wrapper (inalterada — corpo continua "return private...(...)", já propaga o
-- novo campo automaticamente) que carrega o EXECUTE real para service_role.
revoke all on function private.reserve_billing_outbound_operation(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260910170000',
  '20260910170000_wp_asaas_03c_reserve_outcome_category.sql',
  'WP-ASAAS-03C: reserve_billing_outbound_operation (CREATE OR REPLACE, mesma assinatura) '
  'passa a devolver last_error_category em in_flight_retry/claimed_for_retry — habilita a '
  'Edge Function a nunca fazer blind POST após um outcome anterior desconhecido (timeout, '
  '5xx, 2xx vazio/malformado/sem id). Sem alteração de schema, sem nova tabela.',
  'WP-ASAAS-03C'
)
on conflict (version) do nothing;
