-- Stub MÍNIMO das dependências da FIN-E4 que existem no app mas não no Postgres local descartável (agenda, consulta, acesso ao paciente). NÃO vai para produção.
create table if not exists public.appointments (id uuid primary key default gen_random_uuid(), clinic_id uuid references public.clinics(id) on delete cascade, patient_id uuid, professional_id uuid, title text, starts_at timestamptz default now());
create table if not exists public.clinical_encounters (id uuid primary key default gen_random_uuid(), clinic_id uuid references public.clinics(id) on delete cascade, patient_id uuid references public.patients(id), professional_id uuid references public.professionals(id));
grant select on public.appointments, public.clinical_encounters to authenticated;
-- Acesso ao paciente: aqui, "o profissional tem vínculo" é a tabela de teste public.care_team; admin da clínica sempre. (No app: private.can_access_patient real.)
create table if not exists public.care_team (patient_id uuid, profile_id uuid);
grant select on public.care_team to authenticated;
create or replace function private.can_access_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.care_team c where c.patient_id = p_patient and c.profile_id = private.current_profile_id())
      or exists (select 1 from public.patients pt where pt.id = p_patient and private.is_clinic_admin(pt.clinic_id)) $$;
