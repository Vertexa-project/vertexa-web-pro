-- =====================================================================================
-- WP-05A1 — TESTES (Nível 1: request.jwt.claims + `set local role`, ROLLBACK).
-- Exige a migration 20260813090000 aplicada.
--
-- HARNESS: NÃO é um único DO monolítico. O PG 17.6 Docker local (supabase/postgres)
-- entra em SIGSEGV (signal 11) + crash recovery quando este arquivo era um DO único
-- de ~290 linhas. Os mesmos 16 casos passam em transações pequenas. Causa = harness,
-- não a RPC (lotes independentes já tinham passado; o log aponta o `do $$` do teste).
--
-- CANÔNICO: um `psql -v ON_ERROR_STOP=1 -f` deste arquivo. Cada caso é
-- BEGIN / DO pequeno / ROLLBACK, com NOTICE individual.
--
-- FIXTURE REACHABILITY (fluxos reais — nada inventado):
--   admin/owner ........ create_clinic_with_owner / professionals.clinic_role='admin'
--   member ............. promote_to_professional / approve_join_request (clinic_role='member')
--   patient ............ create_patient
--   link ativo ......... create_patient (amarra o chamador) OU assign_patient_professional
--   link inativo ....... deactivate_patient_link
--   canal .............. get_or_create_channel (UNIQUE patient_id)
-- =====================================================================================

create or replace function pg_temp.wp05a1_seed()
returns table (
  c1 uuid, c2 uuid,
  p_own uuid, a_own uuid, p_adm uuid, a_adm uuid,
  p_m1 uuid, a_m1 uuid, p_m2 uuid, a_m2 uuid, p_m3 uuid, a_m3 uuid,
  p_ina uuid, a_ina uuid, p_oth uuid, a_oth uuid,
  p_pat uuid, a_pat uuid, p_pb uuid, a_pb uuid, p_un uuid, a_un uuid,
  prof_own uuid, prof_adm uuid, prof_m1 uuid, prof_m2 uuid, prof_m3 uuid,
  prof_ina uuid, prof_oth uuid, prof_un uuid,
  pat1 uuid, patB uuid
)
language plpgsql
as $seed$
declare
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
  v_p_own uuid := gen_random_uuid(); v_a_own uuid := gen_random_uuid();
  v_p_adm uuid := gen_random_uuid(); v_a_adm uuid := gen_random_uuid();
  v_p_m1  uuid := gen_random_uuid(); v_a_m1  uuid := gen_random_uuid();
  v_p_m2  uuid := gen_random_uuid(); v_a_m2  uuid := gen_random_uuid();
  v_p_m3  uuid := gen_random_uuid(); v_a_m3  uuid := gen_random_uuid();
  v_p_ina uuid := gen_random_uuid(); v_a_ina uuid := gen_random_uuid();
  v_p_oth uuid := gen_random_uuid(); v_a_oth uuid := gen_random_uuid();
  v_p_pat uuid := gen_random_uuid(); v_a_pat uuid := gen_random_uuid();
  v_p_pb  uuid := gen_random_uuid(); v_a_pb  uuid := gen_random_uuid();
  v_p_un  uuid := gen_random_uuid(); v_a_un  uuid := gen_random_uuid();
  v_prof_own uuid; v_prof_adm uuid; v_prof_m1 uuid; v_prof_m2 uuid; v_prof_m3 uuid;
  v_prof_ina uuid; v_prof_oth uuid; v_prof_un uuid;
  v_pat1 uuid; v_patB uuid;
