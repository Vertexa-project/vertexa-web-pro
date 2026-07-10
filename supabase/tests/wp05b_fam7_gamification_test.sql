-- =====================================================================================
-- WP-05B · FAMÍLIA 7 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- 3 modelos: achievements (catálogo read-only client), patient_achievements (dado do paciente, anti-forja),
-- notifications (destinatário; read_at-only). Usa códigos existentes do catálogo (seed da migration).
-- =====================================================================================
begin;
do $$
declare fails text := ''; n int; c1 text; c2 text;
  daX constant uuid := 'da000000-0000-0000-0000-000000000001';
  daY constant uuid := 'da000000-0000-0000-0000-000000000002';
  NX constant uuid := '82000000-0000-0000-0000-000000000001';
  NY constant uuid := '82000000-0000-0000-0000-000000000002';
begin
  select code into c1 from public.achievements order by sort_order limit 1;         -- código do catálogo p/ o seed
  select code into c2 from public.achievements order by sort_order limit 1 offset 1; -- outro código p/ desbloqueio
  if c1 is null or c2 is null then raise exception 'catálogo achievements vazio — seed da migration ausente'; end if;

  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','AdminA','active'),
    ('f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','professional','P1','active'),
    ('f2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','professional','P2','active'),
    ('fe000000-0000-0000-0000-000000000001','ae000000-0000-0000-0000-000000000001','professional','Ext','active'),
    ('fc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','patient','X','active'),
    ('fc000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','patient','Y','active');
  insert into public.clinics (id, name, owner_profile_id) values ('ca000000-0000-0000-0000-000000000001','A','fa000000-0000-0000-0000-000000000001');
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    ('e1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','nutritionist','member'),
    ('e2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','physiotherapist','member'),
    ('ee000000-0000-0000-0000-000000000001','fe000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','personal_trainer','member');
  insert into public.patients (id, profile_id, clinic_id) values (daX,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001'),(daY,'fc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001');
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    ('e1000000-0000-0000-0000-000000000001',daX,false,'active'),('ee000000-0000-0000-0000-000000000001',daX,true,'active');
  insert into public.patient_achievements (id, patient_id, achievement_code) values
    ('81000000-0000-0000-0000-000000000001',daX,c1),('81000000-0000-0000-0000-000000000002',daY,c1);
  insert into public.notifications (id, patient_id, type, title, body) values (NX,daX,'reminder','tX','bX'),(NY,daY,'reminder','tY','bY');

  execute 'set local role authenticated';
  -- LEITURA
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.achievements)<1 then fails:=fails||'X_catalog_readable '; end if;
  if (select count(*) from public.patient_achievements)<>1 then fails:=fails||'X_pa1 '; end if;
  if (select count(*) from public.notifications)<>1 then fails:=fails||'X_notif1 '; end if;
  if (select count(*) from public.notifications where id=NY)<>0 then fails:=fails||'X_IDOR_NY '; end if;
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_achievements)<>1 then fails:=fails||'P1_pa_X '; end if;
  if (select count(*) from public.notifications)<>0 then fails:=fails||'P1_notif0_recipientonly '; end if;
  if (select count(*) from public.achievements)<1 then fails:=fails||'P1_catalog_readable '; end if;
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_achievements)<>0 then fails:=fails||'P2_NONLINKED_pa0 '; end if;
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_achievements)<>0 then fails:=fails||'EXT_MUST_NOT_pa '; end if;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_achievements)<>2 then fails:=fails||'ADMIN_pa2 '; end if;
  if (select count(*) from public.notifications)<>0 then fails:=fails||'ADMIN_notif0_recipientonly '; end if;

  -- ESCRITA — NEGATIVOS
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.achievements(code,title,description,icon,category,sort_order) values('hack_'||c2,'h','d','i','first_step',999); fails:=fails||'NEG_catalog_insert '; exception when others then null; end;
  begin update public.achievements set title='hack' where code=c1; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_catalog_update '; end if; exception when others then null; end;
  begin insert into public.patient_achievements(patient_id,achievement_code) values(daY,c2); fails:=fails||'NEG_FORGE_achievement '; exception when others then null; end;
  begin update public.notifications set read_at=now() where id=NY; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_mark_other_notif '; end if; exception when others then null; end;
  begin update public.notifications set title='hack' where id=NX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_edit_notif_body '; end if; exception when others then null; end;

  -- ESCRITA — POSITIVOS
  begin insert into public.patient_achievements(patient_id,achievement_code) values(daX,c2); exception when others then fails:=fails||'POS_X_unlock_own '; end;
  begin update public.notifications set read_at=now() where id=NX; get diagnostics n=row_count; if n<>1 then fails:=fails||'POS_X_mark_own_notif '; end if; exception when others then fails:=fails||'POS_X_mark_own_notif_err '; end;

  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from public.achievements)<>0 or (select count(*) from public.patient_achievements)<>0
     or (select count(*) from public.notifications)<>0 then fails:=fails||'anon_denied '; end if;

  if length(fails) > 0 then raise exception 'WP05B-FAM7 TESTS FAILED: %', fails;
  else raise notice 'WP05B-FAM7: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
