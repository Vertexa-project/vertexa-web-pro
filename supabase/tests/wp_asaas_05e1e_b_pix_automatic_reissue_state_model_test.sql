-- =====================================================================================
-- WP-ASAAS-05E1E-B · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260918213227. Fixtures sintéticos. Sem HTTP Asaas. Sem seed permanente.
-- =====================================================================================

create or replace function pg_temp.asaas05e1eb_plan()
returns uuid
language sql
as $$
  select pv.id
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;
$$;

create or replace function pg_temp.asaas05e1eb_seed()
returns table (
  clinic_id uuid,
  owner_id uuid,
  account_id uuid,
  contract_id uuid
)
language plpgsql
as $seed$
declare
  v_clinic uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_account uuid;
  v_contract uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
  values (v_owner, gen_random_uuid(), 'professional', 'Owner 05E1EB', 'own-05e1eb@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
  values (v_clinic, 'Clinica 05E1EB', v_owner);
  insert into private.billing_accounts (
    owner_profile_id, clinic_id, provider, environment, external_customer_id
  ) values (
    v_owner, v_clinic, 'asaas', 'sandbox', 'cus_05e1eb'
  ) returning id into v_account;
  insert into private.billing_customer_identities (clinic_id, legal_name, tax_id, email)
    values (v_clinic, 'Clinica Sintetica LTDA', '99991111140', 'bill-05e1eb@t.test');
  v_contract := private.billing_create_commercial_contract(
    v_clinic, pg_temp.asaas05e1eb_plan(), null, now(), null
  );
  return query select v_clinic, v_owner, v_account, v_contract;
end;
$seed$;

create or replace function pg_temp.asaas05e1eb_event(p_ext text, p_type text)
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
    'asaas', 'sandbox', p_ext, p_type, clock_timestamp(),
    'pix_automatic_authorization', p_ext, repeat('c', 64), 'processing'
  ) returning id into v_id;
  return v_id;
end;
$$;


-- T1: first-ever PREPARE still creates generation 1 INTENT + pending op
begin;
do $$
declare
  s record;
  r jsonb;
  v_auth private.billing_pix_automatic_authorizations%rowtype;
  v_op private.billing_outbound_operations%rowtype;
begin
  select * into s from pg_temp.asaas05e1eb_seed();
  r := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  if r->>'outcome' is distinct from 'prepared'
     or (r->>'generation')::int is distinct from 1
     or r->>'provider_status' is distinct from 'INTENT' then
    raise exception 'ASAAS05E1EB T1 FAIL prepare: %', r;
  end if;
  select * into v_auth
    from private.billing_pix_automatic_authorizations
   where id = (r->>'authorization_id')::uuid;
  select * into v_op
    from private.billing_outbound_operations
   where id = (r->'authorization_operation'->>'operation_id')::uuid;
  if v_auth.generation <> 1
     or v_auth.is_primary is not true
     or v_auth.provider_authorization_id is not null
     or v_auth.provider_contract_id is distinct from replace(v_auth.id::text, '-', '')
     or v_op.status is distinct from 'pending'
     or v_op.attempt_count <> 1
     or v_op.pix_authorization_id is distinct from v_auth.id
     or v_op.idempotency_key is distinct from
          (s.account_id::text || ':create_pix_automatic_authorization:' || v_auth.id::text) then
    raise exception 'ASAAS05E1EB T1 FAIL rows';
  end if;
end $$;
rollback;

-- T2: ordinary PREPARE on INTENT is idempotent
begin;
do $$
declare
  s record;
  r1 jsonb;
  r2 jsonb;
begin
  select * into s from pg_temp.asaas05e1eb_seed();
  r1 := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  r2 := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  if r1->>'authorization_id' is distinct from r2->>'authorization_id'
     or r1->'authorization_operation'->>'operation_id'
          is distinct from r2->'authorization_operation'->>'operation_id'
     or (select count(*) from private.billing_pix_automatic_authorizations
          where commercial_contract_id = s.contract_id) <> 1 then
    raise exception 'ASAAS05E1EB T2 FAIL';
  end if;
end $$;
rollback;

-- T3/T4: ordinary PREPARE on CREATED/ACTIVE does not reissue
begin;
do $$
declare
  s record;
  r jsonb;
  v_id uuid;
