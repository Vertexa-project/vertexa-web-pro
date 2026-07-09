-- =====================================================================================
-- WP-05 / FASE A — PURGA DOS DADOS DE DEMONSTRAÇÃO (migration versionada, auditável,
-- determinística e com rollback conhecido).
--
-- HONESTIDADE DE NATUREZA: esta migration é DESTRUTIVA / DE CONTRAÇÃO — ela APAGA DADOS.
-- NÃO é "aditiva". Não cria, renomeia nem remove NENHUM objeto de ESTRUTURA (tabela, coluna,
-- tipo/enum, FK, índice, função/RPC, trigger, bucket). Apenas ESVAZIA as tabelas de dados
-- de demonstração. A estrutura fica 100% intacta (provado por fingerprint antes/depois no WP).
--
-- PROVA DE DESCARTABILIDADE (A2): não há dado real no banco. Evidências no momento da escrita:
--   • profiles: 5 linhas, TODAS com UUID fixo da família demo (…a1/a2/b1/b2/b3), e-mail de
--     teste (@clinicavertice.com / @email.com) e auth_user_id = NULL (ninguém nunca logou);
--   • auth.users / auth.identities / auth.sessions / auth.refresh_tokens = 0 (zero login real);
--   • única clínica = 'Clínica Vértice' (…c1); únicos pacientes = b1/b2/b3; únicos
--     profissionais = e1/e2 → toda linha das tabelas escopadas é demo por FK transitiva.
--
-- ORDEM: folhas → raízes (respeita as FKs sem depender de ON DELETE CASCADE). Ordem validada
-- por dry-run em transação com ROLLBACK (nenhuma foreign_key_violation).
--
-- PRESERVADO DE PROPÓSITO (NÃO é dado de paciente/clínica; não apagar aqui):
--   • public.achievements       — catálogo/ referência (definições de conquistas), consumido
--                                   pelos apps; recriar isso seria mexer em config, não em demo.
--   • public.schema_migration_log — ledger interno de migrations (trilha de auditoria).
--   • public.auth_trigger_events  — diagnóstico do trigger de auth (já vazio; deny-all).
--   • Funções refresh_demo_mariana* e event trigger ensure_rls — ESTRUTURA (não se apaga na Fase A).
--
-- STORAGE (NÃO tratado aqui — de propósito): há 2 objetos demo em 'progress-photos'
--   (demo/mariana/antes.png, demo/mariana/depois.png). Apagar só a linha de storage.objects por
--   SQL ORFANARIA o blob no S3 e a regra do WP proíbe mexer nos metadados "no braço". A remoção
--   coerente (arquivo + registro) exige a Storage API (service key) → é PASSO DO DONO
--   (ver relatório WP-05 Fase A). Além disso o Plano 5 vai rearquitetar esse bucket.
--
-- ROLLBACK (desfazer) — como este arquivo só APAGA dados demo, o "desfazer" é RE-SEMEAR:
--   As migrations de seed são IDEMPOTENTES e DETERMINÍSTICAS. Para restaurar o happy path demo,
--   reaplique os seeds (funcionalmente equivalentes; ids/timestamps gerados podem diferir onde o
--   seed usa gen_random_uuid()/now()):
--     20260617110000_seed_base_demo
--     20260625190000_seed_demo_patient_document
--     20260626093000_seed_demo_appointments / 20260626170000_seed_demo_appointments_week
--     20260626150000_seed_demo_calendar
--     20260701012409_seed_demo_weight_logs_mariana
--     20260701020621_seed_demo_progress_photos_mariana
--     20260701020634_seed_demo_assessments_enrich_mariana
--     20260702134655_seed_demo_mariana_streak_convergence
--     20260702220213_seed_mariana_timeline_coherence
--     20260703023648_seed_demo_mariana_workout_execution (+ _tz_fix)
--   (ou, mais simples: `git revert` deste commit + re-run dos seeds acima).
-- =====================================================================================

-- Folhas mais profundas primeiro; raízes (profiles/clinics) por último.
delete from public.workout_set_logs;
delete from public.supplement_intakes;
delete from public.meal_logs;
delete from public.chat_mentions;
delete from public.calendar_connection_tokens;
delete from public.calendar_event_cache;
delete from public.workout_session_logs;
delete from public.workout_exercises;
delete from public.chat_messages;
delete from public.chat_participants;
delete from public.meals;
delete from public.calendar_connections;
delete from public.calendar_oauth_state;
delete from public.workouts;
delete from public.chat_channels;
delete from public.nutrition_plans;
delete from public.workout_plans;
delete from public.body_assessments;
delete from public.progress_photos;
delete from public.activity_events;
delete from public.activity_sessions;
delete from public.muscle_recovery_states;
delete from public.adherence_snapshots;
delete from public.messages;
delete from public.weight_logs;
delete from public.supplements;
delete from public.patient_achievements;
delete from public.notifications;
delete from public.patient_documents;
delete from public.appointments;
delete from public.professional_patient_links;
delete from public.patients;
delete from public.professionals;
delete from public.campaigns;
delete from public.clinics;
delete from public.profiles;

-- Ledger técnico interno (companion; a própria trilha desta limpeza).
insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260710090000',
  '20260710090000_wp05a_purge_demo_data.sql',
  'WP-05/Fase A: PURGA (destrutiva/contracao) dos dados de demonstracao em 36 tabelas escopadas, '
  'ordem folhas->raizes validada por dry-run. Preserva achievements (catalogo), schema_migration_log '
  '(ledger) e auth_trigger_events. NAO altera estrutura (tabela/coluna/tipo/FK/indice/funcao/trigger/'
  'bucket). Storage (2 objetos demo) = passo do dono via Storage API. auth.users ja estava vazio.',
  'WP-05A'
)
on conflict (version) do nothing;
