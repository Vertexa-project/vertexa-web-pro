-- =====================================================================================
-- WP-DISC-FIX · TESTES Nível 1 (login simulado por request.jwt.claims; ROLLBACK — nada persiste).
-- Assume a migration 20260802090000 aplicada na MESMA transação. Fixtures criadas como `postgres`
-- (bypassrls); toda ação sob teste roda com `set local role authenticated` + claim `sub`.
--
-- PRÉ-REQUISITO do bloco SOLO: a RPC public.create_clinic_with_owner(text) (WP-ONBOARDING,
-- migration 20260801090000, PR #27 — NÃO mergeada e NÃO aplicada). Este branch NÃO a contém.
-- Se ela estiver ausente, o bloco SOLO NÃO é silenciosamente pulado: registra a marca
-- 'SOLO_SKIPPED_NO_PR27' no veredito, para que um skip nunca seja lido como aprovação.
--
-- DESTAQUES: admin atribui e revoga disciplina a SI MESMO; FLUXO COMPLETO DA CLÍNICA SOLO
-- (criar clínica → virar admin → PROVAR o impasse → atribuir a si → cadastrar paciente → salvar
-- plano alimentar); não-admin segue negado (para si e para terceiros); clínica alheia negada; anon
-- negado; regressão do WP-DISC A (admin sem disciplina não escreve; nutricionista ⟂ treino) e
-- policies com contagem e HASH inalterados.
-- =====================================================================================
begin;
do $$
declare
  fails text := '';
  v_cnt int; v_uuid uuid; v_pol_count int; v_pol_hash text;
  -- Baseline de policies do main em 2026-07-23 (a migration só substitui uma FUNÇÃO; nenhuma policy).
  k_pol_count constant int  := 116;
  k_pol_hash  constant text := 'd19d55adae35af55fb2b92db3a2adcc8';

  -- ── Clínica A (equipe: 1 admin + 1 membro) ──
  clA   uuid := gen_random_uuid();
  p_adm uuid := gen_random_uuid(); au_adm uuid := gen_random_uuid(); pr_adm uuid;
  p_mem uuid := gen_random_uuid(); au_mem uuid := gen_random_uuid(); pr_mem uuid;
  -- ── Clínica B (ALHEIA) ──
  clB    uuid := gen_random_uuid();
  p_admB uuid := gen_random_uuid(); au_admB uuid := gen_random_uuid(); pr_admB uuid;
  -- ── Clínica SOLO (nasce da própria RPC de onboarding) ──
  p_solo uuid := gen_random_uuid(); au_solo uuid := gen_random_uuid();
  r jsonb; solo_clinic uuid; solo_prof uuid; solo_patient uuid; solo_plan uuid;
  pat_a uuid;
begin
  -- ═══════════════ FIXTURES ═══════════════
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (p_adm ,au_adm ,'professional','Admin A' ,'active'),
    (p_mem ,au_mem ,'professional','Membro A','active'),
    (p_admB,au_admB,'professional','Admin B' ,'active'),
    (p_solo,au_solo,'patient'     ,'Solo'    ,'pending');   -- pendente: 1º login, igual handle_new_user
  insert into public.clinics (id,name,owner_profile_id) values (clA,'Clinica A',p_adm), (clB,'Clinica B',p_admB);
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_adm ,clA,'other','admin')  returning id into pr_adm;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_mem ,clA,'other','member') returning id into pr_mem;
  insert into public.professionals (profile_id,clinic_id,type,clinic_role) values (p_admB,clB,'other','admin')  returning id into pr_admB;

  -- ═══════════════ POSITIVOS ═══════════════

  -- [P1] ADMIN atribui disciplina a SI MESMO (o que o WP destrava).
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.assign_professional_discipline(pr_adm,'nutricionista');
  reset role;
  select count(*) into v_cnt from public.professional_disciplines where professional_id=pr_adm and discipline='nutricionista';
  if v_cnt<>1 then fails:=fails||'P1_self_assign_missing '; end if;
  select granted_by into v_uuid from public.professional_disciplines where professional_id=pr_adm and discipline='nutricionista';
  if v_uuid is distinct from p_adm then fails:=fails||'P1_granted_by_wrong '; end if;

  -- [P2] ADMIN revoga a disciplina de SI MESMO.
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.revoke_professional_discipline(pr_adm,'nutricionista');
  reset role;
  select count(*) into v_cnt from public.professional_disciplines where professional_id=pr_adm and discipline='nutricionista';
  if v_cnt<>0 then fails:=fails||'P2_self_revoke_failed '; end if;

  -- [P3] ADMIN segue atribuindo a TERCEIROS (comportamento anterior preservado).
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.assign_professional_discipline(pr_mem,'educador_fisico');
  reset role;
  select count(*) into v_cnt from public.professional_disciplines where professional_id=pr_mem and discipline='educador_fisico';
  if v_cnt<>1 then fails:=fails||'P3_assign_third_party_failed '; end if;

  -- ═══════════════ NEGATIVOS ═══════════════

  -- [N1] NÃO-admin tenta atribuir a SI MESMO ⟂
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_mem::text)::text, true); set local role authenticated;
    perform public.assign_professional_discipline(pr_mem,'nutricionista'); reset role;
    fails:=fails||'N1_nonadmin_self_ALLOWED ';
  exception when others then reset role; end;
  select count(*) into v_cnt from public.professional_disciplines where professional_id=pr_mem and discipline='nutricionista';
  if v_cnt<>0 then fails:=fails||'N1_nonadmin_self_persisted '; end if;

  -- [N2] NÃO-admin tenta atribuir a TERCEIROS ⟂
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_mem::text)::text, true); set local role authenticated;
    perform public.assign_professional_discipline(pr_adm,'medico'); reset role;
    fails:=fails||'N2_nonadmin_third_ALLOWED ';
  exception when others then reset role; end;
  select count(*) into v_cnt from public.professional_disciplines where professional_id=pr_adm and discipline='medico';
  if v_cnt<>0 then fails:=fails||'N2_nonadmin_third_persisted '; end if;

  -- [N3] ADMIN da clínica A tenta atribuir a profissional da clínica B (ALHEIA) ⟂
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.assign_professional_discipline(pr_admB,'medico'); reset role;
    fails:=fails||'N3_other_clinic_ALLOWED ';
  exception when others then reset role; end;
  select count(*) into v_cnt from public.professional_disciplines where professional_id=pr_admB;
  if v_cnt<>0 then fails:=fails||'N3_other_clinic_persisted '; end if;

  -- [N4] ANON ⟂ (sem EXECUTE nas duas RPCs)
  begin
    reset role; set local role anon;
    perform public.assign_professional_discipline(pr_adm,'medico'); reset role;
    fails:=fails||'N4_anon_assign_ALLOWED ';
  exception when others then reset role; end;
  begin
    reset role; set local role anon;
    perform public.revoke_professional_discipline(pr_mem,'educador_fisico'); reset role;
    fails:=fails||'N4_anon_revoke_ALLOWED ';
  exception when others then reset role; end;

  -- [N5] REVOKE em clínica ALHEIA ⟂ (o gate de admin da revoke segue intacto — nada foi mexido nela)
  insert into public.professional_disciplines (professional_id,discipline,granted_by) values (pr_admB,'medico',p_admB);
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.revoke_professional_discipline(pr_admB,'medico'); reset role;
    fails:=fails||'N5_revoke_other_clinic_ALLOWED ';
  exception when others then reset role; end;
  select count(*) into v_cnt from public.professional_disciplines where professional_id=pr_admB and discipline='medico';
  if v_cnt<>1 then fails:=fails||'N5_revoke_other_clinic_persisted '; end if;

  -- [N6] Disciplina inexistente ⟂ (validação de entrada preservada)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.assign_professional_discipline(pr_adm,'xpto_inexistente'); reset role;
    fails:=fails||'N6_unknown_discipline_ALLOWED ';
  exception when others then reset role; end;

  -- ═══════════════ REGRESSÃO WP-DISC A (as negações seguem valendo) ═══════════════
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    pat_a := public.create_patient(clA,'Paciente A');
  reset role;

  -- [R1] ADMIN SEM disciplina NÃO escreve clínico (DISC-ADMIN-1 preservado — ele revogou a sua em P2)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.save_nutrition_plan(pat_a,'Plano Sem Disciplina'); reset role;
    fails:=fails||'R1_admin_without_discipline_WROTE ';
  exception when others then reset role; end;

  -- [R2] com a disciplina auto-atribuída, ESCREVE (o destravamento, na clínica com equipe)
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.assign_professional_discipline(pr_adm,'nutricionista');
    perform public.save_nutrition_plan(pat_a,'Plano Com Disciplina');
  reset role;
  select count(*) into v_cnt from public.nutrition_plans where patient_id=pat_a;
  if v_cnt<>1 then fails:=fails||'R2_nutrition_plan_missing '; end if;

  -- [R3] nutricionista ⟂ TREINO (a negação clássica do WP-DISC A continua valendo)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true); set local role authenticated;
    perform public.save_workout_plan(pat_a,'Treino Indevido'); reset role;
    fails:=fails||'R3_nutri_wrote_WORKOUT ';
  exception when others then reset role; end;
  select count(*) into v_cnt from public.workout_plans where patient_id=pat_a;
  if v_cnt<>0 then fails:=fails||'R3_workout_plan_persisted '; end if;

  -- ═══════════════ FLUXO COMPLETO DA CLÍNICA SOLO (o teste que prova o destravamento) ═══════════════
  if to_regprocedure('public.create_clinic_with_owner(text)') is null then
    fails := fails||'SOLO_SKIPPED_NO_PR27 ';   -- nunca silencioso: skip aparece como falha explícita
  else
    -- 1) criar a própria clínica (perfil PENDENTE) …
    perform set_config('request.jwt.claims', json_build_object('sub',au_solo::text)::text, true); set local role authenticated;
      r := public.create_clinic_with_owner('Clinica Solo');
    reset role;
    solo_clinic := (r->>'clinic_id')::uuid; solo_prof := (r->>'professional_id')::uuid;
    if solo_clinic is null or solo_prof is null then fails:=fails||'SOLO_create_clinic_null '; end if;

    -- 2) … virou ADMIN da própria clínica …
    perform set_config('request.jwt.claims', json_build_object('sub',au_solo::text)::text, true); set local role authenticated;
      if not public.am_i_clinic_admin(solo_clinic) then fails:=fails||'SOLO_not_admin '; end if;
      -- 3) … cadastra o paciente (administrativo, não exige disciplina) …
      solo_patient := public.create_patient(solo_clinic,'Paciente Solo');
    reset role;
    if solo_patient is null then fails:=fails||'SOLO_patient_null '; end if;

    -- 4) PROVA DO IMPASSE: sem disciplina, o dono NÃO consegue prescrever (era o beco sem saída).
    begin
      perform set_config('request.jwt.claims', json_build_object('sub',au_solo::text)::text, true); set local role authenticated;
      perform public.save_nutrition_plan(solo_patient,'Plano Antes'); reset role;
      fails:=fails||'SOLO_wrote_WITHOUT_discipline ';
    exception when others then reset role; end;

    -- 5) DESTRAVAMENTO: atribui nutricionista a SI MESMO e prescreve.
    perform set_config('request.jwt.claims', json_build_object('sub',au_solo::text)::text, true); set local role authenticated;
      perform public.assign_professional_discipline(solo_prof,'nutricionista');
      solo_plan := public.save_nutrition_plan(solo_patient,'Plano Alimentar',
        '[{"time":"08:00","name":"Cafe da manha","items":["Ovos","Aveia"],"calories":420}]'::jsonb);
    reset role;
    if solo_plan is null then fails:=fails||'SOLO_plan_null '; end if;
    select count(*) into v_cnt from public.nutrition_plans where patient_id=solo_patient;
    if v_cnt<>1 then fails:=fails||'SOLO_plan_missing '; end if;
    select count(*) into v_cnt from public.meals where nutrition_plan_id=solo_plan;
    if v_cnt<>1 then fails:=fails||'SOLO_meal_missing '; end if;
    select count(*) into v_cnt from public.professional_disciplines where professional_id=solo_prof and discipline='nutricionista';
    if v_cnt<>1 then fails:=fails||'SOLO_discipline_missing '; end if;
  end if;

  -- ═══════════════ REGRESSÃO: policies inalteradas (contagem + HASH) ═══════════════
  select count(*), md5(string_agg(sig,'||' order by sig)) into v_pol_count, v_pol_hash
  from (select schemaname||'.'||tablename||'.'||policyname||'|'||coalesce(cmd,'')||'|'||coalesce(qual,'')
             ||'|'||coalesce(with_check,'')||'|'||coalesce(array_to_string(roles,','),'')||'|'||permissive as sig
        from pg_policies) s;
  if v_pol_count <> k_pol_count then fails:=fails||'REG_pol_count('||v_pol_count||') '; end if;
  if v_pol_hash  <> k_pol_hash  then fails:=fails||'REG_pol_hash('||v_pol_hash||') ';  end if;

  if length(fails)>0 then raise exception 'WP-DISC-FIX TESTS FAILED: %', fails;
  else raise notice 'WP-DISC-FIX: ALL ASSERTIONS PASSED (policies % / %)', v_pol_count, v_pol_hash; end if;
end $$;
rollback;