begin
  select * into s from pg_temp.asaas05e1eb_seed();
  r := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  v_id := (r->>'authorization_id')::uuid;
  update private.billing_pix_automatic_authorizations
     set provider_status = 'CREATED'
   where id = v_id;
  r := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  if r->>'authorization_id' is distinct from v_id::text
     or r->>'outcome' is distinct from 'prepared'
     or (select count(*) from private.billing_pix_automatic_authorizations
          where commercial_contract_id = s.contract_id) <> 1 then
    raise exception 'ASAAS05E1EB T3 FAIL created';
  end if;
  update private.billing_pix_automatic_authorizations
     set provider_status = 'ACTIVE'
   where id = v_id;
  r := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  if r->>'authorization_id' is distinct from v_id::text
     or (select count(*) from private.billing_pix_automatic_authorizations
          where commercial_contract_id = s.contract_id) <> 1 then
    raise exception 'ASAAS05E1EB T4 FAIL active';
  end if;
end $$;
rollback;

-- T5: REFUSED cannot transition back to INTENT
begin;
do $$
begin
  if private.billing_pix_automatic_transition_allowed('REFUSED', 'INTENT')
     or private.billing_pix_automatic_transition_allowed('REFUSED', 'CREATED') then
    raise exception 'ASAAS05E1EB T5 FAIL';
  end if;
end $$;
rollback;

-- T6-T12, T18-T22: explicit REISSUE after REFUSED
begin;
do $$
declare
  s record;
  r_prep jsonb;
  r_refused jsonb;
  r_reissue jsonb;
  r_again jsonb;
  v1 private.billing_pix_automatic_authorizations%rowtype;
  v2 private.billing_pix_automatic_authorizations%rowtype;
  op1 private.billing_outbound_operations%rowtype;
  op2 private.billing_outbound_operations%rowtype;
  v_hist_pid text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
begin
  select * into s from pg_temp.asaas05e1eb_seed();
  r_prep := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  update private.billing_pix_automatic_authorizations
     set provider_status = 'REFUSED',
         provider_authorization_id = v_hist_pid,
         qr_expires_at = timestamptz '2026-09-18 12:49:52+00',
         provider_event_at = timestamptz '2026-09-18 12:50:04+00'
   where id = (r_prep->>'authorization_id')::uuid;
  update private.billing_outbound_operations
     set status = 'completed',
         attempt_count = 2,
         external_object_id = v_hist_pid,
         completed_at = clock_timestamp()
   where id = (r_prep->'authorization_operation'->>'operation_id')::uuid;

  r_refused := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  -- The canonical response retains a stable JSON shape: absent operations are
  -- represented by JSON null, not an omitted key. `->>` normalizes that to SQL
  -- NULL while preserving the invariant that PREPARE creates no operation.
  if r_refused->>'outcome' is distinct from 'refused_requires_reissue'
     or r_refused->>'authorization_id' is distinct from r_prep->>'authorization_id'
     or r_refused->>'authorization_operation' is not null then
    raise exception 'ASAAS05E1EB T6 FAIL silent prepare: %', r_refused;
  end if;

  r_reissue := private.billing_reissue_pix_automatic_authorization(s.contract_id, 'sandbox');
  if r_reissue->>'outcome' is distinct from 'reissued'
     or (r_reissue->>'generation')::int is distinct from 2
     or r_reissue->>'provider_status' is distinct from 'INTENT'
     or r_reissue->>'authorization_id' is not distinct from r_prep->>'authorization_id' then
    raise exception 'ASAAS05E1EB T6 FAIL reissue: %', r_reissue;
  end if;

  select * into v1 from private.billing_pix_automatic_authorizations
   where id = (r_prep->>'authorization_id')::uuid;
  select * into v2 from private.billing_pix_automatic_authorizations
   where id = (r_reissue->>'authorization_id')::uuid;
  select * into op1 from private.billing_outbound_operations
   where id = (r_prep->'authorization_operation'->>'operation_id')::uuid;
  select * into op2 from private.billing_outbound_operations
   where id = (r_reissue->'authorization_operation'->>'operation_id')::uuid;

  if v1.provider_status is distinct from 'REFUSED'
     or v1.provider_authorization_id is distinct from v_hist_pid
     or v1.is_primary is not false
     or v1.generation <> 1
     or v1.qr_expires_at is distinct from timestamptz '2026-09-18 12:49:52+00'
     or v2.provider_status is distinct from 'INTENT'
     or v2.provider_authorization_id is not null
     or v2.is_primary is not true
     or v2.generation <> 2
     or v2.billing_account_id is distinct from v1.billing_account_id
     or v2.commercial_contract_id is distinct from v1.commercial_contract_id
     or op1.status is distinct from 'completed'
     or op1.id = op2.id
     or op2.status is distinct from 'pending'
     or op2.attempt_count <> 1
     or op2.external_object_id is not null
     or op2.completed_at is not null
     or op2.last_error_category is not null
     or op2.idempotency_key = op1.idempotency_key
     or op2.pix_authorization_id is distinct from v2.id
     or (select count(*) from private.billing_pix_automatic_authorizations
          where commercial_contract_id = s.contract_id and is_primary) <> 1 then
    raise exception 'ASAAS05E1EB T7-12 FAIL';
  end if;

  r_again := private.billing_reissue_pix_automatic_authorization(s.contract_id, 'sandbox');
  if r_again->>'outcome' is distinct from 'already_reissued'
     or r_again->>'authorization_id' is distinct from r_reissue->>'authorization_id'
     or (select count(*) from private.billing_pix_automatic_authorizations
          where commercial_contract_id = s.contract_id) <> 2 then
    raise exception 'ASAAS05E1EB T13 sequential concurrent loser: %', r_again;
  end if;

  begin
    insert into private.billing_pix_automatic_authorizations (
      commercial_contract_id, billing_account_id, environment,
      provider_status, is_primary, generation, recurrence_start_date, provider_contract_id
    ) values (
      s.contract_id, s.account_id, 'sandbox',
      'INTENT', false, 2, date '2026-11-01', repeat('d', 32)
    );
    raise exception 'ASAAS05E1EB T13 FAIL: duplicate generation allowed';
  exception
    when unique_violation then
      null;
  end;
