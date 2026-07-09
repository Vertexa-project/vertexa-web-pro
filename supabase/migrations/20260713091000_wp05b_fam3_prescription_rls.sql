-- =====================================================================================
-- WP-05B · FAMÍLIA 3 (Prescrição) · parte 2/2 — RLS REAL de 6 tabelas (EIXO INVERTIDO)
-- Substitui as sprint_*. Determinística/idempotente.
--
-- EIXO INVERTIDO: o PROFISSIONAL vinculado/admin ESCREVE (prescreve); o PACIENTE só LÊ (nunca escreve).
--  · SELECT = can_access_patient_internal(patient_id)  -> paciente dono + prof comum vinculado + admin.
--             EXTERNO EXCLUÍDO das prescrições (decisão AUTH-EXT-1; consistente c/ body_assessments Fam2).
--  · INSERT/UPDATE/DELETE = can_prescribe_for_patient(patient_id) -> prof comum vinculado OU admin.
--             O PACIENTE NÃO tem ramo de escrita -> qualquer INSERT/UPDATE/DELETE do paciente é NEGADO.
--  · Via-pai (workouts/workout_exercises/meals): patient_id resolvido pelo pai via helper (sem recursão).
--             WITH CHECK amarra a prescrição ao paciente vinculado (não prescreve p/ não-vinculado, nem
--             injeta em plano de outro paciente).
--  · Imutabilidade: patient_id / workout_plan_id / workout_id / nutrition_plan_id nunca reescritos
--             (col-priv exclui essas colunas do UPDATE) -> não dá p/ "mover" a prescrição.
-- anon: sem policy => negado. service_role/postgres: bypassrls.
-- Coerência Fam2: supplements (prescrição, aqui) <-> supplement_intakes (tomada, Fam2). Prof prescreve
--   supplements; paciente LÊ supplements e GRAVA supplement_intakes.
--
-- KILL SWITCH (fail-closed): reverter as 6 a DENY-ALL (RLS ON, zero policy); NUNCA reabrir anon:
--   do $$ declare r record; begin
--     for r in select policyname, tablename from pg_policies where schemaname='public' and tablename in
--       ('workout_plans','workouts','workout_exercises','nutrition_plans','meals','supplements')
--     loop execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename); end loop;
--   end $$;
-- Sintoma: profissional não consegue prescrever OU paciente não vê o plano -> corrigir p/ FRENTE;
--   emergência = deny-all; jamais recriar sprint_*.
-- =====================================================================================

-- workout_plans (direto)
drop policy if exists sprint_read_all  on public.workout_plans;
drop policy if exists sprint_plan_write on public.workout_plans;
drop policy if exists workout_plans_select on public.workout_plans;
drop policy if exists workout_plans_write_insert on public.workout_plans;
drop policy if exists workout_plans_write_update on public.workout_plans;
drop policy if exists workout_plans_write_delete on public.workout_plans;
create policy workout_plans_select on public.workout_plans for select to authenticated using ( private.can_access_patient_internal(patient_id) );
create policy workout_plans_write_insert on public.workout_plans for insert to authenticated with check ( private.can_prescribe_for_patient(patient_id) );
create policy workout_plans_write_update on public.workout_plans for update to authenticated using ( private.can_prescribe_for_patient(patient_id) ) with check ( private.can_prescribe_for_patient(patient_id) );
create policy workout_plans_write_delete on public.workout_plans for delete to authenticated using ( private.can_prescribe_for_patient(patient_id) );
revoke update on public.workout_plans from authenticated, anon;
grant  update (professional_id, title, goal) on public.workout_plans to authenticated;

-- workouts (via workout_plan_id)
drop policy if exists sprint_read_all  on public.workouts;
drop policy if exists sprint_plan_write on public.workouts;
drop policy if exists workouts_select on public.workouts;
drop policy if exists workouts_write_insert on public.workouts;
drop policy if exists workouts_write_update on public.workouts;
drop policy if exists workouts_write_delete on public.workouts;
create policy workouts_select on public.workouts for select to authenticated using ( private.can_access_patient_internal(private.workout_plan_patient(workout_plan_id)) );
create policy workouts_write_insert on public.workouts for insert to authenticated with check ( private.can_prescribe_for_patient(private.workout_plan_patient(workout_plan_id)) );
create policy workouts_write_update on public.workouts for update to authenticated using ( private.can_prescribe_for_patient(private.workout_plan_patient(workout_plan_id)) ) with check ( private.can_prescribe_for_patient(private.workout_plan_patient(workout_plan_id)) );
create policy workouts_write_delete on public.workouts for delete to authenticated using ( private.can_prescribe_for_patient(private.workout_plan_patient(workout_plan_id)) );
revoke update on public.workouts from authenticated, anon;
grant  update (letter, name, primary_muscle_group, day_index, estimated_minutes) on public.workouts to authenticated;

