-- =====================================================================================
-- WP-05B · FAMÍLIA 3 (Prescrição) · parte 1/2 — HELPERS (reusam Fam1/Fam2)
-- Idempotente. SECURITY DEFINER, search_path='', execute só authenticated.
--
--  · workout_plan_patient / workout_patient / nutrition_plan_patient: resolvem patient_id VIA pai
--    (workouts→workout_plans, workout_exercises→workouts→workout_plans, meals→nutrition_plans).
--    Por serem DEFINER, a leitura do pai NÃO dispara a RLS do pai -> sem recursão.
--  · can_prescribe_for_patient(p): PROFISSIONAL COMUM VINCULADO ao paciente OU admin da clínica.
--    Paciente e profissional EXTERNO retornam false (paciente só LÊ; externo não prescreve).
--
-- Rollback: drop das 4 funções.
-- =====================================================================================

create or replace function private.workout_plan_patient(p_plan uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select wp.patient_id from public.workout_plans wp where wp.id = p_plan
$$;

create or replace function private.workout_patient(p_workout uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select wp.patient_id
  from public.workouts w join public.workout_plans wp on wp.id = w.workout_plan_id
  where w.id = p_workout
$$;

create or replace function private.nutrition_plan_patient(p_plan uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select np.patient_id from public.nutrition_plans np where np.id = p_plan
$$;

create or replace function private.can_prescribe_for_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_common_professional_of_patient(p_patient)
      or private.is_clinic_admin(private.patient_clinic(p_patient))
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260713090000','20260713090000_wp05b_fam3_helpers.sql',
  'WP-05B Fam3: helpers via-pai (workout_plan_patient/workout_patient/nutrition_plan_patient) e '
  'can_prescribe_for_patient (prof comum vinculado OU admin; paciente/externo=false).',
  'WP-05B-FAM3')
on conflict (version) do nothing;
