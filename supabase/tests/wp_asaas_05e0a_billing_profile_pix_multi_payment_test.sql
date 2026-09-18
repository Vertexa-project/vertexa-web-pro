-- =====================================================================================
-- WP-ASAAS-05E0A · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260912233000 aplicada.
-- Fixtures sintéticos. Sem PII real. Sem HTTP Asaas.
-- commercial active ≠ financially entitled.
-- PIX != PIX_AUTOMATIC.
-- =====================================================================================

create or replace function pg_temp.asaas05e0a_seed()
returns table (
  clinic_a uuid,
  clinic_b uuid,
  owner_a uuid,
  auth_owner_a uuid,
  member_a uuid,
  auth_member_a uuid,
  owner_b uuid,
  auth_owner_b uuid,
  pa_profile uuid,
  auth_pa uuid
)
language plpgsql
as $seed$
declare
  v_clinic_a uuid := gen_random_uuid();
  v_clinic_b uuid := gen_random_uuid();
  v_owner_a uuid := gen_random_uuid();
  v_auth_owner_a uuid := gen_random_uuid();
  v_member_a uuid := gen_random_uuid();
  v_auth_member_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_auth_owner_b uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid();
  v_auth_pa uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values
    (v_owner_a, v_auth_owner_a, 'professional', 'Owner A 05E0A', 'own-a-05e0a@t.test', 'active'),
    (v_member_a, v_auth_member_a, 'professional', 'Member A 05E0A', 'mem-a-05e0a@t.test', 'active'),
    (v_owner_b, v_auth_owner_b, 'professional', 'Owner B 05E0A', 'own-b-05e0a@t.test', 'active'),
    (v_pa, v_auth_pa, 'professional', 'PA 05E0A', 'pa-05e0a@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id)
  values
    (v_clinic_a, 'Clinica 05E0A A', v_owner_a),
    (v_clinic_b, 'Clinica 05E0A B', v_owner_b);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values (v_member_a, v_clinic_a, 'nutritionist', 'member');

  insert into private.platform_admins (profile_id, status)
  values (v_pa, 'active');

  return query select
    v_clinic_a, v_clinic_b, v_owner_a, v_auth_owner_a,
    v_member_a, v_auth_member_a, v_owner_b, v_auth_owner_b,
    v_pa, v_auth_pa;
end;
$seed$;

create or replace function pg_temp.asaas05e0a_plan(p_code text)
returns uuid
language sql
as $$
  select pv.id
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = p_code and pv.version = 1;
$$;

create or replace function pg_temp.asaas05e0a_offer()
returns uuid
language sql
as $$
  select id from private.billing_offers where code = 'founder_2026';
$$;

create or replace function pg_temp.asaas05e0a_account_with_customer(p_clinic uuid, p_owner uuid)
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

create or replace function pg_temp.asaas05e0a_as(p_auth uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth::text)::text, true);
end;
$$;


-- T1: objetos, RLS, 0 policies, 0 seed
begin;
do $$
declare
  v_n int;
  v_rls boolean;
begin
  if to_regclass('private.billing_pix_automatic_authorizations') is null then
    raise exception 'ASAAS05E0A T1 FAIL: authorization table ausente';
  end if;
  select c.relrowsecurity into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_pix_automatic_authorizations';
  if v_rls is not true then
    raise exception 'ASAAS05E0A T1 FAIL: pix auth RLS off';
  end if;
  select count(*) into v_n
    from pg_policies
   where schemaname = 'private'
     and tablename in ('billing_pix_automatic_authorizations', 'billing_customer_identities');
  if v_n <> 0 then
    raise exception 'ASAAS05E0A T1 FAIL: policies=%', v_n;
  end if;
  select count(*) into v_n from private.billing_pix_automatic_authorizations;
  if v_n <> 0 then
    raise exception 'ASAAS05E0A T1 FAIL: pix auth seed=%', v_n;
  end if;
  select count(*) into v_n from private.billing_customer_identities;
  if v_n <> 0 then
    raise exception 'ASAAS05E0A T1 FAIL: identity seed=%', v_n;
  end if;
  select count(*) into v_n from private.billing_commercial_contracts;
  if v_n <> 0 then
    raise exception 'ASAAS05E0A T1 FAIL: contract seed=%', v_n;
  end if;
