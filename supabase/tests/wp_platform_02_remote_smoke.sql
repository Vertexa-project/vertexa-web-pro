-- PLATFORM-02 remote smoke: UM único statement (Management API não preserva pg_temp).
-- Cria fixture isolada, prova S1–S25/S35/S37/S43/S45, apaga tudo no mesmo bloco.
do $p02$
declare
  a_plat uuid := gen_random_uuid(); a_rev uuid := gen_random_uuid();
  a_owner uuid := gen_random_uuid(); a_admin uuid := gen_random_uuid();
  a_member uuid := gen_random_uuid(); a_pat uuid := gen_random_uuid();
  a_owner_b uuid := gen_random_uuid(); a_pending uuid := gen_random_uuid();
  pf_plat uuid := gen_random_uuid(); pf_rev uuid := gen_random_uuid();
  pf_owner uuid := gen_random_uuid(); pf_admin uuid := gen_random_uuid();
  pf_member uuid := gen_random_uuid(); pf_pat uuid := gen_random_uuid();
  pf_owner_b uuid := gen_random_uuid(); pf_pending uuid := gen_random_uuid();
  c_a uuid := gen_random_uuid(); c_b uuid := gen_random_uuid();
  pr_member uuid; pr_owner_b uuid; p_a uuid; ch_a uuid := gen_random_uuid();
  n_evt int; n_prof int; n_pat int; n_after_prof int; n_after_pat int;
  raised boolean; v_state text;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (pf_owner, a_owner, 'professional', 'P02RS Owner A', 'p02rs-own-a@t.test', 'active'),
    (pf_admin, a_admin, 'professional', 'P02RS Admin A', 'p02rs-adm-a@t.test', 'active'),
    (pf_member, a_member, 'professional', 'P02RS Mem A', 'p02rs-mem-a@t.test', 'active'),
    (pf_owner_b, a_owner_b, 'professional', 'P02RS Owner B', 'p02rs-own-b@t.test', 'active'),
    (pf_pat, a_pat, 'patient', 'P02RS Pat A', 'p02rs-pat-a@t.test', 'active'),
    (pf_plat, a_plat, 'professional', 'P02RS PA', 'p02rs-pa@t.test', 'active'),
    (pf_rev, a_rev, 'professional', 'P02RS PA Rev', 'p02rs-rev@t.test', 'active'),
    (pf_pending, a_pending, 'professional', 'P02RS Pending', 'p02rs-pend@t.test', 'pending');

  insert into public.clinics (id, name, owner_profile_id) values
    (c_a, 'P02RS Alfa', pf_owner),
    (c_b, 'P02RS Beta', pf_owner_b);

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status) values
    (pf_owner, c_a, 'other', 'admin', 'active'),
    (pf_admin, c_a, 'doctor', 'admin', 'active'),
    (pf_member, c_a, 'nutritionist', 'member', 'active'),
    (pf_owner_b, c_b, 'doctor', 'admin', 'active');

  select pr.id into pr_member from public.professionals pr where pr.profile_id = pf_member;
  select pr.id into pr_owner_b from public.professionals pr where pr.profile_id = pf_owner_b;

  insert into public.patients (profile_id, clinic_id, goal) values (pf_pat, c_a, 'meta') returning id into p_a;
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
    values (pr_member, p_a, false, 'active');
  insert into public.chat_channels (id, patient_id) values (ch_a, p_a);
  insert into public.chat_participants (channel_id, profile_id, role) values
    (ch_a, pf_pat, 'patient'), (ch_a, pf_member, 'professional');
  insert into public.adherence_snapshots (patient_id, score, level) values (p_a, 50, 'atencao');
  insert into private.platform_admins (profile_id, status, granted_at, revoked_at) values
    (pf_plat, 'active', now(), null),
    (pf_rev, 'revoked', now() - interval '1 day', now());

  select count(*) into n_prof from public.professionals where clinic_id = c_a;
  select count(*) into n_pat from public.patients where clinic_id = c_a;

  perform set_config('request.jwt.claims', json_build_object('sub', a_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  raised := false;
  begin
    perform public.suspend_platform_clinic(c_a, 'motivo suficiente');
  exception when insufficient_privilege then raised := true;
  end;
  execute 'reset role';
  if not raised then raise exception 'P02 remote S4 FAIL'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a_rev, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  raised := false;
  begin
    perform public.suspend_platform_clinic(c_a, 'motivo suficiente');
  exception when insufficient_privilege then raised := true;
  end;
  execute 'reset role';
  if not raised then raise exception 'P02 remote S34 FAIL'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a_plat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.suspend_platform_clinic(c_a, 'inadimplencia de teste');
  execute 'reset role';
  if (select status from public.clinics where id = c_a) is distinct from 'suspended' then
    raise exception 'P02 remote S1 FAIL';
  end if;
  select count(*) into n_evt from private.platform_clinic_status_events where clinic_id = c_a;
  if n_evt <> 1 then raise exception 'P02 remote S2 FAIL events=%', n_evt; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a_plat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  raised := false;
  begin
    perform public.suspend_platform_clinic(c_a, 'segunda tentativa');
  exception when others then
    raised := true;
    if sqlstate is distinct from '22023' then raise exception 'P02 remote S24 FAIL %', sqlstate; end if;
  end;
  execute 'reset role';
  if not raised then raise exception 'P02 remote S24 FAIL passou'; end if;

  select count(*) into n_after_prof from public.professionals where clinic_id = c_a;
  select count(*) into n_after_pat from public.patients where clinic_id = c_a;
  if n_after_prof <> n_prof or n_after_pat <> n_pat then
    raise exception 'P02 remote S23 FAIL';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if private.is_clinic_admin(c_a) then raise exception 'P02 remote S8 FAIL'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', a_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if private.can_access_patient(p_a) then raise exception 'P02 remote S11 FAIL can_access'; end if;
  if not private.is_self_patient(p_a) then raise exception 'P02 remote S11 FAIL identity'; end if;
  select access_state into v_state from public.get_my_clinic_access_state();
  if v_state is distinct from 'clinic_suspended' then
    raise exception 'P02 remote S30 FAIL %', v_state;
  end if;
  raised := false;
  begin
    insert into public.weight_logs (patient_id, weight_kg) values (p_a, 70);
  exception when insufficient_privilege then raised := true;
  end;
  execute 'reset role';
  if not raised then raise exception 'P02 remote S45 FAIL'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a_plat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if private.can_access_patient(p_a) then raise exception 'P02 remote S7 FAIL'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', a_member, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  raised := false;
  begin
    perform public.get_or_create_channel(p_a);
  exception when insufficient_privilege then raised := true;
  end;
  if not raised then raise exception 'P02 remote S42 FAIL'; end if;
  raised := false;
  begin
    perform public.create_patient(c_a, 'P02RS Novo');
  exception when insufficient_privilege then raised := true;
  end;
  execute 'reset role';
  if not raised then raise exception 'P02 remote S43 FAIL'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a_member, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  raised := false;
  begin
    perform public.create_clinic_with_owner('P02RS Nova Tenant');
  exception when others then raised := true;
  end;
  execute 'reset role';
  if not raised then raise exception 'P02 remote S37 FAIL'; end if;
  if exists (select 1 from public.clinics where name = 'P02RS Nova Tenant') then
    raise exception 'P02 remote S37 persistiu';
  end if;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role, status)
    values (pf_member, c_b, 'nutritionist', 'member', 'active');
  perform set_config('request.jwt.claims', json_build_object('sub', a_member, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select access_state into v_state from public.get_my_clinic_access_state();
  execute 'reset role';
  if v_state is distinct from 'operational' then
    raise exception 'P02 remote S35 FAIL %', v_state;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a_plat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.reactivate_platform_clinic(c_a, null);
  execute 'reset role';
  if (select status from public.clinics where id = c_a) is distinct from 'active' then
    raise exception 'P02 remote S20 FAIL';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not private.is_clinic_admin(c_a) then raise exception 'P02 remote S20 owner FAIL'; end if;
  execute 'reset role';

  -- Management API não é superuser: o RAISE aborta o statement e faz rollback do fixture.
  raise exception 'P02 remote smoke PASS'
    using errcode = 'P0001', hint = 'P02_REMOTE_SMOKE_PASS';
end;
$p02$;
