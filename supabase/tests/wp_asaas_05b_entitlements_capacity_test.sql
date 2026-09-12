-- =====================================================================================
-- WP-ASAAS-05B · TESTES Nível 1 (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260912201258 aplicada.
-- Anon = has_*_privilege (sem SET ROLE anon — isolador PG 17.6 SIGSEGV).
-- Fixtures sintéticos. Sem PII real. Sem mutação remota.
-- =====================================================================================

create or replace function pg_temp.asaas05b_seed()
returns table (
  c_life uuid,
  c_cap uuid,
  pf_owner uuid,
  pr_owner uuid,
  pr_member uuid,
  pat_a uuid,
  pat_orphan uuid
)
language plpgsql
as $seed$
declare
  v_c_life uuid := gen_random_uuid();
  v_c_cap uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid();
  v_pf_mem uuid := gen_random_uuid();
  v_pf_pa uuid := gen_random_uuid();
  v_pf_a uuid := gen_random_uuid();
  v_pf_o uuid := gen_random_uuid();
  v_pr_own uuid;
  v_pr_mem uuid;
  v_pat_a uuid;
  v_pat_o uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_own, gen_random_uuid(), 'professional', 'Owner 05B', 'own-05b@t.test', 'active'),
    (v_pf_mem, gen_random_uuid(), 'professional', 'Member 05B', 'mem-05b@t.test', 'active'),
    (v_pf_pa,  gen_random_uuid(), 'admin',        'PA 05B',     'pa-05b@t.test',  'active'),
    (v_pf_a,   gen_random_uuid(), 'patient',      'Pat A 05B',  'pata-05b@t.test','active'),
    (v_pf_o,   gen_random_uuid(), 'patient',      'Orphan 05B', 'pato-05b@t.test','active');

  insert into public.clinics (id, name, owner_profile_id) values
    (v_c_life, 'Clinica Lifecycle 05B', v_pf_own),
    (v_c_cap,  'Clinica Capacity 05B',  v_pf_own);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_own, v_c_life, 'other', 'admin', 'active')
    returning id into v_pr_own;
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_mem, v_c_life, 'nutritionist', 'member', 'active')
    returning id into v_pr_mem;

  insert into public.patients (profile_id, clinic_id)
    values (v_pf_a, v_c_life) returning id into v_pat_a;
  insert into public.patients (profile_id, clinic_id)
    values (v_pf_o, v_c_life) returning id into v_pat_o;

  return query select
    v_c_life, v_c_cap, v_pf_own, v_pr_own, v_pr_mem, v_pat_a, v_pat_o;
end;
$seed$;


-- T1: objetos private, RLS ON, 0 policies
begin;
do $$
declare
  v_n int;
  v_rls boolean;
  v_rel text;
