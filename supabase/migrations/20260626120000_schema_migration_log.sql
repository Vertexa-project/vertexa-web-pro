-- =====================================================================================
-- VERTEXA — Sessão 7 (web): LEDGER humano de migrations (companion legível em PT-BR).
-- ADITIVA e reversível. NÃO altera tabelas/colunas existentes.
--
-- NÃO substitui supabase_migrations.schema_migrations (tabela interna do CLI, que só guarda
-- version+hash). Esta é a fonte de verdade LEGÍVEL do "até onde fomos": uma linha por arquivo
-- de migration do repo, com descrição PT-BR e a sessão (S1..S7 / INTEG / pré-fase2). A web lê
-- via api/ (seção "Migrations aplicadas" em Configurações, só admin).
--
-- `version` = prefixo timestamp do arquivo (14 dígitos). Backfill idempotente (on conflict
-- do update), incluindo a PRÓPRIA migration do ledger.
--
-- Rollback:
--   drop table if exists public.schema_migration_log;
-- =====================================================================================

create table if not exists public.schema_migration_log (
  version     text primary key,            -- prefixo timestamp do arquivo (ex.: '20260625120000')
  filename    text not null,
  description text not null,                -- PT-BR: o que a migration faz
  session     text,                         -- 'S1'..'S9' / 'INTEG' / 'pré-fase2'
  applied_at  timestamptz not null default now()
);

alter table public.schema_migration_log enable row level security;

-- Leitura liberada na sprint (a UI da web lê o ledger). Sem policy de escrita: o ledger só é
-- alimentado por migration (service_role / migração), nunca pelo client anon.
drop policy if exists miglog_read on public.schema_migration_log;
create policy miglog_read on public.schema_migration_log
  for select to anon, authenticated using (true);

-- ========== BACKFILL (idempotente) ==========
insert into public.schema_migration_log (version, filename, description, session) values
  ('20260617120000', '20260617120000_sprint_anon_read_policies.sql',
   'Policies de LEITURA sprint: cria sprint_read_all (SELECT anon/authenticated, using true) em 17 tabelas que estavam com RLS ligada e zero policies (cliente lia 0 linhas). Temporaria.',
   'pré-fase2'),
  ('20260618120000', '20260618120000_chat.sql',
   'Chat (Etapa 2): cria chat_channels/chat_participants/chat_messages/chat_mentions + indices; backfill de 1 canal por paciente + participantes; porta a tabela messages legada; policies permissivas (sprint_read_all SELECT + sprint_chat_write ALL); adiciona chat_messages/chat_mentions ao realtime.',
   'INTEG'),
  ('20260618130000', '20260618130000_sprint_write_policies.sql',
   'Versiona policies de ESCRITA sprint aplicadas via MCP: sprint_activity_write (INSERT activity_events), sprint_muscle_write_insert/update (muscle_recovery_states), sprint_plan_write (ALL em workout_plans/workouts/workout_exercises/nutrition_plans/meals). Permissivas.',
   'INTEG'),
  ('20260618140000', '20260618140000_sprint_adherence_write_policy.sql',
   'Versiona a policy sprint_adherence_write (INSERT em adherence_snapshots, anon/auth, with check true): o app grava o VRI, a web so le. Permissiva de sprint.',
   'INTEG'),
  ('20260625120000', '20260625120000_weight_logs_and_progress_photos_storage.sql',
   'Spine de dados (S1): cria tabela weight_logs (valor canonico de peso do app) + indice + policies sprint (read/write); cria bucket publico de Storage progress-photos + policy de INSERT em storage.objects. Aditiva.',
   'S1'),
  ('20260625170000', '20260625170000_progress_photos_table_insert_policy.sql',
   'Policy sprint_progress_photos_insert (INSERT na TABELA public.progress_photos, anon/auth, with check true): fecha o gap simetrico ao bucket para o app inserir a linha da foto. Permissiva de sprint.',
   'S2'),
  ('20260625180000', '20260625180000_sprint_patient_create_write_policies.sql',
   'Policies de INSERT para o cadastro de paciente pela web (S4): sprint_patient_write/sprint_patient_link_write/sprint_body_assessment_write (with check true) + sprint_profile_write restrito a role=patient. Permissivas de sprint.',
   'S4'),
  ('20260625190000', '20260625190000_seed_demo_patient_document.sql',
   'Seed ficticio (S4): insere 1 laudo (body_assessments com document_url = data:PDF) para a Mariana, para a aba Documentos exibir dado real. Idempotente.',
   'S4'),
  ('20260626090000', '20260626090000_appointments_internal_agenda.sql',
   'Agenda interna (S6): cria tabela appointments (clinic_id/patient_id?/professional_id?/title/starts_at/ends_at/notes) + FKs + indice + RLS sprint (sprint_appointment_read SELECT + sprint_appointment_write ALL). Aditiva.',
   'S6'),
  ('20260626093000', '20260626093000_seed_demo_appointments.sql',
   'Seed ficticio (S6): 3 compromissos da clinica c1 (ancorados em America/Sao_Paulo) para a Agenda da demo. Idempotente (guarda [seed-demo]).',
   'S6'),
  ('20260626120000', '20260626120000_schema_migration_log.sql',
   'Ledger humano de migrations (S7): cria schema_migration_log (version/filename/description/session/applied_at) + policy de leitura (miglog_read) e faz o backfill de todas as migrations do repo. Companion legivel da tabela do CLI.',
   'S7')
on conflict (version) do update set
  filename = excluded.filename,
  description = excluded.description,
  session = excluded.session;
