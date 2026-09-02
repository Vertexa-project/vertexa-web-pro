-- =====================================================================================
-- WP-ONBOARDING · TESTES Nível 1 (login via request.jwt.claims; ROLLBACK). Assume a migration
-- 20260801090000 (public.create_clinic_with_owner) aplicada. Fixtures como postgres (bypassrls);
-- nada persiste.
--
-- DESTAQUES: perfil PENDENTE cria a SUA clínica (dono correto + linha de professionals admin + perfil
-- destravado; reconhecida por am_i_clinic_admin; cadastra paciente e atribui disciplina em seguida);
-- 2ª clínica do mesmo dono RECUSADA (guarda-corpo); DONO vem do servidor (não forjável); anon negado;
-- criar a própria clínica NÃO dá acesso a clínica alheia; nome inválido negado; TRANSACIONAL (sucesso +
-- rollback do subtxn ⇒ clínica+professional+perfil revertem juntos, sem estado parcial). Regressão:
-- promote_to_professional/create_patient/assign_professional_discipline seguem OK; policies inalteradas.
-- =====================================================================================
begin;
do $$
declare
  fails text := ''; v_hint text; r jsonb; v_cnt int;
  v_clinic uuid; v_prof uuid; v_owner uuid; v_name_out text; v_role text; v_status text; v_type text; v_crole text;
  v_patient uuid; v_emp_prof uuid; v_pol_count int; v_pol_hash text; v_pol_hash_before text;
  pn uuid:=gen_random_uuid();  au_pn uuid:=gen_random_uuid();   -- pending user who creates a clinic
  po uuid:=gen_random_uuid();  au_po uuid:=gen_random_uuid();   -- existing owner of another clinic (B)
  clB uuid:=gen_random_uuid();                                  -- the other clinic (owned by po)
  pe uuid:=gen_random_uuid();  au_pe uuid:=gen_random_uuid();   -- pending employee to be promoted
  pnm uuid:=gen_random_uuid(); au_pnm uuid:=gen_random_uuid();  -- fresh user for name-validation
  ptx uuid:=gen_random_uuid(); au_ptx uuid:=gen_random_uuid();  -- fresh user for transactional test
  pf uuid:=gen_random_uuid();  au_pf uuid:=gen_random_uuid();   -- fresh user for forge test
  v_disc text;
