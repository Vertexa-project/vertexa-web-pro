-- =====================================================================================
-- WP-STORAGE (STORAGE-2) · PARTE 1 — Fechar o ARQUIVO FÍSICO: buckets privados + RLS de
-- storage.objects escopada por PATH. As TABELAS (progress_photos Fam2, patient_documents Fam5)
-- já estão fechadas; isto fecha o que faltava: o binário.
--
-- CONTRATO DE PATH (canonizado; já é o padrão dos DOIS writers — app photos.ts, web documents.ts):
--   progress-photos/{patient_id}/{arquivo}   e   patient-documents/{patient_id}/{arquivo}
--   A 1ª pasta É o patient_id. A extração usa private.storage_object_patient(name): parser
--   NULL-safe (exige pasta + uuid válido; senão NULL => todo helper retorna false => DENY).
--   Isso evita cast error em objetos fora do padrão (ex.: legado 'demo/mariana/*.png', que fica
--   INACESSÍVEL por design; remoção via Storage API = pendência, sem dado real).
--
-- MODELO (espelha as tabelas já consolidadas — coerência metadado ⇄ arquivo):
--  · progress-photos (bucket vira PRIVADO: public=false — sem URL pública):
--      SELECT = can_access_patient(patient_id do path)  — paciente dono + prof vinculado + admin
--        + EXTERNO INCLUÍDO: espelha a RLS da TABELA progress_photos (Fam2, behavioral self-log,
--        SELECT can_access_patient). Divergir aqui deixaria o externo vendo a LINHA sem o ARQUIVO.
--        DECISÃO REPORTADA — se o dono reclassificar foto corporal como clínico (AUTH-EXT-1),
--        trocar p/ can_access_patient_internal AQUI E NA TABELA (Fam2), nunca só num lado.
--      INSERT = paciente na PRÓPRIA pasta (storage_object_patient(name) = current_patient_id()).
--        Só o app/paciente sobe foto hoje (verificado por grep; upsert:false). Prof NÃO sobe.
--      UPDATE/DELETE = SEM policy (negado). Tabela também não permite (Fam2); não há fluxo de
--        remoção/substituição de foto — não abrir ramo inexistente. (Upsert exigiria INSERT+
--        SELECT+UPDATE; o contrato usa upsert:false.)
--  · patient-documents (já privado; fecha a policy bucket-wide):
--      SELECT = can_access_patient_internal(patient_id do path) — paciente dono + prof comum
--        vinculado + admin; EXTERNO EXCLUÍDO (AUTH-EXT-1; espelha a tabela Fam5). É o SELECT que
--        habilita createSignedUrl — assinar URL passa a exigir vínculo real.
--      INSERT/DELETE = can_prescribe_for_patient (prof comum vinculado OU admin; espelha Fam5).
--        DELETE habilita a limpeza de órfão do web (documents.ts remove([path]) best-effort).
--        Paciente NÃO sobe documento hoje (app não consome) — ramo não aberto.
--      UPDATE = SEM policy (negado): sem upsert/move; mover objeto de pasta seria UPDATE de name.
--  · anon: NENHUMA policy (as sprint_* davam INSERT/SELECT a anon — eliminadas) + bucket privado.
--  · service_role/postgres: bypassrls (Edge/observability) — intocado.
--
-- SUBSTITUI as 3 policies sprint bucket-wide de storage.objects:
--   sprint_progress_photos_write (INSERT anon+auth, bucket-wide)
--   sprint_patient_documents_storage_read (SELECT anon+auth, bucket-wide — era o que deixava
--     qualquer authenticated ASSINAR url de qualquer exame sabendo o path)
--   sprint_patient_documents_storage_write (INSERT anon+auth, bucket-wide)
--
-- JANELA CONHECIDA (por design, sem dado real): entre a Parte 1 e a Parte 2, a EXIBIÇÃO de fotos
--   de evolução quebra — o app grava/lê URL PÚBLICA (progress_photos.photo_url) e o bucket agora
--   é privado. A Parte 2 (cross-repo) migra app+web p/ path relativo + createSignedUrl.
--
-- KILL SWITCH (fail-closed) — emergência = DENY-ALL em storage.objects; NUNCA reabrir anon,
-- NUNCA voltar public=true (reabriria toda foto por URL), JAMAIS recriar sprint_*:
--   do $$ declare r record; begin
--     for r in select policyname from pg_policies where schemaname='storage' and tablename='objects'
--     loop execute format('drop policy if exists %I on storage.objects', r.policyname); end loop;
--   end $$;
-- Sintoma: app/web parou de subir/exibir o legítimo -> corrigir a policy p/ FRENTE.
-- =====================================================================================

