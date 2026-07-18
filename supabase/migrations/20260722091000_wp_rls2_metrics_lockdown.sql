-- =====================================================================================
-- WP-RLS2 — LOCKDOWN das 3 tabelas de métricas DERIVADAS (fecha a DÍVIDA-RLS-2).
-- O paciente NÃO pode mais gravar as PRÓPRIAS métricas (forja impossível). Só LÊ. A escrita
-- passa a ser exclusiva do motor server-side (RPCs/trigger SECURITY DEFINER, migration anterior)
-- e do service_role. Os SELECTs do PROFISSIONAL/paciente são PRESERVADOS (a exibição do web e do
-- app NÃO quebra — web lê adherence/recovery com fallback gracioso; ver auditoria).
--
-- ANTES (a dívida): o paciente tinha INSERT (as 3) e UPDATE (recuperação) das PRÓPRIAS linhas
--   (adherence_insert_self, muscle_states_insert_self, muscle_states_update_self,
--    patient_achievements_insert_self) → podia FORJAR a própria métrica.
-- DEPOIS: essas 4 policies de escrita SAEM. Ficam SÓ os SELECT (can_access_patient /
--   can_access_patient_internal) — paciente lê a própria, profissional vinculado/admin leem.
--   Sem policy de INSERT/UPDATE/DELETE p/ authenticated ⇒ negado (a RLS segue ENABLED).
--
-- RLS NÃO afrouxada (só REMOVE escrita do paciente). Não toca identidade nem trigger de auth.
--
-- ROLLBACK (reabre a dívida — só p/ emergência; o correto é corrigir p/ frente):
--   create policy adherence_insert_self on public.adherence_snapshots for insert to authenticated with check (private.is_self_patient(patient_id));
--   create policy muscle_states_insert_self on public.muscle_recovery_states for insert to authenticated with check (private.is_self_patient(patient_id));
--   create policy muscle_states_update_self on public.muscle_recovery_states for update to authenticated using (private.is_self_patient(patient_id)) with check (private.is_self_patient(patient_id));
--   create policy patient_achievements_insert_self on public.patient_achievements for insert to authenticated with check (private.is_self_patient(patient_id));
-- =====================================================================================

drop policy if exists adherence_insert_self          on public.adherence_snapshots;
drop policy if exists muscle_states_insert_self       on public.muscle_recovery_states;
drop policy if exists muscle_states_update_self       on public.muscle_recovery_states;
drop policy if exists patient_achievements_insert_self on public.patient_achievements;

-- Defesa em profundidade: além de remover as policies, REVOGA o grant de escrita de authenticated
-- (write vira "permission denied" a nível de grant, não só RLS). SELECT preservado (necessário p/
-- a leitura). O motor (DEFINER, roda como owner) e o service_role seguem escrevendo.
revoke insert, update, delete on public.adherence_snapshots    from authenticated;
revoke insert, update, delete on public.muscle_recovery_states from authenticated;
revoke insert, update, delete on public.patient_achievements   from authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260722091000','20260722091000_wp_rls2_metrics_lockdown.sql',
  'WP-RLS2 lockdown: remove as 4 policies de ESCRITA do paciente nas 3 tabelas de metricas derivadas '
  '(adherence_insert_self, muscle_states_insert_self/update_self, patient_achievements_insert_self). '
  'Paciente passa a SO LER (SELECT preservado: can_access_patient/_internal); escrita so via motor '
  'server-side (DEFINER) e service_role. Forja da propria metrica fica impossivel. RLS NAO afrouxada.',
  'WP-RLS2')
on conflict (version) do nothing;