-- workout_exercises (via workout_id)
drop policy if exists sprint_read_all  on public.workout_exercises;
drop policy if exists sprint_plan_write on public.workout_exercises;
drop policy if exists workout_exercises_select on public.workout_exercises;
drop policy if exists workout_exercises_write_insert on public.workout_exercises;
drop policy if exists workout_exercises_write_update on public.workout_exercises;
drop policy if exists workout_exercises_write_delete on public.workout_exercises;
create policy workout_exercises_select on public.workout_exercises for select to authenticated using ( private.can_access_patient_internal(private.workout_patient(workout_id)) );
create policy workout_exercises_write_insert on public.workout_exercises for insert to authenticated with check ( private.can_prescribe_for_patient(private.workout_patient(workout_id)) );
create policy workout_exercises_write_update on public.workout_exercises for update to authenticated using ( private.can_prescribe_for_patient(private.workout_patient(workout_id)) ) with check ( private.can_prescribe_for_patient(private.workout_patient(workout_id)) );
create policy workout_exercises_write_delete on public.workout_exercises for delete to authenticated using ( private.can_prescribe_for_patient(private.workout_patient(workout_id)) );
revoke update on public.workout_exercises from authenticated, anon;
grant  update (name, muscle_groups, sets, reps, load_kg, rest_seconds, gif_url, notes, order_index) on public.workout_exercises to authenticated;

-- nutrition_plans (direto)
drop policy if exists sprint_read_all  on public.nutrition_plans;
drop policy if exists sprint_plan_write on public.nutrition_plans;
drop policy if exists nutrition_plans_select on public.nutrition_plans;
drop policy if exists nutrition_plans_write_insert on public.nutrition_plans;
drop policy if exists nutrition_plans_write_update on public.nutrition_plans;
drop policy if exists nutrition_plans_write_delete on public.nutrition_plans;
create policy nutrition_plans_select on public.nutrition_plans for select to authenticated using ( private.can_access_patient_internal(patient_id) );
create policy nutrition_plans_write_insert on public.nutrition_plans for insert to authenticated with check ( private.can_prescribe_for_patient(patient_id) );
create policy nutrition_plans_write_update on public.nutrition_plans for update to authenticated using ( private.can_prescribe_for_patient(patient_id) ) with check ( private.can_prescribe_for_patient(patient_id) );
create policy nutrition_plans_write_delete on public.nutrition_plans for delete to authenticated using ( private.can_prescribe_for_patient(patient_id) );
revoke update on public.nutrition_plans from authenticated, anon;
grant  update (professional_id, title, status) on public.nutrition_plans to authenticated;

-- meals (via nutrition_plan_id)
drop policy if exists sprint_read_all  on public.meals;
drop policy if exists sprint_plan_write on public.meals;
drop policy if exists meals_select on public.meals;
drop policy if exists meals_write_insert on public.meals;
drop policy if exists meals_write_update on public.meals;
drop policy if exists meals_write_delete on public.meals;
create policy meals_select on public.meals for select to authenticated using ( private.can_access_patient_internal(private.nutrition_plan_patient(nutrition_plan_id)) );
create policy meals_write_insert on public.meals for insert to authenticated with check ( private.can_prescribe_for_patient(private.nutrition_plan_patient(nutrition_plan_id)) );
create policy meals_write_update on public.meals for update to authenticated using ( private.can_prescribe_for_patient(private.nutrition_plan_patient(nutrition_plan_id)) ) with check ( private.can_prescribe_for_patient(private.nutrition_plan_patient(nutrition_plan_id)) );
create policy meals_write_delete on public.meals for delete to authenticated using ( private.can_prescribe_for_patient(private.nutrition_plan_patient(nutrition_plan_id)) );
revoke update on public.meals from authenticated, anon;
grant  update (time, name, items, calories, order_index) on public.meals to authenticated;

-- supplements (direto; prescrição pareada c/ supplement_intakes da Fam2)
drop policy if exists sprint_supplement_read  on public.supplements;
drop policy if exists sprint_supplement_write on public.supplements;
drop policy if exists supplements_select on public.supplements;
drop policy if exists supplements_write_insert on public.supplements;
drop policy if exists supplements_write_update on public.supplements;
drop policy if exists supplements_write_delete on public.supplements;
create policy supplements_select on public.supplements for select to authenticated using ( private.can_access_patient_internal(patient_id) );
create policy supplements_write_insert on public.supplements for insert to authenticated with check ( private.can_prescribe_for_patient(patient_id) );
create policy supplements_write_update on public.supplements for update to authenticated using ( private.can_prescribe_for_patient(patient_id) ) with check ( private.can_prescribe_for_patient(patient_id) );
create policy supplements_write_delete on public.supplements for delete to authenticated using ( private.can_prescribe_for_patient(patient_id) );
revoke update on public.supplements from authenticated, anon;
grant  update (name, dose, time_label, order_index) on public.supplements to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260713091000','20260713091000_wp05b_fam3_prescription_rls.sql',
  'WP-05B Fam3: RLS real 6 tabelas prescricao (eixo invertido). SELECT can_access_patient_internal '
  '(externo EXCLUIDO); escrita can_prescribe_for_patient (prof vinculado/admin; PACIENTE nao escreve). '
  'Via-pai workouts/exercises/meals; patient_id/plan_id imutavel; anon negado.',
  'WP-05B-FAM3')
on conflict (version) do nothing;
