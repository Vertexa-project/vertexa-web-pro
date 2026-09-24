-- =====================================================================================
-- WP-ASAAS-04 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260910180000/181000/182000/183000 aplicadas (e por extensão ASAAS-02/03).
-- Rodam como owner/superuser (db reset local ou execute_sql remoto) — inserts diretos em
-- private.* funcionam apesar do REVOKE (owner bypassa RLS/grants). As RPCs são exercitadas
-- diretamente pelo schema private (mesma superfície que o wrapper public service_role chama).
-- =====================================================================================

create or replace function pg_temp.asaas04_seed()
returns table (pf uuid, account_id uuid, sub_id uuid, ext_customer text, ext_sub text)
language plpgsql
as $seed$
declare
  v_pf uuid := gen_random_uuid();
  v_auth uuid := gen_random_uuid();
  v_acc uuid;
  v_sub uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, v_auth, 'professional', 'Owner ASAAS04', concat('owner-', v_pf, '@t.test'), 'active');

  insert into private.billing_accounts (owner_profile_id, provider, environment, external_customer_id)
    values (v_pf, 'asaas', 'sandbox', 'cus_seed') returning id into v_acc;

  insert into private.billing_subscriptions (
    billing_account_id, provider, environment, external_subscription_id, external_reference,
    subscription_scope, billing_type, billing_cycle, value_cents, next_due_date
  ) values (
    v_acc, 'asaas', 'sandbox', 'sub_seed', concat('vtx:sandbox:', v_acc, ':subscription:primary'),
    'primary', 'PIX', 'MONTHLY', 1000, current_date
  ) returning id into v_sub;

  return query select v_pf, v_acc, v_sub, 'cus_seed'::text, 'sub_seed'::text;
end;
$seed$;

