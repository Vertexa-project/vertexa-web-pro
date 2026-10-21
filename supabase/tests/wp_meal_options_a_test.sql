-- WP-MEALOPT · A — testes (ROLLBACK).
begin;
do $$
declare
  fails text := ''; n int; pid uuid; mid uuid; o jsonb;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid(); eAdm uuid:=gen_random_uuid(); nutri_disc uuid;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values
    (adm,au_adm,'admin','Admin A','active',now()),(p1,au_p1,'patient','Pac Um','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (eAdm,adm,clA,'nutritionist','admin');
  insert into public.patients (id,profile_id,clinic_id) values (t1,p1,clA);
  insert into public.professional_disciplines (professional_id,discipline) values (eAdm,'nutricionista');
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (eAdm,t1,false,'active');
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  pid := public.save_nutrition_plan(t1, 'Plano', '[
    {"time":"09:00","name":"Café","items":["Leite 200 mL"],"calories":325,
     "options":[{"items":["  Pão 2 fatias "," ","Ovos 2"],"calories":330},{"items":[],"calories":999},{"items":["Tapioca 40 g"]}]},
    {"time":"12:00","name":"Almoço","items":["Arroz"],"calories":500}]'::jsonb);
  select id, options into mid, o from public.meals where nutrition_plan_id = pid and name = 'Café';
  if jsonb_array_length(o) <> 2 then fails := fails || 'opts_count(got '||jsonb_array_length(o)||') '; end if;
  if o->0->'items' <> '["Pão 2 fatias","Ovos 2"]'::jsonb then fails := fails || 'opts_trim('||(o->0->'items')::text||') '; end if;
  if (o->0->>'calories')::int <> 330 then fails := fails || 'opts_kcal '; end if;
  if o->1->'calories' <> 'null'::jsonb then fails := fails || 'opts_null_kcal('||(o->1->'calories')::text||') '; end if;
  select count(*) into n from public.meals where nutrition_plan_id = pid and name = 'Almoço' and options = '[]'::jsonb; if n <> 1 then fails := fails || 'no_opts_default '; end if;
  -- limite de 5 alternativas
  begin
    perform public.save_nutrition_plan(t1, 'Plano', '[{"name":"X","items":["a"],"options":[{"items":["1"]},{"items":["2"]},{"items":["3"]},{"items":["4"]},{"items":["5"]},{"items":["6"]}]}]'::jsonb);
    fails := fails || 'limit_not_enforced ';
  exception when others then null; end;
  -- paciente registra a opção usada; 1 e 7 são barrados
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  select id into mid from public.meals where nutrition_plan_id = pid and name = 'Café';
  if mid is null then select m.id into mid from public.meals m join public.nutrition_plans p on p.id=m.nutrition_plan_id where p.patient_id=t1 and m.name='Café'; end if;
  begin
    insert into public.meal_logs (patient_id, meal_id, option_index) values (t1, mid, 2);
  exception when others then fails := fails || 'opt2_blocked('||sqlerrm||') '; end;
  select count(*) into n from public.meal_logs where patient_id=t1 and option_index=2; if n<>1 then fails:=fails||'opt2_saved '; end if;
  begin insert into public.meal_logs (patient_id, meal_id, option_index, consumed_on) values (t1, mid, 1, current_date - 1); fails := fails || 'opt1_accepted '; exception when others then null; end;
  begin insert into public.meal_logs (patient_id, meal_id, option_index, consumed_on) values (t1, mid, 7, current_date - 2); fails := fails || 'opt7_accepted '; exception when others then null; end;
  reset role;
  raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
end $$;
rollback;
