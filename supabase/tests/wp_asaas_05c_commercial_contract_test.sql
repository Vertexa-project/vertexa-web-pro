-- =====================================================================================
-- WP-ASAAS-05C · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260912211110 aplicada.
-- Anon = has_*_privilege (sem SET ROLE anon — isolador PG 17.6 SIGSEGV).
-- OFFER REFERENCE != OFFER CLAIM. Fixtures sintéticos. Sem PII real.
-- =====================================================================================

create or replace function pg_temp.asaas05c_seed()
returns table (c1 uuid, c2 uuid, c3 uuid)
language plpgsql
as $seed$
declare
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_c3 uuid := gen_random_uuid();
  v_pf uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, gen_random_uuid(), 'professional', 'Owner 05C', 'own-05c@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id) values
    (v_c1, 'Clinica 05C A', v_pf),
    (v_c2, 'Clinica 05C B', v_pf),
    (v_c3, 'Clinica 05C C', v_pf);
  return query select v_c1, v_c2, v_c3;
end;
$seed$;


-- T1: tabela private, RLS ON, 0 policies; migration sem seed
begin;
do $$
declare
  v_n int;
  v_rls boolean;
begin
  if to_regclass('private.billing_commercial_contracts') is null then
    raise exception 'ASAAS05C T1 FAIL: tabela ausente';
  end if;
  select c.relrowsecurity into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'billing_commercial_contracts';
  if v_rls is not true then
    raise exception 'ASAAS05C T1 FAIL: RLS off';
  end if;
  select count(*) into v_n
    from pg_policies
   where schemaname = 'private' and tablename = 'billing_commercial_contracts';
  if v_n <> 0 then
    raise exception 'ASAAS05C T1 FAIL: policies=%', v_n;
  end if;
  select count(*) into v_n from private.billing_commercial_contracts;
  if v_n <> 0 then
    raise exception 'ASAAS05C T1 FAIL: seed de contrato=%', v_n;
  end if;
end $$;
rollback;

