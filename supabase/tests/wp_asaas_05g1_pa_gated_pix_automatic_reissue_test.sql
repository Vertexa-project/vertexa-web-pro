-- =====================================================================================
-- WP-ASAAS-05G1 · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260919190000. Fixtures sintéticos. Sem HTTP Asaas. Sem seed permanente.
-- RELEASE GATE: este arquivo não roda no remoto até a migration ser aplicada.
-- =====================================================================================

create or replace function pg_temp.asaas05g1_plan()
returns uuid
language sql
as $$
  select pv.id
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;
$$;

create or replace function pg_temp.asaas05g1_as(p_auth uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_auth::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.asaas05g1_seed()
returns table (
  clinic_id uuid,
  other_clinic_id uuid,
  owner_id uuid,
  owner_auth uuid,
  admin_id uuid,
  admin_auth uuid,
  member_id uuid,
  member_auth uuid,
  patient_id uuid,
  patient_auth uuid,
  pa_id uuid,
  pa_auth uuid,
  account_id uuid,
  contract_id uuid,
  other_contract_id uuid
)
language plpgsql
as $seed$
declare
  v_clinic uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_owner_auth uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_admin_auth uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_member_auth uuid := gen_random_uuid();
  v_patient uuid := gen_random_uuid();
  v_patient_auth uuid := gen_random_uuid();
  v_pa uuid := gen_random_uuid();
  v_pa_auth uuid := gen_random_uuid();
  v_account uuid;
  v_contract uuid;
  v_other_contract uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_owner, v_owner_auth, 'professional', 'Owner 05G1', 'own-05g1@t.test', 'active'),
    (v_admin, v_admin_auth, 'professional', 'Admin 05G1', 'adm-05g1@t.test', 'active'),
    (v_member, v_member_auth, 'professional', 'Member 05G1', 'mem-05g1@t.test', 'active'),
    (v_patient, v_patient_auth, 'patient', 'Paciente 05G1', 'pat-05g1@t.test', 'active'),
    (v_pa, v_pa_auth, 'professional', 'PA 05G1', 'pa-05g1@t.test', 'active');

  insert into public.clinics (id, name, owner_profile_id) values
    (v_clinic, 'Clinica 05G1', v_owner),
    (v_other, 'Clinica Outra 05G1', v_owner);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_owner, v_clinic, 'other', 'admin', 'active'),
    (v_admin, v_clinic, 'doctor', 'admin', 'active'),
    (v_member, v_clinic, 'nutritionist', 'member', 'active');

  insert into public.patients (profile_id, clinic_id, goal)
    values (v_patient, v_clinic, 'meta');

  insert into private.platform_admins (profile_id, status, granted_at, revoked_at)
    values (v_pa, 'active', now(), null);

  insert into private.billing_accounts (
    owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (
    v_owner, v_clinic, 'asaas', 'sandbox', 'cus_05g1'
  ) returning id into v_account;
  insert into private.billing_accounts (
    owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (
    v_owner, v_other, 'asaas', 'sandbox', 'cus_05g1b'
  );

  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values
      (v_clinic, 'Clinica Sintetica 05G1 LTDA', '99991111140', 'bill-05g1@t.test'),
      (v_other, 'Clinica Outra 05G1 LTDA', '99991111141', 'bill-05g1b@t.test');

  v_contract := private.billing_create_commercial_contract(
    v_clinic, pg_temp.asaas05g1_plan(), null, now(), null
  );
  v_other_contract := private.billing_create_commercial_contract(
    v_other, pg_temp.asaas05g1_plan(), null, now(), null
  );

  return query select
    v_clinic, v_other, v_owner, v_owner_auth, v_admin, v_admin_auth,
    v_member, v_member_auth, v_patient, v_patient_auth, v_pa, v_pa_auth,
    v_account, v_contract, v_other_contract;
end;
$seed$;

create or replace function pg_temp.asaas05g1_refuse(p_contract uuid)
returns uuid
language plpgsql
as $$
declare
  r jsonb;
  v_id uuid;
begin
  r := private.billing_prepare_pix_automatic_authorization(p_contract, 'sandbox');
  v_id := (r->>'authorization_id')::uuid;
  update private.billing_pix_automatic_authorizations
     set provider_status = 'REFUSED'
   where id = v_id;
  return v_id;
end;
$$;


-- I0: PA + REFUSED → reissued, historical old, INTENT new, one reservation, one transition audit
begin;
do $$
declare
  s record;
  v_old uuid;
  r jsonb;
  v1 private.billing_pix_automatic_authorizations%rowtype;
  v2 private.billing_pix_automatic_authorizations%rowtype;
  ev private.billing_pix_automatic_reissue_events%rowtype;
begin
  select * into s from pg_temp.asaas05g1_seed();
  v_old := pg_temp.asaas05g1_refuse(s.contract_id);
  perform pg_temp.asaas05g1_as(s.pa_auth);
  r := public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_old, 'qa 05g1');
  if r->>'outcome' is distinct from 'reissued'
     or (r->>'old_generation')::int is distinct from 1
     or (r->>'new_generation')::int is distinct from 2
     or r->>'new_status' is distinct from 'INTENT' then
    raise exception 'ASAAS05G1 I0 FAIL result: %', r;
  end if;
  select * into v1 from private.billing_pix_automatic_authorizations where id = v_old;
  select * into v2 from private.billing_pix_automatic_authorizations
   where id = (r->>'new_authorization_id')::uuid;
  if v1.provider_status is distinct from 'REFUSED'
     or v1.is_primary is not false
     or v2.provider_status is distinct from 'INTENT'
     or v2.is_primary is not true
     or v2.generation <> 2 then
    raise exception 'ASAAS05G1 I0 FAIL rows';
  end if;
  if (select count(*) from private.billing_outbound_operations
        where pix_authorization_id = v2.id and status = 'pending') <> 1 then
    raise exception 'ASAAS05G1 I0 FAIL reservation';
  end if;
  select * into ev from private.billing_pix_automatic_reissue_events
   where commercial_contract_id = s.contract_id and outcome = 'reissued';
  if ev.actor_profile_id is distinct from s.pa_id
     or ev.old_status is distinct from 'REFUSED'
     or ev.new_status is distinct from 'INTENT'
     or ev.environment is distinct from 'sandbox' then
    raise exception 'ASAAS05G1 I5 FAIL actor/audit: %', ev;
  end if;
end $$;
rollback;

-- I1: non-PA / patient / member / clinic admin forbidden
begin;
do $$
declare
  s record;
  v_old uuid;
  v_before int;
  caller uuid;
begin
  select * into s from pg_temp.asaas05g1_seed();
  v_old := pg_temp.asaas05g1_refuse(s.contract_id);
  v_before := (select count(*) from private.billing_pix_automatic_authorizations
                where commercial_contract_id = s.contract_id);
  foreach caller in array array[s.owner_auth, s.admin_auth, s.member_auth, s.patient_auth]
  loop
    perform pg_temp.asaas05g1_as(caller);
    begin
      perform public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_old);
      raise exception 'ASAAS05G1 I1 FAIL allowed %', caller;
    exception
      when others then
        if sqlerrm not like '%NOT_PLATFORM_ADMIN%' then
          raise;
        end if;
    end;
  end loop;
  if (select count(*) from private.billing_pix_automatic_authorizations
        where commercial_contract_id = s.contract_id) <> v_before
     or (select count(*) from private.billing_pix_automatic_reissue_events
           where commercial_contract_id = s.contract_id) <> 0 then
    raise exception 'ASAAS05G1 I1 FAIL mutation';
  end if;
