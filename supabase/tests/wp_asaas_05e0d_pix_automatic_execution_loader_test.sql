-- =====================================================================================
-- WP-ASAAS-05E0D1 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260913104500. Fixtures sintéticos. Sem HTTP Asaas. Sem seed permanente.
-- =====================================================================================

create or replace function pg_temp.asaas05e0d1_plan()
returns uuid
language sql
as $$
  select pv.id
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;
$$;

create or replace function pg_temp.asaas05e0d1_seed(
  p_environment text,
  p_customer text
)
returns table (
  clinic_id uuid,
  owner_id uuid,
  account_id uuid,
  contract_id uuid,
  auth_id uuid,
  operation_id uuid,
  price_cents int
)
language plpgsql
as $seed$
declare
  v_clinic uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_account uuid;
  v_contract uuid;
  v_auth uuid;
  v_op uuid;
  v_plan uuid;
  v_price int;
  v_hex text;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (v_owner, gen_random_uuid(), 'professional', 'Owner 05E0D1', 'own-05e0d1@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
  values (v_clinic, 'Clinica 05E0D1', v_owner);

  insert into private.billing_accounts (
    owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (
    v_owner, v_clinic, 'asaas', p_environment, p_customer
  ) returning id into v_account;

  v_plan := pg_temp.asaas05e0d1_plan();
  v_contract := private.billing_create_commercial_contract(v_clinic, v_plan, null, now(), null);
  select contracted_price_cents into v_price
    from private.billing_commercial_contracts
   where id = v_contract;
  v_hex := replace(v_contract::text, '-', '');

  insert into private.billing_pix_automatic_authorizations (
    commercial_contract_id, billing_account_id, environment,
    provider_status, provider_contract_id, recurrence_start_date
  ) values (
    v_contract, v_account, p_environment, 'INTENT', v_hex, date '2026-10-12'
  ) returning id into v_auth;

  insert into private.billing_outbound_operations (
    billing_account_id, provider, environment, operation_type,
    idempotency_key, external_reference, status, commercial_contract_id
  ) values (
    v_account, 'asaas', p_environment, 'create_pix_automatic_authorization',
    v_account::text || ':create_pix_automatic_authorization:primary:' || v_contract::text,
    'vtx:' || p_environment || ':' || v_account::text || ':pix_automatic_authorization:primary:' || v_contract::text,
    'pending', v_contract
  ) returning id into v_op;

  return query select v_clinic, v_owner, v_account, v_contract, v_auth, v_op, v_price;
end;
$seed$;

create or replace function pg_temp.asaas05e0d1_fingerprint()
returns text
language sql
as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(id::text || '|' || status || '|' || coalesce(external_object_id, '')
      || '|' || attempt_count::text || '|' || coalesce(last_error_category, '')
      || '|' || updated_at::text, ',' ORDER BY id), '')
       from private.billing_outbound_operations),
    (select coalesce(string_agg(id::text || '|' || provider_status || '|'
      || coalesce(provider_authorization_id, '') || '|' || updated_at::text, ',' ORDER BY id), '')
       from private.billing_pix_automatic_authorizations),
    (select coalesce(string_agg(id::text || '|' || contracted_price_cents::text
      || '|' || status || '|' || updated_at::text, ',' ORDER BY id), '')
       from private.billing_commercial_contracts),
    (select coalesce(string_agg(id::text || '|' || coalesce(external_customer_id, '')
      || '|' || environment || '|' || updated_at::text, ',' ORDER BY id), '')
       from private.billing_accounts),
    (select coalesce(string_agg(id::text || '|' || coalesce(external_subscription_id, '')
      || '|' || updated_at::text, ',' ORDER BY id), '')
       from private.billing_subscriptions),
    (select coalesce(string_agg(id::text || '|' || coalesce(external_payment_id, '')
      || '|' || updated_at::text, ',' ORDER BY id), '')
       from private.billing_payments),
    (select coalesce(string_agg(id::text || '|' || processing_status || '|'
      || coalesce(last_error_category, ''), ',' ORDER BY id), '')
       from private.billing_provider_events)
  ));
