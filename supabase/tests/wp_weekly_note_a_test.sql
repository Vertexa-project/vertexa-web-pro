-- WP-WNOTE · A — testes (ROLLBACK).
begin;
do $$
declare
  fails text := ''; n int; r text; wk date := date_trunc('week', current_date::timestamp)::date; mid date := (date_trunc('week', current_date::timestamp)::date) + 3;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); au_p2 uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid(); admB uuid:=gen_random_uuid(); au_admB uuid:=gen_random_uuid(); eAdm uuid:=gen_random_uuid(); eAdmB uuid:=gen_random_uuid();
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values
    (adm,au_adm,'admin','Admin A','active',now()),(p1,au_p1,'patient','Pac Um','active',now()),(p2,au_p2,'patient','Pac Dois','active',now()),(admB,au_admB,'admin','Admin B','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm),(clB,'B',admB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (eAdm,adm,clA,'nutritionist','admin'),(eAdmB,admB,clB,'nutritionist','admin');
  insert into public.patients (id,profile_id,clinic_id) values (t1,p1,clA),(t2,p2,clB);

  -- equipe grava; a data de qualquer dia da semana vira a segunda; regrava no mesmo lugar
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  perform public.set_weekly_note(t1, mid, '  Semana forte, parabéns!  ');
  select count(*) into n from public.weekly_team_notes where patient_id=t1 and week_start=wk and body='Semana forte, parabéns!'; if n<>1 then fails:=fails||'save_trim_monday '; end if;
  perform public.set_weekly_note(t1, wk, 'Vamos ajustar a carga.');
  select count(*) into n from public.weekly_team_notes where patient_id=t1; if n<>1 then fails:=fails||'upsert_dup(got '||n||') '; end if;
  select body into r from public.weekly_team_notes where patient_id=t1; if r <> 'Vamos ajustar a carga.' then fails:=fails||'upsert_value('||r||') '; end if;
  -- limite de 300
  begin perform public.set_weekly_note(t1, wk, repeat('x', 301)); fails:=fails||'too_long '; exception when others then null; end;
  -- outra clínica não grava
  begin perform public.set_weekly_note(t2, wk, 'invasão'); fails:=fails||'cross_clinic_write '; exception when others then null; end;
  reset role;
  -- paciente lê o seu, não grava, não lê o de outro
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
  select count(*) into n from public.weekly_team_notes where patient_id=t1; if n<>1 then fails:=fails||'patient_read_own(got '||n||') '; end if;
  begin perform public.set_weekly_note(t1, wk, 'eu mesmo'); fails:=fails||'self_write '; exception when others then null; end;
  begin insert into public.weekly_team_notes (patient_id,week_start,body) values (t1, wk - 7, 'direto'); fails:=fails||'direct_insert '; exception when others then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true);
  set local role authenticated;
  select count(*) into n from public.weekly_team_notes where patient_id=t1; if n<>0 then fails:=fails||'patient_read_other(got '||n||') '; end if;
  reset role;
  -- texto vazio apaga (volta ao automático)
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  perform public.set_weekly_note(t1, wk, '   ');
  select count(*) into n from public.weekly_team_notes where patient_id=t1; if n<>0 then fails:=fails||'blank_deletes(got '||n||') '; end if;
  reset role;
  raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
end $$;
rollback;
