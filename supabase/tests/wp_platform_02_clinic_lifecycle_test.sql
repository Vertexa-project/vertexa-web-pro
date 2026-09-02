-- =====================================================================================
-- PLATFORM-02 · TESTES SQL (BEGIN / DO / ROLLBACK).
-- HARNESS: exige 20260903090000. JWT via request.jwt.claims + set local role.
-- NÃO usa service_role como prova de cliente RLS.
-- =====================================================================================

create or replace function pg_temp.wp02_seed()
returns table (
  a_plat uuid, a_rev uuid, a_owner uuid, a_admin uuid, a_member uuid, a_pat uuid,
  a_owner_b uuid, a_pat_b uuid, a_pending uuid,
  pf_plat uuid, pf_rev uuid, pf_owner uuid, pf_admin uuid, pf_member uuid, pf_pat uuid,
  pf_owner_b uuid, pf_pat_b uuid, pf_pending uuid,
  c_a uuid, c_b uuid,
  pr_owner uuid, pr_admin uuid, pr_member uuid, pr_owner_b uuid,
  p_a uuid, p_b uuid, ch_a uuid
)
language plpgsql
as $seed$
declare
  v_c_a uuid := gen_random_uuid(); v_c_b uuid := gen_random_uuid();
  v_pf_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_pf_adm uuid := gen_random_uuid(); v_a_adm uuid := gen_random_uuid();
  v_pf_mem uuid := gen_random_uuid(); v_a_mem uuid := gen_random_uuid();
  v_pf_own_b uuid := gen_random_uuid(); v_a_own_b uuid := gen_random_uuid();
  v_pf_pat uuid := gen_random_uuid(); v_a_pat uuid := gen_random_uuid();
  v_pf_pat_b uuid := gen_random_uuid(); v_a_pat_b uuid := gen_random_uuid();
  v_pf_plat uuid := gen_random_uuid(); v_a_plat uuid := gen_random_uuid();
  v_pf_rev uuid := gen_random_uuid(); v_a_rev uuid := gen_random_uuid();
  v_pf_pend uuid := gen_random_uuid(); v_a_pend uuid := gen_random_uuid();
  v_pr_own uuid; v_pr_adm uuid; v_pr_mem uuid; v_pr_own_b uuid;
  v_p_a uuid; v_p_b uuid; v_ch uuid := gen_random_uuid();
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_pf_own,   v_a_own,   'professional', 'Owner Alfa 02',   'own-02@t.test',   'active'),
    (v_pf_adm,   v_a_adm,   'professional', 'Admin Alfa 02',   'adm-02@t.test',   'active'),
    (v_pf_mem,   v_a_mem,   'professional', 'Member Alfa 02',  'mem-02@t.test',   'active'),
    (v_pf_own_b, v_a_own_b, 'professional', 'Owner Beta 02',   'ownb-02@t.test',  'active'),
    (v_pf_pat,   v_a_pat,   'patient',      'Paciente A 02',   'pa-02@t.test',    'active'),
    (v_pf_pat_b, v_a_pat_b, 'patient',      'Paciente B 02',   'pb-02@t.test',    'active'),
    (v_pf_plat,  v_a_plat,  'professional', 'PA 02',           'plat-02@t.test',  'active'),
    (v_pf_rev,   v_a_rev,   'professional', 'PA Rev 02',       'rev-02@t.test',   'active'),
    (v_pf_pend,  v_a_pend,  'professional', 'Pending 02',      'pend-02@t.test',  'pending');

  insert into public.clinics (id, name, owner_profile_id) values
    (v_c_a, 'Clinica Alfa 02', v_pf_own),
    (v_c_b, 'Clinica Beta 02', v_pf_own_b);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (v_pf_own,   v_c_a, 'other',        'admin',  'active'),
    (v_pf_adm,   v_c_a, 'doctor',       'admin',  'active'),
    (v_pf_mem,   v_c_a, 'nutritionist', 'member', 'active'),
    (v_pf_own_b, v_c_b, 'doctor',       'admin',  'active');

  select pr.id into v_pr_own   from public.professionals pr where pr.profile_id = v_pf_own;
  select pr.id into v_pr_adm   from public.professionals pr where pr.profile_id = v_pf_adm;
  select pr.id into v_pr_mem   from public.professionals pr where pr.profile_id = v_pf_mem;
  select pr.id into v_pr_own_b from public.professionals pr where pr.profile_id = v_pf_own_b;

  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pf_pat, v_c_a, 'meta') returning id into v_p_a;
  insert into public.patients (profile_id, clinic_id, goal)
    values (v_pf_pat_b, v_c_b, 'meta') returning id into v_p_b;

  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (v_pr_mem, v_p_a, false, 'active');

  insert into public.chat_channels (id, patient_id) values (v_ch, v_p_a);
  insert into public.chat_participants (channel_id, profile_id, role) values
    (v_ch, v_pf_pat, 'patient'),
    (v_ch, v_pf_mem, 'professional');
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (v_ch, v_pf_pat, 'patient', 'hello 02');
  insert into public.adherence_snapshots (patient_id, score, level)
    values (v_p_a, 50, 'atencao');

  insert into private.platform_admins (profile_id, status, granted_at, revoked_at) values
    (v_pf_plat, 'active', now(), null),
    (v_pf_rev,  'revoked', now() - interval '1 day', now());

  return query select
    v_a_plat, v_a_rev, v_a_own, v_a_adm, v_a_mem, v_a_pat,
    v_a_own_b, v_a_pat_b, v_a_pend,
    v_pf_plat, v_pf_rev, v_pf_own, v_pf_adm, v_pf_mem, v_pf_pat,
    v_pf_own_b, v_pf_pat_b, v_pf_pend,
    v_c_a, v_c_b,
    v_pr_own, v_pr_adm, v_pr_mem, v_pr_own_b,
    v_p_a, v_p_b, v_ch;