begin
  if to_regclass('private.billing_entitlements') is null
     or to_regclass('private.billing_plan_version_entitlements') is null
     or to_regclass('private.billing_feature_entitlement_map') is null
     or to_regclass('private.billing_clinic_usage') is null then
    raise exception 'ASAAS05B T1 FAIL: objeto 05B ausente';
  end if;

  foreach v_rel in array array[
    'billing_entitlements',
    'billing_plan_version_entitlements',
    'billing_feature_entitlement_map'
  ] loop
    select c.relrowsecurity into v_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'private' and c.relname = v_rel;
    if v_rls is not true then
      raise exception 'ASAAS05B T1 FAIL: RLS off em %', v_rel;
    end if;
  end loop;

  select count(*) into v_n
    from pg_policies
   where schemaname = 'private'
     and tablename in (
       'billing_entitlements',
       'billing_plan_version_entitlements',
       'billing_feature_entitlement_map'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05B T1 FAIL: policies=%', v_n;
  end if;
end $$;
rollback;

-- T2: grants fail-closed (anon / authenticated / service_role)
begin;
do $$
declare
  v_rel text;
begin
  foreach v_rel in array array[
    'private.billing_entitlements',
    'private.billing_plan_version_entitlements',
    'private.billing_feature_entitlement_map',
    'private.billing_clinic_usage'
  ] loop
    if has_table_privilege('authenticated', v_rel, 'select')
       or has_table_privilege('authenticated', v_rel, 'insert')
       or has_table_privilege('authenticated', v_rel, 'update')
       or has_table_privilege('authenticated', v_rel, 'delete') then
      raise exception 'ASAAS05B T2 FAIL: authenticated priv em %', v_rel;
    end if;
    if has_table_privilege('anon', v_rel, 'select')
       or has_table_privilege('anon', v_rel, 'insert')
       or has_table_privilege('anon', v_rel, 'update') then
      raise exception 'ASAAS05B T2 FAIL: anon priv em %', v_rel;
    end if;
    if has_table_privilege('service_role', v_rel, 'select')
       or has_table_privilege('service_role', v_rel, 'insert')
       or has_table_privilege('service_role', v_rel, 'update')
       or has_table_privilege('service_role', v_rel, 'delete') then
      raise exception 'ASAAS05B T2 FAIL: service_role table priv em %', v_rel;
    end if;
  end loop;

  if has_function_privilege(
       'authenticated',
       'private.billing_evaluate_clinic_capacity(uuid,uuid)',
       'execute')
     or has_function_privilege(
       'anon',
       'private.billing_evaluate_clinic_capacity(uuid,uuid)',
       'execute')
     or has_function_privilege(
       'service_role',
       'private.billing_evaluate_clinic_capacity(uuid,uuid)',
       'execute') then
    raise exception 'ASAAS05B T2 FAIL: execute no evaluator';
  end if;

  if has_function_privilege(
       'authenticated',
       'private.billing_resolve_plan_entitlements(uuid)',
       'execute')
     or has_function_privilege(
       'anon',
       'private.billing_resolve_plan_entitlements(uuid)',
       'execute')
     or has_function_privilege(
       'service_role',
       'private.billing_resolve_plan_entitlements(uuid)',
       'execute') then
    raise exception 'ASAAS05B T2 FAIL: execute no resolver';
  end if;
end $$;
rollback;

-- T3: sem RPC pública 05B; create_patient sem plan gate
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
       'billing_evaluate_clinic_capacity',
       'billing_resolve_plan_entitlements',
       'billing_clinic_usage',
       'can_i_use'
     );
  if v_n <> 0 then
    raise exception 'ASAAS05B T3 FAIL: RPC pública 05B=%', v_n;
  end if;

  select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'create_patient'
   order by p.pronargs desc
   limit 1;
  if v_src ~* 'billing_evaluate_clinic_capacity|plan_version_id|billing_plan_versions' then
    raise exception 'ASAAS05B T3 FAIL: create_patient ganhou gate de plano';
  end if;

  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'clinics'
     and column_name in ('plan_id', 'plan_code', 'plan', 'asaas_plan');
  if v_n <> 0 then
    raise exception 'ASAAS05B T3 FAIL: clinics ganhou coluna de plano';
  end if;
end $$;
rollback;

-- T4: 9 entitlements técnicos; 23 claims; map 1:1 só nas 9 reais
begin;
do $$
declare
  v_n int;
  v_mapped int;
  v_unmapped int;
begin
  select count(*) into v_n from private.billing_entitlements where status = 'active';
  if v_n <> 9 then
    raise exception 'ASAAS05B T4 FAIL: entitlements=%', v_n;
  end if;

  select count(*) into v_n from private.billing_features;
  if v_n <> 23 then
    raise exception 'ASAAS05B T4 FAIL: features 05A=%', v_n;
  end if;

  select count(*) into v_mapped from private.billing_feature_entitlement_map;
  if v_mapped <> 9 then
    raise exception 'ASAAS05B T4 FAIL: mapped=%', v_mapped;
  end if;

  select count(*) into v_unmapped
    from private.billing_features f
    left join private.billing_feature_entitlement_map m on m.feature_id = f.id
   where m.feature_id is null
     and f.feature_key in (
       'whatsapp_support',
       'support_sla_4h',
       'guided_onboarding',
       'revenue_projection',
       'revenue_at_risk',
       'financial_bi',
       'patient_challenges_ranking',
       'clinic_branding',
       'professional_revenue_distribution',
       'white_label',
       'retention_automation',
       'patient_app',
       'granular_permissions',
       'multidisciplinary_ecosystem'
     );
  if v_unmapped <> 14 then
    raise exception 'ASAAS05B T4 FAIL: unmapped esperado 14, veio %', v_unmapped;
  end if;

  if exists (
    select 1 from private.billing_entitlements
     where key in (
       'whatsapp_support', 'support_sla_4h', 'white_label',
       'revenue_projection', 'financial_bi'
     )
  ) then
    raise exception 'ASAAS05B T4 FAIL: entitlement fake para claim sem produto';
  end if;