begin
  insert into public.profiles (id, auth_user_id, role, full_name, email, status) values
    (v_p_own, v_a_own,'professional','Dona Alfa',     'own@t05a1.test','active'),
    (v_p_adm, v_a_adm,'professional','Admin Alfa',    'adm@t05a1.test','active'),
    (v_p_m1,  v_a_m1, 'professional','Membro Um',     'm1@t05a1.test', 'active'),
    (v_p_m2,  v_a_m2, 'professional','Membro Dois',   'm2@t05a1.test', 'active'),
    (v_p_m3,  v_a_m3, 'professional','Membro Tres',   'm3@t05a1.test', 'active'),
    (v_p_ina, v_a_ina,'professional','Membro Inat',   'ina@t05a1.test','active'),
    (v_p_oth, v_a_oth,'professional','Admin Beta',    'oth@t05a1.test','active'),
    (v_p_pat, v_a_pat,'patient',     'Paciente Alfa', 'pat@t05a1.test','active'),
    (v_p_pb,  v_a_pb, 'patient',     'Paciente Beta', 'pb@t05a1.test', 'active'),
    (v_p_un,  v_a_un, 'professional','Nao Envolvido', 'un@t05a1.test', 'active');

  insert into public.clinics (id, name, owner_profile_id) values
    (v_c1,'Clinica Alfa 05A1', v_p_own),
    (v_c2,'Clinica Beta 05A1', v_p_oth);

  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (v_p_own,v_c1,'other','admin','active')             returning id into v_prof_own;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (v_p_adm,v_c1,'doctor','admin','active')            returning id into v_prof_adm;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (v_p_m1, v_c1,'nutritionist','member','active')     returning id into v_prof_m1;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (v_p_m2, v_c1,'personal_trainer','member','active') returning id into v_prof_m2;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (v_p_m3, v_c1,'physiotherapist','member','active')  returning id into v_prof_m3;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (v_p_ina,v_c1,'other','member','inactive')          returning id into v_prof_ina;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (v_p_oth,v_c2,'other','admin','active')             returning id into v_prof_oth;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role,status) values
    (v_p_un, v_c2,'doctor','member','active')           returning id into v_prof_un;

  insert into public.patients (profile_id, clinic_id, goal) values (v_p_pat, v_c1, 'meta') returning id into v_pat1;
  insert into public.patients (profile_id, clinic_id, goal) values (v_p_pb,  v_c2, 'meta') returning id into v_patB;

  -- 1º vínculo = efeito de create_patient (amarra o chamador). INSERT direto só na fixture.
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status)
    values (v_prof_own, v_pat1, false, 'active');
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status)
    values (v_prof_oth, v_patB, false, 'active');

  return query select
    v_c1, v_c2,
    v_p_own, v_a_own, v_p_adm, v_a_adm,
    v_p_m1, v_a_m1, v_p_m2, v_a_m2, v_p_m3, v_a_m3,
    v_p_ina, v_a_ina, v_p_oth, v_a_oth,
    v_p_pat, v_a_pat, v_p_pb, v_a_pb, v_p_un, v_a_un,
    v_prof_own, v_prof_adm, v_prof_m1, v_prof_m2, v_prof_m3,
    v_prof_ina, v_prof_oth, v_prof_un,
    v_pat1, v_patB;
end;
$seed$;

-- ── T1 + T2: admin atribui o 2º profissional; paciente fica com 2 ativos ─────────────
begin;
do $$
declare
  s record; link_m1 uuid; v_n int;
begin
  select * into s from pg_temp.wp05a1_seed();
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  link_m1 := public.assign_patient_professional(s.pat1, s.prof_m1);
  reset role;
  if link_m1 is null then raise exception 'T1_null'; end if;
  select count(*) into v_n from public.professional_patient_links
   where patient_id = s.pat1 and coalesce(status,'active')='active';
  if v_n <> 2 then raise exception 'T2_ativos(%)', v_n; end if;
  raise notice 'WP-05A1 T1 T2 PASSED';
end $$;
rollback;

-- ── T3: terceiro profissional também pode ser atribuído ──────────────────────────────
begin;
do $$
declare
  s record; v_n int;
begin
  select * into s from pg_temp.wp05a1_seed();
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m1);
  perform public.assign_patient_professional(s.pat1, s.prof_m2);
  reset role;
  select count(*) into v_n from public.professional_patient_links
   where patient_id = s.pat1 and coalesce(status,'active')='active';
  if v_n <> 3 then raise exception 'T3_ativos(%)', v_n; end if;
  raise notice 'WP-05A1 T3 PASSED';
end $$;
rollback;

