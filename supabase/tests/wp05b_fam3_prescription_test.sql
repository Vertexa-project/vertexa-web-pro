-- =====================================================================================
-- WP-05B · FAMÍLIA 3 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- Um shot: TUDO passa -> silêncio + ROLLBACK limpa; algo falha -> RAISE lista as asserções.
-- Eixo invertido: profissional prescreve, paciente SÓ LÊ. Central: PACIENTE NÃO edita o próprio plano.
-- =====================================================================================
begin;
do $$
declare fails text := ''; n int;
  X constant uuid := 'da000000-0000-0000-0000-000000000001';
  Y constant uuid := 'da000000-0000-0000-0000-000000000002';
  WPX constant uuid := '41000000-0000-0000-0000-000000000001';
  WPY constant uuid := '41000000-0000-0000-0000-000000000002';
  WX constant uuid := '42000000-0000-0000-0000-000000000001';
  NPX constant uuid := '44000000-0000-0000-0000-000000000001';
begin
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
    ('e1000000-0000-0000-0000-000000000001',X,false,'active'),('ee000000-0000-0000-0000-000000000001',X,true,'active');
  insert into public.workout_plans (id, patient_id, professional_id, title) values (WPX,X,'e1000000-0000-0000-0000-000000000001','WPX'),(WPY,Y,'e1000000-0000-0000-0000-000000000001','WPY');
  insert into public.workouts (id, workout_plan_id, name) values (WX,WPX,'A'),('42000000-0000-0000-0000-000000000002',WPY,'A');
  insert into public.workout_exercises (id, workout_id, name) values ('43000000-0000-0000-0000-000000000001',WX,'Supino'),('43000000-0000-0000-0000-000000000002','42000000-0000-0000-0000-000000000002','Supino');
  insert into public.nutrition_plans (id, patient_id, professional_id, title) values (NPX,X,'e1000000-0000-0000-0000-000000000001','NPX'),('44000000-0000-0000-0000-000000000002',Y,'e1000000-0000-0000-0000-000000000001','NPY');
  insert into public.meals (id, nutrition_plan_id, name) values ('45000000-0000-0000-0000-000000000001',NPX,'Cafe'),('45000000-0000-0000-0000-000000000002','44000000-0000-0000-0000-000000000002','Cafe');
  insert into public.supplements (id, patient_id, name) values ('46000000-0000-0000-0000-000000000001',X,'Creatina'),('46000000-0000-0000-0000-000000000002',Y,'Creatina');

  execute 'set local role authenticated';

  -- LEITURA: paciente X lê o SEU plano (6 tabelas), Y invisível
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.workout_plans)<>1 then fails:=fails||'X_wp '; end if;
  if (select count(*) from public.workouts)<>1 then fails:=fails||'X_w '; end if;
  if (select count(*) from public.workout_exercises)<>1 then fails:=fails||'X_we '; end if;
  if (select count(*) from public.nutrition_plans)<>1 then fails:=fails||'X_np '; end if;
  if (select count(*) from public.meals)<>1 then fails:=fails||'X_meal '; end if;
  if (select count(*) from public.supplements)<>1 then fails:=fails||'X_supp '; end if;
  if (select count(*) from public.workout_plans where id=WPY)<>0 then fails:=fails||'X_IDOR_WPY '; end if;
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.workout_plans)<>1 then fails:=fails||'P1_wp '; end if;
  if (select count(*) from public.workout_exercises)<>1 then fails:=fails||'P1_we_viaparent '; end if;
  if (select count(*) from public.meals)<>1 then fails:=fails||'P1_meal_viaparent '; end if;
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.workout_plans)<>0 then fails:=fails||'P2_no_wp '; end if;
  if (select count(*) from public.supplements)<>0 then fails:=fails||'P2_no_supp '; end if;
  perform set_config('request.jwt.claims','{"sub":"a3000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.workout_plans)<>0 then fails:=fails||'P3_no_wp '; end if;
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.workout_plans)<>0 then fails:=fails||'EXT_MUST_NOT_wp '; end if;
  if (select count(*) from public.supplements)<>0 then fails:=fails||'EXT_MUST_NOT_supp '; end if;
  if (select count(*) from public.meals)<>0 then fails:=fails||'EXT_MUST_NOT_meal '; end if;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.workout_plans)<>2 then fails:=fails||'ADMIN_wp2 '; end if;
  if (select count(*) from public.nutrition_plans)<>2 then fails:=fails||'ADMIN_np2 '; end if;

  -- CENTRAL: PACIENTE X NÃO escreve o próprio plano (as 6)
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.workout_plans(patient_id,title) values(X,'hack'); fails:=fails||'PAT_wp_insert '; exception when others then null; end;
  begin insert into public.workouts(workout_plan_id,name) values(WPX,'hack'); fails:=fails||'PAT_w_insert '; exception when others then null; end;
  begin insert into public.workout_exercises(workout_id,name) values(WX,'hack'); fails:=fails||'PAT_we_insert '; exception when others then null; end;
  begin insert into public.nutrition_plans(patient_id,title) values(X,'hack'); fails:=fails||'PAT_np_insert '; exception when others then null; end;
  begin insert into public.meals(nutrition_plan_id,name) values(NPX,'hack'); fails:=fails||'PAT_meal_insert '; exception when others then null; end;
  begin insert into public.supplements(patient_id,name) values(X,'hack'); fails:=fails||'PAT_supp_insert '; exception when others then null; end;
  begin update public.workout_plans set title='hack' where id=WPX; get diagnostics n=row_count; if n>0 then fails:=fails||'PAT_wp_update '; end if; exception when others then null; end;
  begin delete from public.workouts where id=WX; get diagnostics n=row_count; if n>0 then fails:=fails||'PAT_w_delete '; end if; exception when others then null; end;

  -- P1 vinculado PRESCREVE p/ X (positivos nas 6)
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.workout_plans(patient_id,professional_id,title) values(X,'e1000000-0000-0000-0000-000000000001','novo'); exception when others then fails:=fails||'POS_P1_wp '; end;
  begin insert into public.workouts(workout_plan_id,name) values(WPX,'B'); exception when others then fails:=fails||'POS_P1_w '; end;
  begin insert into public.workout_exercises(workout_id,name) values(WX,'Remada'); exception when others then fails:=fails||'POS_P1_we '; end;
  begin insert into public.nutrition_plans(patient_id,professional_id,title) values(X,'e1000000-0000-0000-0000-000000000001','novo'); exception when others then fails:=fails||'POS_P1_np '; end;
  begin insert into public.meals(nutrition_plan_id,name) values(NPX,'Almoco'); exception when others then fails:=fails||'POS_P1_meal '; end;
  begin insert into public.supplements(patient_id,name) values(X,'Whey'); exception when others then fails:=fails||'POS_P1_supp '; end;
  begin insert into public.workout_plans(patient_id,title) values(Y,'x'); fails:=fails||'NEG_P1_prescribe_Y '; exception when others then null; end;
  begin update public.workout_plans set patient_id=Y where id=WPX; get diagnostics n=row_count; if n>0 then fails:=fails||'REWRITE_wp_patientid '; end if; exception when others then null; end;
  begin update public.workouts set workout_plan_id=WPY where id=WX; get diagnostics n=row_count; if n>0 then fails:=fails||'REWRITE_w_planid '; end if; exception when others then null; end;

  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.workout_plans(patient_id,title) values(X,'x'); fails:=fails||'NEG_P2_prescribe_X '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.workout_plans(patient_id,title) values(X,'x'); fails:=fails||'NEG_EXT_prescribe_X '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.supplements(patient_id,name) values(X,'Omega3'); exception when others then fails:=fails||'POS_ADMIN_supp '; end;

  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from public.workout_plans)<>0 or (select count(*) from public.nutrition_plans)<>0
     or (select count(*) from public.supplements)<>0 or (select count(*) from public.meals)<>0
     or (select count(*) from public.workout_exercises)<>0 then fails:=fails||'anon_denied '; end if;

  if length(fails) > 0 then raise exception 'WP05B-FAM3 TESTS FAILED: %', fails;
  else raise notice 'WP05B-FAM3: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
