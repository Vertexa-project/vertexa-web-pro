-- =====================================================================================
-- WP-05B · FAMÍLIA 6 (Agenda/Clínica) · parte 2/2 — RLS REAL (DUAS CHAVES). Idempotente.
-- ESCOPO: appointments, campaigns, calendar_connections, calendar_event_cache.
-- NÃO TOCA: calendar_connection_tokens e calendar_oauth_state (deny-all, sem policy nem grant — tokens
--   NUNCA vão ao client; só service_role/Edge acessa). Confirmado.
--
-- CHAVE PACIENTE — appointments (AUTH-AGENDA-1: vínculo, não clínica):
--   SELECT = admin da clínica OU (paciente vinculado, prof comum) OU (prof ATRIBUÍDO lê a sua consulta).
--   WRITE  = admin OU (paciente vinculado) OU (bloco SEM paciente do próprio prof). NÃO permite auto-
--            atribuir-se a paciente não-vinculado (mesma clínica NÃO basta). Paciente e EXTERNO EXCLUÍDOS
--            (o app não consome agenda; `notes` é sensível — não vaza ao paciente). patient_id/clinic_id imutáveis.
-- CHAVE CLÍNICA — campaigns: SELECT = staff da clínica (admin+profissionais; PACIENTE NÃO vê); escrita = admin.
-- CHAVE CLÍNICA/PROF — calendar_connections: SELECT = dono da conexão OU admin (expõe google_account_email);
--   SEM write de client (Edge/service_role escreve). calendar_event_cache: SELECT = dono da conexão OU admin
--   (COERÊNCIA: fecha a porta lateral do Google — quem não veria a consulta também não vê o cache do outro
--   profissional); SEM write de client.
-- anon: sem policy => negado. service_role/postgres: bypassrls (Edge Functions do Google).
--
-- KILL SWITCH (fail-closed): drop das policies destas 4 -> deny-all; NUNCA reabrir anon:
--   do $$ declare r record; begin
--     for r in select policyname, tablename from pg_policies where schemaname='public'
--       and tablename in ('appointments','campaigns','calendar_connections','calendar_event_cache')
--     loop execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename); end loop;
--   end $$;
-- Sintoma: prof não vê/gere a agenda OU membro não vê campanha/calendário -> corrigir p/ FRENTE; jamais sprint_*.
-- =====================================================================================

-- appointments
drop policy if exists sprint_appointment_read  on public.appointments;
drop policy if exists sprint_appointment_write on public.appointments;
drop policy if exists appointments_select on public.appointments;
drop policy if exists appointments_write_insert on public.appointments;
drop policy if exists appointments_write_update on public.appointments;
drop policy if exists appointments_write_delete on public.appointments;
create policy appointments_select on public.appointments for select to authenticated using (
  private.is_clinic_admin(clinic_id)
  or (patient_id is not null and private.is_common_professional_of_patient(patient_id))
  or (professional_id is not null and private.owns_professional(professional_id))
);
create policy appointments_write_insert on public.appointments for insert to authenticated with check (
  private.is_clinic_admin(clinic_id)
  or (patient_id is not null and private.is_common_professional_of_patient(patient_id))
  or (patient_id is null and professional_id is not null and private.owns_professional(professional_id))
);
create policy appointments_write_update on public.appointments for update to authenticated
  using (
    private.is_clinic_admin(clinic_id)
    or (patient_id is not null and private.is_common_professional_of_patient(patient_id))
    or (patient_id is null and professional_id is not null and private.owns_professional(professional_id)) )
  with check (
    private.is_clinic_admin(clinic_id)
    or (patient_id is not null and private.is_common_professional_of_patient(patient_id))
    or (patient_id is null and professional_id is not null and private.owns_professional(professional_id)) );
create policy appointments_write_delete on public.appointments for delete to authenticated using (
  private.is_clinic_admin(clinic_id)
  or (patient_id is not null and private.is_common_professional_of_patient(patient_id))
  or (patient_id is null and professional_id is not null and private.owns_professional(professional_id))
);
revoke update on public.appointments from authenticated, anon;
grant  update (professional_id, title, starts_at, ends_at, notes, type, status) on public.appointments to authenticated;

-- campaigns (chave clínica; staff lê, admin escreve; paciente NÃO vê)
drop policy if exists sprint_read_all on public.campaigns;
drop policy if exists campaigns_select on public.campaigns;
drop policy if exists campaigns_write_insert on public.campaigns;
drop policy if exists campaigns_write_update on public.campaigns;
drop policy if exists campaigns_write_delete on public.campaigns;
create policy campaigns_select on public.campaigns for select to authenticated using ( private.is_clinic_staff(clinic_id) );
create policy campaigns_write_insert on public.campaigns for insert to authenticated with check ( private.is_clinic_admin(clinic_id) );
create policy campaigns_write_update on public.campaigns for update to authenticated using ( private.is_clinic_admin(clinic_id) ) with check ( private.is_clinic_admin(clinic_id) );
create policy campaigns_write_delete on public.campaigns for delete to authenticated using ( private.is_clinic_admin(clinic_id) );
revoke update on public.campaigns from authenticated, anon;
grant  update (name, trigger, message_template, is_active) on public.campaigns to authenticated;

-- calendar_connections (SELECT-only client: dono da conexão + admin; Edge escreve)
drop policy if exists sprint_calendar_connection_read on public.calendar_connections;
drop policy if exists calendar_connections_select on public.calendar_connections;
create policy calendar_connections_select on public.calendar_connections for select to authenticated using (
  private.is_clinic_admin(clinic_id) or (professional_id is not null and private.owns_professional(professional_id))
);
revoke update on public.calendar_connections from authenticated, anon;

-- calendar_event_cache (COERÊNCIA: dono da conexão + admin; fecha porta lateral do Google)
drop policy if exists sprint_calendar_event_read on public.calendar_event_cache;
drop policy if exists calendar_event_cache_select on public.calendar_event_cache;
create policy calendar_event_cache_select on public.calendar_event_cache for select to authenticated using (
  private.is_clinic_admin(clinic_id) or private.owns_calendar_connection(connection_id)
);
revoke update on public.calendar_event_cache from authenticated, anon;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260716091000','20260716091000_wp05b_fam6_agenda_clinic_rls.sql',
  'WP-05B Fam6: RLS real Agenda/Clinica (2 chaves). appointments por vinculo+admin (paciente/externo '
  'excluidos; prof atribuido le; escrita nao auto-atribui a nao-vinculado; patient_id/clinic_id imutaveis). '
  'campaigns por staff da clinica (escrita admin). calendar_connections/event_cache SELECT-only (dono+admin; '
  'fecha porta lateral do Google); Edge escreve. tokens/oauth_state NAO tocados (deny-all). anon negado.',
  'WP-05B-FAM6')
on conflict (version) do nothing;
