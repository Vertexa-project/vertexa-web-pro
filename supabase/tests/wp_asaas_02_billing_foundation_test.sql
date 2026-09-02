-- =====================================================================================
-- WP-ASAAS-02 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260830090000 aplicada.
-- Anon = has_*_privilege (sem SET ROLE anon — isolador PG 17.6 SIGSEGV).
-- =====================================================================================

create or replace function pg_temp.asaas02_seed()
returns table (pf_a uuid, pf_b uuid, c_exist uuid)
language plpgsql
as $seed$
declare
  v_pf_a uuid := gen_random_uuid();
  v_pf_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_a, gen_random_uuid(), 'professional', 'Owner A ASAAS02', 'a-asaas02@t.test', 'active'),
    (v_pf_b, gen_random_uuid(), 'professional', 'Owner B ASAAS02', 'b-asaas02@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_c, 'Clinica Existente ASAAS02', v_pf_a);
  return query select v_pf_a, v_pf_b, v_c;
end;
$seed$;


-- T1 / T17: tabelas private, RLS ON, 0 policies
begin;
do $$
declare
  v_n int;
  v_rls boolean;
begin
  if to_regclass('private.billing_accounts') is null
     or to_regclass('private.billing_provider_events') is null
     or to_regclass('private.billing_outbound_operations') is null then
    raise exception 'ASAAS02 T1 FAIL: tabela ausente';
  end if;
  select relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_accounts';
  if v_rls is not true then raise exception 'ASAAS02 T17 FAIL: RLS accounts'; end if;
  select relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_provider_events';
  if v_rls is not true then raise exception 'ASAAS02 T17 FAIL: RLS events'; end if;
  select relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_outbound_operations';
  if v_rls is not true then raise exception 'ASAAS02 T17 FAIL: RLS outbound'; end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'private'
     and tablename in (
       'billing_accounts',
       'billing_provider_events',
       'billing_outbound_operations'
     );
  if v_n <> 0 then raise exception 'ASAAS02 T17 FAIL: policies=%', v_n; end if;
end $$;
rollback;

-- T2 / T3 / T4 / T18: authenticated/anon sem table priv; ingest EXECUTE
begin;
do $$
begin
  if has_table_privilege('authenticated', 'private.billing_accounts', 'select')
     or has_table_privilege('authenticated', 'private.billing_accounts', 'insert')
     or has_table_privilege('authenticated', 'private.billing_provider_events', 'select')
     or has_table_privilege('authenticated', 'private.billing_provider_events', 'insert')
     or has_table_privilege('authenticated', 'private.billing_outbound_operations', 'select')
     or has_table_privilege('authenticated', 'private.billing_outbound_operations', 'insert') then
    raise exception 'ASAAS02 T2/T3 FAIL: authenticated table priv';
  end if;
  if has_table_privilege('anon', 'private.billing_accounts', 'select')
     or has_table_privilege('anon', 'private.billing_provider_events', 'insert')
     or has_table_privilege('anon', 'private.billing_outbound_operations', 'select') then
    raise exception 'ASAAS02 T4 FAIL: anon table priv';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.ingest_billing_provider_event(text,text,text,text,timestamptz,text,text,text)',
       'execute'
     ) then
    raise exception 'ASAAS02 T18 FAIL: authenticated execute ingest';
  end if;
  if has_function_privilege(
       'anon',
       'public.ingest_billing_provider_event(text,text,text,text,timestamptz,text,text,text)',
       'execute'
     ) then
    raise exception 'ASAAS02 T18 FAIL: anon execute ingest';
  end if;
  if not has_function_privilege(
       'service_role',
       'public.ingest_billing_provider_event(text,text,text,text,timestamptz,text,text,text)',
       'execute'
     ) then
    raise exception 'ASAAS02 T18 FAIL: service_role sem execute ingest';
  end if;
end $$;
rollback;

-- T5 / T6 / T7: owner FK, clinic nullable, owner NÃO unique
begin;
do $$
declare
  s record;
  v_a uuid;
  v_b uuid;
  v_c uuid;
