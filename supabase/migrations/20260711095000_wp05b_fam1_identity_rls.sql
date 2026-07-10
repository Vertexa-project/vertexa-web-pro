-- =====================================================================================
-- WP-05B · FAMÍLIA 1 · parte 3/3 — RLS REAL das 5 tabelas de identidade
-- Substitui as sprint_* (anon/authenticated using(true)) por RLS por papel/clínica/vínculo.
--
-- Natureza: SUBSTITUIÇÃO de política de segurança (contração do acesso). Determinística/idempotente.
-- anon: sem policy => negado em todas as 5. service_role/postgres: bypassrls (Edge Functions).
-- Imutabilidade de colunas sensíveis via column privileges (revoke update + grant update(cols)).
-- NÃO usa FORCE RLS (ver parte 2: quebraria o bypass dos helpers).
--
-- KILL SWITCH (fail-closed) — reverter esta família para DENY-ALL (RLS ON + zero policy),
-- NUNCA reabrir anon/using(true). Sintoma: cliente legítimo parou de ler (0 linhas onde deveria
-- ver) OU vazamento detectado -> rodar:
--   do $$ declare r record; begin
--     for r in select policyname, tablename from pg_policies where schemaname='public'
--       and tablename in ('profiles','professionals','patients','professional_patient_links','clinics')
--     loop execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename); end loop;
--   end $$;
-- (Conserto é p/ FRENTE — corrigir a policy. Emergência = deny-all; jamais recriar sprint_*.)
--
-- Rollback "de volta ao estado anterior" seguro = deny-all acima (NÃO restaurar sprint_*).
-- =====================================================================================

-- ---------------- profiles ----------------
drop policy if exists sprint_read_all      on public.profiles;
drop policy if exists sprint_profile_write on public.profiles;
drop policy if exists profiles_select      on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using ( private.can_see_profile(id) );
create policy profiles_update_self on public.profiles for update to authenticated
  using ( id = private.current_profile_id() )
  with check ( id = private.current_profile_id() );
-- imutáveis (role/auth_user_id/status/email/id): só full_name/avatar_url editáveis pelo client.
-- INSERT/DELETE: sem policy => negado (profile nasce via trigger handle_new_user, que roda como owner).
revoke update on public.profiles from authenticated, anon;
grant  update (full_name, avatar_url) on public.profiles to authenticated;

-- ---------------- clinics ----------------
drop policy if exists sprint_read_all       on public.clinics;
drop policy if exists clinics_select        on public.clinics;
drop policy if exists clinics_update_admin  on public.clinics;
create policy clinics_select on public.clinics for select to authenticated
  using ( private.is_clinic_member(id) );
create policy clinics_update_admin on public.clinics for update to authenticated
  using ( private.is_clinic_admin(id) )
  with check ( private.is_clinic_admin(id) );
-- owner_profile_id imutável (anti-takeover): só name editável. INSERT/DELETE: negado (service_role provisiona).
revoke update on public.clinics from authenticated, anon;
grant  update (name) on public.clinics to authenticated;

-- ---------------- professionals ----------------
drop policy if exists sprint_read_all            on public.professionals;
drop policy if exists professionals_select       on public.professionals;
drop policy if exists professionals_admin_write  on public.professionals;
create policy professionals_select on public.professionals for select to authenticated
  using ( profile_id = private.current_profile_id() or private.is_clinic_admin(clinic_id) );
create policy professionals_admin_write on public.professionals for all to authenticated
  using ( private.is_clinic_admin(clinic_id) )
  with check ( private.is_clinic_admin(clinic_id) );
-- profile_id/clinic_id/id imutáveis; admin edita disciplina/registro/clinic_role. (não há self-insert: só admin escreve)
revoke update on public.professionals from authenticated, anon;
grant  update (type, registry_number, specialty, clinic_role) on public.professionals to authenticated;

-- ---------------- patients ----------------
drop policy if exists sprint_read_all        on public.patients;
drop policy if exists sprint_patient_write   on public.patients;
drop policy if exists patients_select        on public.patients;
drop policy if exists patients_admin_insert  on public.patients;
drop policy if exists patients_update        on public.patients;
drop policy if exists patients_admin_delete  on public.patients;
create policy patients_select on public.patients for select to authenticated
  using ( private.can_access_patient(id) );
create policy patients_admin_insert on public.patients for insert to authenticated
  with check ( private.is_clinic_admin(clinic_id) );
create policy patients_update on public.patients for update to authenticated
  using ( private.is_clinic_admin(clinic_id) or private.is_common_professional_of_patient(id) )
  with check ( private.is_clinic_admin(clinic_id) or private.is_common_professional_of_patient(id) );
create policy patients_admin_delete on public.patients for delete to authenticated
  using ( private.is_clinic_admin(clinic_id) );
-- profile_id/clinic_id imutáveis (paciente não muda vínculo/clínica; ninguém "move" paciente pelo client).
-- Externo NÃO escreve (is_common_* exclui is_external).
revoke update on public.patients from authenticated, anon;
grant  update (birth_date, sex, height_cm, goal, start_date, start_weight, current_weight, target_weight)
  on public.patients to authenticated;

-- ---------------- professional_patient_links ----------------
drop policy if exists sprint_read_all          on public.professional_patient_links;
drop policy if exists sprint_patient_link_write on public.professional_patient_links;
drop policy if exists ppl_select               on public.professional_patient_links;
drop policy if exists ppl_admin_write          on public.professional_patient_links;
create policy ppl_select on public.professional_patient_links for select to authenticated
  using (
    private.owns_professional(professional_id)
    or private.is_self_patient(patient_id)
    or private.is_clinic_admin(private.patient_clinic(patient_id))
  );
create policy ppl_admin_write on public.professional_patient_links for all to authenticated
  using ( private.is_clinic_admin(private.patient_clinic(patient_id)) )
  with check ( private.is_clinic_admin(private.patient_clinic(patient_id)) );
-- SÓ admin da clínica do paciente escreve o vínculo (anti self-grant). is_external/status por admin; chaves imutáveis.
revoke update on public.professional_patient_links from authenticated, anon;
grant  update (is_external, status) on public.professional_patient_links to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260711095000','20260711095000_wp05b_fam1_identity_rls.sql',
  'WP-05B Fam1: RLS real (SELECT/INSERT/UPDATE/DELETE) em profiles/clinics/professionals/patients/'
  'professional_patient_links substituindo sprint_*. Column privileges p/ imutabilidade '
  '(role/auth_user_id/owner_profile_id/clinic_id/profile_id). anon negado; service_role bypassa. Kill switch = deny-all.',
  'WP-05B-FAM1')
on conflict (version) do nothing;
