-- WP-RANK · A — testes (ROLLBACK).
begin;
do $$
declare
  fails text := ''; n int; r record; j int; today date := private.brt_date(now()); old date := private.brt_date(now()) - 40;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid(); eAdm uuid:=gen_random_uuid();
  pa uuid:=gen_random_uuid(); au_a uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid(); au_b uuid:=gen_random_uuid(); pc uuid:=gen_random_uuid(); au_c uuid:=gen_random_uuid(); pd uuid:=gen_random_uuid(); au_d uuid:=gen_random_uuid();
  ta uuid:=gen_random_uuid(); tb uuid:=gen_random_uuid(); tc uuid:=gen_random_uuid(); td uuid:=gen_random_uuid();
  np uuid; m1 uuid; m2 uuid;
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values
    (adm,au_adm,'admin','Admin','active',now()),
    (pa,au_a,'patient','Maria da Silva Souza','active',now()),(pb,au_b,'patient','Joao Pedro','active',now()),
    (pc,au_c,'patient','Carla','active',now()),(pd,au_d,'patient','Outra Clinica Pessoa','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm),(clB,'B',adm);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (eAdm,adm,clA,'nutritionist','admin');
  insert into public.patients (id,profile_id,clinic_id) values (ta,pa,clA),(tb,pb,clA),(tc,pc,clA),(td,pd,clB);
  insert into public.nutrition_plans (id,patient_id,title,created_at) values (gen_random_uuid(),ta,'P',now()-interval '60 days') returning id into np;
  insert into public.meals (id,nutrition_plan_id,name,order_index) values (gen_random_uuid(),np,'a',1) returning id into m1;
  insert into public.meals (id,nutrition_plan_id,name,order_index) values (gen_random_uuid(),np,'b',2) returning id into m2;
  -- A hoje: treino 40 + água 10 + 1 de 2 refeições (15) = 75 ; e um treino há 40 dias (fora da semana e do mês)
  insert into public.activity_events (patient_id,type,created_at) values (ta,'workout_checked',now()),(ta,'hydration_logged',now()),(ta,'workout_checked',(old::timestamp at time zone 'America/Sao_Paulo') + interval '12 hours');
  insert into public.meal_logs (patient_id,meal_id,consumed_on) values (ta,m1,today);
  insert into public.supplements (id,patient_id,name,created_at) values (gen_random_uuid(),ta,'s1',now()-interval '30 days');
  insert into public.supplement_intakes (patient_id,supplement_id,taken_on) select ta,id,today from public.supplements where patient_id=ta;
  -- B hoje: só água 10 + peso "em análise" (NÃO conta) ; C hoje: água 10 (empata com B)
  insert into public.activity_events (patient_id,type,created_at) values (tb,'hydration_logged',now()),(tc,'hydration_logged',now());
  insert into public.weight_logs (patient_id,weight_kg,review_status) values (tb,50,'pending');
  -- D, de outra clínica, também entra no ranking com muitos pontos
  insert into public.activity_events (patient_id,type,created_at) values (td,'workout_checked',now());
  insert into public.ranking_members (patient_id) values (tb),(tc),(td);

  -- A ainda NÃO aceitou: não vê o ranking
  perform set_config('request.jwt.claims', json_build_object('sub',au_a::text)::text, true);
  set local role authenticated;
  begin perform * from public.clinic_ranking('week'); fails:=fails||'not_member_sees '; exception when others then null; end;
  perform public.join_ranking(); perform public.join_ranking();
  select count(*) into n from public.ranking_members where patient_id=ta; if n<>1 then fails:=fails||'join_dup '; end if;
  begin perform * from public.clinic_ranking('year'); fails:=fails||'bad_period '; exception when others then null; end;

  -- semana: A=75 (1º), B e C=10 (2º empatados); D (outra clínica) não aparece
  select count(*) into n from public.clinic_ranking('week'); if n<>3 then fails:=fails||'week_rows(got '||n||') '; end if;
  select * into r from public.clinic_ranking('week') where is_me; 
  if r.points <> 75 then fails:=fails||'points_a(got '||coalesce(r.points,-1)||') '; end if;
  if r.rank_position <> 1 then fails:=fails||'pos_a '; end if;
  if r.initials <> 'MS' then fails:=fails||'initials(got '||r.initials||') '; end if;
  select count(*) into n from public.clinic_ranking('week') where rank_position=2; if n<>2 then fails:=fails||'tie_same_pos(got '||n||') '; end if;
  select count(*) into n from public.clinic_ranking('week') where points=10; if n<>2 then fails:=fails||'pending_weight_counted '; end if;
  select count(*) into n from public.clinic_ranking('week') where initials='JP'; if n<>1 then fails:=fails||'initials_two_words '; end if;
  select count(*) into n from public.clinic_ranking('week') where initials='CA'; if n<>1 then fails:=fails||'initials_one_word '; end if;
  select count(*) into n from public.clinic_ranking('week') where initials='OP'; if n<>0 then fails:=fails||'cross_clinic '; end if;
  -- o mês não inclui o treino de 40 dias atrás
  select points into j from public.clinic_ranking('month') where is_me; if j <> 75 then fails:=fails||'month_old_event(got '||j||') '; end if;
  -- sair remove na hora
  perform public.leave_ranking();
  begin perform * from public.clinic_ranking('week'); fails:=fails||'left_still_sees '; exception when others then null; end;
  reset role;
  select count(*) into n from public.ranking_members where patient_id=ta; if n<>0 then fails:=fails||'leave '; end if;
  -- quem saiu não aparece para os outros
  perform set_config('request.jwt.claims', json_build_object('sub',au_b::text)::text, true);
  set local role authenticated;
  select count(*) into n from public.clinic_ranking('week'); if n<>2 then fails:=fails||'left_listed(got '||n||') '; end if;
  -- escrita direta bloqueada
  begin insert into public.ranking_members (patient_id) values (ta); fails:=fails||'direct_insert '; exception when others then null; end;
  reset role;
  -- equipe (admin) não é paciente: não entra nem vê
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  begin perform public.join_ranking(); fails:=fails||'staff_joins '; exception when others then null; end;
  begin perform * from public.clinic_ranking('week'); fails:=fails||'staff_sees '; exception when others then null; end;
  reset role;
  raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
end $$;
rollback;