begin
  select * into s from pg_temp.asaas02_seed();
  insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
    values (s.pf_a, null, 'asaas', 'sandbox')
    returning id into v_a;
  insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
    values (s.pf_a, null, 'asaas', 'sandbox')
    returning id into v_b;
  if v_a is null or v_b is null or v_a = v_b then
    raise exception 'ASAAS02 T7 FAIL: owner deveria poder ter 2 accounts';
  end if;
  begin
    insert into private.billing_accounts (owner_profile_id, provider, environment)
      values (gen_random_uuid(), 'asaas', 'sandbox');
    raise exception 'ASAAS02 T5 FAIL: owner FK deveria falhar';
  exception
    when foreign_key_violation then null;
  end;
  if (select clinic_id from private.billing_accounts where id = v_a) is not null then
    raise exception 'ASAAS02 T6 FAIL: clinic deveria ser null';
  end if;
end $$;
rollback;

-- T8: clinic binding unique quando NOT NULL
begin;
do $$
declare
  s record;
begin
  select * into s from pg_temp.asaas02_seed();
  insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
    values (s.pf_a, s.c_exist, 'asaas', 'sandbox');
  begin
    insert into private.billing_accounts (owner_profile_id, clinic_id, provider, environment)
      values (s.pf_b, s.c_exist, 'asaas', 'sandbox');
    raise exception 'ASAAS02 T8 FAIL: clinic unique deveria falhar';
  exception
    when unique_violation then null;
  end;
end $$;
rollback;

-- T9 / T10: environment e provider
begin;
do $$
declare
  s record;
begin
  select * into s from pg_temp.asaas02_seed();
  begin
    insert into private.billing_accounts (owner_profile_id, provider, environment)
      values (s.pf_a, 'asaas', 'staging');
    raise exception 'ASAAS02 T9 FAIL: environment inválido aceito';
  exception
    when check_violation then null;
  end;
  begin
    insert into private.billing_accounts (owner_profile_id, provider, environment)
      values (s.pf_a, 'stripe', 'sandbox');
    raise exception 'ASAAS02 T10 FAIL: provider inválido aceito';
  exception
    when check_violation then null;
  end;
end $$;
rollback;

-- T11: external_customer unique inclui environment
begin;
do $$
declare
  s record;
begin
  select * into s from pg_temp.asaas02_seed();
  insert into private.billing_accounts
    (owner_profile_id, provider, environment, external_customer_id)
    values (s.pf_a, 'asaas', 'sandbox', 'cus_same');
  insert into private.billing_accounts
    (owner_profile_id, provider, environment, external_customer_id)
    values (s.pf_b, 'asaas', 'production', 'cus_same');
  begin
    insert into private.billing_accounts
      (owner_profile_id, provider, environment, external_customer_id)
      values (s.pf_b, 'asaas', 'sandbox', 'cus_same');
    raise exception 'ASAAS02 T11 FAIL: mesmo customer sandbox deveria colidir';
  exception
    when unique_violation then null;
  end;
end $$;
rollback;

-- T12 / T13 / T14: ingest + idempotência + sandbox/prod
begin;
do $$
declare
  v1 jsonb;
  v2 jsonb;
  v3 jsonb;
  v_n int;