end;
$seed$;

create or replace function pg_temp.wp02_login(p_auth uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;


-- H4 / grants
begin;
do $$
declare
  has_name boolean;
  has_status boolean;
begin
  select exists (
    select 1 from information_schema.column_privileges
     where table_schema='public' and table_name='clinics'
       and column_name='name' and grantee='authenticated' and privilege_type='UPDATE'
  ) into has_name;
  select exists (
    select 1 from information_schema.column_privileges
     where table_schema='public' and table_name='clinics'
       and column_name='status' and grantee='authenticated' and privilege_type='UPDATE'
  ) into has_status;
  if has_name is not true then
    raise exception 'P02 H4 FAIL: UPDATE(name) perdido';
  end if;
  if has_status then
    raise exception 'P02 H4 FAIL: authenticated UPDATE status';
  end if;
  if has_function_privilege('anon', 'public.suspend_platform_clinic(uuid,text)', 'execute') then
    raise exception 'P02 FAIL: anon execute suspend';
  end if;
  if not has_function_privilege('authenticated', 'public.suspend_platform_clinic(uuid,text)', 'execute') then
    raise exception 'P02 FAIL: authenticated sem execute suspend';
  end if;
  if has_function_privilege('anon', 'public.get_my_clinic_access_state()', 'execute') then
    raise exception 'P02 FAIL: anon execute access_state';
  end if;
  raise notice 'P02 H4 grants: PASS';
end $$;
rollback;


-- H5: uma FK clinics → profiles (owner). Actor FK só no audit privado.
begin;
do $$
declare
  n_clinics_profiles int;
  n_audit_actor int;
begin
  select count(*) into n_clinics_profiles
    from pg_constraint
   where conrelid = 'public.clinics'::regclass
     and contype = 'f'
     and confrelid = 'public.profiles'::regclass;
  if n_clinics_profiles <> 1 then
    raise exception 'P02 H5 FAIL: clinics→profiles FKs=%', n_clinics_profiles;
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='clinics' and column_name='status_changed_by'
  ) then
    raise exception 'P02 H5 FAIL: status_changed_by em clinics';
  end if;
  select count(*) into n_audit_actor
    from pg_constraint
   where conrelid = 'private.platform_clinic_status_events'::regclass
     and contype = 'f'
     and confrelid = 'public.profiles'::regclass;
  if n_audit_actor <> 1 then
    raise exception 'P02 H5 FAIL: audit actor FK=%', n_audit_actor;
  end if;
  raise notice 'P02 H5: PASS';