end $$;
rollback;

-- T5: estado explícito Pulse/Sync/Apex — sem herança dinâmica
begin;
do $$
declare
  v_pulse uuid;
  v_sync uuid;
  v_apex uuid;
  v_n int;
  v_on int;
begin
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

  select count(*) into v_n
    from private.billing_resolve_plan_entitlements(v_pulse);
  if v_n <> 9 then
    raise exception 'ASAAS05B T5 FAIL: pulse rows=%', v_n;
  end if;

  select count(*) into v_on
    from private.billing_resolve_plan_entitlements(v_pulse)
   where enabled;
  if v_on <> 6 then
    raise exception 'ASAAS05B T5 FAIL: pulse enabled=%', v_on;
  end if;

  if exists (
    select 1 from private.billing_resolve_plan_entitlements(v_pulse)
     where entitlement_key in (
       'body_recovery_map', 'multidisciplinary_chat', 'centralized_team_management'
     ) and enabled
  ) then
    raise exception 'ASAAS05B T5 FAIL: pulse habilitou entitlement Sync/Apex';
  end if;

  select count(*) into v_on
    from private.billing_resolve_plan_entitlements(v_sync)
   where enabled;
  if v_on <> 8 then
    raise exception 'ASAAS05B T5 FAIL: sync enabled=%', v_on;
  end if;

  if exists (
    select 1 from private.billing_resolve_plan_entitlements(v_sync)
     where entitlement_key = 'centralized_team_management' and enabled
  ) then
    raise exception 'ASAAS05B T5 FAIL: sync habilitou team Apex';
  end if;

  select count(*) into v_on
    from private.billing_resolve_plan_entitlements(v_apex)
   where enabled;
  if v_on <> 9 then
    raise exception 'ASAAS05B T5 FAIL: apex enabled=%', v_on;
  end if;
end $$;
rollback;

-- T6: resolver recusa null / unknown — sem default Pulse
begin;
do $$
declare
  v_ok boolean := false;
  v_n int;
begin
  begin
    perform * from private.billing_resolve_plan_entitlements(null);
  exception
    when sqlstate '22023' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05B T6 FAIL: resolver aceitou null';
  end if;

  v_ok := false;
  begin
    perform * from private.billing_resolve_plan_entitlements(gen_random_uuid());
  exception
    when sqlstate 'P0002' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05B T6 FAIL: resolver aceitou version desconhecida';
  end if;

  select count(*) into v_n
    from private.billing_resolve_plan_entitlements(
      (select pv.id
         from private.billing_plan_versions pv
         join private.billing_plans p on p.id = pv.plan_id
        where p.code = 'pulse' and pv.version = 1)
    )
   where entitlement_key = 'centralized_team_management' and enabled;
  if v_n <> 0 then
    raise exception 'ASAAS05B T6 FAIL: fallback Apex no Pulse';
  end if;
end $$;
rollback;

-- T7: lifecycle paciente — distinct, inativo libera, reactiva
begin;
do $$
declare
  s record;
  v_n int;
  v_link2 uuid;
