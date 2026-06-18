-- ⚠️ TEMPORÁRIA — SPRINT até 22/06. NÃO PROMOVER PARA PRODUÇÃO.
-- Formaliza/versiona as policies de ESCRITA "sprint" que foram aplicadas via MCP
-- (Fase 4 / Etapa 4c) mas nunca tinham migration file. NÃO altera comportamento:
-- recria EXATAMENTE o que já existe no banco (mesmos cmd/roles/using/with_check),
-- de forma idempotente (drop if exists + create).
--
-- Cobertura desta migration (writes permissivos `using/with check (true)`):
--   activity_events        sprint_activity_write       (INSERT)
--   muscle_recovery_states sprint_muscle_write_insert  (INSERT)
--   muscle_recovery_states sprint_muscle_write_update  (UPDATE)
--   workout_plans/workouts/workout_exercises/nutrition_plans/meals
--                          sprint_plan_write           (ALL)
--
-- As de leitura (sprint_read_all) estão em 20260617120000; as de chat
-- (sprint_chat_write) em 20260618120000. Substituir tudo por RLS real por
-- papel/clínica antes de qualquer dado real — ver docs/PENDENCIAS.md #14.

-- activity_events — o app paciente insere eventos (timeline). Só INSERT.
drop policy if exists sprint_activity_write on public.activity_events;
create policy sprint_activity_write on public.activity_events
  for insert to anon, authenticated with check (true);

-- muscle_recovery_states — o app paciente faz upsert ao concluir treino.
-- São DUAS policies separadas (INSERT + UPDATE), como no banco.
drop policy if exists sprint_muscle_write_insert on public.muscle_recovery_states;
create policy sprint_muscle_write_insert on public.muscle_recovery_states
  for insert to anon, authenticated with check (true);

drop policy if exists sprint_muscle_write_update on public.muscle_recovery_states;
create policy sprint_muscle_write_update on public.muscle_recovery_states
  for update to anon, authenticated using (true) with check (true);

-- sprint_plan_write (Fase 4) — a web cria/edita planos. FOR ALL nas 5 tabelas.
do $$
declare t text;
begin
  foreach t in array array[
    'workout_plans','workouts','workout_exercises','nutrition_plans','meals'
  ]
  loop
    execute format('drop policy if exists sprint_plan_write on public.%I;', t);
    execute format('create policy sprint_plan_write on public.%I for all to anon, authenticated using (true) with check (true);', t);
  end loop;
end $$;