-- ── T4: assign duplicado no ativo é idempotente ──────────────────────────────────────
begin;
do $$
declare
  s record; link_m1 uuid; link_again uuid; v_n int;
begin
  select * into s from pg_temp.wp05a1_seed();
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  link_m1 := public.assign_patient_professional(s.pat1, s.prof_m1);
  link_again := public.assign_patient_professional(s.pat1, s.prof_m1);
  reset role;
  if link_again is distinct from link_m1 then raise exception 'T4_id_diferente'; end if;
  select count(*) into v_n from public.professional_patient_links
   where professional_id = s.prof_m1 and patient_id = s.pat1;
  if v_n <> 1 then raise exception 'T4_segunda_linha(%)', v_n; end if;
  raise notice 'WP-05A1 T4 PASSED';
end $$;
rollback;

-- ── T5: vínculo inativo + assign → mesma linha reativada ─────────────────────────────
begin;
do $$
declare
  s record; v_id uuid; v_created_at timestamptz; v_is_ext boolean; link_re uuid;
begin
  select * into s from pg_temp.wp05a1_seed();
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m2);
  perform public.deactivate_patient_link(s.prof_m2, s.pat1, 'pausa');
  reset role;
  select id, created_at, coalesce(is_external,false)
    into v_id, v_created_at, v_is_ext
    from public.professional_patient_links
   where professional_id = s.prof_m2 and patient_id = s.pat1;
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  link_re := public.assign_patient_professional(s.pat1, s.prof_m2);
  reset role;
  if link_re is distinct from v_id then raise exception 'T5_nao_mesma_linha'; end if;
  if (select created_at from public.professional_patient_links where id = v_id) is distinct from v_created_at then
    raise exception 'T5_created_at_mudou';
  end if;
  if (select coalesce(is_external,false) from public.professional_patient_links where id = v_id) is distinct from v_is_ext then
    raise exception 'T5_is_external_mudou';
  end if;
  if (select coalesce(status,'active') from public.professional_patient_links where id = v_id) <> 'active' then
    raise exception 'T5_nao_reativou';
  end if;
  raise notice 'WP-05A1 T5 PASSED';
end $$;
rollback;

-- ── T6: profissional de outra clínica → 42501 ────────────────────────────────────────
begin;
do $$
declare
  s record; v_state text;
begin
  select * into s from pg_temp.wp05a1_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.assign_patient_professional(s.pat1, s.prof_oth);
    reset role;
    raise exception 'T6_passou';
  exception
    when raise_exception then raise;
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      if v_state <> '42501' then raise exception 'T6_errcode(%)', v_state; end if;
  end;
  raise notice 'WP-05A1 T6 PASSED';
end $$;
rollback;

-- ── T7: paciente de outra clínica → 42501 ────────────────────────────────────────────
begin;
do $$
declare
  s record; v_state text;
begin
  select * into s from pg_temp.wp05a1_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.assign_patient_professional(s.patB, s.prof_m1);
    reset role;
    raise exception 'T7_passou';
  exception
    when raise_exception then raise;
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      if v_state <> '42501' then raise exception 'T7_errcode(%)', v_state; end if;
  end;
  raise notice 'WP-05A1 T7 PASSED';
end $$;
rollback;

-- ── T8: profissional comum atribuindo → 42501 ────────────────────────────────────────
begin;
do $$
declare
  s record; v_state text;
begin
  select * into s from pg_temp.wp05a1_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',s.a_m1,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.assign_patient_professional(s.pat1, s.prof_m3);
    reset role;
    raise exception 'T8_passou';
  exception
    when raise_exception then raise;
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      if v_state <> '42501' then raise exception 'T8_errcode(%)', v_state; end if;
  end;
  raise notice 'WP-05A1 T8 PASSED';
end $$;
rollback;

-- ── T9: alvo inativo → 42501 ─────────────────────────────────────────────────────────
begin;
do $$
declare
  s record; v_state text;
begin
  select * into s from pg_temp.wp05a1_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    perform public.assign_patient_professional(s.pat1, s.prof_ina);
    reset role;
    raise exception 'T9_passou';
  exception
    when raise_exception then raise;
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      if v_state <> '42501' then raise exception 'T9_errcode(%)', v_state; end if;
  end;
  raise notice 'WP-05A1 T9 PASSED';
