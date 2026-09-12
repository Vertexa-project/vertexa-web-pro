-- =====================================================================================
-- WP-ASAAS-05D · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260912221310 aplicada.
-- Fixtures sintéticos. Sem PII real. Sem HTTP Asaas.
-- OFFER REFERENCE != OFFER CLAIM.
-- commercial active ≠ financially entitled.
-- =====================================================================================

create or replace function pg_temp.asaas05d_seed()
returns table (c1 uuid, c2 uuid, c3 uuid, owner uuid, auth_id uuid)
language plpgsql
as $seed$
declare
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_c3 uuid := gen_random_uuid();
  v_pf uuid := gen_random_uuid();
  v_auth uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, v_auth, 'professional', 'Owner 05D', 'own-05d@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id) values
    (v_c1, 'Clinica 05D A', v_pf),
    (v_c2, 'Clinica 05D B', v_pf),
    (v_c3, 'Clinica 05D C', v_pf);
  return query select v_c1, v_c2, v_c3, v_pf, v_auth;
end;
$seed$;

create or replace function pg_temp.asaas05d_plan(p_code text)
returns uuid
language sql
as $$
  select pv.id
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = p_code and pv.version = 1;
$$;

create or replace function pg_temp.asaas05d_offer()
returns uuid
language sql
as $$
  select id from private.billing_offers where code = 'founder_2026';
$$;

