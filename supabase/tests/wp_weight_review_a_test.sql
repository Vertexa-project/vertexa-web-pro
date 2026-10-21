-- WP-WREV · A — testes (ROLLBACK).
begin;
do $$
declare
  fails text := ''; n int; wid uuid; ok boolean;
  adm uuid:=gen_random_uuid(); au_adm uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); au_p1 uuid:=gen_random_uuid();
  t1 uuid:=gen_random_uuid(); clA uuid:=gen_random_uuid(); eAdm uuid:=gen_random_uuid();
begin
  insert into public.profiles (id,auth_user_id,role,full_name,status,created_at) values
    (adm,au_adm,'admin','Admin A','active',now()),(p1,au_p1,'patient','Pac Um','active',now());
  insert into public.clinics (id,name,owner_profile_id) values (clA,'A',adm);
  insert into public.professionals (id,profile_id,clinic_id,type,clinic_role) values (eAdm,adm,clA,'nutritionist','admin');
  insert into public.patients (id,profile_id,clinic_id) values (t1,p1,clA);
  -- paciente: pending ok; approved direto é barrado
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  set local role authenticated;
  insert into public.weight_logs (patient_id, weight_kg, source, review_status) values (t1, 58.0, 'app', 'pending') returning id into wid;
  begin
    insert into public.weight_logs (patient_id, weight_kg, source, review_status) values (t1, 59.0, 'app', 'approved');
    fails := fails || 'self_approved_insert ';
  exception when others then null; end;
  begin perform public.review_weight_log(wid, 'approved'); fails := fails || 'self_review '; exception when others then null; end;
  -- equipe: aprova -> status + marcador
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  perform public.review_weight_log(wid, 'approved');
  select count(*) into n from public.weight_logs where id=wid and review_status='approved' and reviewed_at is not null; if n<>1 then fails:=fails||'approve_status '; end if;
  select count(*) into n from public.activity_events where patient_id=t1 and type='weight_logged'; if n<>1 then fails:=fails||'approve_marker(got '||n||') '; end if;
  perform public.review_weight_log(wid, 'rejected'); -- já decidido: não muda
  select count(*) into n from public.weight_logs where id=wid and review_status='approved'; if n<>1 then fails:=fails||'decided_changed '; end if;
  select count(*) into n from public.activity_events where patient_id=t1 and type='weight_logged'; if n<>1 then fails:=fails||'marker_dup '; end if;
  -- recusar: sem marcador
  perform set_config('request.jwt.claims', json_build_object('sub',au_p1::text)::text, true);
  insert into public.weight_logs (patient_id, weight_kg, source, review_status) values (t1, 40.0, 'app', 'pending') returning id into wid;
  perform set_config('request.jwt.claims', json_build_object('sub',au_adm::text)::text, true);
  perform public.review_weight_log(wid, 'rejected');
  select count(*) into n from public.weight_logs where id=wid and review_status='rejected'; if n<>1 then fails:=fails||'reject_status '; end if;
  select count(*) into n from public.activity_events where patient_id=t1 and type='weight_logged'; if n<>1 then fails:=fails||'reject_marker '; end if;
  begin perform public.review_weight_log(wid, 'xx'); fails:=fails||'bad_decision '; exception when others then null; end;
  reset role;
  raise exception 'RESULT:%', coalesce(nullif(fails,''),'[]');
end $$;
rollback;