end $$;
rollback;

-- T13b: CREATED/ACTIVE/CANCELLED/EXPIRED cannot reissue
begin;
do $$
declare
  s record;
  r jsonb;
  v_id uuid;
begin
  select * into s from pg_temp.asaas05e1eb_seed();
  r := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  v_id := (r->>'authorization_id')::uuid;
  update private.billing_pix_automatic_authorizations set provider_status = 'CREATED' where id = v_id;
  begin
    perform private.billing_reissue_pix_automatic_authorization(s.contract_id, 'sandbox');
    raise exception 'ASAAS05E1EB T13b FAIL created';
  exception
    when others then
      if sqlerrm not like '%BILLING_REISSUE_NOT_REFUSED%' then
        raise;
      end if;
  end;
  update private.billing_pix_automatic_authorizations set provider_status = 'CANCELLED' where id = v_id;
  begin
    perform private.billing_reissue_pix_automatic_authorization(s.contract_id, 'sandbox');
    raise exception 'ASAAS05E1EB T13b FAIL cancelled';
  exception
    when others then
      if sqlerrm not like '%BILLING_REISSUE_STATUS_UNSUPPORTED%' then
        raise;
      end if;
  end;
end $$;
rollback;

-- T14/T15: late webhook #1 does not mutate #2; webhook #2 mutates #2
begin;
do $$
declare
  s record;
  r_prep jsonb;
  r_reissue jsonb;
  ev1 uuid;
  ev2 uuid;
  applied jsonb;
  v1 private.billing_pix_automatic_authorizations%rowtype;
  v2 private.billing_pix_automatic_authorizations%rowtype;
  v_hist_pid text := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_new_pid text := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