create or replace function pg_temp.asaas05d_account_with_customer(p_clinic uuid, p_owner uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into private.billing_accounts (
    owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (
    p_owner, p_clinic, 'asaas', 'sandbox', 'cus_synth_' || replace(p_clinic::text, '-', '')
  )
  returning id into v_id;
  return v_id;
end;
$$;


-- T1: objetos 05D, RLS, 0 policies, 0 seed
begin;
do $$
declare
  v_n int;
  v_rls boolean;
begin
  if to_regclass('private.billing_customer_identities') is null then
    raise exception 'ASAAS05D T1 FAIL: identity table ausente';
  end if;
  select c.relrowsecurity into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_customer_identities';
  if v_rls is not true then
    raise exception 'ASAAS05D T1 FAIL: identity RLS off';
  end if;
  select count(*) into v_n
    from pg_policies
   where schemaname = 'private' and tablename = 'billing_customer_identities';
  if v_n <> 0 then
    raise exception 'ASAAS05D T1 FAIL: identity policies=%', v_n;
  end if;
  select count(*) into v_n from private.billing_customer_identities;
  if v_n <> 0 then
    raise exception 'ASAAS05D T1 FAIL: identity seed=%', v_n;
  end if;
  select count(*) into v_n from private.billing_commercial_contracts;
  if v_n <> 0 then
    raise exception 'ASAAS05D T1 FAIL: contract seed=%', v_n;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'private' and table_name = 'billing_subscriptions'
       and column_name = 'commercial_contract_id' and is_nullable = 'YES'
  ) then
    raise exception 'ASAAS05D T1 FAIL: commercial_contract_id ausente/not null';
  end if;
end $$;
rollback;

-- T2: grants fail-closed
begin;
do $$
begin
  if has_table_privilege('authenticated', 'private.billing_customer_identities', 'select')
     or has_table_privilege('anon', 'private.billing_customer_identities', 'select')
     or has_table_privilege('service_role', 'private.billing_customer_identities', 'select')
     or has_table_privilege('authenticated', 'private.billing_subscriptions', 'update')
     or has_function_privilege(
          'authenticated',
          'private.billing_prepare_contract_provider_provisioning(uuid,text,text,date)',
          'execute')
     or has_function_privilege(
          'anon',
          'private.billing_prepare_contract_provider_provisioning(uuid,text,text,date)',
          'execute')
     or has_function_privilege(
          'service_role',
          'private.billing_prepare_contract_provider_provisioning(uuid,text,text,date)',
          'execute')
     or has_function_privilege(
          'authenticated',
          'private.billing_bind_subscription_to_contract(uuid,uuid)',
          'execute')
     or has_function_privilege(
          'authenticated',
          'private.billing_commercial_contract_provider_state(uuid)',
          'execute')
     or has_function_privilege(
          'authenticated',
          'private.billing_cents_to_asaas_amount(integer)',
          'execute') then
    raise exception 'ASAAS05D T2 FAIL: client/service_role access';
  end if;
end $$;
rollback;

-- T3: sem RPC pública; produto sem gate; clinics sem plano
begin;
do $$
declare
  v_n int;
  v_src text;
begin
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'billing_prepare_contract_provider_provisioning',
       'billing_bind_subscription_to_contract',
       'billing_commercial_contract_provider_state',
       'subscribe_to_plan',
       'choose_plan',
       'create_contract'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05D T3 FAIL: RPC pública=%', v_n;
  end if;

  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clinics'
     and column_name in ('plan', 'plan_id', 'plan_code', 'plan_version_id', 'asaas_customer_id');
  if v_n <> 0 then
    raise exception 'ASAAS05D T3 FAIL: clinics ganhou billing';
  end if;

  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'private' and table_name = 'billing_commercial_contracts'
     and column_name in ('asaas_customer_id', 'asaas_subscription_id', 'provider_status', 'asaas_status');
  if v_n <> 0 then
    raise exception 'ASAAS05D T3 FAIL: contrato ganhou estado de provedor';
  end if;

  select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_patient'
   order by p.pronargs desc limit 1;
  if v_src ~* 'billing_prepare_contract_provider_provisioning|billing_commercial_contract_provider_state' then
    raise exception 'ASAAS05D T3 FAIL: create_patient gated';
  end if;
end $$;
rollback;

-- T4: conversão monetaria determinística
begin;
do $$
begin
  if private.billing_cents_to_asaas_amount(24700) is distinct from 247.00
     or private.billing_cents_to_asaas_amount(39000) is distinct from 390.00
     or private.billing_cents_to_asaas_amount(49700) is distinct from 497.00
     or private.billing_cents_to_asaas_amount(89000) is distinct from 890.00
     or private.billing_cents_to_asaas_amount(146700) is distinct from 1467.00 then
    raise exception 'ASAAS05D T4 FAIL: conversão';
  end if;
end $$;
rollback;

-- T5: Pulse standard 39000 → 390.00; customer reuse; subscription op 1x
begin;
do $$
declare
  s record;
  v_contract uuid;
  v_acc uuid;
  r1 jsonb;
  r2 jsonb;
  v_ops int;
  v_cust_ops int;
begin
  select * into s from pg_temp.asaas05d_seed();
  v_acc := pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('pulse'), null, now(), null
  );

  r1 := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  r2 := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );

  if (r1->>'contracted_price_cents')::int is distinct from 39000
     or (r1->>'asaas_amount')::numeric is distinct from 390.00
     or r1->>'asaas_cycle' is distinct from 'MONTHLY'
     or r1->>'contracted_currency' is distinct from 'BRL'
     or (r1->>'provider_customer_ready')::boolean is not true
     or r1->>'customer_operation' is not null
     or r1->'subscription_operation'->>'outcome' not in ('reserved', 'in_flight_retry', 'already_completed', 'claimed_for_retry')
     or r1->'subscription_operation'->>'operation_id'
          is distinct from r2->'subscription_operation'->>'operation_id' then
    raise exception 'ASAAS05D T5 FAIL: pulse r1=% r2=%', r1, r2;
  end if;

  select count(*) into v_ops
    from private.billing_outbound_operations
   where commercial_contract_id = v_contract
     and operation_type = 'create_subscription';
  select count(*) into v_cust_ops
    from private.billing_outbound_operations
   where billing_account_id = v_acc
     and operation_type = 'create_customer';
  if v_ops <> 1 or v_cust_ops <> 0 then
    raise exception 'ASAAS05D T5 FAIL: ops sub=% cust=%', v_ops, v_cust_ops;
  end if;