end $$;
rollback;

-- I2: tampering
begin;
do $$
declare
  s record;
  v_old uuid;
  v_other uuid;
begin
  select * into s from pg_temp.asaas05g1_seed();
  v_old := pg_temp.asaas05g1_refuse(s.contract_id);
  v_other := pg_temp.asaas05g1_refuse(s.other_contract_id);
  perform pg_temp.asaas05g1_as(s.pa_auth);

  begin
    perform public.reissue_pix_automatic_authorization(s.other_clinic_id, s.contract_id, v_old);
    raise exception 'ASAAS05G1 I2 FAIL wrong clinic';
  exception
    when others then
      if sqlerrm not like '%BILLING_CLINIC_MISMATCH%' and sqlerrm not like '%BILLING_ACCOUNT_UNKNOWN%' then
        raise;
      end if;
  end;

  begin
    perform public.reissue_pix_automatic_authorization(s.clinic_id, s.other_contract_id, v_old);
    raise exception 'ASAAS05G1 I2 FAIL wrong contract';
  exception
    when others then
      if sqlerrm not like '%BILLING_CLINIC_MISMATCH%' and sqlerrm not like '%BILLING_CONTRACT_MISMATCH%' then
        raise;
      end if;
  end;

  begin
    perform public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_other);
    raise exception 'ASAAS05G1 I2 FAIL other auth';
  exception
    when others then
      if sqlerrm not like '%BILLING_CONTRACT_MISMATCH%' then
        raise;
      end if;
  end;

  if (select count(*) from private.billing_pix_automatic_authorizations
        where commercial_contract_id = s.contract_id) <> 1 then
    raise exception 'ASAAS05G1 I2 FAIL mutation';
  end if;
end $$;
rollback;

-- I2b: historical REFUSED while another primary exists
begin;
do $$
declare
  s record;
  v_old uuid;
  r jsonb;