begin
  select * into s from pg_temp.asaas05b_seed();

  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 0 then
    raise exception 'ASAAS05B T7 FAIL: sem link deveria ser 0, veio %', v_n;
  end if;

  insert into public.professional_patient_links (professional_id, patient_id, status)
    values (s.pr_owner, s.pat_a, 'active');

  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 1 then
    raise exception 'ASAAS05B T7 FAIL: 1 link ativo deveria ser 1, veio %', v_n;
  end if;

  insert into public.professional_patient_links (professional_id, patient_id, status)
    values (s.pr_member, s.pat_a, 'active')
    returning id into v_link2;

  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 1 then
    raise exception 'ASAAS05B T7 FAIL: 2 links do mesmo paciente deveria ser 1, veio %', v_n;
  end if;

  update public.professional_patient_links
     set status = 'inactive'
   where id = v_link2;

  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 1 then
    raise exception 'ASAAS05B T7 FAIL: ainda 1 link ativo deveria ser 1, veio %', v_n;
  end if;

  update public.professional_patient_links
     set status = 'inactive'
   where professional_id = s.pr_owner and patient_id = s.pat_a;

  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 0 then
    raise exception 'ASAAS05B T7 FAIL: último inativo deveria liberar seat, veio %', v_n;
  end if;

  update public.professional_patient_links
     set status = 'active'
   where professional_id = s.pr_owner and patient_id = s.pat_a;

  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 1 then
    raise exception 'ASAAS05B T7 FAIL: reactivate deveria voltar 1, veio %', v_n;
  end if;

  -- órfão sem link nunca conta
  if exists (
    select 1 from public.professional_patient_links
     where patient_id = s.pat_orphan and status = 'active'
  ) then
    raise exception 'ASAAS05B T7 FAIL: orphan nasceu com link';
  end if;
  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 1 then
    raise exception 'ASAAS05B T7 FAIL: orphan não pode somar seat';
  end if;
end $$;
rollback;

-- T8: profissional — owner conta, inativo exclui, PA sozinho não conta
begin;
do $$
declare
  s record;
  v_n int;
  v_pr3 uuid;
  v_pf3 uuid := gen_random_uuid();
begin
  select * into s from pg_temp.asaas05b_seed();

  select active_professionals into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 2 then
    raise exception 'ASAAS05B T8 FAIL: owner+member deveria ser 2, veio %', v_n;
  end if;

  update public.professionals set status = 'inactive' where id = s.pr_member;
  select active_professionals into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 1 then
    raise exception 'ASAAS05B T8 FAIL: member inativo excluído, veio %', v_n;
  end if;

  update public.professionals set status = 'active' where id = s.pr_member;
  select active_professionals into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 2 then
    raise exception 'ASAAS05B T8 FAIL: reactivate member, veio %', v_n;
  end if;

  -- PA sem linha em professionals: usage da clínica de capacity (sem staff) = 0
  select active_professionals into v_n
    from private.billing_clinic_usage where clinic_id = s.c_cap;
  if v_n <> 0 then
    raise exception 'ASAAS05B T8 FAIL: clínica sem professional deveria ser 0, veio %', v_n;
  end if;

  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf3, gen_random_uuid(), 'professional', 'P3 05B', 'p3-05b@t.test', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf3, s.c_life, 'doctor', 'member', 'active')
    returning id into v_pr3;
  select active_professionals into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 3 then
    raise exception 'ASAAS05B T8 FAIL: 3 ativos, veio %', v_n;
  end if;
end $$;
rollback;

-- T9: cross-clinic malformado não conta; unique (profile,clinic)
begin;
do $$
declare
  s record;
  v_c_b uuid := gen_random_uuid();
  v_pf_b uuid := gen_random_uuid();
  v_pr_b uuid;
  v_n int;
  v_ok boolean := false;
begin
  select * into s from pg_temp.asaas05b_seed();

  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf_b, gen_random_uuid(), 'professional', 'Other Clinic', 'ob-05b@t.test', 'active');
  insert into public.clinics (id, name, owner_profile_id)
    values (v_c_b, 'Clinica B 05B', v_pf_b);
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf_b, v_c_b, 'other', 'admin', 'active')
    returning id into v_pr_b;

  insert into public.professional_patient_links (professional_id, patient_id, status)
    values (v_pr_b, s.pat_a, 'active');

  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = s.c_life;
  if v_n <> 0 then
    raise exception 'ASAAS05B T9 FAIL: link cross-clinic contou em A, veio %', v_n;
  end if;

  select active_patients into v_n
    from private.billing_clinic_usage where clinic_id = v_c_b;
  if v_n <> 0 then
    raise exception 'ASAAS05B T9 FAIL: patient de A contou em B, veio %', v_n;
  end if;

  begin
    insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
      values (s.pf_owner, s.c_life, 'doctor', 'member', 'active');
  exception
    when unique_violation then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05B T9 FAIL: duplicate profile/clinic aceito';
  end if;
end $$;
rollback;

-- T10: evaluator exige plan_version; sem default; clínica unknown
begin;
do $$
declare
  s record;
  v_ok boolean := false;
  v_pulse uuid;