begin
  -- baseline do hash de policies (regressão: a migration só ACRESCENTA a função)
  select md5(string_agg(sig,'||' order by sig)) into v_pol_hash_before
  from (select schemaname||'.'||tablename||'.'||policyname||'|'||coalesce(cmd,'')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||coalesce(array_to_string(roles,','),'')||'|'||permissive as sig from pg_policies) s;
  select code into v_disc from public.disciplines order by code limit 1;

  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (pn ,au_pn ,'patient','Novo Dono','pending'),
    (po ,au_po ,'admin'  ,'Dono B'   ,'active'),
    (pe ,au_pe ,'patient','Func Pend','pending'),
    (pnm,au_pnm,'patient','Nome Test','pending'),
    (ptx,au_ptx,'patient','TX Test'  ,'pending'),
    (pf ,au_pf ,'patient','Forja'    ,'pending');
  insert into public.clinics (id,name,owner_profile_id) values (clB,'Clinica B',po);
  if to_regclass('private.clinic_onboarding_policy') is not null then
    insert into private.clinic_onboarding_policy (id, mode, updated_at)
    values (true, 'automatic', clock_timestamp())
    on conflict (id) do update set mode = excluded.mode;
  end if;

  -- ══ POSITIVO: perfil PENDENTE cria a SUA clínica ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_pn::text)::text, true); set local role authenticated;
    r := public.create_clinic_with_owner('Minha Clinica Nova');
  reset role;
  v_clinic := (r->>'clinic_id')::uuid; v_prof := (r->>'professional_id')::uuid;
  if v_clinic is null or v_prof is null then fails:=fails||'P_returns_null '; end if;
  select owner_profile_id, name into v_owner, v_name_out from public.clinics where id=v_clinic;
  if v_owner<>pn then fails:=fails||'P_owner_wrong '; end if;
  if v_name_out<>'Minha Clinica Nova' then fails:=fails||'P_name_wrong '; end if;
  select profile_id, type::text, clinic_role into v_owner, v_type, v_crole from public.professionals where id=v_prof;
  if v_owner<>pn then fails:=fails||'P_prof_profile '; end if;
  if v_type<>'other' then fails:=fails||'P_prof_type('||v_type||') '; end if;
  if v_crole<>'admin' then fails:=fails||'P_prof_role('||v_crole||') '; end if;
  select role::text, status into v_role, v_status from public.profiles where id=pn;
  if v_role<>'professional' then fails:=fails||'P_profile_role('||v_role||') '; end if;
  if v_status<>'active' then fails:=fails||'P_profile_status('||v_status||') '; end if;

  -- ══ POSITIVO: reconhecida como ADMIN por am_i_clinic_admin (posse/clinic_role) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_pn::text)::text, true); set local role authenticated;
    if not public.am_i_clinic_admin(null)     then fails:=fails||'P_not_admin_self '; end if;
    if not public.am_i_clinic_admin(v_clinic) then fails:=fails||'P_not_admin_clinic '; end if;
  reset role;

  -- ══ POSITIVO: cadastra paciente e atribui disciplina à equipe (caminho real) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_pn::text)::text, true); set local role authenticated;
    v_patient := public.create_patient(v_clinic, 'Paciente Um');
  reset role;
  if v_patient is null then fails:=fails||'P_create_patient_null '; end if;
  if v_disc is not null then
    perform set_config('request.jwt.claims', json_build_object('sub',au_pn::text)::text, true); set local role authenticated;
      v_emp_prof := public.promote_to_professional(pe, v_clinic, 'nutritionist', 'member');
      perform public.assign_professional_discipline(v_emp_prof, v_disc);
    reset role;
    select count(*) into v_cnt from public.professional_disciplines where professional_id=v_emp_prof and discipline=v_disc;
    if v_cnt<>1 then fails:=fails||'P_assign_discipline_missing '; end if;
  end if;

  -- ══ NEGATIVO: segunda clínica pelo MESMO dono ⟂ (guarda-corpo) ══
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_pn::text)::text, true); set local role authenticated;
    perform public.create_clinic_with_owner('Segunda Clinica'); reset role;
    fails:=fails||'NEG_second_allowed ';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint; reset role;
    if v_hint<>'ALREADY_OWNS_CLINIC' then fails:=fails||'NEG_second_hint('||coalesce(v_hint,'null')||') '; end if;
  end;
  select count(*) into v_cnt from public.clinics where owner_profile_id=pn;
  if v_cnt<>1 then fails:=fails||'NEG_second_count('||v_cnt||') '; end if;

  -- ══ NEGATIVO: dono NÃO forjável — assinatura só tem p_name; owner = SEMPRE o chamador ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_pf::text)::text, true); set local role authenticated;
    r := public.create_clinic_with_owner('Clinica Forja');
  reset role;
  select owner_profile_id into v_owner from public.clinics where id=(r->>'clinic_id')::uuid;
  if v_owner<>pf then fails:=fails||'NEG_forge_owner_mismatch '; end if;

  -- ══ NEGATIVO: anon ⟂ executar a RPC ══
  begin
    reset role; set local role anon;
    perform public.create_clinic_with_owner('Clinica Anon'); reset role;
    fails:=fails||'NEG_anon_allowed ';
  exception when others then reset role; end;

  -- ══ NEGATIVO: criar a própria clínica NÃO dá acesso a clínica ALHEIA ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_po::text)::text, true); set local role authenticated;
    perform public.create_patient(clB, 'Paciente B');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_pn::text)::text, true); set local role authenticated;
    select count(*) into v_cnt from public.clinics  where id=clB;        if v_cnt<>0 then fails:=fails||'NEG_sees_other_clinic '; end if;
    select count(*) into v_cnt from public.patients where clinic_id=clB;  if v_cnt<>0 then fails:=fails||'NEG_sees_other_patients '; end if;
    if public.am_i_clinic_admin(clB) then fails:=fails||'NEG_admin_of_other '; end if;
  reset role;

  -- ══ NEGATIVO: nome vazio/whitespace/curto/longo ⟂ (usuário fresco pnm p/ evitar guarda-corpo) ══
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_pnm::text)::text, true); set local role authenticated;
    perform public.create_clinic_with_owner(''); reset role; fails:=fails||'NEG_empty_allowed ';
  exception when others then get stacked diagnostics v_hint=pg_exception_hint; reset role;
    if v_hint<>'NAME_REQUIRED' then fails:=fails||'NEG_empty_hint('||coalesce(v_hint,'null')||') '; end if; end;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_pnm::text)::text, true); set local role authenticated;
    perform public.create_clinic_with_owner('   '); reset role; fails:=fails||'NEG_ws_allowed ';
  exception when others then get stacked diagnostics v_hint=pg_exception_hint; reset role;
    if v_hint<>'NAME_REQUIRED' then fails:=fails||'NEG_ws_hint('||coalesce(v_hint,'null')||') '; end if; end;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_pnm::text)::text, true); set local role authenticated;
    perform public.create_clinic_with_owner('a'); reset role; fails:=fails||'NEG_short_allowed ';
  exception when others then get stacked diagnostics v_hint=pg_exception_hint; reset role;
    if v_hint<>'NAME_TOO_SHORT' then fails:=fails||'NEG_short_hint('||coalesce(v_hint,'null')||') '; end if; end;
  begin perform set_config('request.jwt.claims', json_build_object('sub',au_pnm::text)::text, true); set local role authenticated;
    perform public.create_clinic_with_owner(repeat('x',121)); reset role; fails:=fails||'NEG_long_allowed ';
  exception when others then get stacked diagnostics v_hint=pg_exception_hint; reset role;
    if v_hint<>'NAME_TOO_LONG' then fails:=fails||'NEG_long_hint('||coalesce(v_hint,'null')||') '; end if; end;
  select role::text, status into v_role, v_status from public.profiles where id=pnm;
  if v_role<>'patient' or v_status<>'pending' then fails:=fails||'NEG_name_profile_changed '; end if;
  select count(*) into v_cnt from public.clinics where owner_profile_id=pnm; if v_cnt<>0 then fails:=fails||'NEG_name_clinic '; end if;
  select count(*) into v_cnt from public.professionals where profile_id=pnm; if v_cnt<>0 then fails:=fails||'NEG_name_prof '; end if;

  -- ══ TRANSACIONAL: sucesso + rollback do subtxn ⇒ os 3 writes revertem JUNTOS (nada parcial) ══
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_ptx::text)::text, true); set local role authenticated;
    perform public.create_clinic_with_owner('Clinica TX'); reset role;
    raise exception 'force_rollback_tx';
  exception when others then reset role; end;
  select count(*) into v_cnt from public.clinics where owner_profile_id=ptx; if v_cnt<>0 then fails:=fails||'TX_clinic_persisted '; end if;
  select count(*) into v_cnt from public.professionals where profile_id=ptx; if v_cnt<>0 then fails:=fails||'TX_prof_persisted '; end if;
  select role::text, status into v_role, v_status from public.profiles where id=ptx;
  if v_role<>'patient' or v_status<>'pending' then fails:=fails||'TX_profile_changed '; end if;

  -- ══ REGRESSÃO: policies inalteradas (contagem + HASH idênticos ao baseline) ══
  select count(*), md5(string_agg(sig,'||' order by sig)) into v_pol_count, v_pol_hash
  from (select schemaname||'.'||tablename||'.'||policyname||'|'||coalesce(cmd,'')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||coalesce(array_to_string(roles,','),'')||'|'||permissive as sig from pg_policies) s;
  if v_pol_hash<>v_pol_hash_before then fails:=fails||'REG_pol_hash_changed '; end if;

  if length(fails)>0 then raise exception 'WP-ONBOARDING TESTS FAILED: %', fails;
  else raise notice 'WP-ONBOARDING: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
