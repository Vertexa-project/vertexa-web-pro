-- Cartão 1568 (D108): depois de um timeout do Asaas ao criar a autorização Pix, a operação
-- ficava travada para sempre. Guardamos quando a última escrita no provedor pode ter estado em
-- voo; passado o intervalo de segurança e com a busca no Asaas sem nada, a Edge Function pode
-- tentar de novo. Só acrescenta coluna, campos de retorno e uma função nova.

alter table private.billing_outbound_operations
  add column if not exists provider_write_window_at timestamptz;

comment on column private.billing_outbound_operations.provider_write_window_at is
  'Último instante em que uma escrita no provedor pode ter estado em voo sem resultado conhecido (timeout, 5xx, linha pendente abandonada).';

CREATE OR REPLACE FUNCTION private.reserve_billing_outbound_operation(p_billing_account_id uuid, p_provider text, p_environment text, p_operation_type text, p_idempotency_key text, p_external_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_previous_updated_at timestamptz;
  v_write_window_at timestamptz;
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
      select id, status, external_object_id, attempt_count, last_error_category,
             updated_at, provider_write_window_at
        into v_id, v_status, v_external_object_id, v_attempt_count, v_last_error_category,
             v_previous_updated_at, v_write_window_at
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
        -- Linha pendente: uma escrita no provedor pode ter começado até o último toque nela.
        update private.billing_outbound_operations
           set attempt_count = attempt_count + 1,
               updated_at = clock_timestamp(),
               provider_write_window_at = greatest(provider_write_window_at, v_previous_updated_at)
         where id = v_id
        returning attempt_count, provider_write_window_at into v_attempt_count, v_write_window_at;

        return jsonb_build_object(
          'outcome', 'in_flight_retry',
          'operation_id', v_id,
          'attempt_count', v_attempt_count,
          'last_error_category', v_last_error_category,
          'provider_write_window_at', v_write_window_at
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
          'last_error_category', v_last_error_category,
          'provider_write_window_at', v_write_window_at
        );
      end if;
  end;
end;
$function$;

create or replace function private.fail_billing_outbound_operation_after_unknown_write(
  p_operation_id uuid,
  p_error_category text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status text;
  v_category text := btrim(coalesce(p_error_category, ''));
begin
  if v_category = '' then
    raise exception 'fail_billing_outbound_operation_after_unknown_write: error category required'
      using errcode = '22023', hint = 'ERROR_CATEGORY_REQUIRED';
  end if;

  select status into v_status
    from private.billing_outbound_operations
   where id = p_operation_id
   for update;

  if not found then
    raise exception 'fail_billing_outbound_operation_after_unknown_write: operation not found'
      using errcode = '22023', hint = 'OPERATION_NOT_FOUND';
  end if;

  if v_status = 'completed' then
    raise exception 'fail_billing_outbound_operation_after_unknown_write: cannot fail a completed operation'
      using errcode = '42501', hint = 'CANNOT_FAIL_COMPLETED_OPERATION';
  end if;

  update private.billing_outbound_operations
     set status = 'failed',
         last_error_category = v_category,
         provider_write_window_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_operation_id;

  return jsonb_build_object('outcome', 'failed', 'operation_id', p_operation_id, 'last_error_category', v_category);
end;
$function$;

create or replace function public.fail_billing_outbound_operation_after_unknown_write(
  p_operation_id uuid,
  p_error_category text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return private.fail_billing_outbound_operation_after_unknown_write(p_operation_id, p_error_category);
end;
$function$;

revoke all on function private.fail_billing_outbound_operation_after_unknown_write(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_billing_outbound_operation_after_unknown_write(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_billing_outbound_operation_after_unknown_write(uuid, text) to service_role;
