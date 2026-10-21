-- WP-STREAK · A2 — testes (ROLLBACK). Seção PLANEJADO roda com a data de início da regra recuada (harness);
-- seção CORTE roda com a data real e só vale enquanto hoje < início.
begin;
do $$
declare
  fails text := ''; n int; pt uuid := gen_random_uuid(); pf uuid := gen_random_uuid(); au uuid := gen_random_uuid();
  adm uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid(); np uuid; wp uuid; m1 uuid; m2 uuid; s1 uuid; s2 uuid;
  today date := private.brt_date(now()); dw int := extract(dow from private.brt_date(now()))::int;
  old_rule boolean := private.planned_rule_start() > date '2001-01-01';
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values (adm,gen_random_uuid(),'admin','Adm','active',now()),(pf,au,'patient','Pac','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm);
  insert into public.patients (id,profile_id,clinic_id) values (pt,pf,clA);

  if old_rule then
    -- CORTE: antes de 22/10 vale "qualquer registro", mesmo com plano e só 1 de 4 feito
    if today < private.planned_rule_start() then
      insert into public.nutrition_plans (id,patient_id,title,created_at) values (gen_random_uuid(),pt,'P',now()-interval '30 days') returning id into np;
      insert into public.meals (nutrition_plan_id,name,order_index) values (np,'a',1),(np,'b',2),(np,'c',3),(np,'d',4);
      insert into public.workout_plans (id,patient_id,title,created_at) values (gen_random_uuid(),pt,'W',now()-interval '30 days') returning id into wp;
      insert into public.workouts (workout_plan_id,name,day_index) values (wp,'A',dw);
      insert into public.supplements (patient_id,name,created_at) values (pt,'s1',now()-interval '30 days'),(pt,'s2',now()-interval '30 days');
      insert into public.activity_events (patient_id,type,created_at) values (pt,'hydration_logged',now());
      n := private.event_streak_brt(pt); if n <> 1 then fails := fails || 'CUT_old_rule_before_start(got '||n||') '; end if;
    end if;
    raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
  end if;

  -- PLANEJADO: plano alimentar de 2 refeições + 2 suplementos = 4 previstas (plano criado há 30 dias)
  insert into public.nutrition_plans (id,patient_id,title,created_at) values (gen_random_uuid(),pt,'P',now()-interval '30 days') returning id into np;
  insert into public.meals (id,nutrition_plan_id,name,order_index) values (gen_random_uuid(),np,'a',1) returning id into m1;
  insert into public.meals (id,nutrition_plan_id,name,order_index) values (gen_random_uuid(),np,'b',2) returning id into m2;
  insert into public.supplements (id,patient_id,name,created_at) values (gen_random_uuid(),pt,'s1',now()-interval '30 days') returning id into s1;
  insert into public.supplements (id,patient_id,name,created_at) values (gen_random_uuid(),pt,'s2',now()-interval '30 days') returning id into s2;

  -- 1 de 4 (25%): não cumpre; só água também não
  insert into public.meal_logs (patient_id,meal_id,consumed_on) values (pt,m1,today);
  insert into public.activity_events (patient_id,type,created_at) values (pt,'hydration_logged',now());
  n := private.event_streak_brt(pt); if n <> 0 then fails := fails || 'P_25pct(got '||n||') '; end if;
  -- 2 de 4 (50%): cumpre (>= metade)
  insert into public.supplement_intakes (patient_id,supplement_id,taken_on) values (pt,s1,today);
  n := private.event_streak_brt(pt); if n <> 1 then fails := fails || 'P_50pct(got '||n||') '; end if;
  -- repetir a mesma refeição não conta duas vezes (distintas)
  delete from public.meal_logs where patient_id = pt; delete from public.supplement_intakes where patient_id = pt;
  insert into public.meal_logs (patient_id,meal_id,consumed_on) values (pt,m1,today);
  n := private.event_streak_brt(pt); if n <> 0 then fails := fails || 'P_one_meal(got '||n||') '; end if;

  -- treino previsto hoje entra na conta: 5 previstas (2 refeições + 2 suplementos + 1 treino); 2 feitas = 40% não cumpre; 3 = 60% cumpre
  insert into public.workout_plans (id,patient_id,title,created_at) values (gen_random_uuid(),pt,'W',now()-interval '30 days') returning id into wp;
  insert into public.workouts (workout_plan_id,name,day_index) values (wp,'A',dw);
  insert into public.meal_logs (patient_id,meal_id,consumed_on) values (pt,m2,today);
  n := private.event_streak_brt(pt); if n <> 0 then fails := fails || 'P_40pct_with_workout(got '||n||') '; end if;
  insert into public.activity_events (patient_id,type,created_at) values (pt,'workout_checked',now());
  n := private.event_streak_brt(pt); if n <> 1 then fails := fails || 'P_60pct_with_workout(got '||n||') '; end if;
  -- treino de OUTRO dia da semana não é previsto hoje: com 2 refeições feitas (2 de 4 = 50%) cumpre
  update public.workouts set day_index = (dw + 1) % 7 where workout_plan_id = wp;
  delete from public.activity_events where patient_id = pt and type = 'workout_checked';
  n := private.event_streak_brt(pt); if n <> 1 then fails := fails || 'P_other_day_workout(got '||n||') '; end if;

  -- plano criado DEPOIS do dia: dia anterior à criação segue a regra antiga (qualquer registro)
  update public.nutrition_plans set created_at = now() where id = np;
  update public.supplements set created_at = now() where patient_id = pt;
  update public.workout_plans set created_at = now() where id = wp;
  delete from public.meal_logs where patient_id = pt;
  delete from public.activity_events where patient_id = pt;
  insert into public.activity_events (patient_id,type,created_at) select pt,'hydration_logged',(today - x)::timestamp + interval '12 hours' from unnest(array[1,2]) x;
  n := private.event_streak_brt(pt); if n <> 2 then fails := fails || 'P_before_plan_old_rule(got '||n||') '; end if;

  -- descanso continua cobrindo o dia previsto não cumprido
  update public.nutrition_plans set created_at = now() - interval '30 days' where id = np;
  update public.supplements set created_at = now() - interval '30 days' where patient_id = pt;
  delete from public.activity_events where patient_id = pt;
  insert into public.rest_days (patient_id, rest_on) values (pt, today);
  insert into public.meal_logs (patient_id,meal_id,consumed_on) values (pt,m1,today - 1),(pt,m2,today - 1);
  n := private.event_streak_brt(pt); if n <> 1 then fails := fails || 'P_rest_covers(got '||n||') '; end if;

  raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
end $$;
rollback;
