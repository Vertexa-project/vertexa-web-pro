-- =====================================================================================
-- WP-05B · FAMÍLIA 6 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- Duas chaves: appointments (paciente+admin), campaigns/calendar_* (clínica). Coerência agenda↔calendário.
-- =====================================================================================
begin;
do $$
declare fails text := ''; n int;
  caA constant uuid := 'ca000000-0000-0000-0000-000000000001';
  caB constant uuid := 'cb000000-0000-0000-0000-000000000001';
  e1 constant uuid := 'e1000000-0000-0000-0000-000000000001';
  e2 constant uuid := 'e2000000-0000-0000-0000-000000000001';
  e3 constant uuid := 'e3000000-0000-0000-0000-000000000001';
  daX constant uuid := 'da000000-0000-0000-0000-000000000001';
  daY constant uuid := 'da000000-0000-0000-0000-000000000002';
  AX constant uuid := '71000000-0000-0000-0000-000000000001';
  CONNP1 constant uuid := '73000000-0000-0000-0000-000000000001';
begin
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','AdminA','active'),
    ('f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','professional','P1','active'),
    ('f2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','professional','P2','active'),
    ('fb000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','admin','AdminB','active'),
    ('f3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','professional','P3','active'),
    ('fc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','patient','X','active'),
    ('fc000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','patient','Y','active');
  insert into public.clinics (id, name, owner_profile_id) values (caA,'A','fa000000-0000-0000-0000-000000000001'),(caB,'B','fb000000-0000-0000-0000-000000000001');
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    (e1,'f1000000-0000-0000-0000-000000000001',caA,'nutritionist','member'),
    (e2,'f2000000-0000-0000-0000-000000000001',caA,'physiotherapist','member'),
    (e3,'f3000000-0000-0000-0000-000000000001',caB,'doctor','member');
  insert into public.patients (id, profile_id, clinic_id) values (daX,'fc000000-0000-0000-0000-000000000001',caA),(daY,'fc000000-0000-0000-0000-000000000002',caA);
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values (e1,daX,false,'active');
  insert into public.appointments (id, clinic_id, patient_id, professional_id, title, starts_at) values
    (AX,caA,daX,e1,'C',now()),
    ('71000000-0000-0000-0000-000000000002',caA,null,e1,'Bloco',now()),
    ('71000000-0000-0000-0000-000000000003',caB,null,e3,'BlocoB',now());
  insert into public.campaigns (id, clinic_id, name) values ('72000000-0000-0000-0000-000000000001',caA,'CampA'),('72000000-0000-0000-0000-000000000002',caB,'CampB');
  insert into public.calendar_connections (id, clinic_id, professional_id) values (CONNP1,caA,e1),('73000000-0000-0000-0000-000000000002',caB,e3);
  insert into public.calendar_event_cache (id, connection_id, clinic_id, google_event_id, starts_at, title) values
    ('74000000-0000-0000-0000-000000000001',CONNP1,caA,'g1',now(),'Consulta - X'),
    ('74000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-000000000002',caB,'g2',now(),'Consulta B');
  insert into public.calendar_connection_tokens (connection_id, refresh_token) values (CONNP1,'secret');
  insert into public.calendar_oauth_state (state, clinic_id, expires_at) values ('st1',caA,now()+interval '1 hour');

  execute 'set local role authenticated';

  -- LEITURA
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true); -- P1 (vinculado X, dono ConnP1)
  if (select count(*) from public.appointments)<>2 then fails:=fails||'P1_appt2 '; end if;
  if (select count(*) from public.calendar_connections)<>1 then fails:=fails||'P1_conn1 '; end if;
  if (select count(*) from public.calendar_event_cache)<>1 then fails:=fails||'P1_cache1 '; end if;
  if (select count(*) from public.campaigns)<>1 then fails:=fails||'P1_camp1 '; end if;
  begin select count(*) into n from public.calendar_connection_tokens; if n>0 then fails:=fails||'TOKENS_VISIBLE '; end if; exception when insufficient_privilege then null; end;
  begin select count(*) into n from public.calendar_oauth_state; if n>0 then fails:=fails||'OAUTH_VISIBLE '; end if; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true); -- admin A
  if (select count(*) from public.appointments)<>2 then fails:=fails||'ADMIN_appt2 '; end if;
  if (select count(*) from public.campaigns)<>1 then fails:=fails||'ADMIN_camp1 '; end if;
  if (select count(*) from public.calendar_event_cache)<>1 then fails:=fails||'ADMIN_cache1 '; end if;
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true); -- P2 (não vinculado, não dono)
  if (select count(*) from public.appointments)<>0 then fails:=fails||'P2_NONLINKED_appt0 '; end if; -- mesma clínica não basta
  if (select count(*) from public.calendar_event_cache)<>0 then fails:=fails||'P2_SIDEDOOR_cache0 '; end if; -- porta lateral Google fechada
  if (select count(*) from public.campaigns)<>1 then fails:=fails||'P2_staff_camp1 '; end if;
  if (select count(*) from public.calendar_connections)<>0 then fails:=fails||'P2_no_conn '; end if;
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true); -- paciente X
  if (select count(*) from public.appointments)<>0 then fails:=fails||'PATIENT_no_appt '; end if;
  if (select count(*) from public.campaigns)<>0 then fails:=fails||'PATIENT_no_camp '; end if;
  perform set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000001"}',true); -- admin B (isolamento)
  if (select count(*) from public.appointments where clinic_id=caA)<>0 then fails:=fails||'ADMINB_iso_appt '; end if;
  if (select count(*) from public.campaigns where clinic_id=caA)<>0 then fails:=fails||'ADMINB_iso_camp '; end if;
  perform set_config('request.jwt.claims','{"sub":"a3000000-0000-0000-0000-000000000001"}',true); -- P3 clínica B
  if (select count(*) from public.appointments where clinic_id=caA)<>0 then fails:=fails||'P3_no_clinicA '; end if;

  -- ESCRITA — NEGATIVOS
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.appointments(clinic_id,patient_id,professional_id,title,starts_at) values(caA,daX,e2,'C',now()); fails:=fails||'NEG_P2_create_for_X '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.appointments(clinic_id,patient_id,professional_id,title,starts_at) values(caA,daX,e1,'C',now()); fails:=fails||'NEG_adminB_cross_clinic '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  begin update public.appointments set patient_id=daY where id=AX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_rewrite_patientid '; end if; exception when others then null; end;
  begin update public.appointments set clinic_id=caB where id=AX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_rewrite_clinicid '; end if; exception when others then null; end;
  begin insert into public.campaigns(clinic_id,name) values(caA,'evil'); fails:=fails||'NEG_prof_create_campaign '; exception when others then null; end;

  -- ESCRITA — POSITIVOS
  begin insert into public.appointments(clinic_id,patient_id,professional_id,title,starts_at) values(caA,daX,e1,'nova',now()); exception when others then fails:=fails||'POS_P1_create_appt '; end;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.appointments(clinic_id,patient_id,professional_id,title,starts_at) values(caA,daY,e2,'adm',now()); exception when others then fails:=fails||'POS_ADMIN_create_appt '; end;
  begin insert into public.campaigns(clinic_id,name) values(caA,'nova'); exception when others then fails:=fails||'POS_ADMIN_create_campaign '; end;

  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from public.appointments)<>0 or (select count(*) from public.campaigns)<>0
     or (select count(*) from public.calendar_connections)<>0 or (select count(*) from public.calendar_event_cache)<>0 then fails:=fails||'anon_denied '; end if;

  if length(fails) > 0 then raise exception 'WP05B-FAM6 TESTS FAILED: %', fails;
  else raise notice 'WP05B-FAM6: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