end $$;
rollback;

-- T6: Sync Founder 39000. OFFER REFERENCE != CLAIM
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
  v_slots int;
begin
  select * into s from pg_temp.asaas05d_seed();
  perform pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('sync'), pg_temp.asaas05d_offer(), now(), null
  );
  r := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  if (r->>'contracted_price_cents')::int is distinct from 39000
     or (r->>'asaas_amount')::numeric is distinct from 390.00
     or r->>'commercial_offer_id' is null then
    raise exception 'ASAAS05D T6 FAIL: sync founder r=%', r;
  end if;
  if to_regclass('private.billing_founder_claims') is not null then
    raise exception 'ASAAS05D T6 FAIL: founder claims table';
  end if;
  select total_slots into v_slots from private.billing_offers where code = 'founder_2026';
  if v_slots is distinct from 50 then
    raise exception 'ASAAS05D T6 FAIL: slots=%', v_slots;
  end if;
end $$;
rollback;

-- T7: Pulse Founder 24700 → 247.00; sem claim
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
begin
  select * into s from pg_temp.asaas05d_seed();
  perform pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('pulse'), pg_temp.asaas05d_offer(), now(), null
  );
  r := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  if (r->>'contracted_price_cents')::int is distinct from 24700
     or (r->>'asaas_amount')::numeric is distinct from 247.00 then
    raise exception 'ASAAS05D T7 FAIL: pulse founder r=%', r;
  end if;
end $$;
rollback;

-- T8: Apex standard 146700 → 1467.00
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
begin
  select * into s from pg_temp.asaas05d_seed();
  perform pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('apex'), null, now(), null
  );
  r := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  if (r->>'contracted_price_cents')::int is distinct from 146700
     or (r->>'asaas_amount')::numeric is distinct from 1467.00 then
    raise exception 'ASAAS05D T8 FAIL: apex r=%', r;
  end if;
end $$;
rollback;

-- T9: sem identidade + sem customer → falha antes de outbound
begin;
do $$
declare
  s record;
  v_contract uuid;
  v_ops int;
  v_accounts int;
begin
  select * into s from pg_temp.asaas05d_seed();
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('pulse'), null, now(), null
  );
  begin
    perform private.billing_prepare_contract_provider_provisioning(
      v_contract, 'sandbox', 'PIX', date '2030-01-15'
    );
    raise exception 'ASAAS05D T9 FAIL: deveria rejeitar identidade';
  exception
    when others then
      if sqlerrm not like '%BILLING_CUSTOMER_IDENTITY_INCOMPLETE%' then
        raise;
      end if;
  end;
  select count(*) into v_ops from private.billing_outbound_operations;
  select count(*) into v_accounts
    from private.billing_accounts where clinic_id = s.c1;
  if v_ops <> 0 or v_accounts <> 0 then
    raise exception 'ASAAS05D T9 FAIL: side effects ops=% acc=%', v_ops, v_accounts;
  end if;
end $$;
rollback;

-- T10: identidade presente, sem customer → reserve create_customer 1x; sem subscription
begin;
do $$
declare
  s record;
  v_contract uuid;
  r1 jsonb;
  r2 jsonb;
  v_cust int;
  v_sub int;