end $$;
rollback;


-- S1 S2 S3 S4 S5 S6 S24 S7 S8 S11 S12 S14 S18 S19 S20 S21 S22 S23 S25 S33 S34 S42 S44
begin;
do $$
declare
  s record;
  n_evt int;
  n_prof int;
  n_pat int;
  n_link int;
  n_msg int;
  n_snap int;
  n_after_prof int;
  n_after_pat int;
  n_after_link int;
  n_after_msg int;
  n_after_snap int;
  n_notif_before int;
  n_notif_after int;
  raised boolean;
  hint text;
  v_state text;
  v_code text;
  rec record;
begin
  select * into s from pg_temp.wp02_seed();

  select count(*) into n_prof from public.professionals where clinic_id = s.c_a;
  select count(*) into n_pat from public.patients where clinic_id = s.c_a;
  select count(*) into n_link from public.professional_patient_links;
  select count(*) into n_msg from public.chat_messages where channel_id = s.ch_a;
  select count(*) into n_snap from public.adherence_snapshots where patient_id = s.p_a;
  select count(*) into n_notif_before from public.staff_notifications;

  -- S3 common não suspende
  perform pg_temp.wp02_login(s.a_pending);
  raised := false; hint := null;
  begin
    perform public.suspend_platform_clinic(s.c_a, 'motivo suficiente');
  exception when others then
    raised := true; hint := sqlerrm;
    if sqlstate is distinct from '42501' then
      raise exception 'P02 S3 FAIL sqlstate=%', sqlstate;
    end if;
  end;
  reset role;
  if not raised then raise exception 'P02 S3 FAIL: pending suspendeu'; end if;

  -- S4 clinic admin
  perform pg_temp.wp02_login(s.a_admin);
  raised := false;
  begin
    perform public.suspend_platform_clinic(s.c_a, 'motivo suficiente');
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'P02 S4 FAIL: clinic admin suspendeu'; end if;

  -- S5 professional
  perform pg_temp.wp02_login(s.a_member);
  raised := false;
  begin
    perform public.suspend_platform_clinic(s.c_a, 'motivo suficiente');
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'P02 S5 FAIL: member suspendeu'; end if;

  -- S6 patient
  perform pg_temp.wp02_login(s.a_pat);
  raised := false;
  begin
    perform public.suspend_platform_clinic(s.c_a, 'motivo suficiente');
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'P02 S6 FAIL: patient suspendeu'; end if;

  -- S34 PA revoked
  perform pg_temp.wp02_login(s.a_rev);
  raised := false;
  begin
    perform public.suspend_platform_clinic(s.c_a, 'motivo suficiente');
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'P02 S34 FAIL: revoked PA suspendeu'; end if;

  -- S1 PA suspende
  perform pg_temp.wp02_login(s.a_plat);
  perform public.suspend_platform_clinic(s.c_a, 'inadimplencia de teste');
  reset role;

  if (select status from public.clinics where id = s.c_a) is distinct from 'suspended' then
    raise exception 'P02 S1 FAIL: status nao suspended';
  end if;
  select count(*) into n_evt from private.platform_clinic_status_events where clinic_id = s.c_a;
  if n_evt <> 1 then raise exception 'P02 S2 FAIL: events=%', n_evt; end if;

  -- S24 double suspend: erro, sem segundo event
  perform pg_temp.wp02_login(s.a_plat);
  raised := false;
  begin
    perform public.suspend_platform_clinic(s.c_a, 'segunda tentativa');
  exception when others then
    raised := true;
    if sqlstate is distinct from '22023' then
      raise exception 'P02 S24 FAIL sqlstate=%', sqlstate;
    end if;
  end;
  reset role;
  if not raised then raise exception 'P02 S24 FAIL: double suspend passou'; end if;
  select count(*) into n_evt from private.platform_clinic_status_events where clinic_id = s.c_a;
  if n_evt <> 1 then raise exception 'P02 S24 FAIL: segundo event events=%', n_evt; end if;

  -- S23 counts
  select count(*) into n_after_prof from public.professionals where clinic_id = s.c_a;
  select count(*) into n_after_pat from public.patients where clinic_id = s.c_a;
  select count(*) into n_after_link from public.professional_patient_links;
  select count(*) into n_after_msg from public.chat_messages where channel_id = s.ch_a;
  select count(*) into n_after_snap from public.adherence_snapshots where patient_id = s.p_a;
  if n_after_prof <> n_prof or n_after_pat <> n_pat or n_after_link <> n_link
     or n_after_msg <> n_msg or n_after_snap <> n_snap then
    raise exception 'P02 S23 FAIL: counts mudaram';
  end if;
  if (select status from public.professionals where id = s.pr_member) is distinct from 'active' then
    raise exception 'P02 S21 FAIL: professional.status alterado';
  end if;

  -- S8 owner perde operação
  perform pg_temp.wp02_login(s.a_owner);
  if private.is_clinic_admin(s.c_a) then
    raise exception 'P02 S8 FAIL: owner ainda admin';
  end if;
  if private.can_access_patient(s.p_a) then
    raise exception 'P02 S8 FAIL: owner ainda acessa paciente';
  end if;
  reset role;

  -- S9/S10
  perform pg_temp.wp02_login(s.a_admin);
  if private.is_clinic_admin(s.c_a) then
    raise exception 'P02 S9 FAIL: co-admin ainda opera';
  end if;
  reset role;
  perform pg_temp.wp02_login(s.a_member);
  if private.is_common_professional_of_patient(s.p_a) then
    raise exception 'P02 S10 FAIL: professional ainda comum';
  end if;
  if private.is_channel_participant(s.ch_a) then
    raise exception 'P02 S14 FAIL: participant ainda true';
  end if;
  reset role;

  -- S11 patient clinical access
  perform pg_temp.wp02_login(s.a_pat);
  if private.can_access_patient(s.p_a) then
    raise exception 'P02 S11 FAIL: patient can_access';
  end if;
  if not private.is_self_patient(s.p_a) then
    raise exception 'P02 S11 FAIL: is_self_patient perdeu identidade';
  end if;
  select access_state into v_state from public.get_my_clinic_access_state();
  if v_state is distinct from 'clinic_suspended' then
    raise exception 'P02 S30 FAIL: patient access_state=%', v_state;
  end if;
  reset role;

  -- S12 outra clinic intacta
  perform pg_temp.wp02_login(s.a_owner_b);
  if not private.is_clinic_admin(s.c_b) then
    raise exception 'P02 S12 FAIL: beta owner perdeu admin';
  end if;
  if not private.can_access_patient(s.p_b) then
    raise exception 'P02 S12 FAIL: beta patient';
  end if;
  reset role;

  -- S7 PA não ganha dado clínico
  perform pg_temp.wp02_login(s.a_plat);
  if private.can_access_patient(s.p_a) or private.is_clinic_member(s.c_a) then
    raise exception 'P02 S7 FAIL: PA ganhou acesso clínico';
  end if;
  reset role;

  -- S18 join bloqueado (join_code lido como owner, não pelo pending)
  v_code := (select join_code from public.clinics where id = s.c_a);
  perform pg_temp.wp02_login(s.a_pending);
  raised := false;
  begin
    perform public.request_clinic_access(v_code);
  exception when others then
    raised := true;
    if sqlstate is distinct from 'P0002' then
      raise exception 'P02 S18 FAIL sqlstate=%', sqlstate;
    end if;
  end;
  reset role;
  if not raised then raise exception 'P02 S18 FAIL: join em suspensa passou'; end if;

  -- S45 patient self-INSERT bloqueado (weight_logs — sem FK extra)
  perform pg_temp.wp02_login(s.a_pat);
  raised := false;
  begin
    insert into public.weight_logs (patient_id, weight_kg)
      values (s.p_a, 70);
  exception when insufficient_privilege then
    raised := true;
  end;
  reset role;
  if not raised then raise exception 'P02 S45 FAIL: patient inseriu weight_log suspensa'; end if;

  -- S42 get_or_create_channel
  perform pg_temp.wp02_login(s.a_member);
  raised := false;
  begin
    perform public.get_or_create_channel(s.p_a);
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'P02 S42 FAIL: get_or_create_channel passou'; end if;

  -- S19/S43 create_patient DEFINER bloqueado (staff-row sozinha não basta)
  perform pg_temp.wp02_login(s.a_member);
  raised := false;
  begin
    perform public.create_patient(s.c_a, 'Paciente Suspensa P02');
  exception when insufficient_privilege then raised := true;
  end;
  reset role;
  if not raised then raise exception 'P02 S43 FAIL: create_patient passou em clinica suspensa'; end if;

  -- S44 SOS trigger: insert DEFINER/owner não cria notificação
  insert into public.chat_messages (channel_id, sender_profile_id, sender_role, body)
    values (s.ch_a, s.pf_pat, 'patient', 'Preciso de ajuda');
  select count(*) into n_notif_after from public.staff_notifications;
  if n_notif_after <> n_notif_before then
    raise exception 'P02 S44 FAIL: SOS gerou notificação n=% → %', n_notif_before, n_notif_after;
  end if;

  -- S41 VRI não processa suspended
  select * into rec from private.recompute_adherence_all();
  if rec.seen <> 0 then
    raise exception 'P02 S41 FAIL: VRI seen=% para clinica suspensa', rec.seen;
  end if;

  -- S20 reactivate
  perform pg_temp.wp02_login(s.a_plat);
  perform public.reactivate_platform_clinic(s.c_a, null);
  reset role;
  if (select status from public.clinics where id = s.c_a) is distinct from 'active' then
    raise exception 'P02 S20 FAIL: nao reativou';
  end if;
  select count(*) into n_evt from private.platform_clinic_status_events where clinic_id = s.c_a;
  if n_evt <> 2 then raise exception 'P02 S20 FAIL: events apos reactivate=%', n_evt; end if;

  perform pg_temp.wp02_login(s.a_owner);
  if not private.is_clinic_admin(s.c_a) then
    raise exception 'P02 S20 FAIL: owner nao recuperou admin';
  end if;
  reset role;
  perform pg_temp.wp02_login(s.a_member);
  if not private.is_common_professional_of_patient(s.p_a) then
    raise exception 'P02 S20 FAIL: professional nao recuperou acesso';
  end if;
  reset role;
  perform pg_temp.wp02_login(s.a_pat);
  if not private.can_access_patient(s.p_a) then
    raise exception 'P02 S20 FAIL: patient nao recuperou acesso';
  end if;
  reset role;

  if (select status from public.professionals where id = s.pr_member) is distinct from 'active' then
    raise exception 'P02 S21 FAIL pos-reativar';
  end if;
  select count(*) into n_after_link from public.professional_patient_links;
  if n_after_link <> n_link then raise exception 'P02 S22 FAIL: links mudaram'; end if;

  -- S25 double reactivate
  perform pg_temp.wp02_login(s.a_plat);
  raised := false;
  begin
    perform public.reactivate_platform_clinic(s.c_a, null);
  exception when others then
    raised := true;
    if sqlstate is distinct from '22023' then
      raise exception 'P02 S25 FAIL sqlstate=%', sqlstate;
    end if;
  end;
  reset role;
  if not raised then raise exception 'P02 S25 FAIL: double reactivate passou'; end if;
  select count(*) into n_evt from private.platform_clinic_status_events where clinic_id = s.c_a;
  if n_evt <> 2 then raise exception 'P02 S25 FAIL: terceiro event'; end if;

  -- S33 onboarding policy independente (não apagar / não acoplar)
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'private' and table_name = 'clinic_onboarding_policy'
  ) then
    if not exists (select 1 from private.clinic_onboarding_policy) then
      raise exception 'P02 S33 FAIL: policy apagada';
    end if;
  end if;

  -- Asaas isolation: zero escrita billing
  if exists (
    select 1 from information_schema.tables
     where table_schema='private' and table_name='billing_accounts'
  ) then
    if exists (
      select 1 from private.billing_accounts ba where ba.clinic_id in (s.c_a, s.c_b)
    ) then
      raise exception 'P02 Asaas FAIL: billing_account criado';
    end if;
  end if;

  raise notice 'P02 S1-S25 core: PASS';