end $$;
rollback;

-- T2: grants fail-closed
begin;
do $$
begin
  if has_table_privilege('authenticated', 'private.billing_pix_automatic_authorizations', 'select')
     or has_table_privilege('anon', 'private.billing_pix_automatic_authorizations', 'select')
     or has_table_privilege('service_role', 'private.billing_pix_automatic_authorizations', 'select')
     or has_function_privilege(
          'authenticated',
          'private.billing_prepare_pix_automatic_authorization(uuid,text)',
          'execute')
     or has_function_privilege(
          'anon',
          'private.billing_prepare_pix_automatic_authorization(uuid,text)',
          'execute')
     or has_function_privilege(
          'service_role',
          'private.billing_prepare_pix_automatic_authorization(uuid,text)',
          'execute')
     or has_function_privilege(
          'authenticated',
          'private.billing_tax_id_is_valid(text)',
          'execute')
     or has_function_privilege(
          'anon',
          'public.get_my_clinic_billing_identity(uuid)',
          'execute')
     or has_function_privilege(
          'anon',
          'public.upsert_my_clinic_billing_identity(uuid,text,text,text,text)',
          'execute')
     or has_function_privilege(
          'service_role',
          'public.get_my_clinic_billing_identity(uuid)',
          'execute')
     or not has_function_privilege(
          'authenticated',
          'public.get_my_clinic_billing_identity(uuid)',
          'execute')
     or not has_function_privilege(
          'authenticated',
          'public.upsert_my_clinic_billing_identity(uuid,text,text,text,text)',
          'execute') then
    raise exception 'ASAAS05E0A T2 FAIL: grants';
  end if;
end $$;
rollback;