begin
  select * into s from pg_temp.asaas05d_seed();
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (s.c1, 'Clinica Sintetica LTDA', '99991111140', 'bill-05d@t.test');
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('sync'), null, now(), null
  );
  r1 := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  r2 := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  if (r1->>'provider_customer_ready')::boolean is not false
     or r1->'customer_operation'->>'operation_id' is null
     or r1->'customer_operation'->>'operation_id'
          is distinct from r2->'customer_operation'->>'operation_id'
     or r1->>'subscription_operation' is not null then
    raise exception 'ASAAS05D T10 FAIL: r1=% r2=%', r1, r2;
  end if;
  select count(*) into v_cust
    from private.billing_outbound_operations
   where commercial_contract_id = v_contract and operation_type = 'create_customer';
  select count(*) into v_sub
    from private.billing_outbound_operations
   where commercial_contract_id = v_contract and operation_type = 'create_subscription';
  if v_cust <> 1 or v_sub <> 0 then
    raise exception 'ASAAS05D T10 FAIL: cust=% sub=%', v_cust, v_sub;
  end if;
end $$;
rollback;

-- T11: retry / ambiguo — failed network_timeout não cria 2ª subscription
begin;
do $$
declare
  s record;
  v_contract uuid;
  r1 jsonb;
  r2 jsonb;
  v_op uuid;
  v_n int;
begin
  select * into s from pg_temp.asaas05d_seed();
  perform pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('pulse'), null, now(), null
  );
  r1 := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  v_op := (r1->'subscription_operation'->>'operation_id')::uuid;
  perform private.fail_billing_outbound_operation(v_op, 'network_timeout');

  r2 := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  if r2->'subscription_operation'->>'operation_id' is distinct from v_op::text
     or r2->'subscription_operation'->>'outcome' is distinct from 'claimed_for_retry' then
    raise exception 'ASAAS05D T11 FAIL: r2=%', r2;
  end if;
  select count(*) into v_n
    from private.billing_outbound_operations
   where commercial_contract_id = v_contract
     and operation_type = 'create_subscription';
  if v_n <> 1 then
    raise exception 'ASAAS05D T11 FAIL: n=%', v_n;
  end if;
end $$;
rollback;

-- T12: cancelled / ended / pending / unknown
begin;
do $$
declare
  s record;
  v_active uuid;
  v_n int;
begin
  select * into s from pg_temp.asaas05d_seed();
  perform pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_active := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('pulse'), null, now(), null
  );

  update private.billing_commercial_contracts set status = 'cancelled' where id = v_active;
  begin
    perform private.billing_prepare_contract_provider_provisioning(
      v_active, 'sandbox', 'PIX', date '2030-01-15'
    );
    raise exception 'ASAAS05D T12 FAIL: cancelled aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_CONTRACT_INELIGIBLE%' then
        raise;
      end if;
  end;

  update private.billing_commercial_contracts set status = 'ended' where id = v_active;
  begin
    perform private.billing_prepare_contract_provider_provisioning(
      v_active, 'sandbox', 'PIX', date '2030-01-15'
    );
    raise exception 'ASAAS05D T12 FAIL: ended aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_CONTRACT_INELIGIBLE%' then
        raise;
      end if;
  end;

  update private.billing_commercial_contracts set status = 'pending' where id = v_active;
  begin
    perform private.billing_prepare_contract_provider_provisioning(
      v_active, 'sandbox', 'PIX', date '2030-01-15'
    );
    raise exception 'ASAAS05D T12 FAIL: pending aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_CONTRACT_INELIGIBLE%' then
        raise;
      end if;
  end;

  begin
    perform private.billing_prepare_contract_provider_provisioning(
      gen_random_uuid(), 'sandbox', 'PIX', date '2030-01-15'
    );
    raise exception 'ASAAS05D T12 FAIL: unknown aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_CONTRACT_UNKNOWN%' then
        raise;
      end if;
  end;

  select count(*) into v_n from private.billing_outbound_operations;
  if v_n <> 0 then
    raise exception 'ASAAS05D T12 FAIL: outbound=%', v_n;
  end if;
end $$;
rollback;

-- T13: policy inputs — customer ready sem type/date NÃO reserva subscription
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
  v_n int;
