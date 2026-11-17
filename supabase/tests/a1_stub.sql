-- Complemento do p6_stub para a prova SQL da automação A1 (pré-consulta). Só local. Reproduz appointments (com type/status), storage e o parser de path.
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select, insert, delete on storage.objects to authenticated;
insert into storage.buckets (id, name) values ('patient-documents','patient-documents');
create function private.storage_object_patient(p_name text) returns uuid language sql immutable set search_path = '' as $$
  select case when p_name like '%/%' and split_part(p_name,'/',1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_name,'/',1)::uuid end $$;
grant execute on function private.storage_object_patient(text) to authenticated;
create table public.appointments (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null, professional_id uuid references public.professionals(id) on delete set null,
  title text not null, starts_at timestamptz not null, ends_at timestamptz, notes text, created_at timestamptz not null default now(),
  type text not null default 'consulta' check (type in ('consulta','retorno','previsao_retorno','outros')),
  status text not null default 'confirmado' check (status in ('confirmado','pendente','desmarcado')));
grant select, insert, update, delete on public.appointments to authenticated;
-- a Recepção do fixture (e4) não tem vínculo nenhum com pacientes: só marca consulta como admin faria
