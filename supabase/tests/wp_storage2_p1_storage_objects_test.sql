-- =====================================================================================
-- WP-STORAGE · PARTE 1 · TESTES Nível 1 (login simulado via request.jwt.claims; ROLLBACK).
-- storage.objects escopado por path {patient_id}/... nos buckets progress-photos (privado,
-- SELECT espelha Fam2 = externo INCLUÍDO) e patient-documents (externo EXCLUÍDO, Fam5).
-- Fixtures de objeto inseridas como postgres (bypassrls); nada persiste (rollback).
-- =====================================================================================
begin;
do $$
declare fails text := ''; n int;
  daX constant uuid := 'da000000-0000-0000-0000-000000000001';
  daY constant uuid := 'da000000-0000-0000-0000-000000000002';
  e1  constant uuid := 'e1000000-0000-0000-0000-000000000001';
  photoX constant text := 'da000000-0000-0000-0000-000000000001/x-photo.jpg';
  photoY constant text := 'da000000-0000-0000-0000-000000000002/y-photo.jpg';
  docX   constant text := 'da000000-0000-0000-0000-000000000001/x-exam.pdf';
  docY   constant text := 'da000000-0000-0000-0000-000000000002/y-exam.pdf';
begin
  -- ===== FIXTURES (como postgres; bypassrls) =====
  insert into public.profiles (id, auth_user_id, role, full_name, status) values
    ('fa000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','admin','AdminA','active'),
    ('f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','professional','P1','active'),
    ('f2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','professional','P2','active'),
    ('fb000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','admin','AdminB','active'),
    ('f3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','professional','P3','active'),
    ('fe000000-0000-0000-0000-000000000001','ae000000-0000-0000-0000-000000000001','professional','Ext','active'),
    ('fc000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','patient','X','active'),
    ('fc000000-0000-0000-0000-000000000002','ac000000-0000-0000-0000-000000000002','patient','Y','active');
  insert into public.clinics (id, name, owner_profile_id) values
    ('ca000000-0000-0000-0000-000000000001','A','fa000000-0000-0000-0000-000000000001'),
    ('cb000000-0000-0000-0000-000000000001','B','fb000000-0000-0000-0000-000000000001');
  insert into public.professionals (id, profile_id, clinic_id, type, clinic_role) values
    (e1,'f1000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','nutritionist','member'),
    ('e2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','physiotherapist','member'),
    ('e3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','doctor','member'),
    ('ee000000-0000-0000-0000-000000000001','fe000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','personal_trainer','member');
  insert into public.patients (id, profile_id, clinic_id) values
    (daX,'fc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001'),
    (daY,'fc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001');
  insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values
    (e1,daX,false,'active'),('ee000000-0000-0000-0000-000000000001',daX,true,'active');
  insert into storage.objects (bucket_id, name) values
    ('progress-photos', photoX), ('progress-photos', photoY),
    ('patient-documents', docX), ('patient-documents', docY);

  -- Bucket de fotos precisa estar PRIVADO (sem URL pública).
  if (select public from storage.buckets where id='progress-photos') then fails:=fails||'bucket_still_public '; end if;

  execute 'set local role authenticated';

  -- ===== LEITURA =====
  -- Paciente X: vê SÓ o próprio arquivo em cada bucket (demo/mariana invisível).
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from storage.objects where bucket_id='progress-photos')<>1 then fails:=fails||'X_photo_own1 '; end if;
  if (select count(*) from storage.objects where name=photoY)<>0 then fails:=fails||'X_IDOR_photoY '; end if;
  if (select count(*) from storage.objects where bucket_id='patient-documents')<>1 then fails:=fails||'X_doc_own1 '; end if;
  if (select count(*) from storage.objects where name=docY)<>0 then fails:=fails||'X_IDOR_docY '; end if;
  -- P1 (prof comum VINCULADO a X): vê foto e doc de X; nada de Y.
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from storage.objects where name=photoX)<>1 then fails:=fails||'P1_photoX '; end if;
  if (select count(*) from storage.objects where name=docX)<>1 then fails:=fails||'P1_docX '; end if;
  if (select count(*) from storage.objects where name in (photoY,docY))<>0 then fails:=fails||'P1_iso_Y '; end if;
  -- P2 (MESMA clínica, NÃO vinculado): mesma clínica NÃO basta.
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from storage.objects where bucket_id in ('progress-photos','patient-documents'))<>0 then fails:=fails||'P2_unlinked_zero '; end if;
  -- P3 (clínica B): isolamento entre clínicas.
  perform set_config('request.jwt.claims','{"sub":"a3000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from storage.objects where bucket_id in ('progress-photos','patient-documents'))<>0 then fails:=fails||'P3_clinic_iso '; end if;
  -- Externo vinculado a X: foto SIM (espelha Fam2 — decisão reportada); documento NUNCA (AUTH-EXT-1/Fam5).
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from storage.objects where name=photoX)<>1 then fails:=fails||'EXT_photoX_mirror_fam2 '; end if;
  if (select count(*) from storage.objects where bucket_id='patient-documents')<>0 then fails:=fails||'EXT_MUST_NOT_doc '; end if;
  -- AdminA: tudo da clínica A (2+2); demo/mariana (fora do contrato) invisível até p/ admin.
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from storage.objects where bucket_id='progress-photos')<>2 then fails:=fails||'ADMIN_photos2 '; end if;
  if (select count(*) from storage.objects where bucket_id='patient-documents')<>2 then fails:=fails||'ADMIN_docs2 '; end if;
  if (select count(*) from storage.objects where name like 'demo/%')<>0 then fails:=fails||'DEMO_denied '; end if;
  -- AdminB: clínica B não vê nada da A.
  perform set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000001"}',true);
  if (select count(*) from storage.objects where bucket_id in ('progress-photos','patient-documents'))<>0 then fails:=fails||'ADMINB_iso '; end if;

  -- ===== ESCRITA — NEGATIVOS =====
  -- Guard de plataforma: trigger protect_objects_delete (statement-level) bloqueia DELETE via SQL
  -- direto; o Storage API seta storage.allow_delete_query=true internamente. Setamos aqui
  -- (transaction-local) p/ simular o contexto da API — assim os DELETEs (neg e pos) testam a RLS
  -- de verdade (0 linhas vs 1 linha), não o trigger.
  perform set_config('storage.allow_delete_query','true',true);
  -- Paciente X: NÃO grava na pasta de Y (anti-IDOR de INSERT); NÃO sobe documento; NÃO move/apaga foto.
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  begin insert into storage.objects (bucket_id,name) values ('progress-photos', daY::text||'/evil.jpg'); fails:=fails||'NEG_X_insert_other_folder '; exception when others then null; end;
  begin insert into storage.objects (bucket_id,name) values ('patient-documents', daX::text||'/self.pdf'); fails:=fails||'NEG_X_doc_upload '; exception when others then null; end;
  begin update storage.objects set name = daY::text||'/moved.jpg' where name=photoX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_X_move_photo '; end if; exception when others then null; end;
  begin delete from storage.objects where name=photoX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_X_delete_photo '; end if; exception when others then null; end;
  -- P1: NÃO sobe FOTO (só paciente); NÃO move doc p/ pasta de outro paciente.
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  begin insert into storage.objects (bucket_id,name) values ('progress-photos', daX::text||'/byprof.jpg'); fails:=fails||'NEG_P1_photo_upload '; exception when others then null; end;
  begin update storage.objects set name = daY::text||'/moved.pdf' where name=docX; get diagnostics n=row_count; if n>0 then fails:=fails||'NEG_P1_move_doc '; end if; exception when others then null; end;
  -- P2 (não vinculado) e Externo: NÃO sobem documento de X.
  perform set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001"}',true);
  begin insert into storage.objects (bucket_id,name) values ('patient-documents', daX::text||'/p2.pdf'); fails:=fails||'NEG_P2_doc_upload '; exception when others then null; end;
  perform set_config('request.jwt.claims','{"sub":"ae000000-0000-0000-0000-000000000001"}',true);
  begin insert into storage.objects (bucket_id,name) values ('patient-documents', daX::text||'/ext.pdf'); fails:=fails||'NEG_ext_doc_upload '; exception when others then null; end;

  -- ===== ESCRITA — POSITIVOS (por último; contadores acima não são afetados) =====
  -- Paciente X sobe foto na PRÓPRIA pasta.
  perform set_config('request.jwt.claims','{"sub":"ac000000-0000-0000-0000-000000000001"}',true);
  begin insert into storage.objects (bucket_id,name) values ('progress-photos', daX::text||'/nova.jpg'); exception when others then fails:=fails||'POS_X_photo_upload '; end;
  -- P1 sobe e apaga documento de X (delete = limpeza de órfão do web).
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001"}',true);
  begin insert into storage.objects (bucket_id,name) values ('patient-documents', daX::text||'/p1-novo.pdf'); exception when others then fails:=fails||'POS_P1_doc_upload '; end;
  begin delete from storage.objects where name=docX; get diagnostics n=row_count; if n<>1 then fails:=fails||'POS_P1_doc_delete '; end if; exception when others then fails:=fails||'POS_P1_doc_delete_exc '; end;
  -- AdminA sobe documento.
  perform set_config('request.jwt.claims','{"sub":"aa000000-0000-0000-0000-000000000001"}',true);
  begin insert into storage.objects (bucket_id,name) values ('patient-documents', daX::text||'/admin.pdf'); exception when others then fails:=fails||'POS_ADMIN_doc_upload '; end;

  -- ===== ANON: negado em TUDO (leitura e escrita, ambos os buckets) =====
  execute 'reset role'; execute 'set local role anon';
  if (select count(*) from storage.objects where bucket_id in ('progress-photos','patient-documents'))<>0 then fails:=fails||'anon_read_denied '; end if;
  begin insert into storage.objects (bucket_id,name) values ('progress-photos', daX::text||'/anon.jpg'); fails:=fails||'anon_insert_denied '; exception when others then null; end;
  execute 'reset role';

  if length(fails) > 0 then raise exception 'WP-STORAGE-P1 TESTS FAILED: %', fails;
  else raise notice 'WP-STORAGE-P1: ALL ASSERTIONS PASSED'; end if;
end $$;
rollback;
