-- =====================================================================================
-- WP-BILLING-PRODUCT-07 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- LOCAL ONLY. Fixtures sintéticos. Sem HTTP Asaas. Sem apply remoto.
-- =====================================================================================

create or replace function pg_temp.bp07_plan(p_code text)
returns uuid
language sql
stable
as $$
  select pv.id
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = p_code
   order by pv.version desc
   limit 1
$$;

create or replace function pg_temp.bp07_seed()
returns table (
  clinic_a uuid,
  clinic_b uuid,
  clinic_c uuid,
  owner_a uuid,
  admin_a uuid,
  auth_admin_a uuid,
  auth_pa uuid
)
language plpgsql
as $seed$
declare
  v_clinic_a uuid := gen_random_uuid();
  v_clinic_b uuid := gen_random_uuid();
  v_clinic_c uuid := gen_random_uuid();
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_owner_c uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_auth_admin_a uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid();
  v_auth_pa uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values
    (v_owner_a, gen_random_uuid(), 'professional', 'Owner A BP07', 'own-a-bp07@t.test', 'active'),
    (v_owner_b, gen_random_uuid(), 'professional', 'Owner B BP07', 'own-b-bp07@t.test', 'active'),
    (v_owner_c, gen_random_uuid(), 'professional', 'Owner C BP07', 'own-c-bp07@t.test', 'active'),
    (v_admin_a, v_auth_admin_a, 'professional', 'Admin A BP07', 'adm-a-bp07@t.test', 'active'),
    (v_pa, v_auth_pa, 'professional', 'PA BP07', 'pa-bp07@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id)
  values
    (v_clinic_a, 'Clinica BP07 A', v_owner_a),
    (v_clinic_b, 'Clinica BP07 B', v_owner_b),
    (v_clinic_c, 'Clinica BP07 C', v_owner_c);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values (v_admin_a, v_clinic_a, 'nutritionist', 'admin');

  insert into private.platform_admins (profile_id, status) values (v_pa, 'active');

  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
  values
    (v_clinic_a, 'Clinica BP07 A LTDA', '39053344705', 'fiscal-a-bp07@t.test'),
    (v_clinic_b, 'Clinica BP07 B LTDA', '39053344705', 'fiscal-b-bp07@t.test'),
    (v_clinic_c, 'Clinica BP07 C LTDA', '39053344705', 'fiscal-c-bp07@t.test');

  return query select v_clinic_a, v_clinic_b, v_clinic_c, v_owner_a, v_admin_a, v_auth_admin_a, v_auth_pa;
end;
$seed$;

begin;
do $$
declare
  s record;
  v_sync uuid;
  v_pulse uuid;
  v_apex uuid;
  v_price jsonb;
  v_cap jsonb;
  v_gov jsonb;
  v_admit jsonb;
  v_slot integer;
  v_err text;
  v_i integer;
  v_clinic uuid;
  v_owner uuid;
  v_prof uuid;
begin
  select * into s from pg_temp.bp07_seed();
  v_sync := pg_temp.bp07_plan('sync');
  v_pulse := pg_temp.bp07_plan('pulse');
  v_apex := pg_temp.bp07_plan('apex');

  if v_sync is null or v_pulse is null or v_apex is null then
    raise exception 'BP07 catalog versions missing';
  end if;

  perform set_config('request.jwt.claim.sub', s.auth_pa::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- CA cannot self-grant: switch to clinic admin
  perform set_config('request.jwt.claim.sub', s.auth_admin_a::text, true);
  begin
    perform public.admit_platform_founder_clinic(s.clinic_a, 'sync');
    raise exception 'CA self-grant should fail';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_NOT_PLATFORM_ADMIN' then
        raise exception 'expected PA gate, got %', v_err;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', s.auth_pa::text, true);

  insert into private.billing_commercial_contracts (
    clinic_id, plan_version_id, contracted_price_cents, contracted_currency, billing_cycle, status, effective_from
  ) values (s.clinic_a, v_sync, 49700, 'BRL', 'monthly', 'active', timestamptz '2026-09-20 12:00:00-03');

  v_admit := public.admit_platform_founder_clinic(s.clinic_a, 'sync');
  if v_admit->>'outcome' is distinct from 'admitted' then
    raise exception 'admit failed %', v_admit;
  end if;
  select a.slot_number into v_slot
    from private.billing_founder_admissions a
   where a.clinic_id = s.clinic_a;
  if v_slot is distinct from 1 then
    raise exception 'first slot must be 1, got %', v_slot;
  end if;

  begin
    perform public.admit_platform_founder_clinic(s.clinic_a, 'sync');
    raise exception 'second admit same clinic should fail';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_FOUNDER_ALREADY_ADMITTED' then
        raise exception 'expected already admitted, got %', v_err;
      end if;
  end;

  v_price := private.billing_resolve_commercial_price(s.clinic_a, timestamptz '2026-10-01 12:00:00-03');
  if (v_price->>'pricing_reason') is distinct from 'founder_lock'
     or (v_price->>'final_projected_cents')::int is distinct from 39000 then
    raise exception 'lock price failed %', v_price;
  end if;

  v_price := private.billing_resolve_commercial_price(s.clinic_a, timestamptz '2027-09-20 12:00:00-03');
  if (v_price->>'pricing_reason') is distinct from 'founder_lifetime_table'
     or (v_price->>'final_projected_cents')::int is distinct from 34790 then
    raise exception 'lifetime 70 percent failed %', v_price;
  end if;

  -- table version change: insert a synthetic future version then resolve
  insert into private.billing_plan_versions (
    plan_id, version, currency_code, standard_price_cents, max_professionals, max_active_patients,
    additional_professional_price_cents, additional_patient_price_cents
  )
  select p.id, 99, 'BRL', 70000, 3, 100, 3900, 1800
    from private.billing_plans p
   where p.code = 'sync'
     and not exists (
       select 1 from private.billing_plan_versions x where x.plan_id = p.id and x.version = 99
     );
  v_price := private.billing_resolve_commercial_price(s.clinic_a, timestamptz '2027-10-01 12:00:00-03');
  if (v_price->>'final_projected_cents')::int is distinct from 49000 then
    raise exception 'post-lock table version failed %', v_price;
  end if;

  perform public.set_platform_clinic_additional_capacity(s.clinic_a, 2, 1);
  v_price := private.billing_resolve_commercial_price(s.clinic_a, timestamptz '2026-10-01 12:00:00-03');
  if (v_price->>'final_projected_cents')::int is distinct from (39000 + 3900 * 2 + 1800) then
    raise exception 'sync add-on failed %', v_price;
  end if;

  -- Pulse cannot invent add-on
  insert into private.billing_commercial_contracts (
    clinic_id, plan_version_id, contracted_price_cents, contracted_currency, billing_cycle, status, effective_from
  ) values (s.clinic_b, v_pulse, 39000, 'BRL', 'monthly', 'active', now());
  begin
    perform public.set_platform_clinic_additional_capacity(s.clinic_b, 1, 0);
    raise exception 'pulse addon should fail';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_PULSE_NO_ADDON' then
        raise exception 'expected pulse no addon, got %', v_err;
      end if;
  end;

  insert into private.billing_commercial_contracts (
    clinic_id, plan_version_id, contracted_price_cents, contracted_currency, billing_cycle, status, effective_from
  ) values (s.clinic_c, v_apex, 146700, 'BRL', 'monthly', 'active', now());
  perform public.admit_platform_founder_clinic(s.clinic_c, 'apex');
  perform public.set_platform_clinic_additional_capacity(s.clinic_c, 1, 2);
  v_price := private.billing_resolve_commercial_price(s.clinic_c, clock_timestamp());
  if (v_price->>'final_projected_cents')::int is distinct from (89000 + 3900 + 2400) then
    raise exception 'apex add-on failed %', v_price;
  end if;

  -- owner exemption + extra admin counts
  v_cap := private.billing_commercial_capacity(s.clinic_a);
  if (v_cap->>'billable_professionals')::int is distinct from 1
     or (v_cap->>'owner_exempt')::int is distinct from 1 then
    raise exception 'owner exemption failed %', v_cap;
  end if;

  -- cancel / return while open
  perform public.mark_platform_founder_clinic_cancelled(s.clinic_a);
  if not exists (
    select 1 from private.billing_founder_admissions a
     where a.clinic_id = s.clinic_a and a.slot_number = 1 and a.benefit_status = 'returnable'
  ) then
    raise exception 'cancel did not preserve slot';
  end if;
  perform public.restore_platform_founder_clinic_eligibility(s.clinic_a);
  if not exists (
    select 1 from private.billing_founder_admissions a
     where a.clinic_id = s.clinic_a and a.slot_number = 1 and a.benefit_status = 'eligible'
  ) then
    raise exception 'open return failed';
  end if;

  -- 50-slot hard limit (A + C + 48)
  v_i := 0;
  while v_i < 48 loop
    v_clinic := gen_random_uuid();
    v_owner := gen_random_uuid();
    insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_owner, gen_random_uuid(), 'professional', 'F' || v_i, 'f' || v_i || '@t.test', 'active');
    insert into public.clinics (id, name, owner_profile_id)
    values (v_clinic, 'F' || v_i, v_owner);
    perform private.billing_admit_founder(v_clinic, v_sync, null);
    v_i := v_i + 1;
  end loop;
  begin
    v_clinic := gen_random_uuid();
    v_owner := gen_random_uuid();
    insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_owner, gen_random_uuid(), 'professional', 'Overflow', 'ov@t.test', 'active');
    insert into public.clinics (id, name, owner_profile_id) values (v_clinic, 'Overflow', v_owner);
    perform private.billing_admit_founder(v_clinic, v_sync, null);
    raise exception 'slot 51 should fail';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_FOUNDER_SLOTS_EXHAUSTED' then
        raise exception 'expected exhausted, got %', v_err;
      end if;
  end;

  -- close campaign then return must not restore
  perform public.mark_platform_founder_clinic_cancelled(s.clinic_a);
  perform public.close_platform_founder_campaign();
  begin
    perform public.restore_platform_founder_clinic_eligibility(s.clinic_a);
    raise exception 'return after close should fail';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_FOUNDER_RETURN_AFTER_CLOSE' then
        raise exception 'expected return after close, got %', v_err;
      end if;
  end;
  if not exists (
    select 1 from private.billing_founder_admissions a
     where a.clinic_id = s.clinic_a and a.benefit_status = 'historical_only' and a.slot_number = 1
  ) then
    raise exception 'history not preserved after close';
  end if;

  -- professional capacity: Pulse clinic_b included 2; owner is not a professional row
  for v_i in 1..2 loop
    v_prof := gen_random_uuid();
    insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_prof, gen_random_uuid(), 'professional', 'Seat' || v_i, 'seat' || v_i || '@t.test', 'active');
    insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_prof, s.clinic_b, 'nutritionist', 'member', 'active');
  end loop;
  begin
    insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (gen_random_uuid(), s.clinic_b, 'nutritionist', 'admin', 'active');
    raise exception 'professional capacity should block extra admin';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_PROFESSIONAL_CAPACITY' then
        raise exception 'expected professional capacity, got %', v_err;
      end if;
  end;

  begin
    update public.clinics set owner_profile_id = s.admin_a where id = s.clinic_b;
    raise exception 'owner change should be locked';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_OWNER_LOCKED_FOR_CAPACITY' then
        raise exception 'expected owner lock, got %', v_err;
      end if;
  end;

  v_gov := public.get_platform_commercial_governance();
  if (v_gov->>'projection_not_received')::boolean is not true then
    raise exception 'governance must separate projection';
  end if;

  -- coupon seam exists and is unused by resolve
  if private.billing_resolve_commercial_price(s.clinic_c, clock_timestamp())->>'adjustments_applied'
       is distinct from '0' then
    raise exception 'founder must not apply coupon rows';
  end if;
  if private.billing_preview_future_adjustments(s.clinic_c, 10000)->>'founder_is_not_coupon'
       is distinct from 'true' then
    raise exception 'coupon seam missing';
  end if;

  -- CA usage is tenant-scoped
  perform set_config('request.jwt.claim.sub', s.auth_admin_a::text, true);
  begin
    perform public.get_my_clinic_commercial_usage(s.clinic_b);
    raise exception 'cross clinic usage should fail';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_NOT_CLINIC_ADMIN' then
        raise exception 'expected clinic admin gate, got %', v_err;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', s.auth_admin_a::text, true);
  begin
    perform public.set_platform_clinic_additional_capacity(s.clinic_a, 9, 9);
    raise exception 'CA must not set capacity';
  exception
    when others then
      get stacked diagnostics v_err = pg_exception_hint;
      if v_err is distinct from 'BILLING_NOT_PLATFORM_ADMIN' then
        raise exception 'expected PA gate on add-on, got %', v_err;
      end if;
  end;
end;
$$;
rollback;