-- T3: contrato permanece payment-neutral; sem RPC de checkout/prepare
begin;
do $$
declare
  v_n int;
  v_src text;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'private'
     and table_name = 'billing_commercial_contracts'
     and column_name in (
       'payment_method', 'pix_status', 'card_status',
       'asaas_customer_id', 'authorization_id', 'provider_status'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05E0A T3 FAIL: contrato ganhou pagamento';
  end if;

  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'billing_prepare_pix_automatic_authorization',
       'billing_prepare_contract_provider_provisioning',
       'subscribe_to_plan',
       'choose_plan',
       'create_contract'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05E0A T3 FAIL: RPC pública de provisionamento=%', v_n;
  end if;

  select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_patient'
   order by p.pronargs desc limit 1;
  if v_src ~* 'billing_prepare_pix_automatic|get_my_clinic_billing_identity|upsert_my_clinic_billing_identity' then
    raise exception 'ASAAS05E0A T3 FAIL: create_patient gated';
  end if;
end $$;
rollback;

-- T4: CPF/CNPJ checksum + normalização
begin;
do $$
begin
  if private.billing_normalize_tax_id('123.456.789-00') is distinct from '12345678900' then
    raise exception 'ASAAS05E0A T4 FAIL: cpf normalize';
  end if;
  if private.billing_normalize_tax_id('12.345.678/0001-90') is distinct from '12345678000190' then
    raise exception 'ASAAS05E0A T4 FAIL: cnpj normalize';
  end if;
  if private.billing_tax_id_is_valid('99991111140') is not true then
    raise exception 'ASAAS05E0A T4 FAIL: cpf sandbox válido rejeitado';
  end if;
  if private.billing_tax_id_is_valid('11222333000181') is not true then
    raise exception 'ASAAS05E0A T4 FAIL: cnpj válido rejeitado';
  end if;
  if private.billing_tax_id_is_valid('123.456.789-00') is not false
     or private.billing_tax_id_is_valid('11111111111') is not false
     or private.billing_tax_id_is_valid('00000000000') is not false
     or private.billing_tax_id_is_valid('123') is not false
     or private.billing_tax_id_is_valid('') is not false
     or private.billing_tax_id_is_valid(null) is not false
     or private.billing_tax_id_is_valid('11222333000180') is not false
     or private.billing_tax_id_is_valid('00000000000000') is not false then
    raise exception 'ASAAS05E0A T4 FAIL: inválidos aceitos';
  end if;
  if private.billing_mask_tax_id('99991111140') is distinct from '***.***.***-40' then
    raise exception 'ASAAS05E0A T4 FAIL: cpf mask';
  end if;
  if private.billing_mask_tax_id('11222333000181') is distinct from '**.***.***/****-81' then
    raise exception 'ASAAS05E0A T4 FAIL: cnpj mask';
  end if;
end $$;
rollback;

-- T5: Billing Profile authz — admin allow, member/foreign/PA/anon deny
begin;
do $$
declare
  s record;
  v jsonb;
  v_denied boolean;
begin
  select * into s from pg_temp.asaas05e0a_seed();

  perform pg_temp.asaas05e0a_as(s.auth_owner_a);
  set local role authenticated;
  v := public.get_my_clinic_billing_identity(s.clinic_a);
  if (v->>'exists')::boolean is not false then
    raise exception 'ASAAS05E0A T5 FAIL: empty exists=%', v;
  end if;
  v := public.upsert_my_clinic_billing_identity(
    s.clinic_a, 'Clinica Sintetica LTDA', '999.911.111-40', '  BILL-A@T.TEST ', null
  );
  reset role;

  if v->>'legal_name' is distinct from 'Clinica Sintetica LTDA'
     or v->>'tax_id' is distinct from '99991111140'
     or v->>'tax_id_masked' is distinct from '***.***.***-40'
     or v->>'email' is distinct from 'bill-a@t.test'
     or (v->>'is_complete')::boolean is not true then
    raise exception 'ASAAS05E0A T5 FAIL: upsert normalize=%', v;
  end if;

  perform pg_temp.asaas05e0a_as(s.auth_member_a);
  set local role authenticated;
  v_denied := false;
  begin
    perform public.get_my_clinic_billing_identity(s.clinic_a);
  exception
    when insufficient_privilege then v_denied := true;
    when others then
      if sqlerrm like '%BILLING_NOT_CLINIC_ADMIN%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'ASAAS05E0A T5 FAIL: member leu';
  end if;
  v_denied := false;
  begin
    perform public.upsert_my_clinic_billing_identity(
      s.clinic_a, 'X', '99991111140', 'x@t.test', null
    );
  exception
    when insufficient_privilege then v_denied := true;
    when others then
      if sqlerrm like '%BILLING_NOT_CLINIC_ADMIN%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'ASAAS05E0A T5 FAIL: member escreveu';
  end if;
  reset role;

  perform pg_temp.asaas05e0a_as(s.auth_owner_b);
  set local role authenticated;
  v_denied := false;
  begin
    perform public.get_my_clinic_billing_identity(s.clinic_a);
  exception
    when insufficient_privilege then v_denied := true;
    when others then
      if sqlerrm like '%BILLING_NOT_CLINIC_ADMIN%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'ASAAS05E0A T5 FAIL: admin alheio leu';
  end if;
  reset role;

  perform pg_temp.asaas05e0a_as(s.auth_pa);
  set local role authenticated;
  if public.am_i_platform_admin() is not true then
    raise exception 'ASAAS05E0A T5 FAIL: PA fixture';
  end if;
  v_denied := false;
  begin
    perform public.get_my_clinic_billing_identity(s.clinic_a);
  exception
    when insufficient_privilege then v_denied := true;
    when others then
      if sqlerrm like '%BILLING_NOT_CLINIC_ADMIN%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'ASAAS05E0A T5 FAIL: PA leu billing';
  end if;
  v_denied := false;
  begin
    perform public.upsert_my_clinic_billing_identity(
      s.clinic_a, 'PA', '99991111140', 'pa@t.test', null
    );
  exception
    when insufficient_privilege then v_denied := true;
    when others then
      if sqlerrm like '%BILLING_NOT_CLINIC_ADMIN%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'ASAAS05E0A T5 FAIL: PA escreveu billing';
  end if;
  reset role;
end $$;
rollback;

-- T6: tax id inválido rejeitado no write; side effects = 0
begin;
do $$
declare
  s record;
  v_denied boolean;
  v_ident int;
  v_contracts int;
  v_ops int;
  v_auth int;
  v_subs int;
  v_acc int;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  select count(*) into v_contracts from private.billing_commercial_contracts;
  select count(*) into v_ops from private.billing_outbound_operations;
  select count(*) into v_auth from private.billing_pix_automatic_authorizations;
  select count(*) into v_subs from private.billing_subscriptions;
  select count(*) into v_acc from private.billing_accounts;

  perform pg_temp.asaas05e0a_as(s.auth_owner_a);
  set local role authenticated;
  v_denied := false;
  begin
    perform public.upsert_my_clinic_billing_identity(
      s.clinic_a, 'Clinica', '11111111111', 'bill@t.test', null
    );
  exception
    when others then
      if sqlerrm like '%BILLING_INVALID_TAX_ID%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'ASAAS05E0A T6 FAIL: CPF repetido aceito';
  end if;
  v_denied := false;
  begin
    perform public.upsert_my_clinic_billing_identity(
      s.clinic_a, 'Clinica', '12345678900', 'bill@t.test', null
    );
  exception
    when others then
      if sqlerrm like '%BILLING_INVALID_TAX_ID%' then v_denied := true; else raise; end if;
  end;
  if not v_denied then
    raise exception 'ASAAS05E0A T6 FAIL: CPF checksum aceito';
  end if;
  reset role;

  select count(*) into v_ident from private.billing_customer_identities;
  if v_ident <> 0
     or (select count(*) from private.billing_commercial_contracts) <> v_contracts
     or (select count(*) from private.billing_outbound_operations) <> v_ops
     or (select count(*) from private.billing_pix_automatic_authorizations) <> v_auth
     or (select count(*) from private.billing_subscriptions) <> v_subs
     or (select count(*) from private.billing_accounts) <> v_acc then
    raise exception 'ASAAS05E0A T6 FAIL: side effects';
  end if;
end $$;
rollback;

-- T7: save profile válido não cria contrato/ops/auth/subscription
begin;
do $$
declare
  s record;
  v_before_c int;
  v_before_o int;
  v_before_a int;
  v_before_s int;
  v_before_acc int;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  select count(*) into v_before_c from private.billing_commercial_contracts;
  select count(*) into v_before_o from private.billing_outbound_operations;
  select count(*) into v_before_a from private.billing_pix_automatic_authorizations;
  select count(*) into v_before_s from private.billing_subscriptions;
  select count(*) into v_before_acc from private.billing_accounts;

  perform pg_temp.asaas05e0a_as(s.auth_owner_a);
  set local role authenticated;
  perform public.upsert_my_clinic_billing_identity(
    s.clinic_a, 'Clinica Sintetica LTDA', '11.222.333/0001-81', 'fatura@t.test', '11999990000'
  );
  reset role;

  if (select count(*) from private.billing_commercial_contracts) <> v_before_c
     or (select count(*) from private.billing_outbound_operations) <> v_before_o
     or (select count(*) from private.billing_pix_automatic_authorizations) <> v_before_a
     or (select count(*) from private.billing_subscriptions) <> v_before_s
     or (select count(*) from private.billing_accounts) <> v_before_acc then
    raise exception 'ASAAS05E0A T7 FAIL: save criou fatos de provedor';
  end if;
  if private.billing_customer_identity_complete(s.clinic_a) is not true then
    raise exception 'ASAAS05E0A T7 FAIL: completeza';
  end if;
end $$;
rollback;

-- T8: âncora mensal
begin;
do $$
begin
  if private.billing_add_calendar_months(date '2026-09-15', 1) is distinct from date '2026-10-15' then
    raise exception 'ASAAS05E0A T8 FAIL: 15→15';
  end if;
  if private.billing_add_calendar_months(date '2026-01-31', 1) is distinct from date '2026-02-28' then
    raise exception 'ASAAS05E0A T8 FAIL: jan31→feb28';
  end if;
  if private.billing_add_calendar_months(date '2026-01-31', 2) is distinct from date '2026-03-31' then
    raise exception 'ASAAS05E0A T8 FAIL: jan31→mar31';
  end if;
  if private.billing_add_calendar_months(date '2024-01-31', 1) is distinct from date '2024-02-29' then
    raise exception 'ASAAS05E0A T8 FAIL: leap feb29';
  end if;
  if private.billing_add_calendar_months(date '2026-08-31', 1) is distinct from date '2026-09-30' then
    raise exception 'ASAAS05E0A T8 FAIL: aug31→sep30';
  end if;
  if private.billing_add_calendar_months(date '2026-08-31', 2) is distinct from date '2026-10-31' then
    raise exception 'ASAAS05E0A T8 FAIL: aug31→oct31';
  end if;
end $$;
rollback;

-- T9: prepare Pix Automático — política congelada + preço snapshot
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
  v_cid text;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  perform pg_temp.asaas05e0a_account_with_customer(s.clinic_a, s.owner_a);
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (s.clinic_a, 'Clinica Sintetica LTDA', '99991111140', 'bill@t.test');
  v_contract := private.billing_create_commercial_contract(
    s.clinic_a, pg_temp.asaas05e0a_plan('pulse'), null, now(), null
  );
  v_cid := replace(v_contract::text, '-', '');
  r := private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');

  if r->>'strategy' is distinct from 'pix_automatic'
     or r->>'frequency' is distinct from 'MONTHLY'
     or r->>'payment_creation_mode' is distinct from 'SUBSCRIPTION'
     or r->>'retry_policy' is distinct from 'ALLOW_THREE_IN_SEVEN_DAYS'
     or r->>'finish_date' is not null
     or r->>'timezone' is distinct from 'America/Sao_Paulo'
     or (r->>'contracted_price_cents')::int is distinct from 39000
     or (r->>'asaas_amount')::numeric is distinct from 390.00
     or r->>'provider_contract_id' is distinct from replace((r->>'authorization_id'), '-', '')
     or r->>'provider_contract_id' = v_cid
     or char_length(r->>'provider_contract_id') <> 32
     or (r->>'generation')::int is distinct from 1
     or r->>'description' is distinct from 'Vertexa - assinatura mensal'
     or r->>'http_blocked_reason' is distinct from 'ASAAS_PIX_AUTOMATIC_ELIGIBILITY_REQUIRED'
     or (r->>'entitlement_granted')::boolean is not false
     or r->>'subscription_operation' is not null
     or r->>'charge_operation' is not null
     or r->'authorization_operation'->>'operation_id' is null then
    raise exception 'ASAAS05E0A T9 FAIL: r=%', r;
  end if;
  if (r->>'recurrence_start_date')::date
       is distinct from private.billing_add_calendar_months((r->>'activation_date')::date, 1) then
    raise exception 'ASAAS05E0A T9 FAIL: recurrence';
  end if;
end $$;
rollback;

-- T10: preços iguais em qualquer estratégia
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_sync uuid;
  r_auto jsonb;
  r_pix jsonb;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  perform pg_temp.asaas05e0a_account_with_customer(s.clinic_a, s.owner_a);
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (s.clinic_a, 'Clinica Sintetica LTDA', '99991111140', 'bill@t.test');

  v_pulse := private.billing_create_commercial_contract(
    s.clinic_a, pg_temp.asaas05e0a_plan('pulse'), null, now(), null
  );
  r_auto := private.billing_prepare_pix_automatic_authorization(v_pulse, 'sandbox');
  r_pix := private.billing_prepare_contract_provider_provisioning(
    v_pulse, 'sandbox', 'PIX', date '2030-01-15'
  );
  if (r_auto->>'contracted_price_cents') is distinct from (r_pix->>'contracted_price_cents')
     or (r_auto->>'plan_version_id') is distinct from (r_pix->>'plan_version_id')
     or (r_auto->>'asaas_amount')::numeric is distinct from 390.00
     or private.billing_cents_to_asaas_amount(24700) is distinct from 247.00
     or private.billing_cents_to_asaas_amount(39000) is distinct from 390.00
     or private.billing_cents_to_asaas_amount(49700) is distinct from 497.00
     or private.billing_cents_to_asaas_amount(89000) is distinct from 890.00
     or private.billing_cents_to_asaas_amount(146700) is distinct from 1467.00 then
    raise exception 'ASAAS05E0A T10 FAIL: price';
  end if;

  v_sync := private.billing_create_commercial_contract(
    s.clinic_b, pg_temp.asaas05e0a_plan('sync'), null, now(), null
  );
  if (select contracted_price_cents from private.billing_commercial_contracts where id = v_sync)
     is distinct from 49700 then
    raise exception 'ASAAS05E0A T10 FAIL: sync snapshot';
  end if;
end $$;
rollback;

-- T11: prepare duplicado é idempotente
begin;
do $$
declare
  s record;
  v_contract uuid;
  r1 jsonb;
  r2 jsonb;
  v_n int;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  perform pg_temp.asaas05e0a_account_with_customer(s.clinic_a, s.owner_a);
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (s.clinic_a, 'Clinica Sintetica LTDA', '99991111140', 'bill@t.test');
  v_contract := private.billing_create_commercial_contract(
    s.clinic_a, pg_temp.asaas05e0a_plan('sync'), null, now(), null
  );
  r1 := private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');
  r2 := private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');
  if r1->>'authorization_id' is distinct from r2->>'authorization_id'
     or r1->'authorization_operation'->>'operation_id'
          is distinct from r2->'authorization_operation'->>'operation_id' then
    raise exception 'ASAAS05E0A T11 FAIL: r1=% r2=%', r1, r2;
  end if;
  select count(*) into v_n
    from private.billing_pix_automatic_authorizations
   where commercial_contract_id = v_contract;
  if v_n <> 1 then
    raise exception 'ASAAS05E0A T11 FAIL: auth rows=%', v_n;
  end if;
  select count(*) into v_n
    from private.billing_outbound_operations
   where commercial_contract_id = v_contract
     and operation_type = 'create_pix_automatic_authorization';
  if v_n <> 1 then
    raise exception 'ASAAS05E0A T11 FAIL: ops=%', v_n;
  end if;
  -- WP-ASAAS-05E1B-R1: repeated PREPARE must not steal the first-write token.
  -- Expected to FAIL on live schema until insert-only PREPARE is applied.
  if (
    select o.attempt_count
      from private.billing_outbound_operations o
     where o.id = (r2->'authorization_operation'->>'operation_id')::uuid
  ) is distinct from 1 then
    raise exception 'ASAAS05E1B-R1 T11 FAIL: prepare stole attempt_count';
  end if;
end $$;
rollback;

-- T12: identidade incompleta bloqueia antes da reserva Pix
begin;
do $$
declare
  s record;
  v_contract uuid;
  v_ops int;
  v_auth int;
  v_acc int;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  v_contract := private.billing_create_commercial_contract(
    s.clinic_a, pg_temp.asaas05e0a_plan('pulse'), null, now(), null
  );
  begin
    perform private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');
    raise exception 'ASAAS05E0A T12 FAIL: incompleto aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_CUSTOMER_IDENTITY_INCOMPLETE%' then
        raise;
      end if;
  end;
  select count(*) into v_ops from private.billing_outbound_operations;
  select count(*) into v_auth from private.billing_pix_automatic_authorizations;
  select count(*) into v_acc from private.billing_accounts where clinic_id = s.clinic_a;
  if v_ops <> 0 or v_auth <> 0 or v_acc <> 0 then
    raise exception 'ASAAS05E0A T12 FAIL: side effects ops=% auth=% acc=%', v_ops, v_auth, v_acc;
  end if;
end $$;
rollback;

-- T13: contrato inelegível
begin;
do $$
declare
  s record;
  v_contract uuid;
  v_n int;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  perform pg_temp.asaas05e0a_account_with_customer(s.clinic_a, s.owner_a);
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (s.clinic_a, 'Clinica Sintetica LTDA', '99991111140', 'bill@t.test');
  v_contract := private.billing_create_commercial_contract(
    s.clinic_a, pg_temp.asaas05e0a_plan('pulse'), null, now(), null
  );
  update private.billing_commercial_contracts set status = 'cancelled' where id = v_contract;
  begin
    perform private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');
    raise exception 'ASAAS05E0A T13 FAIL: cancelled aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_CONTRACT_INELIGIBLE%' then
        raise;
      end if;
  end;
  update private.billing_commercial_contracts set status = 'ended' where id = v_contract;
  begin
    perform private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');
    raise exception 'ASAAS05E0A T13 FAIL: ended aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_CONTRACT_INELIGIBLE%' then
        raise;
      end if;
  end;
  select count(*) into v_n from private.billing_outbound_operations
   where operation_type = 'create_pix_automatic_authorization';
  if v_n <> 0 then
    raise exception 'ASAAS05E0A T13 FAIL: outbound=%', v_n;
  end if;
end $$;
rollback;

-- T14: ordinary PIX != Pix Automático
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
  v_pix_ops int;
  v_auto_ops int;
  v_auto_rows int;
  v_plan uuid;
  v_offer uuid;
  v_price int;
  v_currency text;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  perform pg_temp.asaas05e0a_account_with_customer(s.clinic_a, s.owner_a);
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (s.clinic_a, 'Clinica Sintetica LTDA', '99991111140', 'bill@t.test');
  v_contract := private.billing_create_commercial_contract(
    s.clinic_a, pg_temp.asaas05e0a_plan('apex'), null, now(), null
  );
  select plan_version_id, commercial_offer_id, contracted_price_cents, contracted_currency
    into v_plan, v_offer, v_price, v_currency
    from private.billing_commercial_contracts
   where id = v_contract;

  r := private.billing_prepare_contract_provider_provisioning(
    v_contract, 'sandbox', 'PIX', date '2030-01-15'
  );
  if r->>'intended_billing_type' is distinct from 'PIX'
     or r->>'authorization_operation' is not null then
    raise exception 'ASAAS05E0A T14 FAIL: 05D pix r=%', r;
  end if;
  select count(*) into v_auto_rows from private.billing_pix_automatic_authorizations
   where commercial_contract_id = v_contract;
  select count(*) into v_auto_ops from private.billing_outbound_operations
   where commercial_contract_id = v_contract
     and operation_type = 'create_pix_automatic_authorization';
  if v_auto_rows <> 0 or v_auto_ops <> 0 then
    raise exception 'ASAAS05E0A T14 FAIL: PIX ordinário criou automático';
  end if;

  r := private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');
  select count(*) into v_pix_ops from private.billing_outbound_operations
   where commercial_contract_id = v_contract
     and operation_type in ('create_subscription', 'create_charge');
  if v_pix_ops <> 1 then
    -- 05D already reserved create_subscription once; pix automatic must not add another
    null;
  end if;
  select count(*) into v_pix_ops from private.billing_outbound_operations
   where commercial_contract_id = v_contract
     and operation_type = 'create_subscription';
  if v_pix_ops <> 1 then
    raise exception 'ASAAS05E0A T14 FAIL: subscription ops=%', v_pix_ops;
  end if;
  select count(*) into v_auto_ops from private.billing_outbound_operations
   where commercial_contract_id = v_contract
     and operation_type = 'create_pix_automatic_authorization';
  if v_auto_ops <> 1 then
    raise exception 'ASAAS05E0A T14 FAIL: auto ops=%', v_auto_ops;
  end if;
  if exists (
    select 1 from private.billing_commercial_contracts
     where id = v_contract
       and (plan_version_id is distinct from v_plan
            or commercial_offer_id is distinct from v_offer
            or contracted_price_cents is distinct from v_price
            or contracted_currency is distinct from v_currency)
  ) then
    raise exception 'ASAAS05E0A T14 FAIL: contrato mutou';
  end if;
  if v_price is distinct from 146700 then
    raise exception 'ASAAS05E0A T14 FAIL: apex price=%', v_price;
  end if;
end $$;
rollback;

-- T15: estratégias canônicas; boleto fora; billingType PIX ≠ pix_automatic
begin;
do $$
begin
  if private.billing_payment_strategy_canonical('PIX_AUTOMATIC') is distinct from 'pix_automatic'
     or private.billing_payment_strategy_canonical('pix_manual') is distinct from 'pix_manual'
     or private.billing_payment_strategy_canonical('CREDIT_CARD') is distinct from 'credit_card' then
    raise exception 'ASAAS05E0A T15 FAIL: canonical';
  end if;
  begin
    perform private.billing_payment_strategy_canonical('PIX');
    raise exception 'ASAAS05E0A T15 FAIL: PIX aceito como strategy';
  exception
    when others then
      if sqlerrm not like '%BILLING_UNKNOWN_PAYMENT_STRATEGY%' then
        raise;
      end if;
  end;
  begin
    perform private.billing_payment_strategy_canonical('boleto');
    raise exception 'ASAAS05E0A T15 FAIL: boleto aceito';
  exception
    when others then
      if sqlerrm not like '%BILLING_UNKNOWN_PAYMENT_STRATEGY%' then
        raise;
      end if;
  end;
end $$;
rollback;

-- T16: Founder intacto; prepare não é entitlement
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
  v_slots int;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  perform pg_temp.asaas05e0a_account_with_customer(s.clinic_a, s.owner_a);
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (s.clinic_a, 'Clinica Sintetica LTDA', '99991111140', 'bill@t.test');
  v_contract := private.billing_create_commercial_contract(
    s.clinic_a, pg_temp.asaas05e0a_plan('sync'), pg_temp.asaas05e0a_offer(), now(), null
  );
  r := private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');
  if (r->>'contracted_price_cents')::int is distinct from 39000
     or (r->>'entitlement_granted')::boolean is not false then
    raise exception 'ASAAS05E0A T16 FAIL: r=%', r;
  end if;
  if to_regclass('private.billing_founder_claims') is not null then
    raise exception 'ASAAS05E0A T16 FAIL: founder claims';
  end if;
  select total_slots into v_slots from private.billing_offers where code = 'founder_2026';
  if v_slots is distinct from 50 then
    raise exception 'ASAAS05E0A T16 FAIL: slots=%', v_slots;
  end if;
end $$;
rollback;

-- T17: classificação de webhook — reconhecimento.
-- processing_supported = false até 05E0A; true depois de 05E0B (tabela de instruções).
begin;
do $$
declare
  r jsonb;
  v_processed boolean := to_regclass('private.billing_pix_automatic_payment_instructions') is not null;
begin
  r := private.billing_classify_asaas_event('PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED');
  if r->>'family' is distinct from 'pix_automatic_eligibility'
     or (r->>'recognized')::boolean is not true
     or (r->>'processing_supported')::boolean is distinct from v_processed then
    raise exception 'ASAAS05E0A T17 FAIL: eligibility %', r;
  end if;
  r := private.billing_classify_asaas_event('PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED');
  if r->>'family' is distinct from 'pix_automatic_authorization'
     or (r->>'processing_supported')::boolean is distinct from v_processed then
    raise exception 'ASAAS05E0A T17 FAIL: auth %', r;
  end if;
  r := private.billing_classify_asaas_event('PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED');
  if r->>'family' is distinct from 'pix_automatic_payment_instruction'
     or (r->>'processing_supported')::boolean is distinct from v_processed then
    raise exception 'ASAAS05E0A T17 FAIL: instruction %', r;
  end if;
  r := private.billing_classify_asaas_event('PAYMENT_RECEIVED');
  if r->>'family' is distinct from 'payment'
     or (r->>'processing_supported')::boolean is not true then
    raise exception 'ASAAS05E0A T17 FAIL: payment %', r;
  end if;
  r := private.billing_classify_asaas_event('PIX_QRCODE_CREATED');
  if r->>'family' is distinct from 'unrecognized'
     or (r->>'recognized')::boolean is not false then
    raise exception 'ASAAS05E0A T17 FAIL: ordinary pix event %', r;
  end if;
end $$;
rollback;

-- T18: identidade completa sem customer reserva só create_customer
begin;
do $$
declare
  s record;
  v_contract uuid;
  r jsonb;
  v_cust int;
  v_auto int;
begin
  select * into s from pg_temp.asaas05e0a_seed();
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (s.clinic_a, 'Clinica Sintetica LTDA', '99991111140', 'bill@t.test');
  v_contract := private.billing_create_commercial_contract(
    s.clinic_a, pg_temp.asaas05e0a_plan('pulse'), null, now(), null
  );
  r := private.billing_prepare_pix_automatic_authorization(v_contract, 'sandbox');
  if (r->>'provider_customer_ready')::boolean is not false
     or r->>'authorization_operation' is not null
     or r->'customer_operation'->>'operation_id' is null then
    raise exception 'ASAAS05E0A T18 FAIL: r=%', r;
  end if;
  select count(*) into v_cust from private.billing_outbound_operations
   where commercial_contract_id = v_contract and operation_type = 'create_customer';
  select count(*) into v_auto from private.billing_outbound_operations
   where commercial_contract_id = v_contract
     and operation_type = 'create_pix_automatic_authorization';
  if v_cust <> 1 or v_auto <> 0 then
    raise exception 'ASAAS05E0A T18 FAIL: cust=% auto=%', v_cust, v_auto;
  end if;
end $$;
rollback;
