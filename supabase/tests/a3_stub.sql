-- Stub MÍNIMO para a prova SQL da automação A3 (medicação) num Postgres LOCAL descartável. NÃO vai para produção.
-- Reproduz só o que a migration A3 usa do banco real (helpers de acesso ao paciente e disciplinas), simplificados.
alter table public.schema_migration_log add constraint schema_migration_log_version_key unique (version);
create table public.professional_patient_links (id uuid primary key default gen_random_uuid(), professional_id uuid references public.professionals(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete cascade, is_external boolean default false, status text default 'active');
create table public.professional_disciplines (professional_id uuid not null references public.professionals(id) on delete cascade, discipline text not null, primary key (professional_id, discipline));
create function private.brt_date(p_ts timestamptz) returns date language sql immutable as $$ select (p_ts at time zone 'America/Sao_Paulo')::date $$;
create function private.patient_clinic(p_patient uuid) returns uuid language sql stable security definer set search_path = '' as $$ select clinic_id from public.patients where id = p_patient $$;
create function private.clinic_is_operational(p_clinic uuid) returns boolean language sql stable as $$ select true $$;
create function private.is_self_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.patients pt where pt.id = p_patient and pt.profile_id = private.current_profile_id()) $$;
create function private.is_common_professional_of_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.professional_patient_links l join public.professionals pr on pr.id = l.professional_id
    where l.patient_id = p_patient and coalesce(l.status,'active') = 'active' and coalesce(l.is_external,false) = false and pr.profile_id = private.current_profile_id()) $$;
create function private.can_access_patient_internal(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_self_patient(p_patient) or private.is_common_professional_of_patient(p_patient) or private.is_clinic_admin(private.patient_clinic(p_patient)) $$;
create function private.can_prescribe_for_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_common_professional_of_patient(p_patient) or private.is_clinic_admin(private.patient_clinic(p_patient)) $$;
create function private.can_write_discipline(p_patient uuid, p_disciplines text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_prescribe_for_patient(p_patient) and exists (select 1 from public.professional_disciplines pd join public.professionals pr on pr.id = pd.professional_id
    where pr.profile_id = private.current_profile_id() and pr.clinic_id = private.patient_clinic(p_patient) and pd.discipline = any(p_disciplines)) $$;
grant execute on all functions in schema private to authenticated;
