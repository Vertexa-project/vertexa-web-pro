-- =====================================================================================
-- WP-05B · FAMÍLIA 2 (Comportamento) · parte 2/2 — RLS REAL de 11 tabelas
-- Substitui as sprint_* por RLS real. Determinística/idempotente.
--
-- MODELO:
--  · Behavioral self-logs (weight_logs, activity_events, activity_sessions, meal_logs,
--    supplement_intakes, muscle_recovery_states, adherence_snapshots, workout_session_logs,
--    workout_set_logs, progress_photos):
--      SELECT  = can_access_patient(patient_id)   (paciente + prof vinculado + admin + EXTERNO)
--      INSERT/UPDATE/DELETE = is_self_patient(patient_id)  (paciente-only; ANTI-FORJA: patient_id
--        vem do client, então WITH CHECK amarra ao próprio; nunca grava p/ outro patient_id).
--    workout_set_logs resolve o paciente VIA pai (session_log_patient) — sem recursão.
--  · body_assessments (antropometria CLÍNICA): externo EXCLUÍDO.
--      SELECT = can_access_patient_internal(patient_id)  (self/comum/admin; SEM externo)
--      INSERT/UPDATE = prof comum vinculado OU admin ; DELETE = admin.
--
-- Imutabilidade: patient_id (e session_log_id em workout_set_logs) nunca reescritos — tabelas
--   append-only não têm policy de UPDATE (negado); muscle_recovery_states e body_assessments têm
--   UPDATE mas com column privileges que excluem patient_id.
-- anon: sem policy => negado. service_role/postgres: bypassrls (Edge/observability).
--
-- KILL SWITCH (fail-closed) — reverter as 11 a DENY-ALL (RLS ON, zero policy); NUNCA reabrir anon:
--   do $$ declare r record; begin
--     for r in select policyname, tablename from pg_policies where schemaname='public' and tablename in
--       ('weight_logs','activity_events','activity_sessions','meal_logs','supplement_intakes',
--        'muscle_recovery_states','adherence_snapshots','workout_session_logs','workout_set_logs',
--        'body_assessments','progress_photos')
--     loop execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename); end loop;
--   end $$;
-- Sintoma: app parou de gravar/ler o legítimo -> corrigir a policy p/ FRENTE; emergência = deny-all,
--   jamais recriar sprint_*.
-- =====================================================================================

-- weight_logs (append-only)
drop policy if exists sprint_weight_read  on public.weight_logs;
drop policy if exists sprint_weight_write on public.weight_logs;
drop policy if exists weight_logs_select on public.weight_logs;
drop policy if exists weight_logs_insert_self on public.weight_logs;
create policy weight_logs_select on public.weight_logs for select to authenticated using ( private.can_access_patient(patient_id) );
create policy weight_logs_insert_self on public.weight_logs for insert to authenticated with check ( private.is_self_patient(patient_id) );
revoke update on public.weight_logs from authenticated, anon;

-- activity_events (append-only)
drop policy if exists sprint_read_all       on public.activity_events;
drop policy if exists sprint_activity_write on public.activity_events;
drop policy if exists activity_events_select on public.activity_events;
drop policy if exists activity_events_insert_self on public.activity_events;
create policy activity_events_select on public.activity_events for select to authenticated using ( private.can_access_patient(patient_id) );
create policy activity_events_insert_self on public.activity_events for insert to authenticated with check ( private.is_self_patient(patient_id) );
revoke update on public.activity_events from authenticated, anon;

-- activity_sessions (append-only)
drop policy if exists sprint_activity_session_read  on public.activity_sessions;
drop policy if exists sprint_activity_session_write on public.activity_sessions;
drop policy if exists activity_sessions_select on public.activity_sessions;
drop policy if exists activity_sessions_insert_self on public.activity_sessions;
create policy activity_sessions_select on public.activity_sessions for select to authenticated using ( private.can_access_patient(patient_id) );
create policy activity_sessions_insert_self on public.activity_sessions for insert to authenticated with check ( private.is_self_patient(patient_id) );
revoke update on public.activity_sessions from authenticated, anon;

