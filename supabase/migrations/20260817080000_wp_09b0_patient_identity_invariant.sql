-- =====================================================================================
-- WP-09B0 — invariante 1 conta paciente = 1 patients row.
--
-- Produto: a mesma pessoa NÃO pertence a duas clínicas com a mesma conta.
-- UNIQUE (profile_id) é GLOBAL. NULLs continuam permitidos (pré-conta / pré-ativação).
-- Sem NOT NULL. Sem UNIQUE(profile_id, clinic_id). Sem Care Team. Sem policy. Sem cron.
--
-- current_patient_id() deixa de usar LIMIT 1: 0 rows → NULL; 1 row → id;
-- >1 row (estado inválido) → erro do executor SQL (fail-closed, não escolha arbitrária).
--
-- NÃO APLICAR no remoto neste WP.
-- =====================================================================================

alter table public.patients
  add constraint patients_profile_id_key unique (profile_id);

comment on constraint patients_profile_id_key on public.patients is
  'WP-09B0: 1 profiles.id → no máximo 1 patients.id. profile_id NULL continua permitido.';

create or replace function private.current_patient_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pt.id
    from public.patients pt
   where pt.profile_id = private.current_profile_id()
$$;

comment on function private.current_patient_id() is
  'WP-09B0: JWT → current_profile_id() → patients.profile_id. Sem LIMIT 1. '
  '0 rows = NULL; 1 row = patient.id. Unicidade estrutural em patients_profile_id_key.';

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260817080000',
  '20260817080000_wp_09b0_patient_identity_invariant.sql',
  'WP-09B0: UNIQUE global patients.profile_id (NULLs ok) e current_patient_id() sem LIMIT 1. '
  'Sem NOT NULL, sem Care Team, sem policy, sem apply remoto.',
  'WP-09B0'
)
on conflict (version) do nothing;
