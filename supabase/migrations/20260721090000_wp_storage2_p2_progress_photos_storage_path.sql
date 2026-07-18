-- =====================================================================================
-- WP-STORAGE (STORAGE-2) · PARTE 2 — storage_path + signed URL (lado BANCO, ADITIVO).
-- Fecha a janela aberta na Parte 1: sob bucket privado, a EXIBIÇÃO de fotos passa a usar
-- createSignedUrl(storage_path). Esta migration só adiciona a COLUNA que carrega o path
-- canônico; a troca de leitura/escrita é código (web display + app upload).
--
-- DECISÃO DO DONO (STORAGE-CONTRACT-1): COLUNA NOVA progress_photos.storage_path (path
--   canônico {patient_id}/{uuid}.ext, o MESMO que a policy da Parte 1 escopa por pasta),
--   CONVIVENDO com photo_url legado. NÃO migra o significado de photo_url; NÃO faz backfill.
--   Leitura robusta aos dois: storage_path presente ⇒ signed URL; senão ⇒ fallback photo_url.
--
-- ADITIVA e reversível. NÃO altera photo_url (segue NOT NULL, legado). NÃO toca policies de
--   storage.objects (a Parte 1 já as fez — esta migration NÃO redefine nada de storage). NÃO
--   afrouxa RLS de tabela alguma.
--
-- COERÊNCIA path↔policy (provada em teste, não assumida): o path gravado pelo app é
--   {patient_id}/{uuid}.ext (patient_id = patients.id do paciente logado = current_patient_id()).
--   A policy storage_progress_photos_insert_self exige storage_object_patient(name) =
--   current_patient_id(); a de SELECT, can_access_patient(storage_object_patient(name)).
--
-- Rollback:
--   alter table public.progress_photos drop column if exists storage_path;
-- =====================================================================================

alter table public.progress_photos
  add column if not exists storage_path text;

comment on column public.progress_photos.storage_path is
  'WP-STORAGE-P2: path canônico do objeto no bucket privado progress-photos '
  '({patient_id}/{uuid}.ext). Fonte da signed URL na exibição. NULL = linha legada '
  '(cai no fallback photo_url). Convive com photo_url (STORAGE-CONTRACT-1).';

insert into public.schema_migration_log (version, filename, description, session)
values ('20260721090000','20260721090000_wp_storage2_p2_progress_photos_storage_path.sql',
  'WP-STORAGE P2 (banco): coluna aditiva progress_photos.storage_path text NULL (path canonico '
  '{patient_id}/{uuid}.ext) para signed URL, convivendo com photo_url legado (STORAGE-CONTRACT-1). '
  'NAO altera photo_url, NAO toca policies de storage.objects, NAO afrouxa RLS. Leitura: '
  'storage_path presente => createSignedUrl; senao => fallback photo_url. Troca de app/web e codigo.',
  'WP-STORAGE-P2')
on conflict (version) do nothing;
