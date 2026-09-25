-- WP-BILLING-MASTER-QA-03R4 local regression. Disposable local database only.
begin;
set local session_replication_role = replica;

insert into private.billing_customer_identities (
  clinic_id, legal_name, tax_id, email
) values (
  '94000000-0000-4000-8000-000000000001',
  'Clinica Sintetica R4', '99991111140', 'billing-r4@vertexa.test'
);

-- The disposable fixture bypasses its clinic FK. Enable only the product
-- normalization trigger in replica mode so FK triggers stay out of this unit
-- fixture while the real billing behavior is still exercised. ROLLBACK below
-- restores the trigger mode.
alter table private.billing_customer_identities
  enable replica trigger trg_billing_protect_customer_identity_tax_id;

do $$
declare
  v_clinic constant uuid := '94000000-0000-4000-8000-000000000001';
  v_source text;
begin
  if private.billing_customer_identity_complete(v_clinic) is not true then
    raise exception 'R4 FAIL: existing non-card identity regressed';
  end if;
  if private.billing_customer_identity_checkout_ready(v_clinic) is not false
     or private.billing_customer_identity_checkout_readiness_error(v_clinic) is distinct from 'billing_phone_required' then
    raise exception 'R4 FAIL: missing billing phone was not classified locally';
  end if;

  update private.billing_customer_identities
     set mobile_phone = '+55 (98) 99999-9999'
   where clinic_id = v_clinic;
  if private.billing_customer_identity_checkout_readiness_error(v_clinic) is distinct from 'billing_address_required' then
    raise exception 'R4 FAIL: missing billing address was not classified locally';
  end if;

  update private.billing_customer_identities
     set billing_address = '  Rua das Flores  '
   where clinic_id = v_clinic;
  if private.billing_customer_identity_checkout_readiness_error(v_clinic) is distinct from 'billing_address_number_required' then
    raise exception 'R4 FAIL: missing address number was not classified locally';
  end if;

  update private.billing_customer_identities
     set billing_address_number = ' S/N '
   where clinic_id = v_clinic;
  if private.billing_customer_identity_checkout_ready(v_clinic) is not true then
    raise exception 'R4 FAIL: complete checkout identity was not accepted';
  end if;
  if not exists (
    select 1 from private.billing_customer_identities i
     where i.clinic_id = v_clinic
       and i.mobile_phone = '98999999999'
       and i.billing_address = 'Rua das Flores'
       and i.billing_address_number = 'S/N'
  ) then
    raise exception 'R4 FAIL: billing address normalization drift';
  end if;

  if to_regprocedure('public.upsert_my_clinic_billing_identity(uuid,text,text,text,text)') is null
     or to_regprocedure('public.upsert_my_clinic_billing_identity(uuid,text,text,text,text,text,text)') is null then
    raise exception 'R4 FAIL: compatible billing identity RPC signatures missing';
  end if;
  if not has_function_privilege(
      'authenticated',
      'public.upsert_my_clinic_billing_identity(uuid,text,text,text,text,text,text)',
      'EXECUTE'
    )
     or has_function_privilege(
      'anon',
      'public.upsert_my_clinic_billing_identity(uuid,text,text,text,text,text,text)',
      'EXECUTE'
    )
     or has_function_privilege(
      'service_role',
      'public.upsert_my_clinic_billing_identity(uuid,text,text,text,text,text,text)',
      'EXECUTE'
    ) then
    raise exception 'R4 FAIL: new billing identity RPC privileges drifted';
  end if;
  if has_table_privilege('authenticated', 'private.billing_customer_identities', 'SELECT')
     or has_table_privilege('authenticated', 'private.billing_customer_identities', 'UPDATE')
     or has_table_privilege('anon', 'private.billing_customer_identities', 'SELECT') then
    raise exception 'R4 FAIL: billing PII table exposed directly';
  end if;

  select pg_get_functiondef(
    'public.upsert_my_clinic_billing_identity(uuid,text,text,text,text,text,text)'::regprocedure
  ) into v_source;
  if v_source not like '%private.is_clinic_admin(p_clinic_id)%'
     or v_source like '%is_platform_admin%' then
    raise exception 'R4 FAIL: tenant authority drifted';
  end if;
end;
$$;

rollback;
