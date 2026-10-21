-- =====================================================================================
-- WP-EFFORT · A — Esforço percebido do treino (PDF do Ernâni, tela 23): ao concluir o treino a paciente diz de 1 a 10
-- como foi o esforço (payload: {workoutId, effort}). Vira um evento PRÓPRIO no catálogo, sem contar como adesão nem como
-- interação — o treino já contou pelo evento workout_checked; este é só informação para a equipe ajustar a carga.
-- Reversível: delete from activity_event_types where type='workout_effort' (após apagar os eventos).
-- =====================================================================================
insert into public.activity_event_types (type, counts_as_adherence, counts_as_interaction, note)
values ('workout_effort', false, false, 'Esforço percebido do treino (1 a 10), informado ao concluir. Informação para a equipe; não conta como adesão nem interação (o treino já contou).')
on conflict (type) do nothing;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261028090000','20261028090000_wp_effort_a.sql','EFFORT-A: tipo de evento workout_effort (esforço percebido 1-10) no catálogo, sem contar como adesão/interação.','EFFORT-A');