begin
  select * into s from pg_temp.asaas05d_seed();
  perform pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('sync'), null, now(), null
  );
  r := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', null, null
  );
  if r->>'outcome' is distinct from 'blocked'
     or r->>'blocked_reason' is distinct from 'SUBSCRIPTION_BILLING_TYPE_POLICY_REQUIRED'
     or (r->>'asaas_amount')::numeric is distinct from 497.00
     or r->>'subscription_operation' is not null then
    raise exception 'ASAAS05D T13 FAIL: r=%', r;
  end if;
  r := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', null
  );
  if r->>'blocked_reason' is distinct from 'SUBSCRIPTION_DUE_DATE_POLICY_REQUIRED'
     or r->>'subscription_operation' is not null then
    raise exception 'ASAAS05D T13 FAIL: due date r=%', r;
  end if;
  select count(*) into v_n
    from private.billing_outbound_operations
   where operation_type = 'create_subscription';
  if v_n <> 0 then
    raise exception 'ASAAS05D T13 FAIL: reserved without policy n=%', v_n;
  end if;
end $$;
rollback;

-- T14: legado unbound + bind consistente + rebind proibido + price mismatch
begin;
do $$
declare
  s record;
  v_acc uuid;
  v_contract uuid;
  v_other uuid;
  v_sub uuid;
  v_legacy uuid;
  b1 jsonb;
  b2 jsonb;
  v_n int;
begin
  select * into s from pg_temp.asaas05d_seed();
  v_acc := pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  insert into private.billing_accounts (
    owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (
    s.owner, s.c2, 'asaas', 'sandbox', 'cus_legacy_unbound'
  );

  insert into private.billing_subscriptions (
    billing_account_id, provider, environment, external_subscription_id,
    external_reference, subscription_scope, billing_type, billing_cycle,
    value_cents, next_due_date
  ) values (
    (select id from private.billing_accounts where clinic_id = s.c2),
    'asaas', 'sandbox', 'sub_legacy_unbound',
    'vtx:sandbox:legacy:subscription:primary', 'primary', 'PIX', 'MONTHLY',
    1000, date '2026-01-01'
  )
  returning id into v_legacy;

  if (select commercial_contract_id from private.billing_subscriptions where id = v_legacy) is not null then
    raise exception 'ASAAS05D T14 FAIL: legado bindado';
  end if;

  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('pulse'), null, now(), null
  );
  v_other := private.billing_create_commercial_contract(
    s.c3, pg_temp.asaas05d_plan('pulse'), null, now(), null
  );

  insert into private.billing_subscriptions (
    billing_account_id, provider, environment, external_subscription_id,
    external_reference, subscription_scope, billing_type, billing_cycle,
    value_cents, next_due_date
  ) values (
    v_acc, 'asaas', 'sandbox', 'sub_new_05d',
    'vtx:sandbox:new05d:subscription:primary', 'primary', 'PIX', 'MONTHLY',
    39000, date '2030-01-15'
  )
  returning id into v_sub;

  b1 := private.billing_bind_subscription_to_contract(v_sub, v_contract);
  b2 := private.billing_bind_subscription_to_contract(v_sub, v_contract);
  if b1->>'outcome' is distinct from 'bound'
     or b2->>'outcome' is distinct from 'already_bound' then
    raise exception 'ASAAS05D T14 FAIL: bind b1=% b2=%', b1, b2;
  end if;

  begin
    perform private.billing_bind_subscription_to_contract(v_sub, v_other);
    raise exception 'ASAAS05D T14 FAIL: rebind aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_CONTRACT_REBIND_FORBIDDEN%' then
        raise;
      end if;
  end;

  begin
    perform private.billing_bind_subscription_to_contract(v_legacy, v_other);
    raise exception 'ASAAS05D T14 FAIL: legado clinic mismatch deveria falhar';
  exception
    when others then
      if sqlerrm not like '%BILLING_BIND_CLINIC_MISMATCH%' then
        raise;
      end if;
  end;

  update private.billing_subscriptions
     set value_cents = 1
   where id = v_legacy;
  -- legado permanece unbound
  if (select commercial_contract_id from private.billing_subscriptions where id = v_legacy) is not null then
    raise exception 'ASAAS05D T14 FAIL: legado reescrito';
  end if;

  select count(*) into v_n
    from private.billing_subscriptions
   where commercial_contract_id is null;
  if v_n < 1 then
    raise exception 'ASAAS05D T14 FAIL: nenhum unbound';
  end if;
