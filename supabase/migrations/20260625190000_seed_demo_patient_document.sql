-- =====================================================================================
-- VERTEXA — Sessão 4 (web): SEED fictício de 1 documento (laudo) para a Mariana.
-- ADITIVA, idempotente e reversível. Só insere dado de SEED (não altera schema).
--
-- Contexto: a ficha do paciente ganhou a aba "Documentos" (body_assessments com
-- document_url != null). Sem nenhum documento no seed, a aba mostraria sempre o estado
-- vazio na demo. Este seed dá UM laudo fictício à Mariana para demonstrar o fluxo real
-- (linha real do banco -> card -> "Abrir documento").
--
-- document_url = data: URI de um PDF MÍNIMO, VÁLIDO e claramente fictício (gerado no
-- próprio repo; abre no navegador sem depender de host externo). ⚠️ Dado de saúde real
-- (laudo) exige bucket PRIVADO + signed URL + escopo por paciente — dívida pós-MVP
-- (docs/PENDENCIAS.md #12 / CONTRATO_INTEGRACAO "Sessão 8"). Hoje só seed fictício.
--
-- Idempotência: só insere se a Mariana ainda não tiver nenhum documento.
-- Rollback:
--   delete from public.body_assessments
--   where patient_id = '10000000-0000-0000-0000-0000000000b1'
--     and document_url like 'data:application/pdf%';
-- =====================================================================================

insert into public.body_assessments
  (patient_id, professional_id, assessed_at, method, weight, body_fat_pct, document_url)
select
  '10000000-0000-0000-0000-0000000000b1'::uuid, -- Mariana (patients.id)
  '00000000-0000-0000-0000-0000000000e2'::uuid, -- Dra. Camila (professionals.id)
  current_date - 20,
  'bioimpedancia',
  71.2,
  27.5,
  'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAzNjAgMjAwXS9Db250ZW50cyA0IDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNSAwIFI+Pj4+Pj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDE3OT4+CnN0cmVhbQpCVCAvRjEgMTYgVGYgMzAgMTUwIFRkIChWRVJURVhBIC0gTGF1ZG8gZGUgQmlvaW1wZWRhbmNpYSkgVGogMCAtMjggVGQgL0YxIDEyIFRmIChQYWNpZW50ZTogTWFyaWFuYSBBbGJ1cXVlcnF1ZSAoREVNTykpIFRqIDAgLTIyIFRkIChEb2N1bWVudG8gZmljdGljaW8gLSBhcGVuYXMgZGVtb25zdHJhY2FvKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU0IDAwMDAwIG4gCjAwMDAwMDAxMDUgMDAwMDAgbiAKMDAwMDAwMDIxNyAwMDAwMCBuIAowMDAwMDAwNDQ1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA2L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNTA4CiUlRU9G'
where not exists (
  select 1 from public.body_assessments
  where patient_id = '10000000-0000-0000-0000-0000000000b1'::uuid
    and document_url is not null
);
