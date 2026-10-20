-- WP-GEST · A — testes (ROLLBACK). Assume 20261025090000 e 20261026090000 aplicadas/concatenadas.
begin;
do $$
declare
  fails text := ''; st text; n int; v jsonb; r record;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid();
  m1 uuid:=gen_random_uuid(); au_m1 uuid:=gen_random_uuid();
  m2 uuid:=gen_random_uuid(); au_m2 uuid:=gen_random_uuid();
  oth uuid:=gen_random_uuid(); au_oth uuid:=gen_random_uuid();
  p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); p3 uuid:=gen_random_uuid(); p4 uuid:=gen_random_uuid(); px uuid:=gen_random_uuid();
  u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid(); u3 uuid:=gen_random_uuid(); u4 uuid:=gen_random_uuid(); ux uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); t3 uuid:=gen_random_uuid(); t4 uuid:=gen_random_uuid(); tx uuid:=gen_random_uuid();
  clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid();
  m3 uuid:=gen_random_uuid(); e3 uuid:=gen_random_uuid(); eAdm uuid:=gen_random_uuid(); e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); eOth uuid:=gen_random_uuid();
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values
    (adm,au_adm,'admin','Admin A','active',now()),(m1,au_m1,'professional','Prof Um','active',now()),(m2,au_m2,'professional','Prof Dois','active',now()),
    (oth,au_oth,'admin','Admin B','active',now()),(m3,gen_random_uuid(),'professional','Prof Inativo','active',now()),
    (p1,u1,'patient','Paciente Um','active',now()),
    (p2,u2,'patient','Paciente Dois','active',now() - interval '40 days'),
    (p3,u3,'patient','Paciente Tres','active',now() - interval '40 days'),
    (p4,u4,'patient','Paciente Quatro','active',now()),
    (px,ux,'patient','Paciente Outra','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm),(clB,'B',oth);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values
    (eAdm,adm,clA,'nutritionist','admin'),(e1,m1,clA,'nutritionist','member'),(e2,m2,clA,'nutritionist','member'),(eOth,oth,clB,'nutritionist','admin');
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role,status) values (e3,m3,clA,'nutritionist','member','inactive');
  insert into public.patients (id,profile_id,clinic_id) values (t1,p1,clA),(t2,p2,clA),(t3,p3,clA),(t4,p4,clA),(tx,px,clB);
  -- e1: t1,t2,t3 ; e2: nenhum ; t4 sem profissional
  insert into public.professional_patient_links (professional_id,patient_id,is_external,status) values (e1,t1,false,'active'),(e1,t2,false,'active'),(e1,t3,false,'active');
  insert into public.activity_events (patient_id,type,payload) values (t1,'meal_logged','{}'::jsonb);
  insert into public.adherence_snapshots (patient_id,score,level,status,streak,weekly_completion_rate,calculated_at) values
    (t1,80,'x','em_acompanhamento',3,80,now()),(t2,10,'x','em_risco',0,20,now()),(t3,40,'x','atencao',0,40,now());

  -- ══ visão geral ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  v := public.clinic_management_overview(clA, 7);
  reset role;
  if (v->>'patients')::int<>4 then fails:=fails||'ov_patients('||(v->>'patients')||') '; end if;
  if (v->>'unassigned')::int<>1 then fails:=fails||'ov_unassigned('||(v->>'unassigned')||') '; end if;
  select * into r from jsonb_to_recordset(v->'professionals') as x(name text, patients int, em_risco int, atencao int, avg_adherence int, idle int) where name='Prof Um';
  if r.patients<>3 or r.em_risco<>1 or r.atencao<>1 or r.avg_adherence<>47 or r.idle<>2 then
    fails:=fails||'ov_prof1('||coalesce(r.patients::text,'?')||'/'||coalesce(r.em_risco::text,'?')||'/'||coalesce(r.atencao::text,'?')||'/'||coalesce(r.avg_adherence::text,'?')||'/'||coalesce(r.idle::text,'?')||') ';
  end if;
  select * into r from jsonb_to_recordset(v->'professionals') as x(name text, patients int, idle int) where name='Prof Dois';
  if r.patients<>0 then fails:=fails||'ov_prof2 '; end if;
  if jsonb_array_length(v->'professionals')<>3 then fails:=fails||'ov_profs_count('||jsonb_array_length(v->'professionals')||') '; end if;
  if jsonb_array_length(v->'new_by_month')<>6 then fails:=fails||'ov_months '; end if;
  if (v->'new_by_month'->5->>'n')::int<>2 then fails:=fails||'ov_month_now('||(v->'new_by_month'->5->>'n')||') '; end if;
  -- parados: t2 e t3 (entraram há 40 dias, sem atividade) com idle ≥ 7; t1 e t4 não
  if jsonb_array_length(v->'stopped')<>2 then fails:=fails||'ov_stopped('||jsonb_array_length(v->'stopped')||') '; end if;
  if (v->'stopped'->0->>'idle_days')::int < 39 then fails:=fails||'ov_stopped_days '; end if;
  if (v->'stopped'->0->'professionals'->>0) is distinct from 'Prof Um' then fails:=fails||'ov_stopped_prof '; end if;
  -- fora da clínica não aparece
  if v::text like '%Outra%' then fails:=fails||'ov_leak '; end if;

  -- membro e admin de outra clínica NÃO veem
  perform set_config('request.jwt.claims', json_build_object('sub',au_m1::text)::text, true);
  set local role authenticated;
  begin perform public.clinic_management_overview(clA); fails:=fails||'member_overview ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'mem_ov_sqlstate('||st||') '; end if; end;
  begin perform * from public.professional_roster(clA, e1); fails:=fails||'member_roster ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'mem_ro_sqlstate('||st||') '; end if; end;
  begin perform public.transfer_patients(e1, e2, null); fails:=fails||'member_transfer ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'mem_tr_sqlstate('||st||') '; end if; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_oth::text)::text, true);
  set local role authenticated;
  begin perform public.clinic_management_overview(clA); fails:=fails||'cross_overview ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'cross_ov_sqlstate('||st||') '; end if; end;
  begin perform public.transfer_patients(e1, e2, null); fails:=fails||'cross_transfer ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'cross_tr_sqlstate('||st||') '; end if; end;
  reset role;

  -- ══ roster ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  select count(*) into n from public.professional_roster(clA, e1); if n<>3 then fails:=fails||'roster(got '||n||') '; end if;
  select count(*) into n from public.professional_roster(clA, e2); if n<>0 then fails:=fails||'roster_empty '; end if;

  -- ══ transferência parcial: t2 (atendido) + t4 (NÃO é do e1) ⇒ moved 1, skipped 1 ══
  v := public.transfer_patients(e1, e2, array[t2, t4], 'Mudança de agenda');
  reset role;
  if (v->>'moved')::int<>1 or (v->>'skipped')::int<>1 then fails:=fails||'tr_partial('||v::text||') '; end if;
  select count(*) into n from public.professional_patient_links where professional_id=e2 and patient_id=t2 and status='active'; if n<>1 then fails:=fails||'tr_new_link '; end if;
  select count(*) into n from public.professional_patient_links where professional_id=e1 and patient_id=t2 and status='inactive' and status_reason='Mudança de agenda'; if n<>1 then fails:=fails||'tr_old_inactive '; end if;
  select count(*) into n from public.professional_patient_links where professional_id=e1 and patient_id in (t1,t3) and status='active'; if n<>2 then fails:=fails||'tr_untouched '; end if;
  select count(*) into n from public.professional_patient_links where patient_id=t4; if n<>0 then fails:=fails||'tr_skipped_got_link '; end if;
  select count(*) into n from public.ppl_status_events where patient_id=t2 and to_status='inactive' and professional_id=e1; if n<>1 then fails:=fails||'tr_trail '; end if;

  -- ══ carteira inteira (null) ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  v := public.transfer_patients(e1, e2, null);
  reset role;
  if (v->>'moved')::int<>2 then fails:=fails||'tr_all('||v::text||') '; end if;
  select count(*) into n from public.professional_patient_links where professional_id=e1 and status='active'; if n<>0 then fails:=fails||'tr_all_old '; end if;
  select count(*) into n from public.professional_patient_links where professional_id=e2 and status='active'; if n<>3 then fails:=fails||'tr_all_new(got '||n||') '; end if;
  -- idempotente: repetir não move nada
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  v := public.transfer_patients(e1, e2, null);
  reset role;
  if (v->>'moved')::int<>0 then fails:=fails||'tr_repeat '; end if;

  -- ══ validações ══
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  begin perform public.transfer_patients(e2, e2, null); fails:=fails||'same_prof ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'22023' then fails:=fails||'same_sqlstate('||st||') '; end if; end;
  begin perform public.transfer_patients(e2, eOth, null); fails:=fails||'to_other_clinic ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'otherclinic_sqlstate('||st||') '; end if; end;
  begin perform public.transfer_patients(e2, e1, array[]::uuid[]); fails:=fails||'empty_list ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'22023' then fails:=fails||'empty_sqlstate('||st||') '; end if; end;
  reset role;
  update public.professionals set status='inactive' where id=e1;
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  begin perform public.transfer_patients(e2, e1, null); fails:=fails||'to_inactive ';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st<>'42501' then fails:=fails||'inactive_sqlstate('||st||') '; end if; end;
  reset role;

  if fails <> '' then raise exception 'WP-GEST-A FAILS: %', fails; end if;
  raise notice 'WP-GEST-A: OK';
end $$;
rollback;