begin
  select * into s from pg_temp.asaas05b_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  begin
    perform * from private.billing_evaluate_clinic_capacity(s.c_life, null);
  exception
    when sqlstate '22023' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05B T10 FAIL: evaluator aceitou plan null';
  end if;

  v_ok := false;
  begin
    perform * from private.billing_evaluate_clinic_capacity(null, v_pulse);
  exception
    when sqlstate '22023' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05B T10 FAIL: evaluator aceitou clinic null';
  end if;

  v_ok := false;
  begin
    perform * from private.billing_evaluate_clinic_capacity(s.c_life, gen_random_uuid());
  exception
    when sqlstate 'P0002' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05B T10 FAIL: evaluator aceitou version unknown';
  end if;

  v_ok := false;
  begin
    perform * from private.billing_evaluate_clinic_capacity(gen_random_uuid(), v_pulse);
  exception
    when sqlstate 'P0002' then
      v_ok := true;
  end;
  if not v_ok then
    raise exception 'ASAAS05B T10 FAIL: evaluator aceitou clinic unknown';
  end if;
end $$;
rollback;

-- T11: Pulse profissionais 1/2 2/2 3/2
begin;
do $$
declare
  s record;
  v_pulse uuid;
  r record;
  v_pf uuid;
begin
  select * into s from pg_temp.asaas05b_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  -- clinic cap: só owner
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (s.pf_owner, s.c_cap, 'other', 'admin', 'active');

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_pulse);
  if r.active_professionals <> 1 or r.max_professionals <> 2
     or r.can_add_professional is not true
     or r.professional_slots_remaining <> 1
     or r.over_limit is not false then
    raise exception 'ASAAS05B T11 FAIL: Pulse 1/2 r=%', r;
  end if;

  v_pf := gen_random_uuid();
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, gen_random_uuid(), 'professional', 'P2 cap', 'p2c-05b@t.test', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf, s.c_cap, 'doctor', 'member', 'active');

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_pulse);
  if r.active_professionals <> 2 or r.can_add_professional is not false
     or r.professional_slots_remaining <> 0
     or r.professionals_over_limit is not false then
    raise exception 'ASAAS05B T11 FAIL: Pulse 2/2 r=%', r;
  end if;

  v_pf := gen_random_uuid();
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, gen_random_uuid(), 'professional', 'P3 cap', 'p3c-05b@t.test', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf, s.c_cap, 'nutritionist', 'member', 'active');

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_pulse);
  if r.active_professionals <> 3 or r.can_add_professional is not false
     or r.professional_slots_remaining <> 0
     or r.professionals_over_limit is not true
     or r.over_limit is not true then
    raise exception 'ASAAS05B T11 FAIL: Pulse 3/2 r=%', r;
  end if;
end $$;
rollback;

-- T12: Pulse pacientes 29/30 30/30 31/30 — remaining nunca negativo
begin;
do $$
declare
  s record;
  v_pulse uuid;
  r record;
  i int;
  v_pf uuid;
  v_pat uuid;
  v_pr uuid;
