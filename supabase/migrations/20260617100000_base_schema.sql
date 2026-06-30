-- VERTEXA — Migration BASE (schema-base promovido de docs/SCHEMA.sql).
-- Reconstrução pós-perda do projeto Supabase antigo (30/06/2026). Promovido a migration para que
-- `db push` / MCP apliquem o schema-base ANTES das migrations incrementais — a 1ª delas
-- (20260617120000_sprint_anon_read_policies) cria policies em tabelas que precisam existir.
-- Idempotente: enums via DO/exception(duplicate_object); tabelas via `create table if not exists`.
-- RLS: HABILITADA nas 17 tabelas-base (decisão de reconstrução; o SCHEMA.sql original não ligava).
--   As policies sprint (sprint_read_all etc.) entram nas migrations seguintes. Sem policy de escrita
--   nessas tabelas até as migrations sprint, anon só lê (após a policy de SELECT). RLS real por
--   papel/clínica continua dívida S9 (#11–#14). NÃO promover esta postura sprint a produção.

-- ========== ENUMS ==========
do $$ begin create type user_role as enum ('professional', 'patient', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type professional_type as enum ('doctor','nutritionist','physiotherapist','personal_trainer','other'); exception when duplicate_object then null; end $$;
do $$ begin create type patient_status as enum ('novo','em_acompanhamento','atencao','em_risco','inativo'); exception when duplicate_object then null; end $$;
do $$ begin create type muscle_status as enum ('fatigued','recovering','recovered','weakened','neutral'); exception when duplicate_object then null; end $$;

-- ========== CORE ==========
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  role user_role not null,
  full_name text not null,
  email text,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_profile_id uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists professionals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  clinic_id uuid references clinics(id),
  type professional_type not null,
  registry_number text,
  specialty text
);

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  clinic_id uuid references clinics(id),
  birth_date date,
  sex text,
  height_cm numeric,
  goal text,
  start_date date default current_date,
  start_weight numeric,
  current_weight numeric,
  target_weight numeric
);

create table if not exists professional_patient_links (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid references professionals(id) on delete cascade,
  patient_id uuid references patients(id) on delete cascade,
  is_external boolean default false,
  status text default 'active',
  created_at timestamptz default now(),
  unique (professional_id, patient_id)
);

-- ========== PLANOS ==========
create table if not exists workout_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  professional_id uuid references professionals(id),
  title text not null,
  goal text,
  created_at timestamptz default now()
);

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  workout_plan_id uuid references workout_plans(id) on delete cascade,
  letter text,
  name text not null,
  primary_muscle_group text,
  day_index int,
  estimated_minutes int
);

create table if not exists workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid references workouts(id) on delete cascade,
  name text not null,
  muscle_groups text[],
  sets int, reps int, load_kg numeric,
  rest_seconds int,
  gif_url text,
  notes text,
  order_index int
);

create table if not exists nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  professional_id uuid references professionals(id),
  title text not null,
  status text default 'active',
  created_at timestamptz default now()
);

create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  nutrition_plan_id uuid references nutrition_plans(id) on delete cascade,
  time text, name text, items text[], calories int, order_index int
);

-- ========== AVALIAÇÃO CORPORAL (métodos selecionáveis) ==========
create table if not exists body_assessments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  professional_id uuid references professionals(id),
  assessed_at date default current_date,
  method text,                 -- bioimpedancia | adipometro | dexa | manual
  weight numeric, body_fat_pct numeric,
  measurements jsonb,
  document_url text,
  created_at timestamptz default now()
);

create table if not exists progress_photos (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  photo_url text not null,
  captured_in_app boolean default true,
  taken_at timestamptz default now()
);

-- ========== EVENTOS = coração da integração ==========
create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  type text not null,
  payload jsonb,
  created_at timestamptz default now()
);

-- ========== RECUPERAÇÃO MUSCULAR ==========
create table if not exists muscle_recovery_states (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  muscle_group text not null,
  last_trained_at timestamptz,
  last_intensity int,
  status muscle_status not null,
  calculated_at timestamptz default now(),
  unique (patient_id, muscle_group)
);

-- ========== VRI snapshot ==========
create table if not exists adherence_snapshots (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  score int, level text, status patient_status,
  streak int, weekly_completion_rate int,
  risk_factors text[], positive_factors text[],
  calculated_at timestamptz default now()
);

-- ========== MENSAGENS / CAMPANHAS ==========
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  sender_role user_role not null,
  sender_professional_id uuid references professionals(id),
  body text not null,
  created_at timestamptz default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id),
  name text not null,
  trigger text,
  message_template text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ========== RLS nas 17 tabelas-base (decisão de reconstrução) ==========
-- Liga RLS; as policies de leitura/escrita sprint vêm nas migrations seguintes
-- (20260617120000_sprint_anon_read_policies em diante).
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','clinics','professionals','patients','professional_patient_links',
    'workout_plans','workouts','workout_exercises','nutrition_plans','meals',
    'body_assessments','progress_photos','activity_events','muscle_recovery_states',
    'adherence_snapshots','messages','campaigns'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
