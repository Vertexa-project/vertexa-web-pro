-- =====================================================================================
-- WP-ASAAS-05E0B · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260913021500. Fixtures sintéticos. Sem HTTP Asaas. Sem seed permanente.
-- =====================================================================================

create or replace function pg_temp.asaas05e0b_seed()
returns table (
  clinic_id uuid,
  owner_id uuid,
  account_id uuid,
  contract_id uuid,
  auth_id uuid,
  contract_hex text,
  price_cents int
)
language plpgsql
as $seed$
declare
  v_clinic uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_auth_user uuid := gen_random_uuid();
  v_account uuid;
  v_contract uuid;
  v_auth uuid;
  v_hex text;
  v_plan uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (v_owner, v_auth_user, 'professional', 'Owner 05E0B', 'own-05e0b@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
  values (v_clinic, 'Clinica 05E0B', v_owner);

  insert into private.billing_accounts (
    owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (
    v_owner, v_clinic, 'asaas', 'sandbox', 'cus_05e0b'
  ) returning id into v_account;

  select pv.id into v_plan
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  v_contract := private.billing_create_commercial_contract(
    v_clinic, v_plan, null, now(), null
  );
  v_hex := replace(v_contract::text, '-', '');

  insert into private.billing_pix_automatic_authorizations (
    commercial_contract_id, billing_account_id, environment,
    provider_status, provider_contract_id, recurrence_start_date
  ) values (
    v_contract, v_account, 'sandbox', 'INTENT', v_hex, date '2026-10-12'
  ) returning id into v_auth;

  return query select v_clinic, v_owner, v_account, v_contract, v_auth, v_hex, 39000;
end;
$seed$;

create or replace function pg_temp.asaas05e0b_event(
  p_ext text,
  p_type text,
  p_resource_type text,
  p_resource_id text,
  p_created timestamptz,
  p_env text default 'sandbox'
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
    'asaas', p_env, p_ext, p_type, p_created,
    p_resource_type, p_resource_id, repeat('b', 64), 'processing'
  ) returning id into v_id;
  return v_id;
end;
$$;


-- T1: objetos, RLS, 0 seed
begin;
do $$
declare
  v_n int;
  v_rls boolean;
begin
  if to_regclass('private.billing_pix_automatic_payment_instructions') is null
     or to_regclass('private.billing_pix_automatic_eligibility') is null then
    raise exception 'ASAAS05E0B T1 FAIL: tabelas ausentes';
  end if;
  select c.relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_pix_automatic_payment_instructions';
  if v_rls is not true then
    raise exception 'ASAAS05E0B T1 FAIL: instruction RLS off';
  end if;
  select count(*) into v_n from private.billing_pix_automatic_authorizations;
  if v_n <> 0 then raise exception 'ASAAS05E0B T1 FAIL: auth seed=%', v_n; end if;
  select count(*) into v_n from private.billing_pix_automatic_payment_instructions;
  if v_n <> 0 then raise exception 'ASAAS05E0B T1 FAIL: instruction seed=%', v_n; end if;
  select count(*) into v_n from private.billing_pix_automatic_eligibility;
  if v_n <> 0 then raise exception 'ASAAS05E0B T1 FAIL: eligibility seed=%', v_n; end if;
  select count(*) into v_n from private.billing_commercial_contracts;
  if v_n <> 0 then raise exception 'ASAAS05E0B T1 FAIL: contract seed=%', v_n; end if;
end $$;
rollback;

-- T2: grants fail-closed + 8-arg ingest permanece
begin;
do $$
begin
  if has_table_privilege('authenticated', 'private.billing_pix_automatic_payment_instructions', 'select')
     or has_table_privilege('anon', 'private.billing_pix_automatic_eligibility', 'select')
     or has_table_privilege('service_role', 'private.billing_pix_automatic_payment_instructions', 'select')
     or has_function_privilege(
          'authenticated',
          'public.apply_billing_pix_automatic_authorization_event(uuid,text,text,text,text,text,integer,timestamptz,text,timestamptz)',
          'execute')
     or not has_function_privilege(
          'service_role',
          'public.ingest_billing_provider_event(text,text,text,text,timestamptz,text,text,text,jsonb)',
          'execute') then
    raise exception 'ASAAS05E0B T2 FAIL: grants';
  end if;
end $$;
rollback;

-- T3: classify agora processa Pix Automático; unknown futuro não é supported
begin;
do $$
declare r jsonb;
begin
  r := private.billing_classify_asaas_event('PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED');
  if (r->>'processing_supported')::boolean is not true then
    raise exception 'ASAAS05E0B T3 FAIL: created %', r;
  end if;
  r := private.billing_classify_asaas_event('PIX_AUTOMATIC_SOMETHING_NEW');
  if r->>'family' is distinct from 'unrecognized'
     or (r->>'processing_supported')::boolean is not false then
    raise exception 'ASAAS05E0B T3 FAIL: unknown %', r;
  end if;
  r := private.billing_classify_asaas_event('PAYMENT_RECEIVED');
  if (r->>'processing_supported')::boolean is not true then
    raise exception 'ASAAS05E0B T3 FAIL: payment';
  end if;
end $$;
rollback;

-- T4: CREATED → ACTIVE; um recurso; contrato intacto
begin;
do $$
declare
  s record;
  e1 uuid;
  e2 uuid;
  r jsonb;
  v_status text;
  v_price int;
  v_n int;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  e1 := pg_temp.asaas05e0b_event(
    'evt_created', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'pix_automatic_authorization', 'auth_prov_1', '2026-09-13 10:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e1, 'sandbox', 'auth_prov_1', 'CREATED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', 'ASAAS1', null
  );
  if r->>'outcome' is distinct from 'applied' then
    raise exception 'ASAAS05E0B T4 FAIL: created %', r;
  end if;

  e2 := pg_temp.asaas05e0b_event(
    'evt_active', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    'pix_automatic_authorization', 'auth_prov_1', '2026-09-13 11:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e2, 'sandbox', 'auth_prov_1', 'ACTIVE', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 11:00:00+00', null, null
  );
  if r->>'outcome' is distinct from 'applied'
     or r->>'provider_status' is distinct from 'ACTIVE'
     or (r->>'entitlement_granted')::boolean is not false
     or (r->>'commercial_mutated')::boolean is not false then
    raise exception 'ASAAS05E0B T4 FAIL: active %', r;
  end if;

  select provider_status into v_status
    from private.billing_pix_automatic_authorizations where id = s.auth_id;
  if v_status is distinct from 'ACTIVE' then
    raise exception 'ASAAS05E0B T4 FAIL: status=%', v_status;
  end if;
  select count(*) into v_n from private.billing_pix_automatic_authorizations
   where commercial_contract_id = s.contract_id;
  if v_n <> 1 then raise exception 'ASAAS05E0B T4 FAIL: rows=%', v_n; end if;
  select contracted_price_cents, status into v_price, v_status
    from private.billing_commercial_contracts where id = s.contract_id;
  if v_price is distinct from 39000 or v_status is distinct from 'active' then
    raise exception 'ASAAS05E0B T4 FAIL: contract mutated';
  end if;
end $$;
rollback;

-- T5: out-of-order CREATED após ACTIVE não regride
begin;
do $$
declare
  s record;
  e1 uuid;
  e2 uuid;
  r jsonb;
  v_status text;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  e1 := pg_temp.asaas05e0b_event(
    'evt_act', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    'pix_automatic_authorization', 'auth_prov_1', '2026-09-13 12:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e1, 'sandbox', 'auth_prov_1', 'ACTIVE', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 12:00:00+00', null, null
  );
  if r->>'outcome' is distinct from 'applied' then
    raise exception 'ASAAS05E0B T5 FAIL: first %', r;
  end if;
  e2 := pg_temp.asaas05e0b_event(
    'evt_old', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'pix_automatic_authorization', 'auth_prov_1', '2026-09-13 10:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e2, 'sandbox', 'auth_prov_1', 'CREATED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', null, null
  );
  if r->>'reason' is distinct from 'ignored_stale' then
    raise exception 'ASAAS05E0B T5 FAIL: stale %', r;
  end if;
  select provider_status into v_status
    from private.billing_pix_automatic_authorizations where id = s.auth_id;
  if v_status is distinct from 'ACTIVE' then
    raise exception 'ASAAS05E0B T5 FAIL: regress=%', v_status;
  end if;
end $$;
rollback;

-- T6: REFUSED não cancela contrato; CREATED stale não reabre
begin;
do $$
declare
  s record;
  e1 uuid;
  e2 uuid;
  r jsonb;
  v_cstatus text;
  v_pstatus text;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  e1 := pg_temp.asaas05e0b_event(
    'evt_c', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'pix_automatic_authorization', 'auth_ref', '2026-09-13 10:00:00+00'
  );
  perform private.apply_billing_pix_automatic_authorization_event(
    e1, 'sandbox', 'auth_ref', 'CREATED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', null, null
  );
  e2 := pg_temp.asaas05e0b_event(
    'evt_r', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED',
    'pix_automatic_authorization', 'auth_ref', '2026-09-13 11:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e2, 'sandbox', 'auth_ref', 'REFUSED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 11:00:00+00', null, null
  );
  if r->>'provider_status' is distinct from 'REFUSED' then
    raise exception 'ASAAS05E0B T6 FAIL: %', r;
  end if;
  select status into v_cstatus from private.billing_commercial_contracts where id = s.contract_id;
  if v_cstatus is distinct from 'active' then
    raise exception 'ASAAS05E0B T6 FAIL: contract=%', v_cstatus;
  end if;
  e1 := pg_temp.asaas05e0b_event(
    'evt_stale_c', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'pix_automatic_authorization', 'auth_ref', '2026-09-13 09:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e1, 'sandbox', 'auth_ref', 'CREATED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 09:00:00+00', null, null
  );
  select provider_status into v_pstatus
    from private.billing_pix_automatic_authorizations where id = s.auth_id;
  if v_pstatus is distinct from 'REFUSED' or r->>'reason' is distinct from 'ignored_stale' then
    raise exception 'ASAAS05E0B T6 FAIL: reopen % %', v_pstatus, r;
  end if;
end $$;
rollback;

-- T7: CANCELLED / EXPIRED seguros
begin;
do $$
declare
  s record;
  e uuid;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  e := pg_temp.asaas05e0b_event(
    'evt_a', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    'pix_automatic_authorization', 'auth_c', '2026-09-13 10:00:00+00'
  );
  perform private.apply_billing_pix_automatic_authorization_event(
    e, 'sandbox', 'auth_c', 'ACTIVE', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', null, null
  );
  e := pg_temp.asaas05e0b_event(
    'evt_x', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
    'pix_automatic_authorization', 'auth_c', '2026-09-13 12:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e, 'sandbox', 'auth_c', 'CANCELLED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 12:00:00+00', null, null
  );
  if r->>'provider_status' is distinct from 'CANCELLED' then
    raise exception 'ASAAS05E0B T7 FAIL: cancel %', r;
  end if;
  if (select status from private.billing_commercial_contracts where id = s.contract_id)
       is distinct from 'active' then
    raise exception 'ASAAS05E0B T7 FAIL: contract cancelled';
  end if;
end $$;
rollback;

begin;
do $$
declare
  s record;
  e uuid;
  r jsonb;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  e := pg_temp.asaas05e0b_event(
    'evt_e', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED',
    'pix_automatic_authorization', 'auth_e', '2026-09-13 10:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e, 'sandbox', 'auth_e', 'EXPIRED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', null, null
  );
  if r->>'outcome' is distinct from 'applied' then
    raise exception 'ASAAS05E0B T7b FAIL: %', r;
  end if;
end $$;
rollback;

-- T8: eligibility + stale
begin;
do $$
declare
  e uuid;
  r jsonb;
  v_status text;
begin
  e := pg_temp.asaas05e0b_event(
    'evt_el1', 'PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED',
    'pix_automatic_eligibility', 'acc_1', '2026-09-13 11:00:00+00'
  );
  r := private.apply_billing_pix_automatic_eligibility_event(
    e, 'sandbox', 'acc_1', 'ELIGIBLE', '2026-09-13 11:00:00+00'
  );
  if r->>'status' is distinct from 'ELIGIBLE'
     or (r->>'entitlement_granted')::boolean is not false then
    raise exception 'ASAAS05E0B T8 FAIL: el %', r;
  end if;
  e := pg_temp.asaas05e0b_event(
    'evt_el2', 'PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED',
    'pix_automatic_eligibility', 'acc_1', '2026-09-13 12:00:00+00'
  );
  perform private.apply_billing_pix_automatic_eligibility_event(
    e, 'sandbox', 'acc_1', 'INELIGIBLE', '2026-09-13 12:00:00+00'
  );
  e := pg_temp.asaas05e0b_event(
    'evt_el3', 'PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED',
    'pix_automatic_eligibility', 'acc_1', '2026-09-13 09:00:00+00'
  );
  r := private.apply_billing_pix_automatic_eligibility_event(
    e, 'sandbox', 'acc_1', 'ELIGIBLE', '2026-09-13 09:00:00+00'
  );
  if r->>'reason' is distinct from 'ignored_stale' then
    raise exception 'ASAAS05E0B T8 FAIL: stale %', r;
  end if;
  select status into v_status from private.billing_pix_automatic_eligibility
   where environment = 'sandbox' and provider_account_id = 'acc_1';
  if v_status is distinct from 'INELIGIBLE' then
    raise exception 'ASAAS05E0B T8 FAIL: status=%', v_status;
  end if;
end $$;
rollback;

-- T9: instruções — um row; duplicate converge; REFUSED/CANCELLED
begin;
do $$
declare
  s record;
  e uuid;
  r jsonb;
  v_n int;
  v_status text;
  v_pay text;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  e := pg_temp.asaas05e0b_event(
    'evt_ac', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'pix_automatic_authorization', 'auth_i', '2026-09-13 10:00:00+00'
  );
  perform private.apply_billing_pix_automatic_authorization_event(
    e, 'sandbox', 'auth_i', 'CREATED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', null, null
  );

  e := pg_temp.asaas05e0b_event(
    'evt_ic', 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED',
    'pix_automatic_payment_instruction', 'inst_1', '2026-09-13 10:05:00+00'
  );
  r := private.apply_billing_pix_automatic_instruction_event(
    e, 'sandbox', 'inst_1', 'AWAITING_REQUEST', 'auth_i', null, date '2026-10-04',
    '2026-09-13 10:05:00+00'
  );
  if r->>'financial_authority' is distinct from 'PAYMENT_EVENTS' then
    raise exception 'ASAAS05E0B T9 FAIL: created %', r;
  end if;
  e := pg_temp.asaas05e0b_event(
    'evt_is', 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED',
    'pix_automatic_payment_instruction', 'inst_1', '2026-09-13 10:06:00+00'
  );
  perform private.apply_billing_pix_automatic_instruction_event(
    e, 'sandbox', 'inst_1', 'SCHEDULED', 'auth_i', 'pay_1', date '2026-10-04',
    '2026-09-13 10:06:00+00'
  );
  e := pg_temp.asaas05e0b_event(
    'evt_is2', 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED',
    'pix_automatic_payment_instruction', 'inst_1', '2026-09-13 10:07:00+00'
  );
  perform private.apply_billing_pix_automatic_instruction_event(
    e, 'sandbox', 'inst_1', 'SCHEDULED', 'auth_i', 'pay_1', date '2026-10-04',
    '2026-09-13 10:07:00+00'
  );
  select count(*), min(status), min(provider_payment_id)
    into v_n, v_status, v_pay
    from private.billing_pix_automatic_payment_instructions
   where provider_instruction_id = 'inst_1';
  if v_n <> 1 or v_status is distinct from 'SCHEDULED' or v_pay is distinct from 'pay_1' then
    raise exception 'ASAAS05E0B T9 FAIL: n=% status=% pay=%', v_n, v_status, v_pay;
  end if;

  e := pg_temp.asaas05e0b_event(
    'evt_ir', 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED',
    'pix_automatic_payment_instruction', 'inst_2', '2026-09-13 10:08:00+00'
  );
  r := private.apply_billing_pix_automatic_instruction_event(
    e, 'sandbox', 'inst_2', 'REFUSED', 'auth_i', null, date '2026-10-04',
    '2026-09-13 10:08:00+00'
  );
  if r->>'outcome' is distinct from 'applied' then
    raise exception 'ASAAS05E0B T9 FAIL: refused %', r;
  end if;
  e := pg_temp.asaas05e0b_event(
    'evt_ix', 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CANCELLED',
    'pix_automatic_payment_instruction', 'inst_2', '2026-09-13 10:09:00+00'
  );
  perform private.apply_billing_pix_automatic_instruction_event(
    e, 'sandbox', 'inst_2', 'CANCELLED', 'auth_i', null, date '2026-10-04',
    '2026-09-13 10:09:00+00'
  );
end $$;
rollback;

-- T10: amount mismatch flag; preço comercial intacto
begin;
do $$
declare
  s record;
  e uuid;
  r jsonb;
  v_price int;
  v_flag boolean;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  e := pg_temp.asaas05e0b_event(
    'evt_mm', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'pix_automatic_authorization', 'auth_mm', '2026-09-13 10:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e, 'sandbox', 'auth_mm', 'CREATED', 'cus_05e0b', s.contract_hex,
    1000, '2026-09-13 10:00:00+00', null, null
  );
  if (r->>'amount_mismatch')::boolean is not true then
    raise exception 'ASAAS05E0B T10 FAIL: %', r;
  end if;
  select contracted_price_cents into v_price
    from private.billing_commercial_contracts where id = s.contract_id;
  select amount_mismatch into v_flag
    from private.billing_pix_automatic_authorizations where id = s.auth_id;
  if v_price is distinct from 39000 or v_flag is not true then
    raise exception 'ASAAS05E0B T10 FAIL: price=% flag=%', v_price, v_flag;
  end if;
end $$;
rollback;

-- T11: customer mismatch não faz bind
begin;
do $$
declare
  s record;
  e uuid;
  r jsonb;
  v_pid text;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  e := pg_temp.asaas05e0b_event(
    'evt_cm', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'pix_automatic_authorization', 'auth_cm', '2026-09-13 10:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e, 'sandbox', 'auth_cm', 'CREATED', 'cus_OTHER_TENANT', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', null, null
  );
  if r->>'reason' is distinct from 'customer_mismatch' then
    raise exception 'ASAAS05E0B T11 FAIL: %', r;
  end if;
  select provider_authorization_id into v_pid
    from private.billing_pix_automatic_authorizations where id = s.auth_id;
  if v_pid is not null then
    raise exception 'ASAAS05E0B T11 FAIL: bound %', v_pid;
  end if;
end $$;
rollback;

-- T12: sandbox não muta autorização production
begin;
do $$
declare
  s record;
  e uuid;
  r jsonb;
  v_status text;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  update private.billing_pix_automatic_authorizations
     set environment = 'production',
         provider_authorization_id = 'auth_prod',
         provider_status = 'ACTIVE'
   where id = s.auth_id;
  e := pg_temp.asaas05e0b_event(
    'evt_sb', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
    'pix_automatic_authorization', 'auth_prod', '2026-09-13 10:00:00+00', 'sandbox'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e, 'sandbox', 'auth_prod', 'CANCELLED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', null, null
  );
  if r->>'reason' is distinct from 'ignored_unmanaged_resource' then
    raise exception 'ASAAS05E0B T12 FAIL: %', r;
  end if;
  select provider_status into v_status
    from private.billing_pix_automatic_authorizations where id = s.auth_id;
  if v_status is distinct from 'ACTIVE' then
    raise exception 'ASAAS05E0B T12 FAIL: mutated=%', v_status;
  end if;
end $$;
rollback;

-- T13: ingest idempotente por event.id (assinatura única com facts opcional)
begin;
do $$
declare
  v1 jsonb;
  v2 jsonb;
  v_n int;
begin
  v1 := private.ingest_billing_provider_event(
    'asaas', 'sandbox', 'evt_dup', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    now(), 'pix_automatic_authorization', 'auth_1', repeat('c', 64)
  );
  v2 := private.ingest_billing_provider_event(
    'asaas', 'sandbox', 'evt_dup', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    now(), 'pix_automatic_authorization', 'auth_1', repeat('c', 64)
  );
  if v1->>'outcome' is distinct from 'inserted'
     or v2->>'outcome' is distinct from 'duplicate' then
    raise exception 'ASAAS05E0B T13 FAIL: % %', v1, v2;
  end if;
  select count(*) into v_n from private.billing_provider_events
   where external_event_id = 'evt_dup';
  if v_n <> 1 then raise exception 'ASAAS05E0B T13 FAIL: rows=%', v_n; end if;
end $$;
rollback;

-- T14: webhook CREATED resolve INTENT pendente (outbound complete)
begin;
do $$
declare
  s record;
  v_op uuid;
  e uuid;
  r jsonb;
  v_ostatus text;
  v_pid text;
begin
  select * into s from pg_temp.asaas05e0b_seed();
  insert into private.billing_outbound_operations (
    billing_account_id, provider, environment, operation_type,
    idempotency_key, external_reference, status, commercial_contract_id
  ) values (
    s.account_id, 'asaas', 'sandbox', 'create_pix_automatic_authorization',
    s.account_id::text || ':create_pix_automatic_authorization:primary:' || s.contract_id::text,
    'vtx:sandbox:' || s.account_id::text || ':pix_automatic_authorization:primary:' || s.contract_id::text,
    'pending', s.contract_id
  ) returning id into v_op;

  e := pg_temp.asaas05e0b_event(
    'evt_bind', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED',
    'pix_automatic_authorization', 'auth_bind', '2026-09-13 10:00:00+00'
  );
  r := private.apply_billing_pix_automatic_authorization_event(
    e, 'sandbox', 'auth_bind', 'CREATED', 'cus_05e0b', s.contract_hex,
    39000, '2026-09-13 10:00:00+00', 'QR1', null
  );
  if r->>'outcome' is distinct from 'applied' then
    raise exception 'ASAAS05E0B T14 FAIL: %', r;
  end if;
  select status, external_object_id into v_ostatus, v_pid
    from private.billing_outbound_operations where id = v_op;
  if v_ostatus is distinct from 'completed' or v_pid is distinct from 'auth_bind' then
    raise exception 'ASAAS05E0B T14 FAIL: op=% id=%', v_ostatus, v_pid;
  end if;
end $$;
rollback;

-- T15: Founder 50; sem enforcement; 8-arg classify PAYMENT
begin;
do $$
declare
  v_slots int;
begin
  if to_regclass('private.billing_founder_claims') is not null then
    raise exception 'ASAAS05E0B T15 FAIL: founder claims';
  end if;
  select total_slots into v_slots from private.billing_offers where code = 'founder_2026';
  if v_slots is distinct from 50 then
    raise exception 'ASAAS05E0B T15 FAIL: slots=%', v_slots;
  end if;
  if to_regprocedure('public.billing_prepare_pix_automatic_authorization(uuid,text)') is not null then
    raise exception 'ASAAS05E0B T15 FAIL: public prepare';
  end if;
end $$;
rollback;