-- meal_logs (insert + delete)
drop policy if exists sprint_meal_read         on public.meal_logs;
drop policy if exists sprint_meal_write_insert on public.meal_logs;
drop policy if exists sprint_meal_write_delete on public.meal_logs;
drop policy if exists meal_logs_select on public.meal_logs;
drop policy if exists meal_logs_insert_self on public.meal_logs;
drop policy if exists meal_logs_delete_self on public.meal_logs;
create policy meal_logs_select on public.meal_logs for select to authenticated using ( private.can_access_patient(patient_id) );
create policy meal_logs_insert_self on public.meal_logs for insert to authenticated with check ( private.is_self_patient(patient_id) );
create policy meal_logs_delete_self on public.meal_logs for delete to authenticated using ( private.is_self_patient(patient_id) );
revoke update on public.meal_logs from authenticated, anon;

-- supplement_intakes (insert + delete)
drop policy if exists sprint_supplement_intake_read   on public.supplement_intakes;
drop policy if exists sprint_supplement_intake_insert on public.supplement_intakes;
drop policy if exists sprint_supplement_intake_delete on public.supplement_intakes;
drop policy if exists supplement_intakes_select on public.supplement_intakes;
drop policy if exists supplement_intakes_insert_self on public.supplement_intakes;
drop policy if exists supplement_intakes_delete_self on public.supplement_intakes;
create policy supplement_intakes_select on public.supplement_intakes for select to authenticated using ( private.can_access_patient(patient_id) );
create policy supplement_intakes_insert_self on public.supplement_intakes for insert to authenticated with check ( private.is_self_patient(patient_id) );
create policy supplement_intakes_delete_self on public.supplement_intakes for delete to authenticated using ( private.is_self_patient(patient_id) );
revoke update on public.supplement_intakes from authenticated, anon;

-- muscle_recovery_states (insert + update upsert)
drop policy if exists sprint_read_all            on public.muscle_recovery_states;
drop policy if exists sprint_muscle_write_insert on public.muscle_recovery_states;
drop policy if exists sprint_muscle_write_update on public.muscle_recovery_states;
drop policy if exists muscle_states_select on public.muscle_recovery_states;
drop policy if exists muscle_states_insert_self on public.muscle_recovery_states;
drop policy if exists muscle_states_update_self on public.muscle_recovery_states;
create policy muscle_states_select on public.muscle_recovery_states for select to authenticated using ( private.can_access_patient(patient_id) );
create policy muscle_states_insert_self on public.muscle_recovery_states for insert to authenticated with check ( private.is_self_patient(patient_id) );
create policy muscle_states_update_self on public.muscle_recovery_states for update to authenticated
  using ( private.is_self_patient(patient_id) ) with check ( private.is_self_patient(patient_id) );
revoke update on public.muscle_recovery_states from authenticated, anon;
grant  update (muscle_group, last_trained_at, last_intensity, status, calculated_at) on public.muscle_recovery_states to authenticated;

-- adherence_snapshots (append-only)
drop policy if exists sprint_read_all        on public.adherence_snapshots;
drop policy if exists sprint_adherence_write on public.adherence_snapshots;
drop policy if exists adherence_select on public.adherence_snapshots;
drop policy if exists adherence_insert_self on public.adherence_snapshots;
create policy adherence_select on public.adherence_snapshots for select to authenticated using ( private.can_access_patient(patient_id) );
create policy adherence_insert_self on public.adherence_snapshots for insert to authenticated with check ( private.is_self_patient(patient_id) );
revoke update on public.adherence_snapshots from authenticated, anon;