create or replace function pg_temp.asaas04_event(
  p_ext_event_id text,
  p_event_type text,
  p_resource_id text,
  p_status text default 'received',
  p_created timestamptz default now()
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into private.billing_provider_events (
    provider, environment, external_event_id, event_type, event_created_at,
    external_resource_type, external_resource_id, payload_hash, processing_status
  ) values (
    'asaas', 'sandbox', p_ext_event_id, p_event_type, p_created,
    'payment', p_resource_id, repeat('a', 64), p_status
  ) returning id into v_id;
  return v_id;
end;
$$;


-- T1: billing_payments existe, RLS ON, 0 policies, REVOKE total (até service_role)
begin;
do $$
declare v_rls boolean; v_n int;
begin
  if to_regclass('private.billing_payments') is null then
    raise exception 'ASAAS04 T1 FAIL: tabela ausente';
  end if;
  select relrowsecurity into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_payments';
  if v_rls is not true then raise exception 'ASAAS04 T1 FAIL: RLS off'; end if;
  select count(*) into v_n from pg_policies where schemaname = 'private' and tablename = 'billing_payments';
  if v_n <> 0 then raise exception 'ASAAS04 T1 FAIL: policies=%', v_n; end if;
  if has_table_privilege('service_role', 'private.billing_payments', 'select')
     or has_table_privilege('authenticated', 'private.billing_payments', 'select')
     or has_table_privilege('anon', 'private.billing_payments', 'select') then
    raise exception 'ASAAS04 T1 FAIL: grant direto de tabela existe';
  end if;
end $$;
rollback;

-- T2: every ledger row needs exactly one canonical source. Since 05F1, that is
-- either a subscription pair or a Pix Automatic authorization; an uncorrelated
-- row is rejected by billing_payments_ledger_source_check.
begin;
do $$
declare s record;
begin
  select * into s from pg_temp.asaas04_seed();
  begin
    insert into private.billing_payments (
      billing_account_id, billing_subscription_id, provider, environment, external_payment_id,
      external_customer_id, external_subscription_id, provider_status, financial_state, value_cents
    ) values (s.account_id, null, 'asaas', 'sandbox', 'pay_x', 'cus_seed', null, 'RECEIVED', 'received', 1000);
    raise exception 'ASAAS04 T2 FAIL: payment without a canonical ledger source should be rejected';
  exception when check_violation then null; end;
end $$;
rollback;

-- T3: financial_state CHECK — vocabulário controlado
begin;
do $$
declare s record;
begin
  select * into s from pg_temp.asaas04_seed();
  begin
    insert into private.billing_payments (
      billing_account_id, billing_subscription_id, provider, environment, external_payment_id,
      external_customer_id, external_subscription_id, provider_status, financial_state, value_cents
    ) values (s.account_id, s.sub_id, 'asaas', 'sandbox', 'pay_bad', 'cus_seed', 'sub_seed', 'RECEIVED', 'not_a_real_state', 1000);
    raise exception 'ASAAS04 T3 FAIL: financial_state inválido deveria ser rejeitado';
  exception when check_violation then null; end;
  -- válido é aceito
  insert into private.billing_payments (
    billing_account_id, billing_subscription_id, provider, environment, external_payment_id,
    external_customer_id, external_subscription_id, provider_status, financial_state, value_cents
  ) values (s.account_id, s.sub_id, 'asaas', 'sandbox', 'pay_ok', 'cus_seed', 'sub_seed', 'RECEIVED', 'partially_refunded', 1000);
end $$;
rollback;

-- T4: value_cents > 0 CHECK; UNIQUE(provider, environment, external_payment_id)
begin;
do $$
declare s record;
begin
  select * into s from pg_temp.asaas04_seed();
  begin
    insert into private.billing_payments (
      billing_account_id, billing_subscription_id, provider, environment, external_payment_id,
      external_customer_id, external_subscription_id, provider_status, financial_state, value_cents
    ) values (s.account_id, s.sub_id, 'asaas', 'sandbox', 'pay_zero', 'cus_seed', 'sub_seed', 'RECEIVED', 'received', 0);
    raise exception 'ASAAS04 T4 FAIL: value_cents=0 deveria ser rejeitado';
  exception when check_violation then null; end;

  insert into private.billing_payments (
    billing_account_id, billing_subscription_id, provider, environment, external_payment_id,
    external_customer_id, external_subscription_id, provider_status, financial_state, value_cents
  ) values (s.account_id, s.sub_id, 'asaas', 'sandbox', 'pay_uniq', 'cus_seed', 'sub_seed', 'RECEIVED', 'received', 1000);
  begin
    insert into private.billing_payments (
      billing_account_id, billing_subscription_id, provider, environment, external_payment_id,
      external_customer_id, external_subscription_id, provider_status, financial_state, value_cents
    ) values (s.account_id, s.sub_id, 'asaas', 'sandbox', 'pay_uniq', 'cus_seed', 'sub_seed', 'CONFIRMED', 'confirmed', 2000);
    raise exception 'ASAAS04 T4 FAIL: external_payment_id duplicado deveria colidir';
  exception when unique_violation then null; end;
end $$;
rollback;

-- T5: grants das RPCs — anon/authenticated nunca; service_role só nos wrappers public
begin;
do $$
declare
  v_apply text := 'public.apply_billing_payment_snapshot(uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,date,date,date,text,timestamptz)';
begin
  -- anon nunca
  if has_function_privilege('anon', 'public.claim_billing_provider_events(text,text,integer)', 'execute')
     or has_function_privilege('anon', 'public.fail_billing_provider_event(uuid,text,boolean,integer)', 'execute')
     or has_function_privilege('anon', 'public.ignore_billing_provider_event(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.resolve_billing_target_by_subscription(text,text,text)', 'execute')
     or has_function_privilege('anon', v_apply, 'execute')
     or has_function_privilege('anon', 'public.handle_missing_payment_on_get(uuid,text,text,text,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.billing_processing_diagnostics(text,text)', 'execute') then
    raise exception 'ASAAS04 T5 FAIL: anon execute em alguma RPC';
  end if;
  -- authenticated nunca
  if has_function_privilege('authenticated', 'public.claim_billing_provider_events(text,text,integer)', 'execute')
     or has_function_privilege('authenticated', v_apply, 'execute')
     or has_function_privilege('authenticated', 'public.billing_processing_diagnostics(text,text)', 'execute') then
    raise exception 'ASAAS04 T5 FAIL: authenticated execute em RPC service_role-only';
  end if;
  -- service_role sim, nos wrappers public
  if not (
    has_function_privilege('service_role', 'public.claim_billing_provider_events(text,text,integer)', 'execute')
    and has_function_privilege('service_role', 'public.fail_billing_provider_event(uuid,text,boolean,integer)', 'execute')
    and has_function_privilege('service_role', 'public.ignore_billing_provider_event(uuid,text)', 'execute')
    and has_function_privilege('service_role', 'public.resolve_billing_target_by_subscription(text,text,text)', 'execute')
    and has_function_privilege('service_role', v_apply, 'execute')
    and has_function_privilege('service_role', 'public.handle_missing_payment_on_get(uuid,text,text,text,text,timestamptz)', 'execute')
    and has_function_privilege('service_role', 'public.billing_processing_diagnostics(text,text)', 'execute')
  ) then
    raise exception 'ASAAS04 T5 FAIL: service_role sem execute em algum wrapper esperado';
  end if;
  -- service_role NUNCA nas funções private
  if has_function_privilege('service_role', 'private.apply_billing_payment_snapshot(uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,date,date,date,text,timestamptz)', 'execute') then
    raise exception 'ASAAS04 T5 FAIL: service_role execute em função private';
  end if;
end $$;
rollback;

-- T6: claim — received -> processing, attempts=1, retorna SEM payload_hash
begin;
do $$
declare s record; v_ev uuid; v_res jsonb; v_row jsonb; v_status text; v_attempts int;
begin
  select * into s from pg_temp.asaas04_seed();
  v_ev := pg_temp.asaas04_event('evt_claim', 'PAYMENT_RECEIVED', 'pay_seed');
  v_res := private.claim_billing_provider_events('asaas', 'sandbox', 5);
  if jsonb_array_length(v_res) < 1 then raise exception 'ASAAS04 T6 FAIL: claim vazio'; end if;
  v_row := v_res->0;
  if v_row ? 'payload_hash' then raise exception 'ASAAS04 T6 FAIL: payload_hash vazou no claim'; end if;
  select processing_status, attempts into v_status, v_attempts from private.billing_provider_events where id = v_ev;
  if v_status is distinct from 'processing' or v_attempts <> 1 then
    raise exception 'ASAAS04 T6 FAIL: status=% attempts=%', v_status, v_attempts;
  end if;
end $$;
rollback;

-- T7: fail retryable seta next_attempt_at; non-retryable deixa NULL; ignore -> ignored;
--     e (regressão do code review) NON-retryable NUNCA é reivindicado; retryable só após maturar.
begin;
do $$
declare s record; v_ev uuid; v_next timestamptz; v_status text; v_claim jsonb;
begin
  select * into s from pg_temp.asaas04_seed();
  v_ev := pg_temp.asaas04_event('evt_fail', 'PAYMENT_RECEIVED', 'pay_seed', 'processing');

  -- retryable com backoff futuro: seta next_attempt_at no futuro.
  perform private.fail_billing_provider_event(v_ev, 'provider_5xx', true, 300);
  select processing_status, next_attempt_at into v_status, v_next from private.billing_provider_events where id = v_ev;
  if v_status is distinct from 'failed' or v_next is null then
    raise exception 'ASAAS04 T7 FAIL: retryable deveria setar next_attempt_at (status=%, next=%)', v_status, v_next;
  end if;
  -- backoff ainda não venceu -> claim NÃO deve reivindicar.
  v_claim := private.claim_billing_provider_events('asaas', 'sandbox', 5);
  if jsonb_array_length(v_claim) <> 0 then
    raise exception 'ASAAS04 T7 FAIL: retryable com backoff futuro não deveria ser reivindicado';
  end if;
  -- backoff vencido -> claim DEVE reivindicar.
  update private.billing_provider_events set next_attempt_at = clock_timestamp() - interval '1 s' where id = v_ev;
  v_claim := private.claim_billing_provider_events('asaas', 'sandbox', 5);
  if jsonb_array_length(v_claim) <> 1 then
    raise exception 'ASAAS04 T7 FAIL: retryable vencido deveria ser reivindicado (n=%)', jsonb_array_length(v_claim);
  end if;

  -- non-retryable: next_attempt_at fica NULL...
  perform private.fail_billing_provider_event(v_ev, 'customer_mismatch', false, 0);
  select next_attempt_at into v_next from private.billing_provider_events where id = v_ev;
  if v_next is not null then raise exception 'ASAAS04 T7 FAIL: non-retryable deveria deixar next_attempt_at NULL'; end if;
  -- ...e NUNCA é reivindicado automaticamente (fail closed — code review Critical #1).
  v_claim := private.claim_billing_provider_events('asaas', 'sandbox', 5);
  if jsonb_array_length(v_claim) <> 0 then
    raise exception 'ASAAS04 T7 FAIL: failed non-retryable (next_attempt_at NULL) NÃO deveria ser reivindicado';
  end if;

  update private.billing_provider_events set processing_status = 'processing' where id = v_ev;
  perform private.ignore_billing_provider_event(v_ev, 'unsupported_event');
  select processing_status into v_status from private.billing_provider_events where id = v_ev;
  if v_status is distinct from 'ignored' then raise exception 'ASAAS04 T7 FAIL: ignore não aplicou'; end if;
end $$;
rollback;

-- T8: resolve_billing_target_by_subscription — found / not found
begin;
do $$
declare s record; v_ok jsonb; v_no jsonb;
begin
  select * into s from pg_temp.asaas04_seed();
  v_ok := private.resolve_billing_target_by_subscription('asaas', 'sandbox', 'sub_seed');
  if (v_ok->>'found')::boolean is not true or v_ok->>'external_customer_id' is distinct from 'cus_seed' then
    raise exception 'ASAAS04 T8 FAIL: resolve found: %', v_ok;
  end if;
  v_no := private.resolve_billing_target_by_subscription('asaas', 'sandbox', 'sub_nao_existe');
  if (v_no->>'found')::boolean is not false then raise exception 'ASAAS04 T8 FAIL: resolve not found: %', v_no; end if;
end $$;
rollback;

-- T9: apply happy path -> row criada + event processed; idempotente; customer_mismatch fail closed
begin;
do $$
declare s record; v_ev uuid; v_ev2 uuid; v_ev3 uuid; v_res jsonb; v_state text; v_status text; v_n int;
begin
  select * into s from pg_temp.asaas04_seed();

  v_ev := pg_temp.asaas04_event('evt_apply1', 'PAYMENT_RECEIVED', 'pay_seed', 'processing', now() - interval '10 min');
  v_res := private.apply_billing_payment_snapshot(
    v_ev, 'evt_apply1', 'asaas', 'sandbox', 'pay_seed', 'sub_seed', 'cus_seed',
    'RECEIVED', 'received', 'PIX', 1000, 950, null, current_date, current_date, current_date,
    'PAYMENT_RECEIVED', now() - interval '10 min'
  );
  if v_res->>'outcome' is distinct from 'applied' then raise exception 'ASAAS04 T9 FAIL: apply: %', v_res; end if;
  select financial_state into v_state from private.billing_payments where external_payment_id = 'pay_seed' and environment = 'sandbox';
  if v_state is distinct from 'received' then raise exception 'ASAAS04 T9 FAIL: state: %', v_state; end if;
  select processing_status into v_status from private.billing_provider_events where id = v_ev;
  if v_status is distinct from 'processed' then raise exception 'ASAAS04 T9 FAIL: event não processed: %', v_status; end if;

  -- Idempotência: segundo evento mais novo atualiza o MESMO row (upsert), snapshot = GET atual.
  v_ev2 := pg_temp.asaas04_event('evt_apply2', 'PAYMENT_REFUNDED', 'pay_seed', 'processing', now());
  v_res := private.apply_billing_payment_snapshot(
    v_ev2, 'evt_apply2', 'asaas', 'sandbox', 'pay_seed', 'sub_seed', 'cus_seed',
    'REFUNDED', 'refunded', 'PIX', 1000, 950, 1000, current_date, current_date, current_date,
    'PAYMENT_REFUNDED', now()
  );
  if v_res->>'outcome' is distinct from 'applied' then raise exception 'ASAAS04 T9 FAIL: 2o apply: %', v_res; end if;
  select count(*), max(financial_state) into v_n, v_state from private.billing_payments where external_payment_id = 'pay_seed' and environment = 'sandbox';
  if v_n <> 1 then raise exception 'ASAAS04 T9 FAIL: upsert criou linha duplicada: %', v_n; end if;
  if v_state is distinct from 'refunded' then raise exception 'ASAAS04 T9 FAIL: snapshot não avançou p/ refunded: %', v_state; end if;

  -- customer_mismatch: nenhum write, event não processed.
  v_ev3 := pg_temp.asaas04_event('evt_apply3', 'PAYMENT_RECEIVED', 'pay_other', 'processing', now());
  v_res := private.apply_billing_payment_snapshot(
    v_ev3, 'evt_apply3', 'asaas', 'sandbox', 'pay_other', 'sub_seed', 'cus_WRONG',
    'RECEIVED', 'received', 'PIX', 1000, null, null, current_date, current_date, current_date,
    'PAYMENT_RECEIVED', now()
  );
  if v_res->>'outcome' is distinct from 'customer_mismatch' then raise exception 'ASAAS04 T9 FAIL: mismatch: %', v_res; end if;
  select count(*) into v_n from private.billing_payments where external_payment_id = 'pay_other';
  if v_n <> 0 then raise exception 'ASAAS04 T9 FAIL: mismatch escreveu snapshot'; end if;
  select processing_status into v_status from private.billing_provider_events where id = v_ev3;
  if v_status is distinct from 'processing' then raise exception 'ASAAS04 T9 FAIL: mismatch mexeu no event: %', v_status; end if;
end $$;
rollback;

-- T10: monotonicidade do audit — evento mais ANTIGO não regride last_provider_event_created_at
begin;
do $$
declare s record; v_new uuid; v_old uuid; v_last timestamptz; v_ts_new timestamptz := now(); v_ts_old timestamptz := now() - interval '1 hour';
begin
  select * into s from pg_temp.asaas04_seed();
  v_new := pg_temp.asaas04_event('evt_new', 'PAYMENT_CONFIRMED', 'pay_mono', 'processing', v_ts_new);
  perform private.apply_billing_payment_snapshot(
    v_new, 'evt_new', 'asaas', 'sandbox', 'pay_mono', 'sub_seed', 'cus_seed',
    'CONFIRMED', 'confirmed', 'PIX', 1000, null, null, null, null, null, 'PAYMENT_CONFIRMED', v_ts_new);

  v_old := pg_temp.asaas04_event('evt_old', 'PAYMENT_CREATED', 'pay_mono', 'processing', v_ts_old);
  perform private.apply_billing_payment_snapshot(
    v_old, 'evt_old', 'asaas', 'sandbox', 'pay_mono', 'sub_seed', 'cus_seed',
    'PENDING', 'pending', 'PIX', 1000, null, null, null, null, null, 'PAYMENT_CREATED', v_ts_old);

  select last_provider_event_created_at into v_last from private.billing_payments where external_payment_id = 'pay_mono';
  if v_last < v_ts_new then
    raise exception 'ASAAS04 T10 FAIL: audit regrediu para evento mais antigo (last=%, esperado>=%)', v_last, v_ts_new;
  end if;
end $$;
rollback;

-- T11: handle_missing_payment_on_get — CASE A ignore; CASE B PAYMENT_DELETED voided; CASE B outro failed
begin;
do $$
declare s record; v_ev uuid; v_res jsonb; v_state text; v_status text;
begin
  select * into s from pg_temp.asaas04_seed();

  -- CASE A: sem billing_payment prévio -> ignored_unmanaged_resource
  v_ev := pg_temp.asaas04_event('evt_404a', 'PAYMENT_RECEIVED', 'pay_ghost', 'processing');
  v_res := private.handle_missing_payment_on_get(v_ev, 'asaas', 'sandbox', 'pay_ghost', 'PAYMENT_RECEIVED', now());
  if v_res->>'outcome' is distinct from 'ignored' then raise exception 'ASAAS04 T11 CASE A FAIL: %', v_res; end if;
  select processing_status into v_status from private.billing_provider_events where id = v_ev;
  if v_status is distinct from 'ignored' then raise exception 'ASAAS04 T11 CASE A FAIL: event %', v_status; end if;

  -- Semear um billing_payment gerenciado para pay_managed
  insert into private.billing_payments (
    billing_account_id, billing_subscription_id, provider, environment, external_payment_id,
    external_customer_id, external_subscription_id, provider_status, financial_state, value_cents,
    last_provider_event_created_at
  ) values (s.account_id, s.sub_id, 'asaas', 'sandbox', 'pay_managed', 'cus_seed', 'sub_seed', 'RECEIVED', 'received', 1000, now() - interval '5 min');

  -- CASE B + PAYMENT_DELETED -> voided
  v_ev := pg_temp.asaas04_event('evt_404b', 'PAYMENT_DELETED', 'pay_managed', 'processing');
  v_res := private.handle_missing_payment_on_get(v_ev, 'asaas', 'sandbox', 'pay_managed', 'PAYMENT_DELETED', now());
  if v_res->>'outcome' is distinct from 'voided' then raise exception 'ASAAS04 T11 CASE B/DELETED FAIL: %', v_res; end if;
  select financial_state into v_state from private.billing_payments where external_payment_id = 'pay_managed';
  if v_state is distinct from 'voided' then raise exception 'ASAAS04 T11 CASE B/DELETED FAIL: state %', v_state; end if;

  -- CASE B sem PAYMENT_DELETED -> failed requires_review (fail closed)
  update private.billing_payments set financial_state = 'received' where external_payment_id = 'pay_managed';
  v_ev := pg_temp.asaas04_event('evt_404c', 'PAYMENT_RECEIVED', 'pay_managed', 'processing');
  v_res := private.handle_missing_payment_on_get(v_ev, 'asaas', 'sandbox', 'pay_managed', 'PAYMENT_RECEIVED', now());
  if v_res->>'outcome' is distinct from 'failed' then raise exception 'ASAAS04 T11 CASE B/other FAIL: %', v_res; end if;
  select processing_status into v_status from private.billing_provider_events where id = v_ev;
  if v_status is distinct from 'failed' then raise exception 'ASAAS04 T11 CASE B/other FAIL: event %', v_status; end if;
  select financial_state into v_state from private.billing_payments where external_payment_id = 'pay_managed';
  if v_state is distinct from 'received' then raise exception 'ASAAS04 T11 CASE B/other FAIL: NÃO devia virar voided: %', v_state; end if;
end $$;
rollback;

-- T12: diagnostics — só contagens/agregados, sem PII/payload_hash
begin;
do $$
declare s record; v_diag jsonb;
begin
  select * into s from pg_temp.asaas04_seed();
  perform pg_temp.asaas04_event('evt_d1', 'PAYMENT_RECEIVED', 'pay_d1', 'received');
  perform pg_temp.asaas04_event('evt_d2', 'PAYMENT_RECEIVED', 'pay_d2', 'failed');
  v_diag := private.billing_processing_diagnostics('asaas', 'sandbox');
  if v_diag ? 'payload_hash' or (v_diag->>'events') is null then
    raise exception 'ASAAS04 T12 FAIL: diagnostics shape: %', v_diag;
  end if;
  if (v_diag->'events'->>'received')::int < 1 then raise exception 'ASAAS04 T12 FAIL: received count'; end if;
end $$;
rollback;

-- T13: backfill de fixture sintética (Correção 4) — WP_ASAAS_* received -> ignored/historical
begin;
do $$
declare s record; v_syn uuid; v_real uuid; v_status text; v_cat text;
begin
  select * into s from pg_temp.asaas04_seed();
  v_syn := pg_temp.asaas04_event('WP_ASAAS_02D3_SMOKE_PROBE', 'PAYMENT_RECEIVED', 'WP_ASAAS_PAY_PROBE', 'received');
  v_real := pg_temp.asaas04_event('evt_real_probe', 'PAYMENT_RECEIVED', 'pay_real_probe', 'received');

  update private.billing_provider_events
     set processing_status = 'ignored', processed_at = now(), last_error_category = 'historical_test_fixture'
   where provider = 'asaas' and environment = 'sandbox' and processing_status = 'received'
     and external_event_id like 'WP\_ASAAS%' escape '\';

  select processing_status, last_error_category into v_status, v_cat from private.billing_provider_events where id = v_syn;
  if v_status is distinct from 'ignored' or v_cat is distinct from 'historical_test_fixture' then
    raise exception 'ASAAS04 T13 FAIL: sintético não backfilled: % / %', v_status, v_cat;
  end if;
  select processing_status into v_status from private.billing_provider_events where id = v_real;
  if v_status is distinct from 'received' then
    raise exception 'ASAAS04 T13 FAIL: evento real (evt_) NÃO deveria ser tocado: %', v_status;
  end if;
end $$;
rollback;

do $$ begin raise notice 'ASAAS04_SQL_ASSERTIONS_PASSED'; end $$;