begin
  v1 := private.ingest_billing_provider_event(
    'asaas', 'sandbox', 'evt_t12', 'PAYMENT_CREATED', now(), 'payment', 'pay_1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  if v1->>'outcome' is distinct from 'inserted' then
    raise exception 'ASAAS02 T12 FAIL: %', v1;
  end if;
  v2 := private.ingest_billing_provider_event(
    'asaas', 'sandbox', 'evt_t12', 'PAYMENT_CREATED', now(), 'payment', 'pay_1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  if v2->>'outcome' is distinct from 'duplicate' then
    raise exception 'ASAAS02 T13 FAIL: %', v2;
  end if;
  select count(*) into v_n from private.billing_provider_events
   where external_event_id = 'evt_t12';
  if v_n <> 1 then raise exception 'ASAAS02 T13 FAIL: rows=%', v_n; end if;

  v3 := private.ingest_billing_provider_event(
    'asaas', 'production', 'evt_t12', 'PAYMENT_CREATED', now(), 'payment', 'pay_1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  if v3->>'outcome' is distinct from 'inserted' then
    raise exception 'ASAAS02 T14 FAIL: %', v3;
  end if;
  select count(*) into v_n from private.billing_provider_events
   where external_event_id = 'evt_t12';
  if v_n <> 2 then raise exception 'ASAAS02 T14 FAIL: sandbox+prod rows=%', v_n; end if;
end $$;
rollback;

-- T15: outbound idempotency unique
begin;
do $$
declare
  s record;
  v_acc uuid;
begin
  select * into s from pg_temp.asaas02_seed();
  insert into private.billing_accounts (owner_profile_id, provider, environment)
    values (s.pf_a, 'asaas', 'sandbox') returning id into v_acc;
  insert into private.billing_outbound_operations
    (billing_account_id, provider, environment, operation_type, idempotency_key, status)
    values (v_acc, 'asaas', 'sandbox', 'create_customer', 'acct-a:create_customer', 'pending');
  begin
    insert into private.billing_outbound_operations
      (billing_account_id, provider, environment, operation_type, idempotency_key, status)
      values (v_acc, 'asaas', 'sandbox', 'create_customer', 'acct-a:create_customer', 'pending');
    raise exception 'ASAAS02 T15 FAIL: outbound unique deveria falhar';
  exception
    when unique_violation then null;
  end;
end $$;
rollback;

-- T16: zero backfill — migration não cria account para clínicas já existentes
begin;
do $$
declare
  v_linked int;
begin
  select count(*) into v_linked
    from private.billing_accounts a
    join public.clinics c on c.id = a.clinic_id;
  if v_linked <> 0 then
    raise exception 'ASAAS02 T16 FAIL: backfill inesperado=%', v_linked;
  end if;
end $$;
rollback;

-- Extra: hash mismatch não sobrescreve; registra conflito; reentrega estável
begin;
do $$
declare
  v1 jsonb;
  v2 jsonb;
  v3 jsonb;
  v_type text;
  v_hash text;
  v_res text;
  v_status text;
  v_err text;
  v_n int;
begin
  v1 := private.ingest_billing_provider_event(
    'asaas', 'sandbox', 'evt_conflict', 'PAYMENT_CREATED', now(), 'payment', 'pay_1',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  v2 := private.ingest_billing_provider_event(
    'asaas', 'sandbox', 'evt_conflict', 'PAYMENT_RECEIVED', now(), 'payment', 'pay_9',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  );
  if v2->>'outcome' is distinct from 'conflict' then
    raise exception 'ASAAS02 conflict FAIL: %', v2;
  end if;
  select event_type, payload_hash, external_resource_id, processing_status, last_error_category
    into v_type, v_hash, v_res, v_status, v_err
    from private.billing_provider_events
   where external_event_id = 'evt_conflict' and environment = 'sandbox';
  if v_type is distinct from 'PAYMENT_CREATED' then
    raise exception 'ASAAS02 conflict FAIL: sobrescreveu type';
  end if;
  if v_hash is distinct from 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' then
    raise exception 'ASAAS02 conflict FAIL: sobrescreveu hash';
  end if;
  if v_res is distinct from 'pay_1' then
    raise exception 'ASAAS02 conflict FAIL: sobrescreveu resource';
  end if;
  if v_status is distinct from 'received' then
    raise exception 'ASAAS02 conflict FAIL: status=%', v_status;
  end if;
  if v_err is distinct from 'payload_hash_mismatch' then
    raise exception 'ASAAS02 conflict FAIL: last_error=%', v_err;
  end if;
  v3 := private.ingest_billing_provider_event(
    'asaas', 'sandbox', 'evt_conflict', 'PAYMENT_RECEIVED', now(), 'payment', 'pay_9',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  );
  if v3->>'outcome' is distinct from 'conflict' then
    raise exception 'ASAAS02 conflict replay FAIL: %', v3;
  end if;
  select count(*) into v_n from private.billing_provider_events
   where external_event_id = 'evt_conflict';
  if v_n <> 1 then raise exception 'ASAAS02 conflict replay FAIL: rows=%', v_n; end if;
end $$;
rollback;

-- Extra: SEC-02 intocado (objetos existem; esta WP não os recria)
begin;
do $$
begin
  if to_regclass('private.clinic_creation_authorizations') is null then
    raise exception 'ASAAS02 SEC-02 FAIL: authorizations sumiu';
  end if;
  if to_regprocedure('public.authorize_clinic_creation(uuid)') is null
     or to_regprocedure('public.create_clinic_with_owner(text)') is null then
    raise exception 'ASAAS02 SEC-02 FAIL: RPCs sumiram';
  end if;
  if to_regprocedure('public.grant_clinic_creation_from_billing(uuid)') is not null then
    raise exception 'ASAAS02 SEC-02 FAIL: grant billing criado cedo demais';
  end if;
end $$;
rollback;

do $$ begin raise notice 'ASAAS02_SQL_ASSERTIONS_PASSED'; end $$;
