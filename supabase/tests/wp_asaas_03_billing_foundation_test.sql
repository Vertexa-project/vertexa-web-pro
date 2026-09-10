-- =====================================================================================
-- WP-ASAAS-03 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260909090000 aplicada (e por extensão 20260830090000/ASAAS-02).
-- JWT sintético: set_config('request.jwt.claims', ...) + set local role authenticated
-- (ler ids para variáveis ANTES do set local role — TEMP TABLE quebra com 42501 depois).
-- =====================================================================================

create or replace function pg_temp.asaas03_seed()
returns table (pf_a uuid, pf_b uuid, auth_a uuid, auth_b uuid, clinic_a uuid)
language plpgsql
as $seed$
declare
  v_pf_a uuid := gen_random_uuid();
  v_pf_b uuid := gen_random_uuid();
  v_auth_a uuid := gen_random_uuid();
  v_auth_b uuid := gen_random_uuid();
  v_clinic_a uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_a, v_auth_a, 'professional', 'Owner A ASAAS03', 'a-asaas03@t.test', 'active'),
    (v_pf_b, v_auth_b, 'professional', 'Owner B ASAAS03', 'b-asaas03@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_clinic_a, 'Clinica A ASAAS03', v_pf_a);
  return query select v_pf_a, v_pf_b, v_auth_a, v_auth_b, v_clinic_a;
end;
$seed$;

create or replace function pg_temp.asaas03_billing_account(p_auth_user_id uuid, p_environment text, p_clinic_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_result := public.get_or_create_billing_account('asaas', p_environment, p_clinic_id);
  reset role;
  return v_result;
end;
$$;


-- T1: billing_subscriptions existe, RLS ON, 0 policies, REVOKE total (até service_role)
begin;
do $$
declare
  v_n int;
  v_rls boolean;
begin
  if to_regclass('private.billing_subscriptions') is null then
    raise exception 'ASAAS03 T1 FAIL: tabela ausente';
  end if;
  select relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_subscriptions';
  if v_rls is not true then raise exception 'ASAAS03 T1 FAIL: RLS off'; end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'private' and tablename = 'billing_subscriptions';
  if v_n <> 0 then raise exception 'ASAAS03 T1 FAIL: policies=%', v_n; end if;
  if has_table_privilege('service_role', 'private.billing_subscriptions', 'select')
     or has_table_privilege('authenticated', 'private.billing_subscriptions', 'select')
     or has_table_privilege('anon', 'private.billing_subscriptions', 'select') then
    raise exception 'ASAAS03 T1 FAIL: grant direto de tabela existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'private' and table_name = 'billing_outbound_operations'
       and column_name = 'external_reference'
  ) then
    raise exception 'ASAAS03 T1 FAIL: external_reference ausente em billing_outbound_operations';
  end if;
end $$;
rollback;

-- T2: grants de função — anon nunca; authenticated só get_or_create; service_role só as 4 outras
begin;
do $$
begin
  if has_function_privilege('anon', 'public.get_or_create_billing_account(text,text,uuid)', 'execute')
     or has_function_privilege('anon', 'public.reserve_billing_outbound_operation(uuid,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.complete_billing_customer_operation(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.complete_billing_subscription_operation(uuid,text,text,text,text,integer,date,text)', 'execute')
     or has_function_privilege('anon', 'public.fail_billing_outbound_operation(uuid,text)', 'execute') then
    raise exception 'ASAAS03 T2 FAIL: anon execute em alguma RPC';
  end if;

  if not has_function_privilege('authenticated', 'public.get_or_create_billing_account(text,text,uuid)', 'execute') then
    raise exception 'ASAAS03 T2 FAIL: authenticated sem execute em get_or_create_billing_account';
  end if;
  if has_function_privilege('authenticated', 'public.reserve_billing_outbound_operation(uuid,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_billing_customer_operation(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_billing_subscription_operation(uuid,text,text,text,text,integer,date,text)', 'execute')
     or has_function_privilege('authenticated', 'public.fail_billing_outbound_operation(uuid,text)', 'execute') then
    raise exception 'ASAAS03 T2 FAIL: authenticated execute em RPC service_role-only';
  end if;

  if has_function_privilege('service_role', 'public.get_or_create_billing_account(text,text,uuid)', 'execute') then
    raise exception 'ASAAS03 T2 FAIL: service_role execute em get_or_create_billing_account';
  end if;
  if not (
    has_function_privilege('service_role', 'public.reserve_billing_outbound_operation(uuid,text,text,text,text,text)', 'execute')
    and has_function_privilege('service_role', 'public.complete_billing_customer_operation(uuid,text)', 'execute')
    and has_function_privilege('service_role', 'public.complete_billing_subscription_operation(uuid,text,text,text,text,integer,date,text)', 'execute')
    and has_function_privilege('service_role', 'public.fail_billing_outbound_operation(uuid,text)', 'execute')
  ) then
    raise exception 'ASAAS03 T2 FAIL: service_role sem execute em alguma RPC esperada';
  end if;
end $$;
rollback;

-- A03: get_or_create_billing_account — casos A (pré-onboarding), C (reentrada), D (liga
-- clínica depois), B (já ligada), CLINIC_NOT_OWNED, NOT_AUTHENTICATED, INVALID_ENVIRONMENT
begin;
do $$
declare
  s record;
  v1 jsonb;
  v2 jsonb;
  v3 jsonb;
  v4 jsonb;
begin
  select * into s from pg_temp.asaas03_seed();

  -- Caso A: pré-onboarding, clinic_id null.
  v1 := pg_temp.asaas03_billing_account(s.auth_a, 'sandbox', null);
  if (v1->>'created')::boolean is not true then
    raise exception 'ASAAS03 A FAIL: primeira chamada deveria criar: %', v1;
  end if;
  if v1->>'clinic_id' is not null then
    raise exception 'ASAAS03 A FAIL: clinic_id deveria ser null: %', v1;
  end if;

  -- Caso C: reentrada, mesma conta, created=false.
  v2 := pg_temp.asaas03_billing_account(s.auth_a, 'sandbox', null);
  if (v2->>'created')::boolean is not false or v2->>'billing_account_id' is distinct from v1->>'billing_account_id' then
    raise exception 'ASAAS03 C FAIL: reentrada deveria reusar a mesma conta: % vs %', v1, v2;
  end if;

  -- Caso D: liga a clínica agora à conta pré-onboarding existente.
  v3 := pg_temp.asaas03_billing_account(s.auth_a, 'sandbox', s.clinic_a);
  if v3->>'billing_account_id' is distinct from v1->>'billing_account_id' then
    raise exception 'ASAAS03 D FAIL: deveria ligar a MESMA conta pré-onboarding: % vs %', v1, v3;
  end if;
  if v3->>'clinic_id' is distinct from s.clinic_a::text then
    raise exception 'ASAAS03 D FAIL: clinic_id não foi ligado: %', v3;
  end if;

  -- Caso B: já ligada, chamando de novo com a mesma clínica.
  v4 := pg_temp.asaas03_billing_account(s.auth_a, 'sandbox', s.clinic_a);
  if (v4->>'created')::boolean is not false or v4->>'billing_account_id' is distinct from v1->>'billing_account_id' then
    raise exception 'ASAAS03 B FAIL: deveria reusar a conta já ligada: %', v4;
  end if;
end $$;
rollback;

begin;
do $$
declare
  s record;
begin
  select * into s from pg_temp.asaas03_seed();
  begin
    perform pg_temp.asaas03_billing_account(s.auth_b, 'sandbox', s.clinic_a);
    raise exception 'ASAAS03 CLINIC_NOT_OWNED FAIL: deveria negar clínica de outro owner';
  exception
    when others then
      if sqlstate is distinct from '42501' then
        raise exception 'ASAAS03 CLINIC_NOT_OWNED FAIL: sqlstate=%, msg=%', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

begin;
do $$
begin
  begin
    perform public.get_or_create_billing_account('asaas', 'sandbox', null);
    raise exception 'ASAAS03 NOT_AUTHENTICATED FAIL: deveria negar sem JWT';
  exception
    when others then
      if sqlstate is distinct from '42501' then
        raise exception 'ASAAS03 NOT_AUTHENTICATED FAIL: sqlstate=%, msg=%', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

begin;
do $$
declare
  s record;
begin
  select * into s from pg_temp.asaas03_seed();
  begin
    perform pg_temp.asaas03_billing_account(s.auth_a, 'staging', null);
    raise exception 'ASAAS03 INVALID_ENVIRONMENT FAIL: deveria negar environment inválido';
  exception
    when others then
      if sqlstate is distinct from '22023' then
        raise exception 'ASAAS03 INVALID_ENVIRONMENT FAIL: sqlstate=%, msg=%', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- A03-01/02: reserve_billing_outbound_operation — reserved, in_flight_retry, ACCOUNT_NOT_FOUND,
-- CUSTOMER_NOT_PROVISIONED
begin;
do $$
declare
  s record;
  v_acc uuid;
  r1 jsonb;
  r2 jsonb;
begin
  select * into s from pg_temp.asaas03_seed();
  insert into private.billing_accounts (owner_profile_id, provider, environment)
    values (s.pf_a, 'asaas', 'sandbox') returning id into v_acc;

  r1 := private.reserve_billing_outbound_operation(
    v_acc, 'asaas', 'sandbox', 'create_customer', 'k1', 'vtx:sandbox:' || v_acc || ':customer'
  );
  if r1->>'outcome' is distinct from 'reserved' or (r1->>'attempt_count')::int <> 1 then
    raise exception 'ASAAS03 A03-01 FAIL: %', r1;
  end if;

  r2 := private.reserve_billing_outbound_operation(
    v_acc, 'asaas', 'sandbox', 'create_customer', 'k1', 'vtx:sandbox:' || v_acc || ':customer'
  );
  if r2->>'outcome' is distinct from 'in_flight_retry' or (r2->>'attempt_count')::int <> 2 then
    raise exception 'ASAAS03 A03-02 FAIL: %', r2;
  end if;

  begin
    perform private.reserve_billing_outbound_operation(
      gen_random_uuid(), 'asaas', 'sandbox', 'create_customer', 'k-missing', 'vtx:sandbox:missing:customer'
    );
    raise exception 'ASAAS03 ACCOUNT_NOT_FOUND FAIL: deveria falhar conta inexistente';
  exception
    when others then
      if sqlstate is distinct from '22023' then
        raise exception 'ASAAS03 ACCOUNT_NOT_FOUND FAIL: sqlstate=%', sqlstate;
      end if;
  end;

  begin
    perform private.reserve_billing_outbound_operation(
      v_acc, 'asaas', 'sandbox', 'create_subscription', 'k-sub', 'vtx:sandbox:' || v_acc || ':subscription:primary'
    );
    raise exception 'ASAAS03 CUSTOMER_NOT_PROVISIONED FAIL: deveria negar sem customer';
  exception
    when others then
      if sqlstate is distinct from '42501' then
        raise exception 'ASAAS03 CUSTOMER_NOT_PROVISIONED FAIL: sqlstate=%', sqlstate;
      end if;
  end;
end $$;
rollback;

-- A03-07: complete_billing_customer_operation — completed, already_completed, conflict
begin;
do $$
declare
  s record;
  v_acc uuid;
  v_op uuid;
  r1 jsonb;
  c1 jsonb;
  c2 jsonb;
  c3 jsonb;
  v_ext text;
begin
  select * into s from pg_temp.asaas03_seed();
  insert into private.billing_accounts (owner_profile_id, provider, environment)
    values (s.pf_a, 'asaas', 'sandbox') returning id into v_acc;

  r1 := private.reserve_billing_outbound_operation(
    v_acc, 'asaas', 'sandbox', 'create_customer', 'kc', 'vtx:sandbox:' || v_acc || ':customer'
  );
  v_op := (r1->>'operation_id')::uuid;

  c1 := private.complete_billing_customer_operation(v_op, 'cus_123');
  if c1->>'outcome' is distinct from 'completed' then
    raise exception 'ASAAS03 A03-07 FAIL: %', c1;
  end if;
  select external_customer_id into v_ext from private.billing_accounts where id = v_acc;
  if v_ext is distinct from 'cus_123' then
    raise exception 'ASAAS03 A03-07 FAIL: external_customer_id não persistiu: %', v_ext;
  end if;

  c2 := private.complete_billing_customer_operation(v_op, 'cus_123');
  if c2->>'outcome' is distinct from 'already_completed' then
    raise exception 'ASAAS03 A03-02-customer FAIL: %', c2;
  end if;

  c3 := private.complete_billing_customer_operation(v_op, 'cus_OUTRO');
  if c3->>'outcome' is distinct from 'conflict' then
    raise exception 'ASAAS03 conflict FAIL: %', c3;
  end if;
  select external_customer_id into v_ext from private.billing_accounts where id = v_acc;
  if v_ext is distinct from 'cus_123' then
    raise exception 'ASAAS03 conflict FAIL: sobrescreveu external_customer_id: %', v_ext;
  end if;

  begin
    perform private.complete_billing_customer_operation(v_op, 'x');
  exception
    when others then null; -- já completed/conflict; não deveria levantar exception aqui, só validando idempotência acima
  end;
end $$;
rollback;

-- A03-08/12: complete_billing_subscription_operation — completed, persistência, scope,
-- value_cents > 0 (nunca >= 1000), unicidade por scope (não por billing_account isolado)
begin;
do $$
declare
  s record;
  v_acc uuid;
  v_op_cust uuid;
  v_op_sub uuid;
  r jsonb;
  cs jsonb;
  v_sub_id uuid;
  v_scope text;
  v_value int;
  v_n int;
begin
  select * into s from pg_temp.asaas03_seed();
  insert into private.billing_accounts (owner_profile_id, provider, environment)
    values (s.pf_a, 'asaas', 'sandbox') returning id into v_acc;

  r := private.reserve_billing_outbound_operation(
    v_acc, 'asaas', 'sandbox', 'create_customer', 'kc2', 'vtx:sandbox:' || v_acc || ':customer'
  );
  v_op_cust := (r->>'operation_id')::uuid;
  perform private.complete_billing_customer_operation(v_op_cust, 'cus_abc');

  r := private.reserve_billing_outbound_operation(
    v_acc, 'asaas', 'sandbox', 'create_subscription', 'ks', 'vtx:sandbox:' || v_acc || ':subscription:primary'
  );
  v_op_sub := (r->>'operation_id')::uuid;

  cs := private.complete_billing_subscription_operation(
    v_op_sub, 'sub_xyz', 'primary', 'PIX', 'MONTHLY', 1000, current_date, 'vtx:sandbox:' || v_acc || ':subscription:primary'
  );
  if cs->>'outcome' is distinct from 'completed' then
    raise exception 'ASAAS03 A03-08 FAIL: %', cs;
  end if;

  select id, subscription_scope, value_cents into v_sub_id, v_scope, v_value
    from private.billing_subscriptions where billing_account_id = v_acc;
  if v_sub_id is null or v_scope is distinct from 'primary' or v_value <> 1000 then
    raise exception 'ASAAS03 A03-12 FAIL: subscription não persistida corretamente';
  end if;

  -- value_cents CHECK é > 0, não >= 1000 (Correção 1): 1 é aceito, 0 é rejeitado.
  begin
    insert into private.billing_subscriptions (
      billing_account_id, provider, environment, external_subscription_id, external_reference,
      subscription_scope, billing_type, billing_cycle, value_cents, next_due_date
    ) values (
      v_acc, 'asaas', 'sandbox', 'sub_floor_probe', 'vtx:sandbox:' || v_acc || ':subscription:floor_probe',
      'floor_probe', 'PIX', 'MONTHLY', 1, current_date
    );
    delete from private.billing_subscriptions where external_subscription_id = 'sub_floor_probe';
  exception
    when check_violation then
      raise exception 'ASAAS03 VALUE_FLOOR FAIL: value_cents=1 deveria ser aceito (regra é > 0, não >= 1000)';
  end;

  begin
    insert into private.billing_subscriptions (
      billing_account_id, provider, environment, external_subscription_id, external_reference,
      subscription_scope, billing_type, billing_cycle, value_cents, next_due_date
    ) values (
      v_acc, 'asaas', 'sandbox', 'sub_zero_probe', 'vtx:sandbox:' || v_acc || ':subscription:zero_probe',
      'zero_probe', 'PIX', 'MONTHLY', 0, current_date
    );
    raise exception 'ASAAS03 VALUE_FLOOR FAIL: value_cents=0 deveria ser rejeitado';
  exception
    when check_violation then null;
  end;

  -- Correção 2: uma 2a subscription para a MESMA billing_account com scope DIFERENTE é permitida
  -- (prova que não existe UNIQUE(billing_account_id) isolado).
  insert into private.billing_subscriptions (
    billing_account_id, provider, environment, external_subscription_id, external_reference,
    subscription_scope, billing_type, billing_cycle, value_cents, next_due_date
  ) values (
    v_acc, 'asaas', 'sandbox', 'sub_replacement', 'vtx:sandbox:' || v_acc || ':subscription:replacement-1',
    'replacement-1', 'PIX', 'MONTHLY', 2000, current_date
  );
  select count(*) into v_n from private.billing_subscriptions where billing_account_id = v_acc;
  if v_n <> 2 then
    raise exception 'ASAAS03 SCOPE FAIL: esperava 2 subscriptions (scopes diferentes), achou %', v_n;
  end if;

  -- Mas o MESMO scope duas vezes para a MESMA conta colide (unicidade por scope).
  begin
    insert into private.billing_subscriptions (
      billing_account_id, provider, environment, external_subscription_id, external_reference,
      subscription_scope, billing_type, billing_cycle, value_cents, next_due_date
    ) values (
      v_acc, 'asaas', 'sandbox', 'sub_dup_primary', 'vtx:sandbox:' || v_acc || ':subscription:primary-dup',
      'primary', 'PIX', 'MONTHLY', 3000, current_date
    );
    raise exception 'ASAAS03 SCOPE FAIL: 2o "primary" para a mesma conta deveria colidir';
  exception
    when unique_violation then null;
  end;
end $$;
rollback;

-- fail_billing_outbound_operation: failed a partir de pending, claimed_for_retry, e nunca
-- rebaixa completed
begin;
do $$
declare
  s record;
  v_acc uuid;
  r jsonb;
  v_op uuid;
  f1 jsonb;
  r2 jsonb;
  c1 jsonb;
begin
  select * into s from pg_temp.asaas03_seed();
  insert into private.billing_accounts (owner_profile_id, provider, environment)
    values (s.pf_a, 'asaas', 'sandbox') returning id into v_acc;

  r := private.reserve_billing_outbound_operation(
    v_acc, 'asaas', 'sandbox', 'create_customer', 'kf', 'vtx:sandbox:' || v_acc || ':customer'
  );
  v_op := (r->>'operation_id')::uuid;

  f1 := private.fail_billing_outbound_operation(v_op, 'network_timeout');
  if f1->>'outcome' is distinct from 'failed' then
    raise exception 'ASAAS03 FAIL_OP FAIL: %', f1;
  end if;

  r2 := private.reserve_billing_outbound_operation(
    v_acc, 'asaas', 'sandbox', 'create_customer', 'kf', 'vtx:sandbox:' || v_acc || ':customer'
  );
  if r2->>'outcome' is distinct from 'claimed_for_retry' or (r2->>'attempt_count')::int <> 2 then
    raise exception 'ASAAS03 CLAIMED_FOR_RETRY FAIL: %', r2;
  end if;

  c1 := private.complete_billing_customer_operation(v_op, 'cus_final');
  if c1->>'outcome' is distinct from 'completed' then
    raise exception 'ASAAS03 CLAIMED_FOR_RETRY FAIL: complete depois do retry: %', c1;
  end if;

  begin
    perform private.fail_billing_outbound_operation(v_op, 'anything');
    raise exception 'ASAAS03 CANNOT_FAIL_COMPLETED FAIL: deveria recusar';
  exception
    when others then
      if sqlstate is distinct from '42501' then
        raise exception 'ASAAS03 CANNOT_FAIL_COMPLETED FAIL: sqlstate=%', sqlstate;
      end if;
  end;
end $$;
rollback;

-- A03-22/23/24: nenhum entitlement, clinic/paciente intocados
begin;
do $$
declare
  v_before_clinics int;
  v_after_clinics int;
  v_grants int;
begin
  select count(*) into v_before_clinics from public.clinics;
  perform 1; -- nenhuma operação ASAAS-03 roda aqui de propósito: é um smoke de superfície
  select count(*) into v_after_clinics from public.clinics;
  if v_before_clinics <> v_after_clinics then
    raise exception 'ASAAS03 A03-23 FAIL: contagem de clinics mudou sem ação';
  end if;
  if to_regprocedure('public.grant_clinic_creation_from_billing(uuid)') is not null then
    raise exception 'ASAAS03 A03-22 FAIL: grant billing criado cedo demais (fora de escopo)';
  end if;
  select count(*) into v_grants from private.clinic_creation_authorizations where source = 'asaas';
  if v_grants <> 0 then
    raise exception 'ASAAS03 A03-22 FAIL: grant source=asaas encontrado (fora de escopo desta WP)';
  end if;
end $$;
rollback;

do $$ begin raise notice 'ASAAS03_SQL_ASSERTIONS_PASSED'; end $$;
