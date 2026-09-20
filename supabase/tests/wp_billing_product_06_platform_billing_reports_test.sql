-- =====================================================================================
-- WP-BILLING-PRODUCT-06 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260920220000 aplicada localmente. Não muta QA live.
-- Fixtures sintéticos. Sem HTTP Asaas. Sem apply remoto neste WP.
-- =====================================================================================

create or replace function pg_temp.bp06_seed()
returns table (
  clinic_a uuid,
  clinic_b uuid,
  auth_admin_a uuid,
  auth_patient_a uuid,
  auth_pa uuid
)
language plpgsql
as $seed$
declare
  v_clinic_a uuid := gen_random_uuid();
  v_clinic_b uuid := gen_random_uuid();
  v_owner_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_auth_admin_a uuid := gen_random_uuid();
  v_patient uuid := gen_random_uuid();
  v_auth_patient uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid();
  v_auth_pa uuid := gen_random_uuid();
  v_plan_version uuid;
  v_contract_a uuid := gen_random_uuid();
  v_account_a uuid := gen_random_uuid();
  v_authz_a uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values
    (v_owner_a, gen_random_uuid(), 'professional', 'Owner A BP06', 'own-a-bp06@t.test', 'active'),
    (v_admin_a, v_auth_admin_a, 'professional', 'Admin A BP06', 'adm-a-bp06@t.test', 'active'),
    (v_patient, v_auth_patient, 'patient', 'Patient A BP06', 'pat-a-bp06@t.test', 'active'),
    (v_pa, v_auth_pa, 'professional', 'PA BP06', 'pa-bp06@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id)
  values
    (v_clinic_a, 'Clinica BP06 A', v_owner_a),
    (v_clinic_b, 'Clinica BP06 B Sem Pagamento', v_owner_a);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values (v_admin_a, v_clinic_a, 'nutritionist', 'admin');

  insert into private.platform_admins (profile_id, status) values (v_pa, 'active');

  select pv.id into v_plan_version
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse'
   order by pv.version desc
   limit 1;

  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
  values (v_clinic_a, 'Clinica BP06 A LTDA', '39053344705', 'fiscal-a-bp06@t.test');

  insert into private.billing_commercial_contracts (
    id, clinic_id, plan_version_id, contracted_price_cents, contracted_currency,
    billing_cycle, status, effective_from
  ) values (v_contract_a, v_clinic_a, v_plan_version, 39000, 'BRL', 'monthly', 'active', now());

  insert into private.billing_accounts (
    id, owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (v_account_a, v_owner_a, v_clinic_a, 'asaas', 'sandbox', 'cus-bound-bp06');

  insert into private.billing_pix_automatic_authorizations (
    id, commercial_contract_id, billing_account_id, environment,
    provider_status, is_primary, provider_contract_id
  ) values (v_authz_a, v_contract_a, v_account_a, 'sandbox', 'ACTIVE', true, replace(v_contract_a::text, '-', ''));

  insert into private.billing_payments (
    id, billing_account_id, provider, environment, external_payment_id,
    external_customer_id, provider_status, financial_state, billing_type,
    value_cents, due_date, payment_date, pix_authorization_id
  ) values (
    gen_random_uuid(), v_account_a, 'asaas', 'sandbox', 'pay-recv-bp06',
    'cus-bound-bp06', 'RECEIVED', 'received', 'PIX',
    39000, date '2026-09-10', date '2026-09-11', v_authz_a
  );

  return query select v_clinic_a, v_clinic_b, v_auth_admin_a, v_auth_patient, v_auth_pa;
end;
$seed$;

create or replace function pg_temp.bp06_as(p_auth uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth::text)::text, true);
end;
$$;

begin;
do $$
declare
  v_src text;
begin
  if to_regprocedure('public.get_platform_billing_report(date,date)') is null
     or to_regprocedure('public.list_platform_billing_report_export(date,date,text,integer,integer)') is null then
    raise exception 'BP06 T1 FAIL: missing report RPC';
  end if;
  select pg_get_functiondef('public.get_platform_billing_report(date,date)'::regprocedure) into v_src;
  if v_src !~ 'private.assert_platform_billing_reader' then
    raise exception 'BP06 T1 FAIL: missing platform assert';
  end if;
  if v_src ~ 'get_my_clinic_' then
    raise exception 'BP06 T1 FAIL: reused tenant RPC';
  end if;
  if has_function_privilege('anon', 'public.get_platform_billing_report(date,date)'::regprocedure, 'execute') then
    raise exception 'BP06 T1 FAIL: anon execute';
  end if;
  if not has_function_privilege('authenticated', 'public.get_platform_billing_report(date,date)'::regprocedure, 'execute') then
    raise exception 'BP06 T1 FAIL: authenticated missing execute';
  end if;
  if exists (
    select 1 from information_schema.tables
     where table_schema in ('public', 'private')
       and table_name in ('billing_report_facts', 'platform_billing_reports')
  ) then
    raise exception 'BP06 T1 FAIL: unexpected reporting table';
  end if;
end;
$$;
rollback;

begin;
do $$
declare
  s record;
  v_err text;
  v_rep jsonb;
  v_export jsonb;
begin
  select * into s from pg_temp.bp06_seed();

  perform pg_temp.bp06_as(s.auth_admin_a);
  begin
    perform public.get_platform_billing_report(date '2026-09-01', date '2026-09-30');
    raise exception 'BP06 T2 FAIL: clinic admin report';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%BILLING_NOT_PLATFORM_ADMIN%' then
        raise exception 'BP06 T2 FAIL: clinic admin hint %', v_err;
      end if;
  end;

  perform pg_temp.bp06_as(s.auth_patient_a);
  begin
    perform public.list_platform_billing_report_export(date '2026-09-01', date '2026-09-30', 'payments', 200, 0);
    raise exception 'BP06 T2 FAIL: patient export';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%BILLING_NOT_PLATFORM_ADMIN%' then
        raise exception 'BP06 T2 FAIL: patient hint %', v_err;
      end if;
  end;

  reset role;
  perform pg_temp.bp06_as(s.auth_pa);
  begin
    perform public.get_platform_billing_report(date '2026-01-01', date '2027-12-31');
    raise exception 'BP06 T3 FAIL: unbounded period';
  exception
    when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like '%BILLING_REPORT_PERIOD_TOO_LONG%' then
        raise exception 'BP06 T3 FAIL: long period hint %', v_err;
      end if;
  end;

  v_rep := public.get_platform_billing_report(date '2026-09-01', date '2026-09-30');
  if coalesce(v_rep->>'timezone', '') <> 'America/Sao_Paulo' then
    raise exception 'BP06 T4 FAIL: timezone';
  end if;
  if coalesce((v_rep->>'received_in_period_cents')::bigint, 0) < 39000 then
    raise exception 'BP06 T4 FAIL: received';
  end if;
  if v_rep->'received_by_plan'->0->>'plan_attribution' <> 'contract' then
    raise exception 'BP06 T4 FAIL: plan attribution';
  end if;
  if v_rep::text ~* 'qr_payload|encoded_image|webhook_payload|tax_id|service_role' then
    raise exception 'BP06 T4 FAIL: leaked secret/provider';
  end if;
  if coalesce((v_rep->>'active_pix_automatic_authorizations')::int, 0) < 1 then
    raise exception 'BP06 T4 FAIL: active pix';
  end if;
  if coalesce((v_rep->>'entitlement_enforcement'), '') <> 'OFF' then
    raise exception 'BP06 T4 FAIL: entitlement';
  end if;

  v_export := public.list_platform_billing_report_export(
    date '2026-09-01', date '2026-09-30', 'payments', 999, 0
  );
  if coalesce((v_export->>'limit')::int, 0) <> 500 then
    raise exception 'BP06 T5 FAIL: export clamp %', v_export->>'limit';
  end if;
  if coalesce(v_export->>'kind', '') <> 'payments' then
    raise exception 'BP06 T5 FAIL: kind';
  end if;
  if v_export::text ~* 'tax_id|encoded_image|webhook_payload|external_resource_id' then
    raise exception 'BP06 T5 FAIL: export leak';
  end if;
end;
$$;
rollback;
