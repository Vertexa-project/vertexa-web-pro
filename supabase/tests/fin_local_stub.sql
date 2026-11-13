-- Stub MÍNIMO para provar as migrations FIN-E1/E2 num Postgres LOCAL descartável (sem Supabase). NÃO vai para produção.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
create schema if not exists private;
grant usage on schema private, auth to authenticated, anon;
grant usage on schema public to authenticated, anon;

create table public.profiles (id uuid primary key default gen_random_uuid(), auth_user_id uuid, full_name text not null);
create table public.clinics (id uuid primary key default gen_random_uuid(), name text not null, owner_profile_id uuid references public.profiles(id));
create table public.professionals (id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles(id), clinic_id uuid references public.clinics(id),
  status text default 'active', clinic_role text);
create table public.patients (id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles(id), clinic_id uuid references public.clinics(id));
create table public.schema_migration_log (version text, filename text, description text, session text, applied_at timestamptz default now());
grant select on public.profiles, public.clinics, public.professionals, public.patients to authenticated;

create function private.current_profile_id() returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.auth_user_id = (select auth.uid()) limit 1 $$;
create function private.is_clinic_admin(p_clinic uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic is not null and (exists(select 1 from public.clinics c where c.id = p_clinic and c.owner_profile_id = private.current_profile_id())
    or exists(select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.clinic_role = 'admin' and pr.profile_id = private.current_profile_id())) $$;
create function private.is_clinic_member(p_clinic uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic is not null and (private.is_clinic_admin(p_clinic)
    or exists(select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id() and coalesce(pr.status,'active') = 'active')
    or exists(select 1 from public.patients pt where pt.clinic_id = p_clinic and pt.profile_id = private.current_profile_id())) $$;