$$;


-- T1: function exists
begin;
do $$
begin
  if to_regprocedure('public.load_prepared_pix_automatic_authorization(uuid)') is null
     or to_regprocedure('private.load_prepared_pix_automatic_authorization(uuid)') is null then
    raise exception 'ASAAS05E0D1 T1 FAIL: function missing';
  end if;
end $$;
rollback;

-- T2: authenticated denied
begin;
do $$
begin
  if has_function_privilege(
       'authenticated',
       'public.load_prepared_pix_automatic_authorization(uuid)',
       'execute')
     or has_function_privilege(
       'authenticated',
       'private.load_prepared_pix_automatic_authorization(uuid)',
       'execute') then
    raise exception 'ASAAS05E0D1 T2 FAIL: authenticated execute';
  end if;
end $$;
rollback;

-- T3: anon denied
begin;
do $$
begin
  if has_function_privilege(
       'anon',
       'public.load_prepared_pix_automatic_authorization(uuid)',
       'execute')
     or has_function_privilege(
       'anon',
       'private.load_prepared_pix_automatic_authorization(uuid)',
       'execute') then
    raise exception 'ASAAS05E0D1 T3 FAIL: anon execute';
  end if;
end $$;
rollback;

-- T4: service_role allowed on public wrapper only; actual call works
begin;
do $$
declare
  s record;
  r jsonb;
begin
  if not has_function_privilege(
       'service_role',
       'public.load_prepared_pix_automatic_authorization(uuid)',
       'execute') then
    raise exception 'ASAAS05E0D1 T4 FAIL: service_role public denied';
  end if;
  if has_function_privilege(
       'service_role',
       'private.load_prepared_pix_automatic_authorization(uuid)',
       'execute') then
    raise exception 'ASAAS05E0D1 T4 FAIL: service_role private execute';
  end if;

  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_05e0d1');
  set local role service_role;
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  reset role;
  if (r->>'found')::boolean is not true or r->>'operation_id' is distinct from s.operation_id::text then
    raise exception 'ASAAS05E0D1 T4 FAIL: %', r;
  end if;
end $$;
rollback;

-- T5: search_path locked + SECURITY DEFINER
begin;
do $$
declare
  v_definer boolean;
  v_cfg text[];
begin
  select p.prosecdef, p.proconfig
    into v_definer, v_cfg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'load_prepared_pix_automatic_authorization';
  if v_definer is not true then
    raise exception 'ASAAS05E0D1 T5 FAIL: public not definer';
  end if;
  if not exists (
    select 1 from unnest(coalesce(v_cfg, array[]::text[])) cfg
     where cfg in ('search_path=', 'search_path=""', 'search_path=''''')
  ) then
    raise exception 'ASAAS05E0D1 T5 FAIL: public search_path %', v_cfg;
  end if;

  select p.prosecdef, p.proconfig
    into v_definer, v_cfg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = 'load_prepared_pix_automatic_authorization';
  if v_definer is not true then
    raise exception 'ASAAS05E0D1 T5 FAIL: private not definer';
  end if;
  if not exists (
    select 1 from unnest(coalesce(v_cfg, array[]::text[])) cfg
     where cfg in ('search_path=', 'search_path=""', 'search_path=''''')
  ) then
    raise exception 'ASAAS05E0D1 T5 FAIL: private search_path %', v_cfg;
  end if;
end $$;
rollback;

