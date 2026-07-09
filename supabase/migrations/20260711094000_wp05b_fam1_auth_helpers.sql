-- =====================================================================================
-- WP-05B · FAMÍLIA 1 · parte 2/3 — HELPERS DE AUTORIZAÇÃO (fundação da RLS real)
--
-- Contrato de identidade: auth.uid() -> profiles.auth_user_id -> profiles.id ->
--   (patients.profile_id | professionals.profile_id) -> clinic.
--
-- Por que SECURITY DEFINER + search_path='' (anti-recursão / anti-shadow / anti-metadata):
--   - DEFINER: as funções rodam como o dono (postgres, bypassrls). Assim, quando a policy de
--     `patients` chama can_access_patient(), a leitura interna de patients/links/professionals
--     NÃO dispara as policies dessas tabelas -> QUEBRA a recursão (policy A -> tabela B -> policy A).
--     Por isso NÃO usar FORCE ROW LEVEL SECURITY nessas tabelas (FORCE remove o bypass do dono e
--     recria a recursão + trava o handle_new_user).
--   - search_path='' + tudo schema-qualified: impede função-sombra em public sequestrar a resolução.
--   - Sem entrada controlável pelo client: usam só auth.uid() (JWT verificado) e tabelas do servidor;
--     nunca user_metadata/signup_surface; nunca recebem role do client; nunca escrevem.
--   - EXECUTE só para authenticated (revogado de public/anon) -> anon não chama os helpers.
--   - schema `private` NÃO exposto na Data API (Settings > API deve manter exposed=public/graphql_public).
--
-- Idempotente (create or replace / if not exists). Rollback: drop schema private cascade;
-- =====================================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.current_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.auth_user_id = (select auth.uid()) limit 1
$$;

create or replace function private.current_patient_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select pt.id from public.patients pt where pt.profile_id = private.current_profile_id() limit 1
$$;

create or replace function private.owns_professional(p_prof uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.professionals pr
                where pr.id = p_prof and pr.profile_id = private.current_profile_id())
$$;

create or replace function private.is_clinic_admin(p_clinic uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic is not null and (
    exists(select 1 from public.clinics c
           where c.id = p_clinic and c.owner_profile_id = private.current_profile_id())
    or exists(select 1 from public.professionals pr
              where pr.clinic_id = p_clinic and pr.clinic_role = 'admin'
                and pr.profile_id = private.current_profile_id())
  )
$$;

create or replace function private.is_clinic_member(p_clinic uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic is not null and (
    private.is_clinic_admin(p_clinic)
    or exists(select 1 from public.professionals pr
              where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id())
    or exists(select 1 from public.patients pt
              where pt.clinic_id = p_clinic and pt.profile_id = private.current_profile_id())
  )
$$;

create or replace function private.is_self_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.patients pt
                where pt.id = p_patient and pt.profile_id = private.current_profile_id())
$$;

create or replace function private.patient_clinic(p_patient uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select pt.clinic_id from public.patients pt where pt.id = p_patient
$$;

create or replace function private.is_common_professional_of_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.professional_patient_links l
    join public.professionals pr on pr.id = l.professional_id
    where l.patient_id = p_patient and coalesce(l.status,'active') = 'active'
      and coalesce(l.is_external,false) = false
      and pr.profile_id = private.current_profile_id())
$$;

create or replace function private.is_external_professional_of_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.professional_patient_links l
    join public.professionals pr on pr.id = l.professional_id
    where l.patient_id = p_patient and coalesce(l.status,'active') = 'active'
      and coalesce(l.is_external,false) = true
      and pr.profile_id = private.current_profile_id())
$$;

create or replace function private.can_access_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_self_patient(p_patient)
      or private.is_common_professional_of_patient(p_patient)
      or private.is_external_professional_of_patient(p_patient)
      or private.is_clinic_admin(private.patient_clinic(p_patient))
$$;

create or replace function private.can_see_profile(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    p_target = private.current_profile_id()
    or exists(select 1 from public.patients pt
              where pt.profile_id = p_target and private.can_access_patient(pt.id))
    or exists(select 1 from public.professionals pr
              where pr.profile_id = p_target and private.is_clinic_admin(pr.clinic_id))
    or exists(
      select 1 from public.professional_patient_links l
      join public.professionals pr on pr.id = l.professional_id
      join public.patients pt on pt.id = l.patient_id
      where pr.profile_id = p_target and pt.profile_id = private.current_profile_id()
        and coalesce(l.status,'active') = 'active')
$$;

-- Fecha execução: nunca public/anon; só authenticated (as policies rodam como authenticated).
revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260711094000','20260711094000_wp05b_fam1_auth_helpers.sql',
  'WP-05B Fam1: helpers SECURITY DEFINER (schema private, search_path='''', execute so authenticated): '
  'current_profile_id/current_patient_id/owns_professional/is_clinic_admin/is_clinic_member/is_self_patient/'
  'patient_clinic/is_common|external_professional_of_patient/can_access_patient/can_see_profile. Anti-recursao.',
  'WP-05B-FAM1')
on conflict (version) do nothing;