end $$;
rollback;


-- S35 multi-membership
begin;
do $$
declare
  s record;
  v_state text;
begin
  select * into s from pg_temp.wp02_seed();
  -- mesmo profile em A e B: clonar member em B
  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (s.pf_member, s.c_b, 'nutritionist', 'member', 'active');

  perform pg_temp.wp02_login(s.a_plat);
  perform public.suspend_platform_clinic(s.c_a, 'pausa alfa');
  reset role;

  perform pg_temp.wp02_login(s.a_member);
  select access_state into v_state from public.get_my_clinic_access_state();
  if v_state is distinct from 'operational' then
    raise exception 'P02 S35 FAIL: access_state=%', v_state;
  end if;
  if not exists (
    select 1 from public.my_clinic_memberships() m
     where m.clinic_id = s.c_b and m.clinic_status = 'active'
  ) then
    raise exception 'P02 S35 FAIL: membership B sumiu';
  end if;
  reset role;
  raise notice 'P02 S35: PASS';
end $$;
rollback;


-- S37: membership (mesmo só suspensa) não libera criar outro tenant
begin;
do $$
declare
  s record;
  raised boolean := false;
begin
  select * into s from pg_temp.wp02_seed();
  perform pg_temp.wp02_login(s.a_plat);
  perform public.suspend_platform_clinic(s.c_a, 'pausa s37');
  reset role;

  perform pg_temp.wp02_login(s.a_member);
  begin
    perform public.create_clinic_with_owner('Clinica Nova S37');
  exception when others then
    raised := true;
  end;
  reset role;
  if not raised then
    raise exception 'P02 S37 FAIL: member de suspensa criou nova clinica';
  end if;
  if exists (select 1 from public.clinics where name = 'Clinica Nova S37') then
    raise exception 'P02 S37 FAIL: clinica nova persistiu';
  end if;
  raise notice 'P02 S37: PASS';
end $$;
rollback;


-- clinic_is_operational fail-closed
begin;
do $$
begin
  if private.clinic_is_operational(null) then
    raise exception 'P02 FAIL: operational(null)';
  end if;
  if private.clinic_is_operational(gen_random_uuid()) then
    raise exception 'P02 FAIL: operational(missing)';
  end if;
  raise notice 'P02 predicate: PASS';
end $$;
rollback;


-- H1: nenhuma policy clínica cita is_platform_admin
begin;
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_policy
   where (pg_get_expr(polqual, polrelid) like '%is_platform_admin%'
       or pg_get_expr(polwithcheck, polrelid) like '%is_platform_admin%')
     and polrelid::regclass::text not like 'private.%';
  if n <> 0 then
    raise exception 'P02 H1 FAIL: is_platform_admin em policy clínica n=%', n;
  end if;
  raise notice 'P02 H1: PASS';
end $$;
rollback;