-- Parser NULL-safe do contrato de path: 1ª pasta = patient_id (uuid) ou NULL (deny).
-- Puro (sem tabela): INVOKER/immutable; exige pasta ('%/%') — objeto flat não conta como pasta.
create or replace function private.storage_object_patient(p_name text)
returns uuid
language sql
immutable
set search_path to ''
as $$
  select case
    when p_name like '%/%'
     and split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;
revoke execute on function private.storage_object_patient(text) from public;
grant execute on function private.storage_object_patient(text) to authenticated;

-- Bucket de fotos vira PRIVADO (fim da URL pública).
update storage.buckets set public = false where id = 'progress-photos';

-- Novas policies (escopadas por bucket + comando + path).
drop policy if exists storage_progress_photos_select      on storage.objects;
drop policy if exists storage_progress_photos_insert_self on storage.objects;
drop policy if exists storage_patient_documents_select    on storage.objects;
drop policy if exists storage_patient_documents_insert    on storage.objects;
drop policy if exists storage_patient_documents_delete    on storage.objects;

create policy storage_progress_photos_select on storage.objects for select to authenticated
  using ( bucket_id = 'progress-photos'
          and private.can_access_patient(private.storage_object_patient(name)) );
create policy storage_progress_photos_insert_self on storage.objects for insert to authenticated
  with check ( bucket_id = 'progress-photos'
               and private.storage_object_patient(name) = private.current_patient_id() );

create policy storage_patient_documents_select on storage.objects for select to authenticated
  using ( bucket_id = 'patient-documents'
          and private.can_access_patient_internal(private.storage_object_patient(name)) );
create policy storage_patient_documents_insert on storage.objects for insert to authenticated
  with check ( bucket_id = 'patient-documents'
               and private.can_prescribe_for_patient(private.storage_object_patient(name)) );
create policy storage_patient_documents_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'patient-documents'
          and private.can_prescribe_for_patient(private.storage_object_patient(name)) );

-- Só depois das novas existirem: eliminar as bucket-wide da sprint (incluíam ANON).
drop policy if exists sprint_progress_photos_write            on storage.objects;
drop policy if exists sprint_patient_documents_storage_read   on storage.objects;
drop policy if exists sprint_patient_documents_storage_write  on storage.objects;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260720090000','20260720090000_wp_storage2_p1_storage_objects_rls.sql',
  'WP-STORAGE P1: progress-photos vira privado (public=false); RLS de storage.objects escopada por '
  'path {patient_id}/... via private.storage_object_patient (parser NULL-safe). Fotos: SELECT '
  'can_access_patient (espelha Fam2, externo incluido - reportado), INSERT so paciente na propria '
  'pasta, UPDATE/DELETE negados. Documentos: SELECT can_access_patient_internal (externo excluido, '
  'espelha Fam5), INSERT/DELETE can_prescribe_for_patient, UPDATE negado. anon negado. Substitui as '
  '3 sprint_* bucket-wide. Janela: exibicao de fotos quebra ate a Parte 2 (app usa URL publica).',
  'WP-STORAGE-P1')
on conflict (version) do nothing;
