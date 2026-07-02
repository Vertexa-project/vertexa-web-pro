-- =====================================================================================
-- VERTEXA — patient_documents: exames/documentos do paciente (PDF/imagem) — fecha #12 p/ exame
-- ADITIVA e reversível. NÃO altera tabelas existentes. NÃO renomeia colunas.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md + calls 23/06 e 26/06): a Juliana precisa mandar exame
-- por PDF; nutri/fisio precisam VER; registrar QUEM enviou. Hoje o único anexo é
-- body_assessments.document_url (URL crua, aba Documentos — segue read-only, dívida #18). Esta é
-- a tabela CANÔNICA de documentos/exames, com bucket PRIVADO + URL assinada (fecha a #12 para o
-- EXAME; a foto de progresso segue pública em bucket separado, dívida à parte).
--
-- Modelo BIDIRECIONAL (uploaded_by_role): a WEB escreve (uploaded_by_role='professional',
-- uploaded_by_professional_id = professionals.id do profissional atuante). O APP PACIENTE
-- lerá/ESCREVERÁ no futuro (uploaded_by_role='patient', professional_id NULL) — NÃO implementado
-- aqui (sessão futura do repo do app). O app hoje NÃO consome nada de documentos (verificado).
--
-- file_path = CAMINHO do objeto no bucket (NÃO URL pública). A web resolve via createSignedUrl
-- (TTL curto) no clique. Bucket privado => sem URL pública; a policy de SELECT em storage.objects
-- (abaixo) é o que AUTORIZA o anon a ASSINAR a URL na sprint.
--
-- RLS: policies PERMISSIVAS de sprint (seed/demo fictício), só SELECT + INSERT (documento é
-- imutável na sprint; SEM UPDATE/DELETE para anon). Intenção da RLS REAL (S9, #11–#14):
--   * SELECT: só profissionais VINCULADOS ao paciente (professional_patient_links) + o próprio
--     paciente (auth.uid() -> patients).
--   * INSERT do profissional: via auth.uid() -> professionals (dono do vínculo);
--     INSERT do paciente: só o próprio (auth.uid() -> seu patient_id), com professional_id NULL.
-- Storage 'patient-documents' idem: fechar por pasta = patient_id sob a mesma RLS. AMBAS
-- (tabela + storage) anotadas no checklist #14 do CONTRATO.
--
-- Rollback:
--   drop policy if exists sprint_patient_document_read           on public.patient_documents;
--   drop policy if exists sprint_patient_document_insert         on public.patient_documents;
--   drop policy if exists sprint_patient_documents_storage_read  on storage.objects;
--   drop policy if exists sprint_patient_documents_storage_write on storage.objects;
--   drop table  if exists public.patient_documents cascade;
--   delete from storage.objects where bucket_id = 'patient-documents';  -- FK: esvaziar antes do bucket
--   delete from storage.buckets where id = 'patient-documents';
-- =====================================================================================

create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  uploaded_by_role text not null check (uploaded_by_role in ('professional', 'patient')),
  -- auditoria de QUEM enviou; null quando o paciente envia (app, futuro). Preserva o documento
  -- se o profissional for removido (set null), sem apagar histórico clínico.
  uploaded_by_professional_id uuid references public.professionals(id) on delete set null,
  kind text not null default 'exam',        -- exam | report | other (texto flexível)
  title text,
  file_path text not null,                  -- caminho do objeto no bucket privado (NÃO URL pública)
  mime_type text,
  file_size_bytes bigint,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists patient_documents_patient_uploaded_idx
  on public.patient_documents (patient_id, uploaded_at desc);

alter table public.patient_documents enable row level security;

-- Policies PERMISSIVAS de sprint (seed/demo fictício). Substituir por RLS por vínculo/paciente (#11–#14).
-- Intenção da RLS REAL (S9): SELECT só profissionais vinculados + o paciente; INSERT do profissional
-- via auth.uid()->professionals, do paciente só o próprio (professional_id NULL).
drop policy if exists sprint_patient_document_read on public.patient_documents;
create policy sprint_patient_document_read on public.patient_documents
  for select to anon, authenticated using (true);

drop policy if exists sprint_patient_document_insert on public.patient_documents;
create policy sprint_patient_document_insert on public.patient_documents
  for insert to anon, authenticated with check (true);

-- -------------------------------------------------------------------------------------
-- Storage: bucket PRIVADO de documentos/exames (public=false). Diferente de 'progress-photos'
-- (público). Sem URL pública => download só via createSignedUrl. Por isso precisamos de policy de
-- SELECT (autoriza o anon a ASSINAR a URL na sprint) ALÉM do INSERT (upload). AMBAS no #14.
insert into storage.buckets (id, name, public)
values ('patient-documents', 'patient-documents', false)
on conflict (id) do nothing;

drop policy if exists sprint_patient_documents_storage_write on storage.objects;
create policy sprint_patient_documents_storage_write on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'patient-documents');

drop policy if exists sprint_patient_documents_storage_read on storage.objects;
create policy sprint_patient_documents_storage_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'patient-documents');
