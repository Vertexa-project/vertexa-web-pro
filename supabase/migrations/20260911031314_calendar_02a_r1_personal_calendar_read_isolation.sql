-- =====================================================================================
-- CALENDAR-02A-R1 — isolamento de LEITURA da Google Calendar pessoal.
--
-- ANTES: SELECT em calendar_connections / calendar_event_cache permitia
--   private.is_clinic_admin(clinic_id) — clinic admin lia e-mail Google, status,
--   calendar_name e titles/timestamps do cache de OUTRO profissional.
--
-- DEPOIS: só o profissional dono (private.owns_professional /
--   private.owns_calendar_connection). Admin role NÃO é consentimento.
--
-- Sem helper novo. Sem grant novo. Sem write de client (continua só SELECT).
-- Tokens / oauth_state NÃO tocados (deny-all + service_role).
-- Edge Functions (service_role, bypassrls) inalteradas.
-- Appointments / campaigns / equipe / jornada / disciplinas / auditoria
-- continuam com as policies atuais (is_clinic_admin intacto lá).
--
-- Idempotente: drop + create das duas policies de SELECT.
-- =====================================================================================

drop policy if exists calendar_connections_select on public.calendar_connections;
create policy calendar_connections_select on public.calendar_connections
  for select to authenticated
  using (
    professional_id is not null
    and private.owns_professional(professional_id)
  );

comment on policy calendar_connections_select on public.calendar_connections is
  'CALENDAR-02A-R1: SELECT só da conexão cujo professionals.profile_id = current_profile_id() '
  'e profissional/clínica operacionais (owns_professional). Sem ramo is_clinic_admin. '
  'professional_id NULL = deny (fail closed). Escrita continua só service_role.';

drop policy if exists calendar_event_cache_select on public.calendar_event_cache;
create policy calendar_event_cache_select on public.calendar_event_cache
  for select to authenticated
  using (private.owns_calendar_connection(connection_id));

comment on policy calendar_event_cache_select on public.calendar_event_cache is
  'CALENDAR-02A-R1: SELECT só do cache cuja conexão é do profissional do caller '
  '(owns_calendar_connection → owns_professional). Sem is_clinic_admin(clinic_id). '
  'clinic_id do evento NÃO é autoridade.';

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260911031314',
  '20260911031314_calendar_02a_r1_personal_calendar_read_isolation.sql',
  'CALENDAR-02A-R1: calendar_connections/event_cache SELECT own-professional only. '
  'Remove is_clinic_admin leak. Tokens/oauth_state unchanged. Financial drain untouched.',
  'CALENDAR-02A-R1'
)
on conflict (version) do nothing;
