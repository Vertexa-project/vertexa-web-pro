-- =====================================================================================
-- WP-05B · FAMÍLIA 6 (Agenda/Clínica) · parte 1/2 — HELPERS. Idempotente. DEFINER, search_path='', authenticated.
--
--  · is_clinic_staff(clinic): admin OU profissional da clínica (o PACIENTE não é staff) — chave CLÍNICA
--    (campaigns). Não usa can_access_patient (não é dado por-paciente).
--  · owns_calendar_connection(conn): o profissional da conexão de calendário sou eu — usado no
--    calendar_event_cache p/ FECHAR a porta lateral do Google (não revela o cache de outro profissional).
-- Rollback: drop das 2 funções.
-- =====================================================================================

create or replace function private.is_clinic_staff(p_clinic uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic is not null and (
    private.is_clinic_admin(p_clinic)
    or exists(select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id()))
$$;

create or replace function private.owns_calendar_connection(p_conn uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.calendar_connections c where c.id = p_conn and private.owns_professional(c.professional_id))
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260716090000','20260716090000_wp05b_fam6_helpers.sql',
  'WP-05B Fam6: helpers is_clinic_staff (chave clinica, paciente nao e staff) e owns_calendar_connection '
  '(fecha porta lateral do Google no calendar_event_cache).',
  'WP-05B-FAM6')
on conflict (version) do nothing;