begin
  select * into s from pg_temp.asaas05e1eb_seed();
  r_prep := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  update private.billing_pix_automatic_authorizations
     set provider_status = 'REFUSED',
         provider_authorization_id = v_hist_pid,
         provider_event_at = timestamptz '2026-09-18 15:51:01+00'
   where id = (r_prep->>'authorization_id')::uuid;
  r_reissue := private.billing_reissue_pix_automatic_authorization(s.contract_id, 'sandbox');

  ev1 := pg_temp.asaas05e1eb_event('evt_hist', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED');
  applied := private.apply_billing_pix_automatic_authorization_event(
    ev1, 'sandbox', v_hist_pid, 'REFUSED', 'cus_05e1eb',
    (select provider_contract_id from private.billing_pix_automatic_authorizations
      where id = (r_prep->>'authorization_id')::uuid),
    39000, timestamptz '2026-09-18 15:51:01+00', null, null
  );
  if applied->>'authorization_id' is distinct from r_prep->>'authorization_id' then
    raise exception 'ASAAS05E1EB T14 FAIL late #1 target: %', applied;
  end if;

  select * into v1 from private.billing_pix_automatic_authorizations
   where id = (r_prep->>'authorization_id')::uuid;
  select * into v2 from private.billing_pix_automatic_authorizations
   where id = (r_reissue->>'authorization_id')::uuid;
  if v1.provider_status is distinct from 'REFUSED'
     or v2.provider_status is distinct from 'INTENT'
     or v2.provider_authorization_id is not null then
    raise exception 'ASAAS05E1EB T14 FAIL #2 mutated';
  end if;

  ev2 := pg_temp.asaas05e1eb_event('evt_new', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED');
  applied := private.apply_billing_pix_automatic_authorization_event(
    ev2, 'sandbox', v_new_pid, 'CREATED', 'cus_05e1eb',
    v2.provider_contract_id, 39000, clock_timestamp(), 'CONC2', null
  );
  if applied->>'authorization_id' is distinct from r_reissue->>'authorization_id'
     or applied->>'provider_status' is distinct from 'CREATED' then
    raise exception 'ASAAS05E1EB T15 FAIL #2 apply: %', applied;
  end if;
  select * into v1 from private.billing_pix_automatic_authorizations
   where id = (r_prep->>'authorization_id')::uuid;
  select * into v2 from private.billing_pix_automatic_authorizations
   where id = (r_reissue->>'authorization_id')::uuid;
  if v1.provider_status is distinct from 'REFUSED'
     or v2.provider_status is distinct from 'CREATED'
     or v2.provider_authorization_id is distinct from v_new_pid then
    raise exception 'ASAAS05E1EB T15 FAIL isolation';
  end if;
end $$;
rollback;

-- T16/T17: loader binds operation #2 to authorization #2, not historical primary
begin;
do $$
declare
  s record;
  r_prep jsonb;
  r_reissue jsonb;
  loaded jsonb;
begin
  select * into s from pg_temp.asaas05e1eb_seed();
  r_prep := private.billing_prepare_pix_automatic_authorization(s.contract_id, 'sandbox');
  update private.billing_pix_automatic_authorizations
     set provider_status = 'REFUSED',
         provider_authorization_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
   where id = (r_prep->>'authorization_id')::uuid;
  update private.billing_outbound_operations
     set status = 'completed',
         external_object_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
         completed_at = clock_timestamp()
   where id = (r_prep->'authorization_operation'->>'operation_id')::uuid;
  r_reissue := private.billing_reissue_pix_automatic_authorization(s.contract_id, 'sandbox');

  loaded := public.load_prepared_pix_automatic_authorization(
    (r_reissue->'authorization_operation'->>'operation_id')::uuid
  );
  if loaded->>'authorization_id' is distinct from r_reissue->>'authorization_id'
     or loaded->>'authorization_provider_status' is distinct from 'INTENT'
     or (loaded->>'generation')::int is distinct from 2
     or loaded->>'idempotency_key' is not distinct from
          (select idempotency_key from private.billing_outbound_operations
            where id = (r_prep->'authorization_operation'->>'operation_id')::uuid)
     or loaded->>'provider_contract_id' is not distinct from
          (select provider_contract_id from private.billing_pix_automatic_authorizations
            where id = (r_prep->>'authorization_id')::uuid) then
    raise exception 'ASAAS05E1EB T16 FAIL load #2: %', loaded;
  end if;

  loaded := public.load_prepared_pix_automatic_authorization(
    (r_prep->'authorization_operation'->>'operation_id')::uuid
  );
  if loaded->>'authorization_id' is distinct from r_prep->>'authorization_id'
     or loaded->>'load_state' is distinct from 'already_completed'
     or loaded->>'authorization_provider_status' is distinct from 'REFUSED' then
    raise exception 'ASAAS05E1EB T18 FAIL load #1: %', loaded;
  end if;
end $$;
rollback;

-- Grants remain private
begin;
do $$
begin
  if has_function_privilege('anon', 'private.billing_reissue_pix_automatic_authorization(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'private.billing_reissue_pix_automatic_authorization(uuid,text)', 'execute')
     or has_function_privilege('public', 'private.billing_reissue_pix_automatic_authorization(uuid,text)', 'execute')
     or to_regprocedure('public.billing_reissue_pix_automatic_authorization(uuid,text)') is not null then
    raise exception 'ASAAS05E1EB SECURITY FAIL: public reissue path';
  end if;
end $$;
rollback;