-- T6: missing operation fails closed
begin;
do $$
declare r jsonb;
begin
  r := public.load_prepared_pix_automatic_authorization('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if r->>'found' is distinct from 'false'
     or r->>'error' is distinct from 'operation_not_found'
     or r ? 'contracted_price_cents'
     or r ? 'external_customer_id' then
    raise exception 'ASAAS05E0D1 T6 FAIL: %', r;
  end if;
end $$;
rollback;

-- T7: wrong provider fails closed (schema CHECK + function guard)
begin;
do $$
declare
  v_src text;
  v_chk text;
begin
  select pg_get_functiondef('private.load_prepared_pix_automatic_authorization(uuid)'::regprocedure)
    into v_src;
  if v_src not like '%operation_provider_mismatch%'
     or v_src not like '%asaas%' then
    raise exception 'ASAAS05E0D1 T7 FAIL: provider guard missing';
  end if;
  select pg_get_constraintdef(oid) into v_chk
    from pg_constraint
   where conname = 'billing_outbound_operations_provider_check';
  if v_chk not like '%asaas%' then
    raise exception 'ASAAS05E0D1 T7 FAIL: provider check %', v_chk;
  end if;
end $$;
rollback;

-- T8: wrong operation type fails closed
begin;
do $$
declare
  s record;
  v_op uuid;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_05e0d1');
  insert into private.billing_outbound_operations (
    billing_account_id, provider, environment, operation_type,
    idempotency_key, status, commercial_contract_id
  ) values (
    s.account_id, 'asaas', 'sandbox', 'create_subscription',
    s.account_id::text || ':create_subscription:primary:' || s.contract_id::text,
    'pending', s.contract_id
  ) returning id into v_op;
  r := public.load_prepared_pix_automatic_authorization(v_op);
  if r->>'found' is distinct from 'false'
     or r->>'error' is distinct from 'operation_type_mismatch' then
    raise exception 'ASAAS05E0D1 T8 FAIL: %', r;
  end if;
end $$;
rollback;

-- T9: sandbox intent loads trusted sandbox environment
begin;
do $$
declare
  s record;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_sandbox_05e0d1');
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  if r->>'environment' is distinct from 'sandbox'
     or r->>'load_state' is distinct from 'actionable'
     or (r->>'actionable')::boolean is not true
     or r->>'operation_status' is distinct from 'pending' then
    raise exception 'ASAAS05E0D1 T9 FAIL: %', r;
  end if;
end $$;
rollback;

-- T10: production intent loads trusted production environment
begin;
do $$
declare
  s record;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0d1_seed('production', 'cus_prod_05e0d1');
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  if r->>'environment' is distinct from 'production'
     or r->>'external_customer_id' is distinct from 'cus_prod_05e0d1' then
    raise exception 'ASAAS05E0D1 T10 FAIL: %', r;
  end if;
end $$;
rollback;

-- T11: customer ID from DB only (including null)
begin;
do $$
declare
  s record;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_db_only');
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  if r->>'external_customer_id' is distinct from 'cus_db_only' then
    raise exception 'ASAAS05E0D1 T11 FAIL: customer %', r;
  end if;

  update private.billing_accounts
     set external_customer_id = null
   where id = s.account_id;
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  if r->>'external_customer_id' is not null or (r->>'found')::boolean is not true then
    raise exception 'ASAAS05E0D1 T11 FAIL: null customer %', r;
  end if;
end $$;
rollback;

-- T12: price from contract snapshot only (never current catalog/offer)
begin;
do $$
declare
  s record;
  r jsonb;
  v_catalog int;
  v_src text;
begin
  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_05e0d1');
  select standard_price_cents into v_catalog
    from private.billing_plan_versions
   where id = pg_temp.asaas05e0d1_plan();
  select pg_get_functiondef('private.load_prepared_pix_automatic_authorization(uuid)'::regprocedure)
    into v_src;
  if v_src like '%standard_price_cents%'
     or v_src like '%billing_offer_plan_prices%'
     or v_src like '%billing_offers%' then
    raise exception 'ASAAS05E0D1 T12 FAIL: loader reads catalog';
  end if;
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  if (r->>'contracted_price_cents')::int is distinct from s.price_cents
     or (r->>'contracted_price_cents')::int is distinct from (
          select contracted_price_cents from private.billing_commercial_contracts where id = s.contract_id
        )
     or r->>'contracted_currency' is distinct from 'BRL'
     or v_catalog is null then
    raise exception 'ASAAS05E0D1 T12 FAIL: price=% catalog=% r=%', s.price_cents, v_catalog, r;
  end if;
end $$;
rollback;

-- T13: caller cannot supply amount/customer/environment — only operation_id
begin;
do $$
declare
  v_args text;
  v_n int;
begin
  select pg_get_function_identity_arguments(
           'public.load_prepared_pix_automatic_authorization(uuid)'::regprocedure
         )
    into v_args;
  if v_args is distinct from 'p_operation_id uuid' then
    raise exception 'ASAAS05E0D1 T13 FAIL: args=%', v_args;
  end if;
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname = 'load_prepared_pix_automatic_authorization';
  if v_n <> 2 then
    raise exception 'ASAAS05E0D1 T13 FAIL: overloads=%', v_n;
  end if;
end $$;
rollback;

-- T14: account/contract clinic mismatch fails closed
begin;
do $$
declare
  a record;
  b record;
  v_op uuid;
  r jsonb;
begin
  select * into a from pg_temp.asaas05e0d1_seed('sandbox', 'cus_a');
  select * into b from pg_temp.asaas05e0d1_seed('sandbox', 'cus_b');
  insert into private.billing_outbound_operations (
    billing_account_id, provider, environment, operation_type,
    idempotency_key, status, commercial_contract_id
  ) values (
    b.account_id, 'asaas', 'sandbox', 'create_pix_automatic_authorization',
    b.account_id::text || ':create_pix_automatic_authorization:cross:' || a.contract_id::text,
    'pending', a.contract_id
  ) returning id into v_op;
  r := public.load_prepared_pix_automatic_authorization(v_op);
  if r->>'found' is distinct from 'false'
     or r->>'error' is distinct from 'relationship_mismatch' then
    raise exception 'ASAAS05E0D1 T14 FAIL: %', r;
  end if;
end $$;
rollback;

-- T15: operation bound to another contract's authorization fails closed
begin;
do $$
declare
  a record;
  b record;
  r jsonb;
begin
  select * into a from pg_temp.asaas05e0d1_seed('sandbox', 'cus_a');
  select * into b from pg_temp.asaas05e0d1_seed('sandbox', 'cus_b');
  update private.billing_outbound_operations
     set pix_authorization_id = b.auth_id
   where id = a.operation_id;
  r := public.load_prepared_pix_automatic_authorization(a.operation_id);
  if r->>'found' is distinct from 'false'
     or r->>'error' is distinct from 'relationship_mismatch' then
    raise exception 'ASAAS05E0D1 T15 FAIL: %', r;
  end if;
end $$;
rollback;

-- T16: completed operation loads as already_completed / no-op capable
begin;
do $$
declare
  s record;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_05e0d1');
  update private.billing_outbound_operations
     set status = 'completed',
         external_object_id = 'auth_done',
         completed_at = clock_timestamp()
   where id = s.operation_id;
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  if r->>'load_state' is distinct from 'already_completed'
     or r->>'operation_status' is distinct from 'completed'
     or (r->>'actionable')::boolean is not true then
    raise exception 'ASAAS05E0D1 T16 FAIL: %', r;
  end if;
end $$;
rollback;

-- T17: ambiguous/unknown operation remains loadable for reconciliation
begin;
do $$
declare
  s record;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_05e0d1');
  update private.billing_outbound_operations
     set status = 'failed',
         last_error_category = 'network_timeout'
   where id = s.operation_id;
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  if r->>'found' is distinct from 'true'
     or r->>'load_state' is distinct from 'outcome_unknown_requires_reconciliation'
     or (r->>'actionable')::boolean is not true
     or r->>'last_error_category' is distinct from 'network_timeout'
     or r->>'external_customer_id' is distinct from 'cus_05e0d1'
     or r->>'commercial_contract_id' is distinct from s.contract_id::text then
    raise exception 'ASAAS05E0D1 T17 FAIL: %', r;
  end if;
end $$;
rollback;

-- T18: invocation causes zero DB state mutation
begin;
do $$
declare
  s record;
  before_fp text;
  after_fp text;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_05e0d1');
  before_fp := pg_temp.asaas05e0d1_fingerprint();
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  after_fp := pg_temp.asaas05e0d1_fingerprint();
  if (r->>'found')::boolean is not true then
    raise exception 'ASAAS05E0D1 T18 FAIL: load %', r;
  end if;
  if before_fp is distinct from after_fp then
    raise exception 'ASAAS05E0D1 T18 FAIL: mutated % -> %', before_fp, after_fp;
  end if;
end $$;
rollback;

-- T19: no Billing Profile PII returned
begin;
do $$
declare
  s record;
  r jsonb;
  v_keys text;
begin
  select * into s from pg_temp.asaas05e0d1_seed('sandbox', 'cus_05e0d1');
  insert into private.billing_customer_identities (
    clinic_id, legal_name, tax_id, email, mobile_phone
  ) values (
    s.clinic_id, 'SECRET LEGAL NAME LTDA', '99991111140', 'secret-pii@t.test', '11999990000'
  );
  r := public.load_prepared_pix_automatic_authorization(s.operation_id);
  v_keys := (select string_agg(k, ',' ORDER BY k) from jsonb_object_keys(r) k);
  if r::text ilike '%SECRET LEGAL%'
     or r::text ilike '%99991111140%'
     or r::text ilike '%secret-pii@%'
     or r::text ilike '%11999990000%'
     or r ? 'tax_id'
     or r ? 'legal_name'
     or r ? 'email'
     or r ? 'mobile_phone'
     or r ? 'full_name' then
    raise exception 'ASAAS05E0D1 T19 FAIL: pii leaked keys=% r=%', v_keys, r;
  end if;
end $$;
rollback;

-- T20: PUBLIC / authenticated execute denied (explicit ACL)
begin;
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    left join pg_roles r on r.oid = acl.grantee
   where n.nspname = 'public'
     and p.proname = 'load_prepared_pix_automatic_authorization'
     and acl.privilege_type = 'EXECUTE'
     and (
       acl.grantee = 0
       or r.rolname in ('anon', 'authenticated', 'PUBLIC')
     );
  if v_bad <> 0 then
    raise exception 'ASAAS05E0D1 T20 FAIL: leaked execute grants=%', v_bad;
  end if;
  if has_function_privilege(
       'authenticated',
       'public.load_prepared_pix_automatic_authorization(uuid)',
       'execute') then
    raise exception 'ASAAS05E0D1 T20 FAIL: authenticated execute';
  end if;
end $$;
rollback;

-- Compat: old Edge signatures used by webhook v9 / processor v8 / cron v8 / outbound v11
begin;
do $$
begin
  if to_regprocedure('public.ingest_billing_provider_event(text,text,text,text,timestamptz,text,text,text,jsonb)') is null
     or to_regprocedure('public.claim_billing_provider_events(text,text,integer)') is null
     or to_regprocedure('public.reserve_billing_outbound_operation(uuid,text,text,text,text,text)') is null
     or to_regprocedure('public.complete_billing_customer_operation(uuid,text)') is null
     or to_regprocedure('public.complete_billing_subscription_operation(uuid,text,text,text,text,integer,date,text)') is null
     or to_regprocedure('public.fail_billing_outbound_operation(uuid,text)') is null
     or to_regprocedure('public.complete_billing_pix_automatic_authorization_operation(uuid,text,text,text,text,timestamptz)') is null
     or to_regprocedure('public.apply_billing_pix_automatic_authorization_event(uuid,text,text,text,text,text,integer,timestamptz,text,timestamptz)') is null
     or to_regprocedure('private.invoke_asaas_processor_cron()') is null then
    raise exception 'ASAAS05E0D1 COMPAT FAIL: old Edge signature missing';
  end if;
end $$;
rollback;
