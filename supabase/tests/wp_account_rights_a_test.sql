-- WP-LGPD · A — testes (ROLLBACK).
begin;
do $$
declare
  fails text := ''; n int; r text; j jsonb; rq uuid;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); au_p2 uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid(); clB uuid:=gen_random_uuid(); admB uuid:=gen_random_uuid(); au_admB uuid:=gen_random_uuid(); eAdm uuid:=gen_random_uuid(); eAdmB uuid:=gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email) values (au_p1, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@x.com');
  insert into public.profiles (id,auth_user_id,role,full_name,email,status,created_at) values
    (adm,au_adm,'admin','Admin A','a@x.com','active',now()),(p1,au_p1,'patient','Pac Um','p1@x.com','active',now()),(p2,au_p2,'patient','Pac Dois','p2@x.com','active',now()),(admB,au_admB,'admin','Admin B','b@x.com','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm),(clB,'B',admB);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (eAdm,adm,clA,'nutritionist','admin'),(eAdmB,admB,clB,'nutritionist','admin');
  insert into public.patients (id,profile_id,clinic_id,birth_date,sex,goal) values (t1,p1,clA,'1990-05-05','F','emagrecer'),(t2,p2,clB,'1991-01-01','M','x');
  insert into public.weight_logs (patient_id, weight_kg) values (t1, 70), (t2, 90);
  insert into public.progress_photos (patient_id, storage_path, taken_at) values (t1, 'x/a.jpg', now());
  insert into public.account_deletion_requests (patient_id, clinic_id) values (t2, clB);

  -- exportar: só o meu; não vaza o do outro
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
  j := public.my_data_export();
  if jsonb_array_length(j->'weight_logs') <> 1 then fails:=fails||'export_own '; end if;
  if (j->'weight_logs'->0->>'weight_kg')::numeric <> 70 then fails:=fails||'export_other_leak '; end if;
  if j->'cadastro'->>'goal' <> 'emagrecer' then fails:=fails||'export_cadastro '; end if;
  -- pedir exclusão: idempotente
  rq := public.request_account_deletion();
  if public.request_account_deletion() <> rq then fails:=fails||'request_not_idempotent '; end if;
  select count(*) into n from public.account_deletion_requests where patient_id=t1 and status='open'; if n<>1 then fails:=fails||'one_open(got '||n||') '; end if;
  -- paciente não executa
  begin perform public.execute_account_deletion(rq); fails:=fails||'patient_executes '; exception when others then null; end;
  -- cancelar e pedir de novo
  if not public.cancel_account_deletion() then fails:=fails||'cancel '; end if;
  if public.cancel_account_deletion() then fails:=fails||'cancel_twice '; end if;
  rq := public.request_account_deletion();
  reset role;
  -- paciente de outra clínica não vê o pedido
  perform set_config('request.jwt.claims', json_build_object('sub',au_p2::text)::text, true);
  set local role authenticated;
  select count(*) into n from public.account_deletion_requests where patient_id=t1; if n<>0 then fails:=fails||'other_patient_sees(got '||n||') '; end if;
  begin perform public.my_data_export(); n:=-1; exception when others then n:=0; end; if n=0 then null; end if;
  reset role;
  -- admin de OUTRA clínica não executa
  perform set_config('request.jwt.claims', json_build_object('sub',au_admB::text)::text, true);
  set local role authenticated;
  begin perform public.execute_account_deletion(rq); fails:=fails||'cross_clinic_exec '; exception when others then null; end;
  reset role;
  -- admin da clínica executa
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  set local role authenticated;
  j := public.execute_account_deletion(rq);
  if jsonb_array_length(j) <> 1 then fails:=fails||'files_returned(got '||jsonb_array_length(j)||') '; end if;
  begin perform public.execute_account_deletion(rq); fails:=fails||'exec_twice '; exception when others then null; end;
  reset role;
  select full_name into r from public.profiles where id=p1; if r <> 'Paciente removido' then fails:=fails||'name_not_anon '; end if;
  select count(*) into n from public.profiles where id=p1 and (email is not null or status <> 'inactive'); if n<>0 then fails:=fails||'email_or_status '; end if;
  select count(*) into n from public.patients where id=t1 and (birth_date is not null or sex is not null or goal is not null); if n<>0 then fails:=fails||'patient_pii '; end if;
  select count(*) into n from public.progress_photos where patient_id=t1; if n<>0 then fails:=fails||'photos_kept '; end if;
  select count(*) into n from public.weight_logs where patient_id=t1; if n<>1 then fails:=fails||'history_lost '; end if;
  select count(*) into n from auth.users where id=au_p1 and banned_until is not null and email like 'removido+%'; if n<>1 then fails:=fails||'login_not_blocked '; end if;
  select count(*) into n from public.account_deletion_requests where patient_id=t2 and status='open'; if n<>1 then fails:=fails||'other_request_changed '; end if;
  select count(*) into n from public.weight_logs where patient_id=t2; if n<>1 then fails:=fails||'other_patient_touched '; end if;
  select count(*) into n from public.profiles where id=p2 and full_name='Pac Dois'; if n<>1 then fails:=fails||'other_profile_touched '; end if;
  raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
end $$;
rollback;
