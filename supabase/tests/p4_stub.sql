-- Stub MÍNIMO para a prova SQL da parte 4 do redesign (importar/exportar pacientes) num Postgres LOCAL descartável. NÃO vai para produção.
-- create_patient aqui é um substituto simplificado (mesma assinatura e mesma regra de admin); o real está provado em produção.
alter table public.profiles add column if not exists email text;
alter table public.patients add column if not exists birth_date date, add column if not exists sex text, add column if not exists height_cm numeric,
  add column if not exists goal text, add column if not exists start_date date default current_date, add column if not exists start_weight numeric,
  add column if not exists current_weight numeric, add column if not exists target_weight numeric;
create table public.professional_patient_links (id uuid primary key default gen_random_uuid(), professional_id uuid references public.professionals(id),
  patient_id uuid references public.patients(id) on delete cascade, is_external boolean default false, status text default 'active');
create table public.weight_logs (id uuid primary key default gen_random_uuid(), patient_id uuid references public.patients(id) on delete cascade,
  weight_kg numeric not null, measured_at timestamptz not null default now());
create table public.adherence_snapshots (id uuid primary key default gen_random_uuid(), patient_id uuid references public.patients(id) on delete cascade,
  score int, status text, weekly_completion_rate int, calculated_at timestamptz default now());
grant select on public.professional_patient_links, public.weight_logs, public.adherence_snapshots to authenticated;
create function private.clinic_is_operational(p_clinic uuid) returns boolean language sql stable as $$ select true $$;
create function private.identity_email_lock(p_email text) returns void language plpgsql set search_path = '' as $$
begin if p_email is null or btrim(p_email) = '' then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vertexa:identity-email:' || lower(btrim(p_email)), 0)); end $$;
create function private.clinical_can_access_patient(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.patients pt where pt.id = p_patient and private.is_clinic_admin(pt.clinic_id)) $$;
create function public.create_patient(
  p_clinic_id uuid, p_full_name text, p_email text default null, p_birth_date date default null, p_sex text default null, p_height_cm numeric default null,
  p_goal text default null, p_start_weight numeric default null, p_target_weight numeric default null, p_anamnese_method text default null,
  p_anamnese_weight numeric default null, p_anamnese_body_fat_pct numeric default null, p_anamnese_notes text default null, p_start_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prof uuid; v_pat uuid;
begin
  if not private.is_clinic_admin(p_clinic_id) then raise exception 'forbidden: PATIENT_CREATE_ADMIN_REQUIRED' using errcode = '42501'; end if;
  insert into public.profiles (full_name, email, status) values (btrim(p_full_name), nullif(btrim(coalesce(p_email,'')),''), 'active') returning id into v_prof;
  insert into public.patients (profile_id, clinic_id, goal, birth_date, sex, height_cm, start_weight, current_weight, target_weight, start_date)
  values (v_prof, p_clinic_id, p_goal, p_birth_date, p_sex, p_height_cm, p_start_weight, p_start_weight, p_target_weight, coalesce(p_start_date, current_date)) returning id into v_pat;
  insert into public.professional_patient_links (professional_id, patient_id)
    select pr.id, v_pat from public.professionals pr where pr.clinic_id = p_clinic_id and pr.profile_id = private.current_profile_id() limit 1;
  return v_pat;
end $$;
alter table public.schema_migration_log add constraint schema_migration_log_version_key unique (version);
