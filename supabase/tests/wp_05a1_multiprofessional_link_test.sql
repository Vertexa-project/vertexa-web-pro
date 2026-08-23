-- =====================================================================================
-- WP-05A1 — TESTES (Nível 1: request.jwt.claims + `set local role`, ROLLBACK).
-- Exige a migration 20260813090000 aplicada (ou executada antes, na MESMA transação).
--
-- FIXTURE REACHABILITY (fluxos reais do produto — nada inventado):
--   admin/owner ........ create_clinic_with_owner (owner_profile_id) ou professionals.clinic_role='admin'
--   member ............. promote_to_professional / approve_join_request (clinic_role='member')
--   patient ............ create_patient
--   link ativo ......... create_patient (amarra o chamador) OU assign_patient_professional
--   link inativo ....... deactivate_patient_link
--   canal .............. get_or_create_channel (UNIQUE patient_id)
--
-- OS 16 CASOS DO WP + isolamento.
-- =====================================================================================

begin;
do $$
declare
  fails text := '';
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  p_own uuid := gen_random_uuid(); a_own uuid := gen_random_uuid();
  p_adm uuid := gen_random_uuid(); a_adm uuid := gen_random_uuid();
  p_m1  uuid := gen_random_uuid(); a_m1  uuid := gen_random_uuid();
  p_m2  uuid := gen_random_uuid(); a_m2  uuid := gen_random_uuid();
  p_m3  uuid := gen_random_uuid(); a_m3  uuid := gen_random_uuid();
  p_ina uuid := gen_random_uuid(); a_ina uuid := gen_random_uuid();
  p_oth uuid := gen_random_uuid(); a_oth uuid := gen_random_uuid();
  p_pat uuid := gen_random_uuid(); a_pat uuid := gen_random_uuid();
  p_pb  uuid := gen_random_uuid(); a_pb  uuid := gen_random_uuid();
  p_un  uuid := gen_random_uuid(); a_un  uuid := gen_random_uuid();
  prof_own uuid; prof_adm uuid; prof_m1 uuid; prof_m2 uuid; prof_m3 uuid;
  prof_ina uuid; prof_oth uuid; prof_un uuid;
  pat1 uuid; patB uuid;
  link_m1 uuid; link_m2 uuid; link_m3 uuid; link_again uuid; link_re uuid;
  ch1 uuid := gen_random_uuid();
  v_n int; v_state text;
  antes_b int; depois_b int;
  antes_un int; depois_un int;
  v_created_at timestamptz; v_is_ext boolean; v_id uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (p_own, a_own,'professional','Dona Alfa',     'own@t05a1.test','active'),
    (p_adm, a_adm,'professional','Admin Alfa',    'adm@t05a1.test','active'),
    (p_m1,  a_m1, 'professional','Membro Um',     'm1@t05a1.test', 'active'),
    (p_m2,  a_m2, 'professional','Membro Dois',   'm2@t05a1.test', 'active'),
    (p_m3,  a_m3, 'professional','Membro Tres',   'm3@t05a1.test', 'active'),
    (p_ina, a_ina,'professional','Membro Inat',   'ina@t05a1.test','active'),
    (p_oth, a_oth,'professional','Admin Beta',    'oth@t05a1.test','active'),
    (p_pat, a_pat,'patient',     'Paciente Alfa', 'pat@t05a1.test','active'),
    (p_pb,  a_pb, 'patient',     'Paciente Beta', 'pb@t05a1.test', 'active'),
    (p_un,  a_un, 'professional','Nao Envolvido', 'un@t05a1.test', 'active');

  insert into public.clinics (id, name, owner_profile_id) values
    (c1,'Clinica Alfa 05A1', p_own),
    (c2,'Clinica Beta 05A1', p_oth);

  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (p_own,c1,'other','admin','active')             returning id into prof_own;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (p_adm,c1,'doctor','admin','active')            returning id into prof_adm;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (p_m1, c1,'nutritionist','member','active')     returning id into prof_m1;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (p_m2, c1,'personal_trainer','member','active') returning id into prof_m2;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (p_m3, c1,'physiotherapist','member','active')  returning id into prof_m3;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (p_ina,c1,'other','member','inactive')          returning id into prof_ina;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (p_oth,c2,'other','admin','active')             returning id into prof_oth;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (p_un, c2,'doctor','member','active')           returning id into prof_un;

  insert into public.patients (profile_id, clinic_id, goal) values (p_pat, c1, 'meta') returning id into pat1;
  insert into public.patients (profile_id, clinic_id, goal) values (p_pb,  c2, 'meta') returning id into patB;

  -- Fluxo real: create_patient amarra o CHAMADOR. Aqui o 1º vínculo nasce como o do dono.
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status)
    values (prof_own, pat1, false, 'active');
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status)
    values (prof_oth, patB, false, 'active');

  select count(*) into antes_b from public.professional_patient_links where patient_id = patB;
  select count(*) into antes_un from public.professional_patient_links where professional_id = prof_un;

  -- ── (1)(2) admin atribui o segundo profissional ativo da mesma clínica ────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  link_m1 := public.assign_patient_professional(pat1, prof_m1);
  reset role;
  if link_m1 is null then fails := fails || 'T1_null '; end if;
  select count(*) into v_n from public.professional_patient_links
   where patient_id = pat1 and coalesce(status,'active')='active';
  if v_n <> 2 then fails := fails || 'T2_ativos('||v_n::text||') '; end if;

  -- ── (3) terceiro profissional também pode ser atribuído ────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  link_m2 := public.assign_patient_professional(pat1, prof_m2);
  reset role;
  select count(*) into v_n from public.professional_patient_links
   where patient_id = pat1 and coalesce(status,'active')='active';
  if v_n <> 3 then fails := fails || 'T3_ativos('||v_n::text||') '; end if;

  -- ── (4) assign duplicado no ativo é idempotente (mesma linha, sem segunda) ─────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  link_again := public.assign_patient_professional(pat1, prof_m1);
  reset role;
  if link_again is distinct from link_m1 then fails := fails || 'T4_id_diferente '; end if;
  select count(*) into v_n from public.professional_patient_links
   where professional_id = prof_m1 and patient_id = pat1;
  if v_n <> 1 then fails := fails || 'T4_segunda_linha('||v_n::text||') '; end if;

  -- ── (5) vínculo inativo + assign → mesma linha reativada ───────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.deactivate_patient_link(prof_m2, pat1, 'pausa');
  reset role;
  select id, created_at, coalesce(is_external,false)
    into v_id, v_created_at, v_is_ext
    from public.professional_patient_links
   where professional_id = prof_m2 and patient_id = pat1;
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  link_re := public.assign_patient_professional(pat1, prof_m2);
  reset role;
  if link_re is distinct from v_id then fails := fails || 'T5_nao_mesma_linha '; end if;
  if (select created_at from public.professional_patient_links where id = v_id) is distinct from v_created_at then
    fails := fails || 'T5_created_at_mudou ';
  end if;
  if (select coalesce(is_external,false) from public.professional_patient_links where id = v_id) is distinct from v_is_ext then
    fails := fails || 'T5_is_external_mudou ';
  end if;
  if (select coalesce(status,'active') from public.professional_patient_links where id = v_id) <> 'active' then
    fails := fails || 'T5_nao_reativou ';
  end if;

  -- ── (6) profissional de outra clínica → negado ─────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.assign_patient_professional(pat1, prof_oth);
    reset role; fails := fails || 'T6_passou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    if v_state <> '42501' then fails := fails || 'T6_errcode('||v_state||') '; end if;
  end;

  -- ── (7) paciente de outra clínica → negado ─────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.assign_patient_professional(patB, prof_m1);
    reset role; fails := fails || 'T7_passou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    if v_state <> '42501' then fails := fails || 'T7_errcode('||v_state||') '; end if;
  end;

  -- ── (8) profissional comum atribuindo → negado ─────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_m1,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.assign_patient_professional(pat1, prof_m3);
    reset role; fails := fails || 'T8_passou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    if v_state <> '42501' then fails := fails || 'T8_errcode('||v_state||') '; end if;
  end;

  -- ── (9) alvo inativo → negado ──────────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.assign_patient_professional(pat1, prof_ina);
    reset role; fails := fails || 'T9_passou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    if v_state <> '42501' then fails := fails || 'T9_errcode('||v_state||') '; end if;
  end;

  -- ── (10) não autenticado → negado ──────────────────────────────────────────────────
  -- EXECUTE revogado de anon (sem SET ROLE anon: o PG 17 local desta máquina
  -- segfaulta nesse caminho; a prova de privilégio é equivalente e estável).
  if has_function_privilege('anon','public.assign_patient_professional(uuid,uuid)','execute') then
    fails := fails || 'T10_anon_execute ';
  end if;
  begin
    perform set_config('request.jwt.claims', '{}', true);
    set local role authenticated;
    perform public.assign_patient_professional(pat1, prof_m3);
    reset role; fails := fails || 'T10_passou ';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    reset role;
    if v_state <> '42501' then fails := fails || 'T10_errcode('||v_state||') '; end if;
  end;

  -- ── (11) sem canal → assign NÃO cria canal ─────────────────────────────────────────
  select count(*) into v_n from public.chat_channels where patient_id = pat1;
  if v_n <> 0 then fails := fails || 'T11_canal_preexistente '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  link_m3 := public.assign_patient_professional(pat1, prof_m3);
  reset role;
  select count(*) into v_n from public.chat_channels where patient_id = pat1;
  if v_n <> 0 then fails := fails || 'T11_criou_canal '; end if;

  -- ── (12) canal existente → novo profissional entra no roster ───────────────────────
  insert into public.chat_channels (id, patient_id) values (ch1, pat1);
  insert into public.chat_participants (channel_id, profile_id, role) values
    (ch1, p_pat, 'patient'),
    (ch1, p_own, 'professional');
  -- assign de m1 (já ativo) deve reconciliar o roster e colocar m1/m2/m3
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(pat1, prof_m1);
  reset role;
  select count(*) into v_n from public.chat_participants
   where channel_id = ch1 and profile_id = p_m1 and role = 'professional';
  if v_n <> 1 then fails := fails || 'T12_m1_fora_roster '; end if;
  select count(*) into v_n from public.chat_participants
   where channel_id = ch1 and profile_id = p_m3 and role = 'professional';
  if v_n <> 1 then fails := fails || 'T12_m3_fora_roster '; end if;

  -- ── (13) deactivate → sai do roster ────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.deactivate_patient_link(prof_m1, pat1, 'sai');
  reset role;
  select count(*) into v_n from public.chat_participants
   where channel_id = ch1 and profile_id = p_m1 and role = 'professional';
  if v_n <> 0 then fails := fails || 'T13_ainda_no_roster '; end if;

  -- ── (14) reactivate → volta ao roster ──────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.reactivate_patient_link(prof_m1, pat1, 'volta');
  reset role;
  select count(*) into v_n from public.chat_participants
   where channel_id = ch1 and profile_id = p_m1 and role = 'professional';
  if v_n <> 1 then fails := fails || 'T14_nao_voltou_roster '; end if;

  -- ── (15) INSERT cru autenticado → negado após hardening ────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
      values (prof_un, pat1, false, 'active');
    reset role; fails := fails || 'T15_insert_cru_passou ';
  exception when others then
    reset role;
  end;
  if has_table_privilege('authenticated','public.professional_patient_links','insert') then
    fails := fails || 'T15_grant_insert ';
  end if;
  if has_table_privilege('authenticated','public.professional_patient_links','delete') then
    fails := fails || 'T15_grant_delete ';
  end if;

  -- ── (16) SELECT legítimo continua ──────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub',a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.professional_patient_links where patient_id = pat1;
  reset role;
  if v_n < 2 then fails := fails || 'T16_admin_select('||v_n::text||') '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',a_m1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.professional_patient_links
   where professional_id = prof_m1 and patient_id = pat1;
  reset role;
  if v_n <> 1 then fails := fails || 'T16_membro_select '; end if;

  if not has_table_privilege('authenticated','public.professional_patient_links','select') then
    fails := fails || 'T16_grant_select ';
  end if;

  -- ── Isolamento: atores não envolvidos DEPOIS == ANTES ──────────────────────────────
  select count(*) into depois_b from public.professional_patient_links where patient_id = patB;
  select count(*) into depois_un from public.professional_patient_links where professional_id = prof_un;
  if depois_b <> antes_b then fails := fails || 'ISO_beta_links '; end if;
  if depois_un <> antes_un then fails := fails || 'ISO_uninvolved '; end if;

  -- O recém-vinculado ganha só o acesso que o modelo já dá a um profissional interno ativo.
  perform set_config('request.jwt.claims', json_build_object('sub',a_m3,'role','authenticated')::text, true);
  set local role authenticated;
  if not private.is_common_professional_of_patient(pat1) then fails := fails || 'ISO_m3_sem_acesso_alvo '; end if;
  if private.can_access_patient(patB) then fails := fails || 'ISO_m3_ganhou_beta '; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',a_un,'role','authenticated')::text, true);
  set local role authenticated;
  if private.can_access_patient(pat1) then fails := fails || 'ISO_un_ganhou_alfa '; end if;
  reset role;

  if length(fails) > 0 then
    raise exception 'WP-05A1 TESTS FAILED: %', fails;
  else
    raise notice 'WP-05A1: ALL ASSERTIONS PASSED';
  end if;
end $$;
rollback;
