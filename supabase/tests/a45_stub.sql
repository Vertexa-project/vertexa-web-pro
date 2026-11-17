-- Complementos do p6_stub para a prova SQL de A4+A5 (só local, nunca produção).
alter table public.patients add column if not exists created_at timestamptz not null default now();
create table public.progress_photos (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete cascade,
  storage_path text, taken_at timestamptz not null default now(), pose text check (pose is null or pose in ('front','side','back')));
create table public.weight_logs (id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete cascade,
  weight_kg numeric not null, measured_at timestamptz not null default now(), review_status text not null default 'ok');
alter default privileges in schema public grant execute on functions to authenticated;
