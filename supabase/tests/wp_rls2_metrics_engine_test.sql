-- =====================================================================================
-- WP-RLS2 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- (A) PARIDADE: o motor server-side produz o MESMO resultado das fórmulas do app
--     (adherenceEngine.ts / achievementsEngine.ts / recoveryRule.ts) — típico/vazio/borda.
-- (B) LOCKDOWN: paciente NÃO grava as 3 métricas (nem a própria); SELECT preservado; positivo
--     (bruto do paciente ⇒ servidor recalcula ⇒ paciente e prof vinculado leem).
-- Fuso: America/Sao_Paulo (BRT), decisão do dono. Fixtures como postgres (bypassrls); nada persiste.
-- =====================================================================================

-- ───────── (A1) PARIDADE VRI — typical(89), empty(70/inativo), saturated(100/streak14) ─────────
begin;
do $$
declare
  fails text := '';
  acX uuid:='ac000000-0000-0000-0000-000000000001'; daX uuid:='da000000-0000-0000-0000-000000000001';
  acY uuid:='ac000000-0000-0000-0000-000000000002'; daY uuid:='da000000-0000-0000-0000-000000000002';
  planY uuid:='b0000000-0000-0000-0000-000000000002'; mealY uuid:='b1000000-0000-0000-0000-000000000002'; supY uuid:='b2000000-0000-0000-0000-000000000002';
  r record; k int;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','A','active'),
    ('fc000000-0000-0000-0000-000000000001',acX,'patient','X','active'),
    ('fc000000-0000-0000-0000-000000000002',acY,'patient','Y','active');
  insert into public.clinics (id,name,owner_profile_id) values ('ca000000-0000-0000-0000-000000000001','A','fa000000-0000-0000-0000-000000000001');
  insert into public.patients (id,profile_id,clinic_id) values
    (daX,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001'),
    (daY,'fc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001');

  -- TYPICAL: 1 workout hoje + 1 peso hoje => 89/alta/em_acompanhamento/streak1/weekly20
  insert into public.activity_events (patient_id,type,payload,created_at) values (daX,'workout_checked','{}', (private.brt_date(now()) + time '12:00') at time zone 'America/Sao_Paulo');
  insert into public.weight_logs (patient_id,weight_kg,measured_at,source) values (daX,80,(private.brt_date(now()) + time '10:00') at time zone 'America/Sao_Paulo','app');
  perform set_config('request.jwt.claims', json_build_object('sub',acX::text)::text, true); set local role authenticated; perform public.recompute_adherence(); reset role;
  select * into r from public.adherence_snapshots where patient_id=daX order by calculated_at desc limit 1;
  if r.score<>89 or r.level<>'alta' or r.status::text<>'em_acompanhamento' or r.streak<>1 or r.weekly_completion_rate<>20 then fails:=fails||format('TYP=%s/%s/%s/streak%s/wk%s ',r.score,r.level,r.status,r.streak,r.weekly_completion_rate); end if;
  if r.risk_factors<>array['Nenhum hábito registrado hoje','Poucos treinos esta semana','Foto mensal pendente'] then fails:=fails||'TYP_risk '; end if;
  if r.positive_factors<>array['Peso atualizado','Plano acompanhado'] then fails:=fails||'TYP_pos '; end if;

  -- EMPTY: sem dados => 70/moderada/inativo/streak0, risk 5, pos 0
  perform set_config('request.jwt.claims', json_build_object('sub',acY::text)::text, true); set local role authenticated; perform public.recompute_adherence(); reset role;
  select * into r from public.adherence_snapshots where patient_id=daY order by calculated_at desc limit 1;
  if r.score<>70 or r.level<>'moderada' or r.status::text<>'inativo' or r.streak<>0 then fails:=fails||format('EMPTY=%s/%s/%s/streak%s ',r.score,r.level,r.status,r.streak); end if;
  if coalesce(array_length(r.risk_factors,1),0)<>5 or coalesce(array_length(r.positive_factors,1),0)<>0 then fails:=fails||'EMPTY_factors '; end if;

  -- SATURATED: sinal>=75 (14 dias de treino + hábitos/peso/foto/refeição/suplemento/atividade) => 100/alta/streak14
  for k in 0..13 loop insert into public.activity_events (patient_id,type,payload,created_at) values (daX,'workout_checked','{}',(private.brt_date(now()) - k + time '12:00') at time zone 'America/Sao_Paulo'); end loop;
  insert into public.activity_events (patient_id,type,payload,created_at) values
    (daX,'hydration_logged','{}',(private.brt_date(now()) + time '08:00') at time zone 'America/Sao_Paulo'),
    (daX,'hydration_logged','{}',(private.brt_date(now()) + time '09:00') at time zone 'America/Sao_Paulo'),
    (daX,'sleep_logged','{}',(private.brt_date(now()) + time '07:00') at time zone 'America/Sao_Paulo'),
    (daX,'mood_logged','{}',(private.brt_date(now()) + time '07:30') at time zone 'America/Sao_Paulo'),
    (daX,'activity_logged','{}',(private.brt_date(now()) - 0 + time '18:00') at time zone 'America/Sao_Paulo'),
    (daX,'activity_logged','{}',(private.brt_date(now()) - 1 + time '18:00') at time zone 'America/Sao_Paulo'),
    (daX,'activity_logged','{}',(private.brt_date(now()) - 2 + time '18:00') at time zone 'America/Sao_Paulo');
  insert into public.progress_photos (patient_id,photo_url,storage_path,taken_at) values (daX,'x',daX::text||'/a.jpg',now());
  insert into public.nutrition_plans (id,patient_id,title,created_at) values (planY,daX,'P',now());
  insert into public.meals (id,nutrition_plan_id,name,order_index) values (mealY,planY,'M',0);
  insert into public.meal_logs (patient_id,meal_id,consumed_on,consumed_at,source) values (daX,mealY,private.brt_date(now()),now(),'app');
  insert into public.supplements (id,patient_id,name,order_index,created_at) values (supY,daX,'S',0,now());
  insert into public.supplement_intakes (patient_id,supplement_id,taken_on,taken_at,source) values (daX,supY,private.brt_date(now()),now(),'app');
  perform set_config('request.jwt.claims', json_build_object('sub',acX::text)::text, true); set local role authenticated; perform public.recompute_adherence(); reset role;
  select * into r from public.adherence_snapshots where patient_id=daX order by calculated_at desc limit 1;
  if r.score<>100 or r.level<>'alta' or r.streak<>14 then fails:=fails||format('SAT=%s/%s/streak%s ',r.score,r.level,r.streak); end if;

  if length(fails)>0 then raise exception 'VRI PARITY FAIL: %', fails; else raise notice 'WP-RLS2 VRI PARITY: PASS'; end if;
end $$;
rollback;

-- ───────── (A2) PARIDADE CONQUISTAS — empty([]), typical(9), full(12) ─────────
begin;
do $$
declare
  fails text := '';
  acX uuid:='ac000000-0000-0000-0000-000000000001'; daX uuid:='da000000-0000-0000-0000-000000000001';
  acY uuid:='ac000000-0000-0000-0000-000000000002'; daY uuid:='da000000-0000-0000-0000-000000000002';
  acZ uuid:='ac000000-0000-0000-0000-000000000003'; daZ uuid:='da000000-0000-0000-0000-000000000003';
  got text[]; k int;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','A','active'),
    ('fc000000-0000-0000-0000-000000000001',acX,'patient','X','active'),
    ('fc000000-0000-0000-0000-000000000002',acY,'patient','Y','active'),
    ('fc000000-0000-0000-0000-000000000003',acZ,'patient','Z','active');
  insert into public.clinics (id,name,owner_profile_id) values ('ca000000-0000-0000-0000-000000000001','A','fa000000-0000-0000-0000-000000000001');
  insert into public.patients (id,profile_id,clinic_id,start_weight,current_weight,target_weight) values
    (daX,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001',null,null,null),
    (daY,'fc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001',80,74.2,70),
    (daZ,'fc000000-0000-0000-0000-000000000003','ca000000-0000-0000-0000-000000000001',80,70,72);
  -- EMPTY
  perform set_config('request.jwt.claims', json_build_object('sub',acX::text)::text, true); set local role authenticated; perform public.recompute_achievements(); reset role;
  if exists (select 1 from public.patient_achievements where patient_id=daX) then fails:=fails||'EMPTY_not_empty '; end if;
  -- TYPICAL (streak 8, 5.8kg, target não batido, todas as tabelas-valor)
  for k in 0..7 loop insert into public.activity_events (patient_id,type,payload,created_at) values (daY,'workout_checked','{}',(private.brt_date(now()) - k + time '12:00') at time zone 'America/Sao_Paulo'); end loop;
  insert into public.weight_logs (patient_id,weight_kg,measured_at,source) values (daY,74.2,now(),'app');
  insert into public.progress_photos (patient_id,photo_url,storage_path,taken_at) values (daY,'x',daY::text||'/a.jpg',now());
  insert into public.meals (id,nutrition_plan_id,name,order_index) values ('b1000000-0000-0000-0000-0000000000f2',null,'M',0);
  insert into public.meal_logs (patient_id,meal_id,consumed_on,consumed_at,source) values (daY,'b1000000-0000-0000-0000-0000000000f2',private.brt_date(now()),now(),'app');
  insert into public.activity_sessions (patient_id,modality,duration_min,source,performed_at,created_at) values (daY,'run',30,'app',now(),now());
  insert into public.supplements (id,patient_id,name,order_index,created_at) values ('b2000000-0000-0000-0000-0000000000f2',daY,'S',0,now());
  insert into public.supplement_intakes (patient_id,supplement_id,taken_on,taken_at,source) values (daY,'b2000000-0000-0000-0000-0000000000f2',private.brt_date(now()),now(),'app');
  perform set_config('request.jwt.claims', json_build_object('sub',acY::text)::text, true); set local role authenticated; perform public.recompute_achievements(); reset role;
  select array_agg(achievement_code order by achievement_code) into got from public.patient_achievements where patient_id=daY;
  if got<>array['first_activity','first_meal_day','first_photo','first_supplement','first_weight','first_workout','streak_7','weight_3kg','weight_5kg'] then fails:=fails||format('TYP=%L ',got); end if;
  -- FULL (streak 30, 10kg, target batido)
  for k in 0..29 loop insert into public.activity_events (patient_id,type,payload,created_at) values (daZ,'workout_checked','{}',(private.brt_date(now()) - k + time '12:00') at time zone 'America/Sao_Paulo'); end loop;
  insert into public.weight_logs (patient_id,weight_kg,measured_at,source) values (daZ,70,now(),'app');
  insert into public.progress_photos (patient_id,photo_url,storage_path,taken_at) values (daZ,'x',daZ::text||'/a.jpg',now());
  insert into public.meals (id,nutrition_plan_id,name,order_index) values ('b1000000-0000-0000-0000-0000000000f3',null,'M',0);
  insert into public.meal_logs (patient_id,meal_id,consumed_on,consumed_at,source) values (daZ,'b1000000-0000-0000-0000-0000000000f3',private.brt_date(now()),now(),'app');
  insert into public.activity_sessions (patient_id,modality,duration_min,source,performed_at,created_at) values (daZ,'run',30,'app',now(),now());
  insert into public.supplements (id,patient_id,name,order_index,created_at) values ('b2000000-0000-0000-0000-0000000000f3',daZ,'S',0,now());
  insert into public.supplement_intakes (patient_id,supplement_id,taken_on,taken_at,source) values (daZ,'b2000000-0000-0000-0000-0000000000f3',private.brt_date(now()),now(),'app');
  perform set_config('request.jwt.claims', json_build_object('sub',acZ::text)::text, true); set local role authenticated; perform public.recompute_achievements(); reset role;
  if (select count(*) from public.patient_achievements where patient_id=daZ)<>12 then fails:=fails||'FULL_not_12 '; end if;
  if length(fails)>0 then raise exception 'ACHIEVEMENTS PARITY FAIL: %', fails; else raise notice 'WP-RLS2 ACHIEVEMENTS PARITY: PASS'; end if;
end $$;
rollback;

-- ───────── (A3) PARIDADE RECUPERAÇÃO — translate + trigger + decay ─────────
begin;
do $$
declare
  fails text := '';
  daX uuid:='da000000-0000-0000-0000-000000000001'; wk uuid:='c0000000-0000-0000-0000-000000000001';
  got text[]; st public.muscle_status;
begin
  if private.translate_pt_muscle('Peito')<>array['chest'] then fails:=fails||'T_peito '; end if;
  if private.translate_pt_muscle('Deltoide posterior')<>array['shoulders'] then fails:=fails||'T_delt_post '; end if; -- ombro ANTES de posterior
  if private.translate_pt_muscle('Pernas')<>array['quadriceps','hamstrings','glutes','calves'] then fails:=fails||'T_pernas '; end if;
  if private.translate_pt_muscle('xyz')<>array[]::text[] then fails:=fails||'T_unmapped '; end if;
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','A','active'),
    ('fc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','patient','X','active');
  insert into public.clinics (id,name,owner_profile_id) values ('ca000000-0000-0000-0000-000000000001','A','fa000000-0000-0000-0000-000000000001');
  insert into public.patients (id,profile_id,clinic_id) values (daX,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001');
  insert into public.workout_plans (id,patient_id,title) values ('cf000000-0000-0000-0000-000000000001',daX,'P');
  insert into public.workouts (id,workout_plan_id,name) values (wk,'cf000000-0000-0000-0000-000000000001','A');
  insert into public.workout_exercises (workout_id,name,muscle_groups,order_index) values (wk,'Supino',array['Peito','Tríceps'],0),(wk,'Desenvolvimento',array['Deltoide posterior'],1);
  insert into public.activity_events (patient_id,type,payload,created_at) values (daX,'workout_checked',jsonb_build_object('action','completed','workoutId',wk::text),now());
  select array_agg(muscle_group order by muscle_group) into got from public.muscle_recovery_states where patient_id=daX;
  if got<>array['chest','shoulders','triceps'] then fails:=fails||format('TRG=%L ',got); end if;
  if exists (select 1 from public.muscle_recovery_states where patient_id=daX and (status<>'fatigued' or last_intensity<>70)) then fails:=fails||'TRG_state '; end if;
  update public.muscle_recovery_states set last_trained_at=(private.brt_date(now()) - 3 + time '12:00') at time zone 'America/Sao_Paulo' where patient_id=daX and muscle_group='chest';
  perform private.recompute_recovery_decay();
  select status into st from public.muscle_recovery_states where patient_id=daX and muscle_group='chest';
  if st<>'recovering' then fails:=fails||format('DECAY3=%s ',st); end if;
  update public.muscle_recovery_states set last_trained_at=(private.brt_date(now()) - 5 + time '12:00') at time zone 'America/Sao_Paulo' where patient_id=daX and muscle_group='chest';
  perform private.recompute_recovery_decay();
  select status into st from public.muscle_recovery_states where patient_id=daX and muscle_group='chest';
  if st<>'weakened' then fails:=fails||format('DECAY5=%s ',st); end if;
  if length(fails)>0 then raise exception 'RECOVERY PARITY FAIL: %', fails; else raise notice 'WP-RLS2 RECOVERY PARITY: PASS'; end if;
end $$;
rollback;

-- ───────── (B) LOCKDOWN — paciente NÃO grava; SELECT preservado; positivo ─────────
begin;
do $$
declare
  fails text := '';
  fa uuid:='fa000000-0000-0000-0000-000000000001'; aa uuid:='aa000000-0000-0000-0000-000000000001';
  f1 uuid:='f1000000-0000-0000-0000-000000000001'; a1 uuid:='a1000000-0000-0000-0000-000000000001'; e1 uuid:='e1000000-0000-0000-0000-000000000001';
  f2 uuid:='f2000000-0000-0000-0000-000000000001'; a2 uuid:='a2000000-0000-0000-0000-000000000001'; e2 uuid:='e2000000-0000-0000-0000-000000000001';
  acX uuid:='ac000000-0000-0000-0000-000000000001'; daX uuid:='da000000-0000-0000-0000-000000000001';
  acY uuid:='ac000000-0000-0000-0000-000000000002'; daY uuid:='da000000-0000-0000-0000-000000000002';
  wk uuid:='c0000000-0000-0000-0000-000000000001'; n int;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status) values
    (fa,aa,'admin','A','active'),(f1,a1,'professional','P1','active'),(f2,a2,'professional','P2','active'),
    ('fc000000-0000-0000-0000-000000000001',acX,'patient','X','active'),('fc000000-0000-0000-0000-000000000002',acY,'patient','Y','active');
  insert into public.clinics (id,name,owner_profile_id) values ('ca000000-0000-0000-0000-000000000001','A',fa);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (e1,f1,'ca000000-0000-0000-0000-000000000001','doctor','member'),(e2,f2,'ca000000-0000-0000-0000-000000000001','doctor','member');
  insert into public.patients (id,profile_id,clinic_id) values (daX,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001'),(daY,'fc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001');
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (e1,daX,false,'active');
  insert into public.workout_plans (id,patient_id,title) values ('cf000000-0000-0000-0000-000000000001',daX,'P');
  insert into public.workouts (id,workout_plan_id,name) values (wk,'cf000000-0000-0000-0000-000000000001','A');
  insert into public.workout_exercises (workout_id,name,muscle_groups,order_index) values (wk,'Supino',array['Peito'],0);
  insert into public.activity_events (patient_id,type,payload,created_at) values (daX,'workout_checked','{}',now());
  insert into public.weight_logs (patient_id,weight_kg,measured_at,source) values (daX,80,now(),'app');

  perform set_config('request.jwt.claims', json_build_object('sub',acX::text)::text, true); set local role authenticated;
  perform public.recompute_adherence(); perform public.recompute_achievements();
  insert into public.activity_events (patient_id,type,payload,created_at) values (daX,'workout_checked',jsonb_build_object('action','completed','workoutId',wk::text),now());

  begin insert into public.adherence_snapshots (patient_id,score,level,status,streak) values (daX,10,'risco','em_risco',0); fails:=fails||'NEG_ins_adherence '; exception when others then null; end;
  begin insert into public.patient_achievements (patient_id,achievement_code,source) values (daX,'streak_30','forged'); fails:=fails||'NEG_ins_achiev '; exception when others then null; end;
  begin insert into public.muscle_recovery_states (patient_id,muscle_group,status) values (daX,'chest','recovered'); fails:=fails||'NEG_ins_recovery '; exception when others then null; end;
  begin update public.adherence_snapshots set score=100 where patient_id=daX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_upd_adherence '; end if; exception when others then null; end;
  begin update public.muscle_recovery_states set status='recovered' where patient_id=daX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_upd_recovery '; end if; exception when others then null; end;
  begin delete from public.patient_achievements where patient_id=daX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_del_achiev '; end if; exception when others then null; end;

  if (select count(*) from public.adherence_snapshots where patient_id=daX)<1 then fails:=fails||'X_own_adherence_0 '; end if;
  if (select count(*) from public.muscle_recovery_states where patient_id=daX)<1 then fails:=fails||'X_own_recovery_0 '; end if;
  if (select count(*) from public.patient_achievements where patient_id=daX)<1 then fails:=fails||'X_own_achiev_0 '; end if;
  if (select count(*) from public.adherence_snapshots where patient_id=daY)<>0 then fails:=fails||'X_reads_Y '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',a1::text)::text, true);
  if (select count(*) from public.adherence_snapshots where patient_id=daX)<1 then fails:=fails||'P1_adherence_0 '; end if;
  if (select count(*) from public.muscle_recovery_states where patient_id=daX)<1 then fails:=fails||'P1_recovery_0 '; end if;
  if (select count(*) from public.patient_achievements where patient_id=daX)<1 then fails:=fails||'P1_achiev_0 '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',a2::text)::text, true);
  if (select count(*) from public.adherence_snapshots where patient_id=daX)<>0 then fails:=fails||'P2_unlinked_reads '; end if;
  reset role; set local role anon; perform set_config('request.jwt.claims','{}',true);
  if (select count(*) from public.adherence_snapshots where patient_id=daX)<>0 then fails:=fails||'anon_reads '; end if;
  reset role;
  if length(fails)>0 then raise exception 'LOCKDOWN L1 FAIL: %', fails; else raise notice 'WP-RLS2 LOCKDOWN L1: PASS'; end if;
end $$;
rollback;