end $$;
rollback;

-- T15: price mismatch no bind; state provisioned ≠ entitlement
begin;
do $$
declare
  s record;
  v_acc uuid;
  v_contract uuid;
  v_sub uuid;
  st jsonb;
begin
  select * into s from pg_temp.asaas05d_seed();
  v_acc := pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('apex'), null, now(), null
  );
  insert into private.billing_subscriptions (
    billing_account_id, provider, environment, external_subscription_id,
    external_reference, subscription_scope, billing_type, billing_cycle,
    value_cents, next_due_date
  ) values (
    v_acc, 'asaas', 'sandbox', 'sub_mismatch',
    'vtx:sandbox:mismatch:subscription:primary', 'primary', 'PIX', 'MONTHLY',
    39000, date '2030-01-15'
  )
  returning id into v_sub;

  begin
    perform private.billing_bind_subscription_to_contract(v_sub, v_contract);
    raise exception 'ASAAS05D T15 FAIL: mismatch aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_PRICE_MISMATCH%' then
        raise;
      end if;
  end;

  update private.billing_subscriptions set value_cents = 146700 where id = v_sub;
  perform private.billing_bind_subscription_to_contract(v_sub, v_contract);
  st := private.billing_commercial_contract_provider_state(v_contract);
  if st->>'provisioning_state' is distinct from 'provisioned'
     or (st->>'provider_subscription_ready')::boolean is not true then
    raise exception 'ASAAS05D T15 FAIL: state=%', st;
  end if;
  -- Contrato ativo + provisioned NÃO implica paid/entitled — só estado de binding.
  if (select status from private.billing_commercial_contracts where id = v_contract)
       is distinct from 'active' then
    raise exception 'ASAAS05D T15 FAIL: status comercial alterado';
  end if;
end $$;
rollback;

-- T16: subscriptions ainda sem colunas comerciais de catálogo; sem founder claim
begin;
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'private' and table_name = 'billing_subscriptions'
     and column_name in (
       'contracted_price_cents', 'commercial_offer_id', 'plan_code',
       'catalog_plan_version_id', 'contracted_currency'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05D T16 FAIL: subscriptions ganhou snapshot comercial';
  end if;
  if to_regclass('private.billing_founder_claims') is not null then
    raise exception 'ASAAS05D T16 FAIL: founder claims';
  end if;
end $$;
rollback;

-- T17: clinic.display name NÃO é identidade; Sync standard 49700
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
begin
  select * into s from pg_temp.asaas05d_seed();
  perform pg_temp.asaas05d_account_with_customer(s.c1, s.owner);
  v_contract := private.billing_create_commercial_contract(
    s.c1, pg_temp.asaas05d_plan('sync'), null, now(), null
  );
  r := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  if (r->>'contracted_price_cents')::int is distinct from 49700
     or (r->>'asaas_amount')::numeric is distinct from 497.00 then
    raise exception 'ASAAS05D T17 FAIL: r=%', r;
  end if;
  if exists (
    select 1 from private.billing_customer_identities i
     join public.clinics c on c.id = i.clinic_id
     where i.legal_name = c.name
  ) then
    raise exception 'ASAAS05D T17 FAIL: clinic.name usado como legal_name';
  end if;
end $$;
rollback;

do $$
begin
  raise notice 'ASAAS05D_SQL_ASSERTIONS_PASSED';
end $$;
