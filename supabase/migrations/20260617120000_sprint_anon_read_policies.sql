-- ⚠️ TEMPORÁRIA — SPRINT até 22/06. NÃO PROMOVER PARA PRODUÇÃO.
-- As 17 tabelas públicas estavam com RLS ligada e zero policies (cliente lia 0 linhas).
-- Esta migration libera SOMENTE LEITURA (SELECT) para anon+authenticated, para a demo
-- funcionar com dados fictícios (seed). Substituir por RLS real (por papel/clínica) antes
-- de qualquer dado real de paciente — ver docs/PENDENCIAS.md #11.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','clinics','professionals','patients','professional_patient_links',
    'workout_plans','workouts','workout_exercises','nutrition_plans','meals',
    'body_assessments','progress_photos','activity_events','muscle_recovery_states',
    'adherence_snapshots','messages','campaigns'
  ]
  loop
    execute format('drop policy if exists sprint_read_all on public.%I;', t);
    execute format('create policy sprint_read_all on public.%I for select to anon, authenticated using (true);', t);
  end loop;
end $$;
