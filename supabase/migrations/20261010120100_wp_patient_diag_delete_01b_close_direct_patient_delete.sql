-- WP-PATIENT-DIAG-DELETE-01b — fecha o DELETE direto em public.patients (defesa em profundidade)
--
-- Antes (catálogo de produção, 2026-10-10):
--   - policy PERMISSIVE patients_admin_delete (20260711095000_wp05b_fam1_identity_rls.sql),
--     USING private.is_clinic_admin(clinic_id): qualquer admin ativo da clínica executava
--     DELETE direto em public.patients via PostgREST;
--   - grants de tabela: anon e authenticated com DELETE e TRUNCATE (padrão do Supabase).
--   ~25 tabelas clínicas referenciam patients.id com ON DELETE CASCADE: um único DELETE apagava
--   avaliações, pesos, fotos, planos, mensagens etc., sem nenhuma verificação de identidade ou
--   movimentação, deixando profile/Auth órfãos.
--
-- Caminhos legítimos verificados (2026-10-10): nenhum código do web, do app do paciente, do app
-- nativo ou das edge functions apaga public.patients diretamente; nenhuma função do banco contém
-- "delete from public.patients". A única exclusão suportada passa a ser a RPC SECURITY DEFINER
-- public.delete_unused_patient_registration (roda como owner; não depende destes grants).
--
-- Depois:
--   1. sem policy de DELETE para clientes em public.patients;
--   2. sem privilégio DELETE/TRUNCATE para anon e authenticated (TRUNCATE ignora RLS).
-- service_role e o owner mantêm seus privilégios (operação de servidor).
-- Não toca billing (a policy RESTRICTIVE billing_preprod_clinical_access continua como está).

drop policy if exists patients_admin_delete on public.patients;

revoke delete, truncate on table public.patients from anon, authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20261010120100',
  '20261010120100_wp_patient_diag_delete_01b_close_direct_patient_delete.sql',
  'PATIENT-DIAG-DELETE-01b: remove patients_admin_delete + revoke delete/truncate de anon/authenticated '
  'em public.patients; exclusão de paciente só via delete_unused_patient_registration.',
  'PATIENT-DIAG-DELETE-01'
);