end $$;
rollback;

-- ── T10: não autenticado → negado (EXECUTE anon + JWT vazio). Sem SET ROLE anon:
-- o PG 17 Docker local segfaulta nesse caminho; a prova de privilégio cobre o grant.
begin;
do $$
declare
  s record; v_state text;
begin
  select * into s from pg_temp.wp05a1_seed();
  if has_function_privilege('anon','public.assign_patient_professional(uuid,uuid)','execute') then
    raise exception 'T10_anon_execute';
  end if;
  begin
    perform set_config('request.jwt.claims', '{}', true);
    set local role authenticated;
    perform public.assign_patient_professional(s.pat1, s.prof_m3);
    reset role;
    raise exception 'T10_passou';
  exception
    when raise_exception then raise;
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
      reset role;
      if v_state <> '42501' then raise exception 'T10_errcode(%)', v_state; end if;
  end;
  raise notice 'WP-05A1 T10 PASSED';
end $$;
rollback;

-- ── T11: sem canal → assign NÃO cria canal ───────────────────────────────────────────
begin;
do $$
declare
  s record; v_n int;
begin
  select * into s from pg_temp.wp05a1_seed();
  select count(*) into v_n from public.chat_channels where patient_id = s.pat1;
  if v_n <> 0 then raise exception 'T11_canal_preexistente'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m3);
  reset role;
  select count(*) into v_n from public.chat_channels where patient_id = s.pat1;
  if v_n <> 0 then raise exception 'T11_criou_canal'; end if;
  raise notice 'WP-05A1 T11 PASSED';
end $$;
rollback;

-- ── T12: canal existente → novo profissional entra no roster ─────────────────────────
begin;
do $$
declare
  s record; ch1 uuid := gen_random_uuid(); v_n int;
begin
  select * into s from pg_temp.wp05a1_seed();
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m1);
  perform public.assign_patient_professional(s.pat1, s.prof_m3);
  reset role;
  insert into public.chat_channels (id, patient_id) values (ch1, s.pat1);
  insert into public.chat_participants (channel_id, profile_id, role) values
    (ch1, s.p_pat, 'patient'),
    (ch1, s.p_own, 'professional');
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m1);
  reset role;
  select count(*) into v_n from public.chat_participants
   where channel_id = ch1 and profile_id = s.p_m1 and role = 'professional';
  if v_n <> 1 then raise exception 'T12_m1_fora_roster'; end if;
  select count(*) into v_n from public.chat_participants
   where channel_id = ch1 and profile_id = s.p_m3 and role = 'professional';
  if v_n <> 1 then raise exception 'T12_m3_fora_roster'; end if;
  raise notice 'WP-05A1 T12 PASSED';
end $$;
rollback;

-- ── T13: deactivate → sai do roster ──────────────────────────────────────────────────
begin;
do $$
declare
  s record; ch1 uuid := gen_random_uuid(); v_n int;
begin
  select * into s from pg_temp.wp05a1_seed();
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m1);
  reset role;
  insert into public.chat_channels (id, patient_id) values (ch1, s.pat1);
  insert into public.chat_participants (channel_id, profile_id, role) values
    (ch1, s.p_pat, 'patient'),
    (ch1, s.p_own, 'professional'),
    (ch1, s.p_m1, 'professional');
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.deactivate_patient_link(s.prof_m1, s.pat1, 'sai');
  reset role;
  select count(*) into v_n from public.chat_participants
   where channel_id = ch1 and profile_id = s.p_m1 and role = 'professional';
  if v_n <> 0 then raise exception 'T13_ainda_no_roster'; end if;
  raise notice 'WP-05A1 T13 PASSED';
end $$;
rollback;

-- ── T14: reactivate → volta ao roster ────────────────────────────────────────────────
begin;
do $$
declare
  s record; ch1 uuid := gen_random_uuid(); v_n int;