-- workout_session_logs (append-only)
drop policy if exists sprint_workout_session_read  on public.workout_session_logs;
drop policy if exists sprint_workout_session_write on public.workout_session_logs;
drop policy if exists wsl_select on public.workout_session_logs;
drop policy if exists wsl_insert_self on public.workout_session_logs;
create policy wsl_select on public.workout_session_logs for select to authenticated using ( private.can_access_patient(patient_id) );
create policy wsl_insert_self on public.workout_session_logs for insert to authenticated with check ( private.is_self_patient(patient_id) );
revoke update on public.workout_session_logs from authenticated, anon;

-- workout_set_logs (via pai session_log_patient)
drop policy if exists sprint_workout_set_read  on public.workout_set_logs;
drop policy if exists sprint_workout_set_write on public.workout_set_logs;
drop policy if exists wset_select on public.workout_set_logs;
drop policy if exists wset_insert_self on public.workout_set_logs;
create policy wset_select on public.workout_set_logs for select to authenticated
  using ( private.can_access_patient(private.session_log_patient(session_log_id)) );
create policy wset_insert_self on public.workout_set_logs for insert to authenticated
  with check ( private.is_self_patient(private.session_log_patient(session_log_id)) );
revoke update on public.workout_set_logs from authenticated, anon;

-- progress_photos (SÓ tabela/metadado; bucket = família Storage, NÃO tocado aqui)
drop policy if exists sprint_read_all              on public.progress_photos;
drop policy if exists sprint_progress_photos_insert on public.progress_photos;
drop policy if exists progress_photos_select on public.progress_photos;
drop policy if exists progress_photos_insert_self on public.progress_photos;
create policy progress_photos_select on public.progress_photos for select to authenticated using ( private.can_access_patient(patient_id) );
create policy progress_photos_insert_self on public.progress_photos for insert to authenticated with check ( private.is_self_patient(patient_id) );
revoke update on public.progress_photos from authenticated, anon;

-- body_assessments (CLÍNICO: externo EXCLUÍDO; escrita prof comum vinculado / admin)
drop policy if exists sprint_read_all             on public.body_assessments;
drop policy if exists sprint_body_assessment_write on public.body_assessments;
drop policy if exists body_assessments_select on public.body_assessments;
drop policy if exists body_assessments_write_insert on public.body_assessments;
drop policy if exists body_assessments_write_update on public.body_assessments;
drop policy if exists body_assessments_admin_delete on public.body_assessments;
create policy body_assessments_select on public.body_assessments for select to authenticated
  using ( private.can_access_patient_internal(patient_id) );
create policy body_assessments_write_insert on public.body_assessments for insert to authenticated
  with check ( private.is_common_professional_of_patient(patient_id) or private.is_clinic_admin(private.patient_clinic(patient_id)) );
create policy body_assessments_write_update on public.body_assessments for update to authenticated
  using ( private.is_common_professional_of_patient(patient_id) or private.is_clinic_admin(private.patient_clinic(patient_id)) )
  with check ( private.is_common_professional_of_patient(patient_id) or private.is_clinic_admin(private.patient_clinic(patient_id)) );
create policy body_assessments_admin_delete on public.body_assessments for delete to authenticated
  using ( private.is_clinic_admin(private.patient_clinic(patient_id)) );
revoke update on public.body_assessments from authenticated, anon;
grant  update (professional_id, assessed_at, method, weight, body_fat_pct, measurements, document_url, created_at) on public.body_assessments to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260712091000','20260712091000_wp05b_fam2_behavior_rls.sql',
  'WP-05B Fam2: RLS real em 11 tabelas de comportamento substituindo sprint_*. Behavioral: SELECT '
  'can_access_patient, escrita is_self_patient (anti-forja). workout_set_logs via pai. body_assessments '
  'externo EXCLUIDO (can_access_patient_internal) + escrita prof/admin. patient_id imutavel. anon negado.',
  'WP-05B-FAM2')
on conflict (version) do nothing;
