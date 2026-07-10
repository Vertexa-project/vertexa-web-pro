-- =====================================================================================
-- WP-05B · FAMÍLIA 5 (Documentos) — RLS REAL de public.patient_documents (SÓ A TABELA)
-- ESCOPO: apenas o METADADO (linha). NÃO altera bucket nem storage.objects — o bucket privado
-- 'patient-documents' (arquivo + signed URL) é WP de Storage DEDICADO, POSTERIOR. Reusa helpers Fam2/Fam3.
--
--  · patient_documents liga DIRETO a patient_id (NOT NULL). Autoria = uploaded_by_role +
--    uploaded_by_professional_id. file_path = caminho do objeto no bucket (NÃO tocado aqui).
--  · SELECT = can_access_patient_internal(patient_id): paciente dono + prof comum vinculado + admin.
--    EXTERNO EXCLUÍDO (documento clínico; consistente com body_assessments/prescrições). Decisão reportada.
--  · INSERT/UPDATE/DELETE = can_prescribe_for_patient(patient_id) (prof comum vinculado OU admin). O
--    PACIENTE NÃO escreve (o app NÃO consome documentos hoje — verificado por grep; sem ramo de paciente).
--  · patient_id e file_path IMUTÁVEIS (col-priv: só kind/title/mime_type/file_size_bytes editáveis) —
--    não move o documento p/ outro paciente nem repontar o metadado a outro arquivo.
-- anon: sem policy => negado. service_role/postgres: bypassrls.
--
-- NOTA DE DEPENDÊNCIA (Storage WP, NÃO resolvido aqui): o bucket 'patient-documents' segue com a policy
--   sprint de storage.objects (sprint_patient_documents_storage_read, bucket-wide) — qualquer authenticated
--   ainda pode ASSINAR uma URL se souber o file_path. Fechar a TABELA reduz a exposição (não dá p/ enumerar
--   os file_path), mas o BUCKET continua aberto até o WP de Storage. A exibição atual do web (signed URL)
--   NÃO quebra (a policy de storage está intacta).
--
-- KILL SWITCH (fail-closed): reverter a tabela a DENY-ALL; NUNCA reabrir anon:
--   do $$ declare r record; begin
--     for r in select policyname from pg_policies where schemaname='public' and tablename='patient_documents'
--     loop execute format('drop policy if exists %I on public.patient_documents', r.policyname); end loop;
--   end $$;
-- Sintoma: profissional não vê/insere exame OU paciente não vê o seu -> corrigir p/ FRENTE; jamais sprint_*.
-- =====================================================================================

drop policy if exists sprint_patient_document_read   on public.patient_documents;
drop policy if exists sprint_patient_document_insert on public.patient_documents;
drop policy if exists patient_documents_select on public.patient_documents;
drop policy if exists patient_documents_write_insert on public.patient_documents;
drop policy if exists patient_documents_write_update on public.patient_documents;
drop policy if exists patient_documents_write_delete on public.patient_documents;
create policy patient_documents_select on public.patient_documents for select to authenticated
  using ( private.can_access_patient_internal(patient_id) );
create policy patient_documents_write_insert on public.patient_documents for insert to authenticated
  with check ( private.can_prescribe_for_patient(patient_id) );
create policy patient_documents_write_update on public.patient_documents for update to authenticated
  using ( private.can_prescribe_for_patient(patient_id) ) with check ( private.can_prescribe_for_patient(patient_id) );
create policy patient_documents_write_delete on public.patient_documents for delete to authenticated
  using ( private.can_prescribe_for_patient(patient_id) );
revoke update on public.patient_documents from authenticated, anon;
grant  update (kind, title, mime_type, file_size_bytes) on public.patient_documents to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260715090000','20260715090000_wp05b_fam5_patient_documents_rls.sql',
  'WP-05B Fam5: RLS real de patient_documents (SO a tabela; bucket NAO tocado). SELECT '
  'can_access_patient_internal (externo excluido); escrita can_prescribe_for_patient (paciente nao escreve). '
  'patient_id/file_path imutaveis. anon negado. Bucket patient-documents = WP de Storage pendente.',
  'WP-05B-FAM5')
on conflict (version) do nothing;