begin
  select * into s from pg_temp.asaas05b_seed();
  select pv.id into v_pulse
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'pulse' and pv.version = 1;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (s.pf_owner, s.c_cap, 'other', 'admin', 'active')
    returning id into v_pr;

  for i in 1..31 loop
    v_pf := gen_random_uuid();
    insert into public.profiles (id, auth_user_id, role, full_name, email, status)
      values (
        v_pf, gen_random_uuid(), 'patient',
        'Cap Pat ' || i, 'cappat-' || i || '-05b@t.test', 'active'
      );
    insert into public.patients (profile_id, clinic_id)
      values (v_pf, s.c_cap) returning id into v_pat;
    if i <= 29 then
      insert into public.professional_patient_links (professional_id, patient_id, status)
        values (v_pr, v_pat, 'active');
    end if;
  end loop;

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_pulse);
  if r.active_patients <> 29 or r.max_active_patients <> 30
     or r.can_activate_patient is not true
     or r.patient_slots_remaining <> 1
     or r.patients_over_limit is not false then
    raise exception 'ASAAS05B T12 FAIL: Pulse 29/30 r=%', r;
  end if;

  insert into public.professional_patient_links (professional_id, patient_id, status)
  select v_pr, p.id, 'active'
    from public.patients p
    join public.profiles pf on pf.id = p.profile_id
   where p.clinic_id = s.c_cap
     and pf.email = 'cappat-30-05b@t.test';

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_pulse);
  if r.active_patients <> 30 or r.can_activate_patient is not false
     or r.patient_slots_remaining <> 0
     or r.patients_over_limit is not false
     or r.over_limit is not false then
    raise exception 'ASAAS05B T12 FAIL: Pulse 30/30 r=%', r;
  end if;

  insert into public.professional_patient_links (professional_id, patient_id, status)
  select v_pr, p.id, 'active'
    from public.patients p
    join public.profiles pf on pf.id = p.profile_id
   where p.clinic_id = s.c_cap
     and pf.email = 'cappat-31-05b@t.test';

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_pulse);
  if r.active_patients <> 31 or r.can_activate_patient is not false
     or r.patient_slots_remaining <> 0
     or r.patients_over_limit is not true
     or r.over_limit is not true then
    raise exception 'ASAAS05B T12 FAIL: Pulse 31/30 r=%', r;
  end if;

  select count(*) into i from public.patients where clinic_id = s.c_cap;
  if i <> 31 then
    raise exception 'ASAAS05B T12 FAIL: evaluator mutou pacientes count=%', i;
  end if;
end $$;
rollback;

-- T13: Sync 3/50 e Apex 3/50 — mesmos dados, versões explícitas
begin;
do $$
declare
  s record;
  v_sync uuid;
  v_apex uuid;
  r record;
  i int;
  v_pf uuid;
  v_pat uuid;
  v_pr uuid;
  v_pr2 uuid;
  v_pr3 uuid;
begin
  select * into s from pg_temp.asaas05b_seed();
  select pv.id into v_sync
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'sync' and pv.version = 1;
  select pv.id into v_apex
    from private.billing_plan_versions pv
    join private.billing_plans p on p.id = pv.plan_id
   where p.code = 'apex' and pv.version = 1;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (s.pf_owner, s.c_cap, 'other', 'admin', 'active')
    returning id into v_pr;

  v_pf := gen_random_uuid();
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, gen_random_uuid(), 'professional', 'S2', 's2-05b@t.test', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf, s.c_cap, 'doctor', 'member', 'active')
    returning id into v_pr2;

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_sync);
  if r.active_professionals <> 2 or r.max_professionals <> 3
     or r.can_add_professional is not true then
    raise exception 'ASAAS05B T13 FAIL: Sync 2/3 r=%', r;
  end if;

  v_pf := gen_random_uuid();
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, gen_random_uuid(), 'professional', 'S3', 's3-05b@t.test', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf, s.c_cap, 'nutritionist', 'member', 'active')
    returning id into v_pr3;

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_sync);
  if r.active_professionals <> 3 or r.can_add_professional is not false
     or r.professionals_over_limit is not false then
    raise exception 'ASAAS05B T13 FAIL: Sync 3/3 r=%', r;
  end if;
  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_apex);
  if r.active_professionals <> 3 or r.max_professionals <> 3
     or r.can_add_professional is not false then
    raise exception 'ASAAS05B T13 FAIL: Apex 3/3 r=%', r;
  end if;

  v_pf := gen_random_uuid();
  insert into public.profiles (id, auth_user_id, role, full_name, email, status)
    values (v_pf, gen_random_uuid(), 'professional', 'S4', 's4-05b@t.test', 'active');
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (v_pf, s.c_cap, 'physiotherapist', 'member', 'active');

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_sync);
  if r.active_professionals <> 4 or r.over_limit is not true
     or r.professional_slots_remaining <> 0 then
    raise exception 'ASAAS05B T13 FAIL: Sync 4/3 r=%', r;
  end if;
  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_apex);
  if r.active_professionals <> 4 or r.over_limit is not true then
    raise exception 'ASAAS05B T13 FAIL: Apex 4/3 r=%', r;
  end if;

  for i in 1..51 loop
    v_pf := gen_random_uuid();
    insert into public.profiles (id, auth_user_id, role, full_name, email, status)
      values (
        v_pf, gen_random_uuid(), 'patient',
        'Sync Pat ' || i, 'spat-' || i || '-05b@t.test', 'active'
      );
    insert into public.patients (profile_id, clinic_id)
      values (v_pf, s.c_cap) returning id into v_pat;
    if i <= 49 then
      insert into public.professional_patient_links (professional_id, patient_id, status)
        values (v_pr, v_pat, 'active');
    end if;
  end loop;

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_sync);
  if r.active_patients <> 49 or r.max_active_patients <> 50
     or r.can_activate_patient is not true
     or r.patient_slots_remaining <> 1 then
    raise exception 'ASAAS05B T13 FAIL: Sync 49/50 r=%', r;
  end if;
  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_apex);
  if r.active_patients <> 49 or r.max_active_patients <> 50
     or r.can_activate_patient is not true then
    raise exception 'ASAAS05B T13 FAIL: Apex 49/50 r=%', r;
  end if;

  insert into public.professional_patient_links (professional_id, patient_id, status)
  select v_pr, p.id, 'active'
    from public.patients p
    join public.profiles pf on pf.id = p.profile_id
   where p.clinic_id = s.c_cap and pf.email = 'spat-50-05b@t.test';

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_sync);
  if r.active_patients <> 50 or r.can_activate_patient is not false
     or r.patients_over_limit is not false then
    raise exception 'ASAAS05B T13 FAIL: Sync 50/50 r=%', r;
  end if;
  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_apex);
  if r.active_patients <> 50 or r.can_activate_patient is not false then
    raise exception 'ASAAS05B T13 FAIL: Apex 50/50 r=%', r;
  end if;

  insert into public.professional_patient_links (professional_id, patient_id, status)
  select v_pr, p.id, 'active'
    from public.patients p
    join public.profiles pf on pf.id = p.profile_id
   where p.clinic_id = s.c_cap and pf.email = 'spat-51-05b@t.test';

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_sync);
  if r.active_patients <> 51 or r.can_activate_patient is not false
     or r.patient_slots_remaining <> 0
     or r.patients_over_limit is not true
     or r.over_limit is not true then
    raise exception 'ASAAS05B T13 FAIL: Sync 51/50 r=%', r;
  end if;
  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_apex);
  if r.active_patients <> 51 or r.patients_over_limit is not true
     or r.patient_slots_remaining <> 0 then
    raise exception 'ASAAS05B T13 FAIL: Apex 51/50 r=%', r;
  end if;
