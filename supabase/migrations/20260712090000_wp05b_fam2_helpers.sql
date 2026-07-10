-- =====================================================================================
-- WP-05B · FAMÍLIA 2 (Comportamento) · parte 1/2 — HELPERS (reusam a Família 1)
-- Idempotente. SECURITY DEFINER, search_path='', execute só authenticated (via grant no fim).
--
--  · session_log_patient(session): resolve o patient_id de workout_set_logs VIA o pai
--    workout_session_logs (workout_set_logs NÃO tem patient_id direto). Por ser DEFINER,
--    a leitura do pai NÃO dispara a RLS de workout_session_logs -> sem recursão.
--  · can_access_patient_internal(p): acesso "clínico" = self OR profissional-comum-vinculado OR
--    admin. EXCLUI o profissional EXTERNO (AUTH-EXT-1). Usado só em body_assessments (dado clínico
--    que o externo NÃO deve ver).
--
-- Rollback: drop function private.session_log_patient(uuid); drop function private.can_access_patient_internal(uuid);
-- =====================================================================================

create or replace function private.session_log_patient(p_session uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select wsl.patient_id from public.workout_session_logs wsl where wsl.id = p_session
$$;

create or replace function private.can_access_patient_internal(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_self_patient(p_patient)
      or private.is_common_professional_of_patient(p_patient)
      or private.is_clinic_admin(private.patient_clinic(p_patient))
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260712090000','20260712090000_wp05b_fam2_helpers.sql',
  'WP-05B Fam2: helpers session_log_patient (via-pai workout_set_logs) e can_access_patient_internal '
  '(clinico, exclui externo). SECURITY DEFINER, search_path vazio, execute so authenticated.',
  'WP-05B-FAM2')
on conflict (version) do nothing;
