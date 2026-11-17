-- Complementos do stub p6 para a prova SQL da A6 (reengajamento). Só local, nunca produção.
alter table public.profiles add column if not exists created_at timestamptz not null default now();
create type public.user_role as enum ('patient','professional','admin');
create table public.activity_events (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete cascade, type text not null, created_at timestamptz not null default now());
create table public.weight_logs (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete cascade, measured_at timestamptz not null default now());
create table public.progress_photos (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete cascade, taken_at timestamptz not null default now());
create table public.chat_channels (id uuid primary key default gen_random_uuid(), patient_id uuid references public.patients(id) on delete cascade unique, created_at timestamptz default now());
create table public.chat_participants (id uuid primary key default gen_random_uuid(), channel_id uuid references public.chat_channels(id) on delete cascade, profile_id uuid references public.profiles(id) on delete cascade, role public.user_role not null, unique (channel_id, profile_id));
create table public.chat_messages (id uuid primary key default gen_random_uuid(), channel_id uuid references public.chat_channels(id) on delete cascade, sender_profile_id uuid references public.profiles(id), sender_role public.user_role not null, body text not null, created_at timestamptz default now());
create function private.is_clinic_staff(p_clinic uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select p_clinic is not null and (private.is_clinic_admin(p_clinic) or exists(select 1 from public.professionals pr where pr.clinic_id = p_clinic and pr.profile_id = private.current_profile_id())) $$;
create function private.can_access_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_self_patient(p_patient) or private.is_common_professional_of_patient(p_patient) or private.is_clinic_admin(private.patient_clinic(p_patient)) $$;
create function private.clinic_is_operational(p_clinic uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
create function private.campaign_render(p_text text, p_full_name text) returns text language sql immutable set search_path = '' as $$
  select replace(p_text, '{nome}', coalesce(nullif(split_part(btrim(coalesce(p_full_name,'')), ' ', 1), ''), 'você')) $$;
grant execute on all functions in schema private to authenticated;
-- paciente sem conta (profile_id nulo) e paciente inativo
insert into public.profiles (id, auth_user_id, full_name, status) values ('00000000-0000-0000-0000-0000000000c4', gen_random_uuid(), 'Inativa Teste', 'inactive');
insert into public.patients (id, profile_id, clinic_id) values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000ca01');
