-- =====================================================================================
-- WP-05B · FAMÍLIA 2 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- Um shot: se TUDO passar, termina em silêncio e o ROLLBACK limpa as fixtures. Se algo falhar,
-- RAISE EXCEPTION lista as asserções quebradas. Fixtures A5 + comportamento (1 linha de X e 1 de Y
-- por tabela) + pais (nutrition_plan/meal, supplement) p/ meal_logs/supplement_intakes.
-- =====================================================================================
begin;
do $$
declare fails text := ''; n int;
  X constant uuid := 'da000000-0000-0000-0000-000000000001';
  Y constant uuid := 'da000000-0000-0000-0000-000000000002';
  WSLX constant uuid := '39000000-0000-0000-0000-000000000001';
  WSLY constant uuid := '39000000-0000-0000-0000-000000000002';
begin
  -- ---------- fixtures ----------
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','AdminA','active'),
    ('f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','professional','P1','active'),
    ('f2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','professional','P2','active'),
    ('fb000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','admin','AdminB','active'),
    ('f3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','professional','P3','active'),
    ('fe000000-0000-0000-0000-000000000001','ae000000-0000-0000-0000-000000000001','professional','Ext','active'),
    ('fc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','patient','X','active'),
    ('fc000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','patient','Y','active');
  insert into public.clinics (id, name, owner_profile_id) values
    ('ca000000-0000-0000-0000-000000000001','A','fa000000-0000-0000-0000-000000000001'),
    ('cb000000-0000-0000-0000-000000000001','B','fb000000-0000-0000-0000-000000000001');
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    ('e1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','nutritionist','member'),
    ('e2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','physiotherapist','member'),
    ('e3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','doctor','member'),
    ('ee000000-0000-0000-0000-000000000001','fe000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','personal_trainer','member');
  insert into public.patients (id, profile_id, clinic_id) values
    (X,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001'),
    (Y,'fc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001');
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    ('e1000000-0000-0000-0000-000000000001',X,false,'active'),
    ('ee000000-0000-0000-0000-000000000001',X,true,'active');
  insert into public.nutrition_plans (id, patient_id, professional_id, title) values
    ('31000000-0000-0000-0000-000000000001',X,'e1000000-0000-0000-0000-000000000001','NX'),
    ('31000000-0000-0000-0000-000000000002',Y,'e1000000-0000-0000-0000-000000000001','NY');
  insert into public.meals (id, nutrition_plan_id, name) values
    ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','MealX'),
    ('32000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002','MealY');
  insert into public.supplements (id, patient_id, name) values
    ('34000000-0000-0000-0000-000000000001',X,'SupX'), ('34000000-0000-0000-0000-000000000002',Y,'SupY');
  insert into public.weight_logs (id, patient_id, weight_kg) values ('36000000-0000-0000-0000-000000000001',X,70),('36000000-0000-0000-0000-000000000002',Y,80);
  insert into public.activity_events (id, patient_id, type) values ('37000000-0000-0000-0000-000000000001',X,'hydration_logged'),('37000000-0000-0000-0000-000000000002',Y,'hydration_logged');
  insert into public.activity_sessions (id, patient_id, modality, duration_min) values ('38000000-0000-0000-0000-000000000001',X,'corrida',30),('38000000-0000-0000-0000-000000000002',Y,'corrida',30);
  insert into public.meal_logs (id, patient_id, meal_id) values ('33000000-0000-0000-0000-000000000001',X,'32000000-0000-0000-0000-000000000001'),('33000000-0000-0000-0000-000000000002',Y,'32000000-0000-0000-0000-000000000002');
  insert into public.supplement_intakes (id, patient_id, supplement_id) values ('35000000-0000-0000-0000-000000000001',X,'34000000-0000-0000-0000-000000000001'),('35000000-0000-0000-0000-000000000002',Y,'34000000-0000-0000-0000-000000000002');
  insert into public.muscle_recovery_states (id, patient_id, muscle_group, status) values ('3c000000-0000-0000-0000-000000000001',X,'chest','recovering'),('3c000000-0000-0000-0000-000000000002',Y,'chest','recovering');
  insert into public.adherence_snapshots (id, patient_id, score, status) values ('3d000000-0000-0000-0000-000000000001',X,88,'em_acompanhamento'),('3d000000-0000-0000-0000-000000000002',Y,50,'atencao');
  insert into public.workout_session_logs (id, patient_id, workout_name) values (WSLX,X,'A'),(WSLY,Y,'A');
  insert into public.workout_set_logs (id, session_log_id, exercise_name, set_index, weight_kg, reps_done) values ('3a000000-0000-0000-0000-000000000001',WSLX,'Supino',1,20,10),('3a000000-0000-0000-0000-000000000002',WSLY,'Supino',1,20,10);
  insert into public.body_assessments (id, patient_id, professional_id, method, weight) values ('3b000000-0000-0000-0000-000000000001',X,'e1000000-0000-0000-0000-000000000001','bio',70),('3b000000-0000-0000-0000-000000000002',Y,'e1000000-0000-0000-0000-000000000001','bio',80);
  insert into public.progress_photos (id, patient_id, photo_url) values ('3e000000-0000-0000-0000-000000000001',X,'x/1.jpg'),('3e000000-0000-0000-0000-000000000002',Y,'y/1.jpg');

  execute 'set local role authenticated';

  -- ===== LEITURA: X isola em TODAS as 11 =====
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.weight_logs)<>1 then fails:=fails||'X_weight_iso '; end if;
  if (select count(*) from public.activity_events)<>1 then fails:=fails||'X_actev_iso '; end if;
  if (select count(*) from public.activity_sessions)<>1 then fails:=fails||'X_actses_iso '; end if;
  if (select count(*) from public.meal_logs)<>1 then fails:=fails||'X_meal_iso '; end if;
  if (select count(*) from public.supplement_intakes)<>1 then fails:=fails||'X_supp_iso '; end if;
  if (select count(*) from public.muscle_recovery_states)<>1 then fails:=fails||'X_muscle_iso '; end if;
  if (select count(*) from public.adherence_snapshots)<>1 then fails:=fails||'X_adh_iso '; end if;
  if (select count(*) from public.workout_session_logs)<>1 then fails:=fails||'X_wsl_iso '; end if;
  if (select count(*) from public.workout_set_logs)<>1 then fails:=fails||'X_wset_iso '; end if;
  if (select count(*) from public.body_assessments)<>1 then fails:=fails||'X_ba_iso '; end if;
  if (select count(*) from public.progress_photos)<>1 then fails:=fails||'X_pp_iso '; end if;
  if (select count(*) from public.weight_logs where id='36000000-0000-0000-0000-000000000002')<>0 then fails:=fails||'X_IDOR_WY '; end if;
  -- P1 vinculado vê X, não Y
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.weight_logs)<>1 then fails:=fails||'P1_sees_X '; end if;
  if (select count(*) from public.workout_set_logs)<>1 then fails:=fails||'P1_wset '; end if;
  if (select count(*) from public.body_assessments)<>1 then fails:=fails||'P1_ba '; end if;
  -- P2 mesma clínica sem vínculo: nada
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.weight_logs)<>0 then fails:=fails||'P2_no_X '; end if;
  if (select count(*) from public.body_assessments)<>0 then fails:=fails||'P2_no_ba '; end if;
  -- P3 clínica B: nada
  perform set_config('request.jwt.claims','{"sub":"a3000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.weight_logs)<>0 then fails:=fails||'P3_no_X '; end if;
  -- Externo: behavioral SIM, body_assessments NÃO
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.weight_logs)<>1 then fails:=fails||'EXT_behavioral '; end if;
  if (select count(*) from public.workout_set_logs)<>1 then fails:=fails||'EXT_workout '; end if;
  if (select count(*) from public.body_assessments)<>0 then fails:=fails||'EXT_MUST_NOT_ba '; end if;
  -- admin vê os 2
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.weight_logs)<>2 then fails:=fails||'ADMIN_both_weight '; end if;
  if (select count(*) from public.body_assessments)<>2 then fails:=fails||'ADMIN_both_ba '; end if;

  -- ===== ESCRITA =====
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.weight_logs(patient_id,weight_kg) values(X,71); exception when others then fails:=fails||'POS_X_weight '; end;
  begin insert into public.activity_events(patient_id,type) values(X,'hydration_logged'); exception when others then fails:=fails||'POS_X_actev '; end;
  begin insert into public.progress_photos(patient_id,photo_url) values(X,'x/2.jpg'); exception when others then fails:=fails||'POS_X_pp '; end;
  begin insert into public.meal_logs(patient_id,meal_id,consumed_on) values(X,'32000000-0000-0000-0000-000000000001', date '2020-01-01'); exception when others then fails:=fails||'POS_X_meal '; end;
  begin insert into public.workout_set_logs(session_log_id,exercise_name,set_index,weight_kg,reps_done) values(WSLX,'Agacho',1,50,8); exception when others then fails:=fails||'POS_X_wset '; end;
  -- FORJA patient_id=Y em todas as tabelas paciente-escritas
  begin insert into public.weight_logs(patient_id,weight_kg) values(Y,99); fails:=fails||'FORGE_weight '; exception when others then null; end;
  begin insert into public.activity_events(patient_id,type) values(Y,'x'); fails:=fails||'FORGE_actev '; exception when others then null; end;
  begin insert into public.activity_sessions(patient_id,modality,duration_min) values(Y,'x',1); fails:=fails||'FORGE_actses '; exception when others then null; end;
  begin insert into public.meal_logs(patient_id,meal_id) values(Y,'32000000-0000-0000-0000-000000000001'); fails:=fails||'FORGE_meal '; exception when others then null; end;
  begin insert into public.supplement_intakes(patient_id,supplement_id) values(Y,'34000000-0000-0000-0000-000000000001'); fails:=fails||'FORGE_supp '; exception when others then null; end;
  begin insert into public.muscle_recovery_states(patient_id,muscle_group,status) values(Y,'back','recovering'); fails:=fails||'FORGE_muscle '; exception when others then null; end;
  begin insert into public.adherence_snapshots(patient_id,score,status) values(Y,10,'em_risco'); fails:=fails||'FORGE_adh '; exception when others then null; end;
  begin insert into public.workout_session_logs(patient_id,workout_name) values(Y,'B'); fails:=fails||'FORGE_wsl '; exception when others then null; end;
  begin insert into public.progress_photos(patient_id,photo_url) values(Y,'z.jpg'); fails:=fails||'FORGE_pp '; exception when others then null; end;
  begin insert into public.workout_set_logs(session_log_id,exercise_name,set_index,weight_kg,reps_done) values(WSLY,'H',1,1,1); fails:=fails||'FORGE_wset_parent '; exception when others then null; end;
  -- reescrever patient_id / update append-only => negado
  begin update public.muscle_recovery_states set patient_id=Y where id='3c000000-0000-0000-0000-000000000001'; get diagnostics n=row_count; if n>0 then fails:=fails||'REWRITE_patientid '; end if; exception when others then null; end;
  begin update public.weight_logs set weight_kg=1 where id='36000000-0000-0000-0000-000000000001'; get diagnostics n=row_count; if n>0 then fails:=fails||'UPDATE_appendonly '; end if; exception when others then null; end;
  -- P1 escreve body_assessment de X (positivo) e de Y (negativo)
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.body_assessments(patient_id,professional_id,method,weight) values(X,'e1000000-0000-0000-0000-000000000001','dexa',69); exception when others then fails:=fails||'POS_P1_ba_X '; end;
  begin insert into public.body_assessments(patient_id,professional_id,method,weight) values(Y,'e1000000-0000-0000-0000-000000000001','dexa',79); fails:=fails||'NEG_P1_ba_Y '; exception when others then null; end;
  -- externo tenta escrever body_assessment => negado
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.body_assessments(patient_id,professional_id,method,weight) values(X,'ee000000-0000-0000-0000-000000000001','x',70); fails:=fails||'NEG_EXT_ba '; exception when others then null; end;

  -- anon nega tudo
  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from public.weight_logs)<>0 or (select count(*) from public.body_assessments)<>0
     or (select count(*) from public.workout_set_logs)<>0 or (select count(*) from public.progress_photos)<>0 then fails:=fails||'anon_denied '; end if;

  if length(fails) > 0 then raise exception 'WP05B-FAM2 TESTS FAILED: %', fails;
  else raise notice 'WP05B-FAM2: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