-- T2: grants fail-closed
begin;
do $$
begin
  if has_table_privilege('authenticated', 'private.billing_commercial_contracts', 'select')
     or has_table_privilege('authenticated', 'private.billing_commercial_contracts', 'insert')
     or has_table_privilege('anon', 'private.billing_commercial_contracts', 'select')
     or has_table_privilege('service_role', 'private.billing_commercial_contracts', 'select')
     or has_table_privilege('service_role', 'private.billing_commercial_contracts', 'insert') then
    raise exception 'ASAAS05C T2 FAIL: table priv';
  end if;
  if has_function_privilege('authenticated', 'private.billing_create_commercial_contract(uuid,uuid,uuid,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('anon', 'private.billing_create_commercial_contract(uuid,uuid,uuid,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('service_role', 'private.billing_create_commercial_contract(uuid,uuid,uuid,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'private.billing_clinic_active_contract(uuid)', 'execute')
     or has_function_privilege('anon', 'private.billing_clinic_active_contract(uuid)', 'execute')
     or has_function_privilege('service_role', 'private.billing_clinic_active_contract(uuid)', 'execute') then
    raise exception 'ASAAS05C T2 FAIL: execute priv';
  end if;
end $$;
rollback;

-- T3: sem RPC pública; clinics/subscriptions intactas; create_patient sem gate
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
       'billing_create_commercial_contract',
       'billing_clinic_active_contract',
       'choose_plan'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05C T3 FAIL: RPC pública=%', v_n;
  end if;

  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clinics'
     and column_name in ('plan', 'plan_id', 'plan_code', 'plan_version_id', 'effective_plan');
  if v_n <> 0 then
    raise exception 'ASAAS05C T3 FAIL: clinics ganhou plano';
  end if;

  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'private' and table_name = 'billing_subscriptions'
     and column_name in (
       'contracted_price_cents', 'commercial_offer_id', 'plan_code',
       'catalog_plan_version_id', 'contracted_currency'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05C T3 FAIL: subscriptions alterada';
  end if;

  select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_patient'
   order by p.pronargs desc limit 1;
  if v_src ~* 'billing_create_commercial_contract|billing_clinic_active_contract' then
    raise exception 'ASAAS05C T3 FAIL: create_patient gated';
  end if;
end $$;
rollback;

-- T4: Pulse standard — caller não informa preço
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_id uuid;
  r record;
  v_slots int;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  v_id := private.billing_create_commercial_contract(s.c1, v_pulse, null, now(), null);
  select * into r from private.billing_clinic_active_contract(s.c1);

  if r.contract_id is distinct from v_id
     or r.plan_code is distinct from 'pulse'
     or r.plan_version is distinct from 1
     or r.contracted_price_cents is distinct from 39000
     or r.currency is distinct from 'BRL'
     or r.offer_id is not null
     or r.billing_cycle is distinct from 'monthly' then
    raise exception 'ASAAS05C T4 FAIL: pulse standard r=%', r;
  end if;

  select count(*) into v_slots
    from private.billing_accounts
   where clinic_id = s.c1;
  if v_slots <> 0 then
    raise exception 'ASAAS05C T4 FAIL: exigiu billing_account';
  end if;
end $$;
rollback;

-- T5: Sync + Founder 39000. OFFER REFERENCE != CLAIM
begin;
do $$
declare
  s record;
  v_sync uuid;
  v_offer uuid;
  r record;
  v_slots int;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_sync
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'sync' and pv.version = 1;
  select id into v_offer from private.billing_offers where code = 'founder_2026';

  perform private.billing_create_commercial_contract(s.c1, v_sync, v_offer, now(), null);
  select * into r from private.billing_clinic_active_contract(s.c1);

  if r.contracted_price_cents is distinct from 39000
     or r.plan_code is distinct from 'sync'
     or r.offer_code is distinct from 'founder_2026' then
    raise exception 'ASAAS05C T5 FAIL: founder sync r=%', r;
  end if;

  if to_regclass('private.billing_offer_claims') is not null
     or to_regclass('private.billing_founder_claims') is not null then
    raise exception 'ASAAS05C T5 FAIL: tabela de claim criada';
  end if;
  select total_slots into v_slots from private.billing_offers where code = 'founder_2026';
  if v_slots <> 50 then
    raise exception 'ASAAS05C T5 FAIL: slot Founder consumido slots=%', v_slots;
  end if;
end $$;
rollback;

-- T6: Apex + Founder 89000, sem claim
begin;
do $$
declare
  s record;
  v_apex uuid;
  v_offer uuid;
  r record;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_apex
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'apex' and pv.version = 1;
  select id into v_offer from private.billing_offers where code = 'founder_2026';

  perform private.billing_create_commercial_contract(s.c1, v_apex, v_offer, now(), null);
  select * into r from private.billing_clinic_active_contract(s.c1);
  if r.contracted_price_cents is distinct from 89000
     or r.plan_code is distinct from 'apex' then
    raise exception 'ASAAS05C T6 FAIL: apex founder r=%', r;
  end if;
end $$;
rollback;

-- T7: offer sem preço para a versão → reject
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_offer uuid;
  v_ok boolean := false;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;
  insert into private.billing_offers (
    code, display_name, status, total_slots, price_lock_months,
    future_adjustment_discount_bps, commercial_terms
  ) values ('orphan_05c', 'Orphan', 'active', 1, 1, 0, 'test')
    returning id into v_offer;

  begin
    perform private.billing_create_commercial_contract(s.c1, v_pulse, v_offer, now(), null);
  exception
    when sqlstate '22023' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T7 FAIL: offer sem preço aceita';
  end if;
end $$;
rollback;

-- T8: offer inativa rejeita create; contrato existente continua resolvível
begin;
do $$
declare
  s record;
  v_sync uuid;
  v_offer uuid;
  v_ok boolean := false;
  r record;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_sync
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'sync' and pv.version = 1;
  select id into v_offer from private.billing_offers where code = 'founder_2026';

  perform private.billing_create_commercial_contract(s.c1, v_sync, v_offer, now(), null);
  update private.billing_offers set status = 'retired' where id = v_offer;

  select * into r from private.billing_clinic_active_contract(s.c1);
  if r.offer_code is distinct from 'founder_2026'
     or r.contracted_price_cents is distinct from 39000 then
    raise exception 'ASAAS05C T8 FAIL: histórico some após retire r=%', r;
  end if;

  begin
    perform private.billing_create_commercial_contract(s.c2, v_sync, v_offer, now(), null);
  exception
    when sqlstate '22023' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T8 FAIL: offer retired aceita em create novo';
  end if;
end $$;
rollback;

-- T9: plano retired rejeita create novo; contrato histórico continua
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_ok boolean := false;
  r record;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  perform private.billing_create_commercial_contract(s.c1, v_pulse, null, now(), null);
  update private.billing_plans set status = 'retired' where code = 'pulse';

  select * into r from private.billing_clinic_active_contract(s.c1);
  if r.plan_code is distinct from 'pulse' or r.contracted_price_cents is distinct from 39000 then
    raise exception 'ASAAS05C T9 FAIL: histórico pulse some r=%', r;
  end if;

  begin
    perform private.billing_create_commercial_contract(s.c2, v_pulse, null, now(), null);
  exception
    when sqlstate '22023' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T9 FAIL: retired plan aceito em create';
  end if;
end $$;
rollback;

-- T10: um ativo por clínica
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_sync uuid;
  v_ok boolean := false;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;
  select pv.id into v_sync
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'sync' and pv.version = 1;

  perform private.billing_create_commercial_contract(s.c1, v_pulse, null, now(), null);
  begin
    perform private.billing_create_commercial_contract(s.c1, v_sync, null, now(), null);
  exception
    when unique_violation then
      v_ok := true;
    when sqlstate '23505' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T10 FAIL: segundo ativo aceito';
  end if;
end $$;
rollback;

-- T11: sem contrato = none, não Pulse
begin;
do $$
declare
  s record;
  v_n int;
begin
  select * into s from pg_temp.asaas05c_seed();
  select count(*) into v_n from private.billing_clinic_active_contract(s.c1);
  if v_n <> 0 then
    raise exception 'ASAAS05C T11 FAIL: fallback inventado n=%', v_n;
  end if;
end $$;
rollback;

-- T12: snapshot imutável
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_sync uuid;
  v_id uuid;
  v_ok boolean := false;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;
  select pv.id into v_sync
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'sync' and pv.version = 1;

  v_id := private.billing_create_commercial_contract(s.c1, v_pulse, null, now(), null);

  begin
    update private.billing_commercial_contracts set contracted_price_cents = 1 where id = v_id;
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T12 FAIL: rewrite preço aceito';
  end if;

  v_ok := false;
  begin
    update private.billing_commercial_contracts set plan_version_id = v_sync where id = v_id;
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T12 FAIL: rewrite plan aceito';
  end if;

  v_ok := false;
  begin
    update private.billing_commercial_contracts set clinic_id = s.c2 where id = v_id;
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T12 FAIL: rewrite clinic aceito';
  end if;

  v_ok := false;
  begin
    update private.billing_commercial_contracts
       set commercial_offer_id = (select id from private.billing_offers where code = 'founder_2026')
     where id = v_id;
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T12 FAIL: rewrite offer aceito';
  end if;

  v_ok := false;
  begin
    update private.billing_commercial_contracts set contracted_currency = 'USD' where id = v_id;
  exception
    when check_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T12 FAIL: rewrite currency aceito';
  end if;

  if exists (
    select 1 from private.billing_commercial_contracts
     where id = v_id and (
       contracted_price_cents <> 39000
       or plan_version_id is distinct from v_pulse
       or clinic_id is distinct from s.c1
       or commercial_offer_id is not null
       or contracted_currency is distinct from 'BRL'
     )
  ) then
    raise exception 'ASAAS05C T12 FAIL: snapshot mutou';
  end if;
end $$;
rollback;

-- T13: nova versão de catálogo não altera snapshot
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_plan uuid;
  v_next_version int;
  r record;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id, pv.plan_id into v_pulse, v_plan
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  perform private.billing_create_commercial_contract(s.c1, v_pulse, null, now(), null);
  -- PRODUCT-07 already materializes v2. Create the next immutable catalog
  -- version so this test continues to exercise snapshot isolation.
  select max(version) + 1 into v_next_version
    from private.billing_plan_versions
   where plan_id = v_plan;
  insert into private.billing_plan_versions (
    plan_id, version, currency_code, standard_price_cents,
    max_professionals, max_active_patients
  ) values (v_plan, v_next_version, 'BRL', 99999, 9, 99);

  select * into r from private.billing_clinic_active_contract(s.c1);
  if r.contracted_price_cents is distinct from 39000
     or r.plan_version is distinct from 1 then
    raise exception 'ASAAS05C T13 FAIL: snapshot acompanhou catálogo r=%', r;
  end if;
end $$;
rollback;

-- T14: ponte capacity Pulse 2/30
begin;
do $$
declare
  s record;
  v_pulse uuid;
  r record;
  cap record;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  perform private.billing_create_commercial_contract(s.c1, v_pulse, null, now(), null);
  select * into r from private.billing_clinic_active_contract(s.c1);
  select * into cap from private.billing_evaluate_clinic_capacity(s.c1, r.plan_version_id);

  if cap.max_professionals is distinct from 2
     or cap.max_active_patients is distinct from 30 then
    raise exception 'ASAAS05C T14 FAIL: capacity r=%', cap;
  end if;
end $$;
rollback;

-- T15: ponte entitlements 6/8/9
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_sync uuid;
  v_apex uuid;
  r record;
  v_on int;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;
  select pv.id into v_sync
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'sync' and pv.version = 1;
  select pv.id into v_apex
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'apex' and pv.version = 1;

  perform private.billing_create_commercial_contract(s.c1, v_pulse, null, now(), null);
  select * into r from private.billing_clinic_active_contract(s.c1);
  select count(*) into v_on
    from private.billing_resolve_plan_entitlements(r.plan_version_id) where enabled;
  if v_on <> 6 then
    raise exception 'ASAAS05C T15 FAIL: pulse entitlements=%', v_on;
  end if;

  perform private.billing_create_commercial_contract(s.c2, v_sync, null, now(), null);
  select * into r from private.billing_clinic_active_contract(s.c2);
  select count(*) into v_on
    from private.billing_resolve_plan_entitlements(r.plan_version_id) where enabled;
  if v_on <> 8 then
    raise exception 'ASAAS05C T15 FAIL: sync entitlements=%', v_on;
  end if;

  perform private.billing_create_commercial_contract(s.c3, v_apex, null, now(), null);
  select * into r from private.billing_clinic_active_contract(s.c3);
  select count(*) into v_on
    from private.billing_resolve_plan_entitlements(r.plan_version_id) where enabled;
  if v_on <> 9 then
    raise exception 'ASAAS05C T15 FAIL: apex entitlements=%', v_on;
  end if;
end $$;
rollback;

-- T16: create rejeita clinic/version null; window inválida; source=asaas intacto
begin;
do $$
declare
  s record;
  v_pulse uuid;
  v_ok boolean := false;
  v_n int;
begin
  select * into s from pg_temp.asaas05c_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  begin
    perform private.billing_create_commercial_contract(null, v_pulse, null, now(), null);
  exception
    when sqlstate '22023' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T16 FAIL: clinic null aceito';
  end if;

  v_ok := false;
  begin
    perform private.billing_create_commercial_contract(s.c1, v_pulse, null, now(), now() - interval '1 day');
  exception
    when sqlstate '22023' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05C T16 FAIL: window invertida aceita';
  end if;

  select count(*) into v_n
    from private.clinic_creation_authorizations where source = 'asaas';
  if v_n <> 0 then
    raise exception 'ASAAS05C T16 FAIL: source=asaas=%', v_n;
  end if;
end $$;
rollback;

do $$
begin
  raise notice 'ASAAS05C_SQL_ASSERTIONS_PASSED';
end $$;