begin
  select * into s from pg_temp.asaas05g1_seed();
  v_old := pg_temp.asaas05g1_refuse(s.contract_id);
  perform pg_temp.asaas05g1_as(s.pa_auth);
  r := public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_old);
  begin
    perform public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_old);
    raise exception 'ASAAS05G1 I2b FAIL historical';
  exception
    when others then
      if sqlerrm not like '%BILLING_REISSUE_NOT_PRIMARY%' then
        raise;
      end if;
  end;
  if (select count(*) from private.billing_pix_automatic_authorizations
        where commercial_contract_id = s.contract_id) <> 2 then
    raise exception 'ASAAS05G1 I2b FAIL extra generation';
  end if;
end $$;
rollback;

-- I3: state matrix
begin;
do $$
declare
  s record;
  v_id uuid;
  r jsonb;
  st text;
begin
  select * into s from pg_temp.asaas05g1_seed();
  r := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  v_id := (r->>'authorization_id')::uuid;
  perform pg_temp.asaas05g1_as(s.pa_auth);

  foreach st in array array['CREATED', 'ACTIVE']
  loop
    update private.billing_pix_automatic_authorizations set provider_status = st where id = v_id;
    begin
      perform public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_id);
      raise exception 'ASAAS05G1 I3 FAIL %', st;
    exception
      when others then
        if sqlerrm not like '%BILLING_REISSUE_NOT_REFUSED%' then
          raise;
        end if;
    end;
  end loop;

  foreach st in array array['CANCELLED', 'EXPIRED']
  loop
    update private.billing_pix_automatic_authorizations set provider_status = st where id = v_id;
    begin
      perform public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_id);
      raise exception 'ASAAS05G1 I3 FAIL %', st;
    exception
      when others then
        if sqlerrm not like '%BILLING_REISSUE_STATUS_UNSUPPORTED%' then
          raise;
        end if;
    end;
  end loop;

  update private.billing_pix_automatic_authorizations set provider_status = 'REFUSED' where id = v_id;
  r := public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_id);
  if r->>'outcome' is distinct from 'reissued' then
    raise exception 'ASAAS05G1 I3 FAIL refused';
  end if;
  r := public.reissue_pix_automatic_authorization(
    s.clinic_id, s.contract_id, (r->>'new_authorization_id')::uuid
  );
  if r->>'outcome' is distinct from 'already_reissued' then
    raise exception 'ASAAS05G1 I3 FAIL intent: %', r;
  end if;
  if (select count(*) from private.billing_pix_automatic_reissue_events
        where commercial_contract_id = s.contract_id and outcome = 'reissued') <> 1 then
    raise exception 'ASAAS05G1 I3 FAIL duplicate transition audit';
  end if;
end $$;
rollback;

-- I4: sequential repeat does not create N+2 from the same REFUSED
begin;
do $$
declare
  s record;
  v_old uuid;
  r1 jsonb;
  r2 jsonb;
begin
  select * into s from pg_temp.asaas05g1_seed();
  v_old := pg_temp.asaas05g1_refuse(s.contract_id);
  perform pg_temp.asaas05g1_as(s.pa_auth);
  r1 := public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_old);
  begin
    r2 := public.reissue_pix_automatic_authorization(s.clinic_id, s.contract_id, v_old);
    raise exception 'ASAAS05G1 I4 FAIL second on old primary: %', r2;
  exception
    when others then
      if sqlerrm not like '%BILLING_REISSUE_NOT_PRIMARY%' then
        raise;
      end if;
  end;
  r2 := public.reissue_pix_automatic_authorization(
    s.clinic_id, s.contract_id, (r1->>'new_authorization_id')::uuid
  );
  if r2->>'outcome' is distinct from 'already_reissued'
     or (select count(*) from private.billing_pix_automatic_authorizations
           where commercial_contract_id = s.contract_id) <> 2
     or (select count(*) from private.billing_pix_automatic_authorizations
           where commercial_contract_id = s.contract_id and is_primary) <> 1
     or (select count(*) from private.billing_pix_automatic_reissue_events
           where commercial_contract_id = s.contract_id and outcome = 'reissued') <> 1 then
    raise exception 'ASAAS05G1 I4 FAIL counts';
  end if;
end $$;
rollback;

-- Grants / private remains sealed
begin;
do $$
begin
  if has_function_privilege('anon', 'public.reissue_pix_automatic_authorization(uuid,uuid,uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.reissue_pix_automatic_authorization(uuid,uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'private.billing_reissue_pix_automatic_authorization(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'private.billing_reissue_pix_automatic_authorization(uuid,text)', 'execute')
     or has_table_privilege('authenticated', 'private.billing_pix_automatic_reissue_events', 'select')
     or has_table_privilege('anon', 'private.billing_pix_automatic_reissue_events', 'select')
     or has_function_privilege('anon', 'public.list_platform_clinic_pix_automatic_statuses()', 'execute')
     or not has_function_privilege('authenticated', 'public.list_platform_clinic_pix_automatic_statuses()', 'execute') then
    raise exception 'ASAAS05G1 SECURITY FAIL grants';
  end if;
end $$;
rollback;
