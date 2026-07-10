-- =====================================================================================
-- WP-05B · FAMÍLIA 7 (Gamificação/Notificações) — RLS REAL (TRÊS MODELOS). Idempotente.
-- Reusa helpers (is_self_patient, can_access_patient_internal). anon negado. service_role: bypassa.
--
--  1) achievements = CATÁLOGO (sem patient_id): SELECT p/ qualquer authenticated (anon negado);
--     ESCRITA de ninguém pelo client (sem policy de INSERT/UPDATE/DELETE + revoke) — só service_role/migration.
--  2) patient_achievements = dado do PACIENTE: SELECT can_access_patient_internal (paciente dono + prof
--     comum vinculado + admin; EXTERNO EXCLUÍDO). INSERT = is_self_patient (o paciente desbloqueia o SEU;
--     ANTI-FORJA). APPEND-ONLY (sem UPDATE/DELETE) -> patient_id imutável, conquista não se reescreve.
--     DÍVIDA (não resolvida aqui): o desbloqueio é CLIENT-SIDE (app faz upsert) -> paciente pode inflar a
--     própria gamificação (mesma classe do VRI/adherence da Fam2). Idealmente engine server-side.
--  3) notifications = avisos do DESTINATÁRIO: SELECT is_self_patient (só o paciente destinatário; prof/admin
--     NÃO veem a caixa pessoal). UPDATE só de read_at e só pelo destinatário (col-priv). INSERT/DELETE do
--     client NEGADO (emissor = seed/server-side; criar emissor real é dívida à parte).
--
-- KILL SWITCH (fail-closed): drop das policies das 3 -> deny-all (achievements deny-all só esconde o
--   catálogo, é seguro); NUNCA reabrir anon. Sintoma: paciente parou de ver conquistas/notificações OU o
--   catálogo sumiu -> corrigir p/ FRENTE.
-- =====================================================================================

-- achievements (catálogo)
drop policy if exists sprint_achievement_read on public.achievements;
drop policy if exists achievements_catalog_read on public.achievements;
create policy achievements_catalog_read on public.achievements for select to authenticated using ( true );
revoke insert, update, delete on public.achievements from authenticated, anon;

-- patient_achievements
drop policy if exists sprint_patient_achievement_read   on public.patient_achievements;
drop policy if exists sprint_patient_achievement_insert on public.patient_achievements;
drop policy if exists patient_achievements_select on public.patient_achievements;
drop policy if exists patient_achievements_insert_self on public.patient_achievements;
create policy patient_achievements_select on public.patient_achievements for select to authenticated
  using ( private.can_access_patient_internal(patient_id) );
create policy patient_achievements_insert_self on public.patient_achievements for insert to authenticated
  with check ( private.is_self_patient(patient_id) );
revoke update on public.patient_achievements from authenticated, anon;

-- notifications
drop policy if exists sprint_notification_read   on public.notifications;
drop policy if exists sprint_notification_update on public.notifications;
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update_read on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using ( private.is_self_patient(patient_id) );
create policy notifications_update_read on public.notifications for update to authenticated
  using ( private.is_self_patient(patient_id) ) with check ( private.is_self_patient(patient_id) );
revoke update on public.notifications from authenticated, anon;
grant  update (read_at) on public.notifications to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260717090000','20260717090000_wp05b_fam7_gamification_rls.sql',
  'WP-05B Fam7: RLS real (3 modelos). achievements=catalogo (SELECT authenticated; escrita ninguem client). '
  'patient_achievements: SELECT can_access_patient_internal (externo excluido), INSERT is_self_patient '
  '(anti-forja; desbloqueio client-side=divida), append-only. notifications: SELECT/UPDATE(read_at) so o '
  'destinatario; INSERT/DELETE negado (emissor server-side). anon negado.',
  'WP-05B-FAM7')
on conflict (version) do nothing;
