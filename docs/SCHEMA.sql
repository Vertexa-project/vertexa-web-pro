-- VERTEXA — Schema Supabase (happy path para a sprint até 22/06)
-- Compartilhado entre Web Profissional e App Paciente.
-- O coração da integração é activity_events. Derivado do eventTracker.ts/adherenceEngine.ts
-- que JÁ existem no app paciente.

-- ========== ENUMS ==========
create type user_role as enum ('professional', 'patient', 'admin');
create type professional_type as enum ('doctor','nutritionist','physiotherapist','personal_trainer','other');
create type patient_status as enum ('novo','em_acompanhamento','atencao','em_risco','inativo');
create type muscle_status as enum ('fatigued','recovering','recovered','weakened','neutral');

-- ========== CORE ==========
create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  role user_role not null,
  full_name text not null,
  email text,
  avatar_url text,
  created_at timestamptz default now()
);

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_profile_id uuid references profiles(id),
  created_at timestamptz default now()
);

create table professionals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  clinic_id uuid references clinics(id),
  type professional_type not null,
  registry_number text,
  specialty text
);

create table patients (
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

create table professional_patient_links (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid references professionals(id) on delete cascade,
  patient_id uuid references patients(id) on delete cascade,
  is_external boolean default false,
  status text default 'active',
  created_at timestamptz default now(),
  unique (professional_id, patient_id)
);

-- ========== PLANOS ==========
create table workout_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  professional_id uuid references professionals(id),
  title text not null,
  goal text,
  created_at timestamptz default now()
);

create table workouts (
  id uuid primary key default gen_random_uuid(),
  workout_plan_id uuid references workout_plans(id) on delete cascade,
  letter text,
  name text not null,
  primary_muscle_group text,
  day_index int,
  estimated_minutes int
);

create table workout_exercises (
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

create table nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  professional_id uuid references professionals(id),
  title text not null,
  status text default 'active',
  created_at timestamptz default now()
);

create table meals (
  id uuid primary key default gen_random_uuid(),
  nutrition_plan_id uuid references nutrition_plans(id) on delete cascade,
  time text, name text, items text[], calories int, order_index int
);

-- ========== AVALIAÇÃO CORPORAL (métodos selecionáveis) ==========
create table body_assessments (
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

create table progress_photos (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  photo_url text not null,
  captured_in_app boolean default true,
  taken_at timestamptz default now()
);

-- ========== EVENTOS = coração da integração ==========
create table activity_events (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  type text not null,
  payload jsonb,
  created_at timestamptz default now()
);

-- ========== RECUPERAÇÃO MUSCULAR ==========
create table muscle_recovery_states (
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
create table adherence_snapshots (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  score int, level text, status patient_status,
  streak int, weekly_completion_rate int,
  risk_factors text[], positive_factors text[],
  calculated_at timestamptz default now()
);

-- ========== MENSAGENS / CAMPANHAS ==========
create table messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  sender_role user_role not null,
  sender_professional_id uuid references professionals(id),
  body text not null,
  created_at timestamptz default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id),
  name text not null,
  trigger text,
  message_template text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- NOTA: RLS real fica para pós-22/06. Nesta sprint usar apenas anon key no client.