end $$;
rollback;

-- T14: versão histórica de plano retired ainda avalia
begin;
do $$
declare
  s record;
  v_plan uuid;
  v_ver uuid;
  r record;
begin
  select * into s from pg_temp.asaas05b_seed();

  insert into private.billing_plans (code, display_name, sort_order, status)
    values ('legacy_05b_hist', 'Legacy 05B', 90, 'retired')
    returning id into v_plan;
  insert into private.billing_plan_versions (
    plan_id, version, currency_code, standard_price_cents,
    max_professionals, max_active_patients
  ) values (v_plan, 1, 'BRL', 0, 1, 1)
    returning id into v_ver;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (s.pf_owner, s.c_cap, 'other', 'admin', 'active');

  select * into r from private.billing_evaluate_clinic_capacity(s.c_cap, v_ver);
  if r.plan_version_id <> v_ver
     or r.max_professionals <> 1
     or r.active_professionals <> 1
     or r.can_add_professional is not false then
    raise exception 'ASAAS05B T14 FAIL: retired version r=%', r;
  end if;
end $$;
rollback;

-- T15: sem colunas Asaas / preço / PII nos objetos 05B
begin;
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'private'
     and table_name in (
       'billing_entitlements',
       'billing_plan_version_entitlements',
       'billing_feature_entitlement_map'
     )
     and column_name ~* '(asaas|external_|provider|price|cents|email|name|phone)';
  if v_n <> 0 then
    raise exception 'ASAAS05B T15 FAIL: coluna indevida=%', v_n;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'private'
       and table_name = 'billing_subscriptions'
       and column_name in (
         'plan_id', 'plan_code', 'catalog_plan_version_id',
         'contracted_price_cents', 'commercial_offer_id'
       )
  ) then
    raise exception 'ASAAS05B T15 FAIL: subscriptions alterada';
  end if;
end $$;
rollback;

do $$
begin
  raise notice 'ASAAS05B_SQL_ASSERTIONS_PASSED';
end $$;