begin
  select * into s from pg_temp.wp05a1_seed();
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m1);
  perform public.deactivate_patient_link(s.prof_m1, s.pat1, 'sai');
  reset role;
  insert into public.chat_channels (id, patient_id) values (ch1, s.pat1);
  insert into public.chat_participants (channel_id, profile_id, role) values
    (ch1, s.p_pat, 'patient'),
    (ch1, s.p_own, 'professional');
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.reactivate_patient_link(s.prof_m1, s.pat1, 'volta');
  reset role;
  select count(*) into v_n from public.chat_participants
   where channel_id = ch1 and profile_id = s.p_m1 and role = 'professional';
  if v_n <> 1 then raise exception 'T14_nao_voltou_roster'; end if;
  raise notice 'WP-05A1 T14 PASSED';
end $$;
rollback;

-- ── T15: INSERT cru autenticado → negado após hardening ──────────────────────────────
begin;
do $$
declare
  s record; passed boolean := false;
begin
  select * into s from pg_temp.wp05a1_seed();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
    set local role authenticated;
    insert into public.professional_patient_links (professional_id, patient_id, is_external, status)
      values (s.prof_un, s.pat1, false, 'active');
    reset role;
    raise exception 'T15_insert_cru_passou';
  exception
    when raise_exception then raise;
    when others then
      reset role;
      passed := true;
  end;
  if not passed then raise exception 'T15_sem_erro'; end if;
  if has_table_privilege('authenticated','public.professional_patient_links','insert') then
    raise exception 'T15_grant_insert';
  end if;
  if has_table_privilege('authenticated','public.professional_patient_links','delete') then
    raise exception 'T15_grant_delete';
  end if;
  raise notice 'WP-05A1 T15 PASSED';
end $$;
rollback;

-- ── T16: SELECT legítimo continua ────────────────────────────────────────────────────
begin;
do $$
declare
  s record; v_n int;
begin
  select * into s from pg_temp.wp05a1_seed();
  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m1);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.professional_patient_links where patient_id = s.pat1;
  reset role;
  if v_n < 2 then raise exception 'T16_admin_select(%)', v_n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',s.a_m1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.professional_patient_links
   where professional_id = s.prof_m1 and patient_id = s.pat1;
  reset role;
  if v_n <> 1 then raise exception 'T16_membro_select'; end if;

  if not has_table_privilege('authenticated','public.professional_patient_links','select') then
    raise exception 'T16_grant_select';
  end if;
  raise notice 'WP-05A1 T16 PASSED';
end $$;
rollback;

-- ── ISO: atores não envolvidos DEPOIS == ANTES; recém-vinculado só o acesso do modelo
begin;
do $$
declare
  s record; antes_b int; depois_b int; antes_un int; depois_un int;
begin
  select * into s from pg_temp.wp05a1_seed();
  select count(*) into antes_b from public.professional_patient_links where patient_id = s.patB;
  select count(*) into antes_un from public.professional_patient_links where professional_id = s.prof_un;

  perform set_config('request.jwt.claims', json_build_object('sub',s.a_adm,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.assign_patient_professional(s.pat1, s.prof_m3);
  reset role;

  select count(*) into depois_b from public.professional_patient_links where patient_id = s.patB;
  select count(*) into depois_un from public.professional_patient_links where professional_id = s.prof_un;
  if depois_b <> antes_b then raise exception 'ISO_beta_links'; end if;
  if depois_un <> antes_un then raise exception 'ISO_uninvolved'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',s.a_m3,'role','authenticated')::text, true);
  set local role authenticated;
  if not private.is_common_professional_of_patient(s.pat1) then raise exception 'ISO_m3_sem_acesso_alvo'; end if;
  if private.can_access_patient(s.patB) then raise exception 'ISO_m3_ganhou_beta'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',s.a_un,'role','authenticated')::text, true);
  set local role authenticated;
  if private.can_access_patient(s.pat1) then raise exception 'ISO_un_ganhou_alfa'; end if;
  reset role;
  raise notice 'WP-05A1 ISO PASSED';
end $$;
rollback;

do $$ begin raise notice 'WP-05A1: ALL ASSERTIONS PASSED'; end $$;
