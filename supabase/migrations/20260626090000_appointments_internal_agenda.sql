-- =====================================================================================
-- VERTEXA — Sessão 6 (web): AGENDA INTERNA (Review §3). Tabela `appointments`.
-- ADITIVA e reversível. NÃO altera tabelas/colunas existentes (só cria tabela/policies).
--
-- Decisão travada: agenda INTERNA (sem credenciais Google nesta fase). A web faz o CRUD
-- real dos compromissos; o botão "Conectar Google Agenda" é gancho/placeholder (dívida #19):
-- quando vierem as credenciais, troca-se a FONTE da agenda pela API do Google. Google Meet
-- NÃO entra. O app paciente NÃO usa esta tabela (web-only).
--
-- Isolamento por clínica: `clinic_id` (NOT NULL) escopa os compromissos à clínica do
-- profissional logado (no client; validar no servidor antes de dado real — #11–#14).
--
-- ⚠️ RLS permissiva — SPRINT. Só com seed/dados fictícios. Antes de dado real, trocar por
-- RLS por papel/clínica/vínculo (mesma dívida dos demais `sprint_*`).
--
-- Rollback:
--   drop table if exists public.appointments cascade;
-- =====================================================================================

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- Consulta da agenda = por clínica + janela de tempo, ordenada por início.
create index if not exists appointments_clinic_starts_idx
  on public.appointments (clinic_id, starts_at);

alter table public.appointments enable row level security;

-- Leitura (sprint): qualquer anon/auth lê (igual ao padrão sprint_read_all das demais tabelas).
drop policy if exists sprint_appointment_read on public.appointments;
create policy sprint_appointment_read on public.appointments
  for select to anon, authenticated using (true);

-- Escrita (sprint): CRUD completo (criar/editar/excluir) — padrão permissivo igual a chat/planos.
drop policy if exists sprint_appointment_write on public.appointments;
create policy sprint_appointment_write on public.appointments
  for all to anon, authenticated using (true) with check (true);
