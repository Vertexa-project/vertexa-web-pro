-- Stub MÍNIMO das dependências da FIN-E9 que existem no app mas não no Postgres local descartável. NÃO vai para produção.
alter table public.professionals add column if not exists registry_number text;
alter table public.professionals add column if not exists specialty text;
alter table public.patients add column if not exists birth_date date;
create table if not exists public.activity_events (id uuid primary key default gen_random_uuid(), patient_id uuid references public.patients(id) on delete cascade, type text not null, payload jsonb, created_at timestamptz default now());
grant select on public.activity_events to authenticated;
create or replace function private.patient_clinic(p_patient uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select clinic_id from public.patients where id = p_patient $$;
create or replace function private.is_self_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.patients pt where pt.id = p_patient and pt.profile_id = private.current_profile_id()) $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;
grant usage on schema public to service_role;
create unique index if not exists schema_migration_log_version_uq on public.schema_migration_log (version);
