-- =====================================================================================
-- WP-05B · FAMÍLIA 5 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- patient_documents (metadado). Documento clínico: externo EXCLUÍDO; paciente NÃO escreve.
-- =====================================================================================
begin;
do $$
declare fails text := ''; n int;
  daX constant uuid := 'da000000-0000-0000-0000-000000000001';
  daY constant uuid := 'da000000-0000-0000-0000-000000000002';
  DX constant uuid := '61000000-0000-0000-0000-000000000001';
  DY constant uuid := '61000000-0000-0000-0000-000000000002';
  e1 constant uuid := 'e1000000-0000-0000-0000-000000000001';
begin
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','AdminA','active'),
    ('f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','professional','P1','active'),
    ('f2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','professional','P2','active'),
    ('fb000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','admin','AdminB','active'),
    ('f3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','professional','P3','active'),
    ('fe000000-0000-0000-0000-000000000001','ae000000-0000-0000-0000-000000000001','professional','Ext','active'),
    ('fc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','patient','X','active'),
    ('fc000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','patient','Y','active');
  insert into public.clinics (id, name, owner_profile_id) values ('ca000000-0000-0000-0000-000000000001','A','fa000000-0000-0000-0000-000000000001'),('cb000000-0000-0000-0000-000000000001','B','fb000000-0000-0000-0000-000000000001');
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    (e1,'f1000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','nutritionist','member'),
    ('e2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','physiotherapist','member'),
    ('e3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','doctor','member'),
    ('ee000000-0000-0000-0000-000000000001','fe000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','personal_trainer','member');
  insert into public.patients (id, profile_id, clinic_id) values (daX,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001'),(daY,'fc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001');
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    (e1,daX,false,'active'),('ee000000-0000-0000-0000-000000000001',daX,true,'active');
  insert into public.patient_documents (id, patient_id, uploaded_by_role, uploaded_by_professional_id, kind, file_path) values
    (DX,daX,'professional',e1,'exam','x/exam.pdf'),(DY,daY,'professional',e1,'exam','y/exam.pdf');

  execute 'set local role authenticated';

  -- LEITURA
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_documents)<>1 then fails:=fails||'X_docs1 '; end if;
  if (select count(*) from public.patient_documents where id=DY)<>0 then fails:=fails||'X_IDOR_DY '; end if;
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_documents)<>1 then fails:=fails||'P1_docs1 '; end if;
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_documents)<>0 then fails:=fails||'P2_no_docs '; end if;
  perform set_config('request.jwt.claims','{"sub":"a3000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_documents)<>0 then fails:=fails||'P3_no_docs '; end if;
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_documents)<>0 then fails:=fails||'EXT_MUST_NOT_docs '; end if;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_documents)<>2 then fails:=fails||'ADMIN_docs2 '; end if;
  perform set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from public.patient_documents)<>0 then fails:=fails||'ADMINB_iso '; end if;

  -- ESCRITA — NEGATIVOS
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.patient_documents(patient_id,uploaded_by_role,kind,file_path) values(daX,'patient','exam','x/self.pdf'); fails:=fails||'NEG_patient_upload '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.patient_documents(patient_id,uploaded_by_role,uploaded_by_professional_id,kind,file_path) values(daX,'professional','e2000000-0000-0000-0000-000000000001','exam','x/p2.pdf'); fails:=fails||'NEG_unlinked_upload '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.patient_documents(patient_id,uploaded_by_role,kind,file_path) values(daX,'professional','exam','x/ext.pdf'); fails:=fails||'NEG_ext_upload '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  begin update public.patient_documents set patient_id=daY where id=DX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_rewrite_patientid '; end if; exception when others then null; end;

  -- ESCRITA — POSITIVOS (por último)
  begin insert into public.patient_documents(patient_id,uploaded_by_role,uploaded_by_professional_id,kind,file_path) values(daX,'professional',e1,'report','x/new.pdf'); exception when others then fails:=fails||'POS_P1_upload '; end;
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  begin insert into public.patient_documents(patient_id,uploaded_by_role,kind,file_path) values(daX,'professional','exam','x/admin.pdf'); exception when others then fails:=fails||'POS_ADMIN_upload '; end;

  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from public.patient_documents)<>0 then fails:=fails||'anon_denied '; end if;

  if length(fails) > 0 then raise exception 'WP05B-FAM5 TESTS FAILED: %', fails;
  else raise notice 'WP05B-FAM5: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
