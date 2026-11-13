-- Esqueleto MÍNIMO do Supabase para provar as migrations clinical_* num Postgres local DESCARTÁVEL.
-- (roles, auth.uid(), storage, e as tabelas existentes que a feature lê). Nunca roda em produção.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; create schema storage; create schema private; create extension if not exists pgcrypto;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema public, auth, storage, private to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant usage on sequences to anon, authenticated, service_role;

create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated, service_role;

create table public.clinics (id uuid primary key, name text, status text default 'active', owner_profile_id uuid);
create table public.profiles (id uuid primary key, auth_user_id uuid, full_name text, email text);
create table public.professionals (id uuid primary key, profile_id uuid, clinic_id uuid, type text, registry_number text, specialty text, clinic_role text, status text default 'active');
create table public.patients (id uuid primary key, profile_id uuid, clinic_id uuid);
create table public.professional_patient_links (id uuid primary key default gen_random_uuid(), professional_id uuid, patient_id uuid, is_external boolean default false, status text default 'active');
create table public.notifications (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id), type text not null, title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now());
create table public.schema_migration_log (version text, filename text, description text, session text, applied_at timestamptz default now());

create function private.current_profile_id() returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.auth_user_id = (select auth.uid()) limit 1 $$;
create function private.clinic_is_operational(p_clinic_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clinics c where c.id = p_clinic_id and c.status = 'active') $$;
create function private.is_self_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.patients pt where pt.id = p_patient and pt.profile_id = private.current_profile_id()) $$;
grant execute on all functions in schema private to authenticated;
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated using (private.is_self_patient(patient_id));

-- seed com os MESMOS ids que a prova usa (fictícios)
insert into public.clinics (id, name) values ('0772a4aa-bf03-482b-8512-ea6557f06a04','QA'),('7d5ed85e-7b61-4f27-ac06-62caf577af9b','Outra');
insert into public.profiles (id, auth_user_id, full_name) values
 ('b6f0fb90-7e8b-4116-a9c0-fdf7b33f6e8e','fa747d61-7702-4f8a-a2ac-559b4555aaa5','Prof QA'),
 ('00000000-0000-0000-0000-0000000000a1','20f5c2b1-cecf-4021-9e6e-75ce072e4cc9','Mariana'),
 ('00000000-0000-0000-0000-0000000000a2','b80f9f2e-6538-441a-bd6d-ca8c738d1337','Admin outra'),
 ('00000000-0000-0000-0000-0000000000a3','57efaff6-fcfe-4c1e-9327-37cf50fcc26b','Financeiro'),
 ('00000000-0000-0000-0000-0000000000a4','36191555-cfcc-4a87-837e-be8e2c021571','Recepção'),
 ('00000000-0000-0000-0000-0000000000a5','9b75ae26-39ca-498b-a9ca-543656c878e5','Bia');
insert into public.professionals (id, profile_id, clinic_id, type, registry_number, clinic_role) values
 ('90df80ab-7162-4151-82a4-fbf5b033b396','b6f0fb90-7e8b-4116-a9c0-fdf7b33f6e8e','0772a4aa-bf03-482b-8512-ea6557f06a04','other','CRM 123','admin'),
 ('c009762d-7e1a-4268-bbeb-db03bcf763a0','00000000-0000-0000-0000-0000000000a2','7d5ed85e-7b61-4f27-ac06-62caf577af9b','other',null,'admin'),
 ('97140e40-e98c-4a3d-98aa-0972b79d093e','00000000-0000-0000-0000-0000000000a3','0772a4aa-bf03-482b-8512-ea6557f06a04','other',null,'member'),
 ('15cfe4b9-033a-4e55-a263-8a4795ec843a','00000000-0000-0000-0000-0000000000a4','0772a4aa-bf03-482b-8512-ea6557f06a04','other',null,'member'),
 ('8bed7723-e1b3-4188-b3a4-575911fea3fa','00000000-0000-0000-0000-0000000000a5','0772a4aa-bf03-482b-8512-ea6557f06a04','other',null,'member');
insert into public.patients (id, profile_id, clinic_id) values ('cc2a636b-aec9-4132-afe7-475d293d67de','00000000-0000-0000-0000-0000000000a1','0772a4aa-bf03-482b-8512-ea6557f06a04');
insert into public.professional_patient_links (professional_id, patient_id) values ('90df80ab-7162-4151-82a4-fbf5b033b396','cc2a636b-aec9-4132-afe7-475d293d67de');
