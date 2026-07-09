-- =====================================================================================
-- WP-05B · FAMÍLIA 1 (Identidade) · parte 1/3 — CO-ADMIN (migration ADITIVA e reversível)
--
-- Decisão do dono AUTH-ADMIN-1: admin = DONO (clinics.owner_profile_id) OU co-admin por
-- MEMBERSHIP controlada no servidor. NUNCA derivar admin de profiles.role (mutável).
-- O schema NÃO tinha nenhuma noção de co-admin (professionals só tinha type/registry/specialty).
-- Esta migration adiciona professionals.clinic_role {member|admin}, setável só por admin (a RLS
-- da parte 3 restringe a escrita de professionals ao admin da clínica).
--
-- ADITIVA: só add column + check + comment. Não remove/renomeia nada. Determinística/idempotente.
-- Rollback conhecido:
--   alter table public.professionals drop column if exists clinic_role;
-- =====================================================================================

alter table public.professionals add column if not exists clinic_role text not null default 'member';

do $$ begin
  alter table public.professionals
    add constraint professionals_clinic_role_chk check (clinic_role in ('member','admin'));
exception when duplicate_object then null; end $$;

comment on column public.professionals.clinic_role is
  'member|admin. admin = co-admin da clinica (WP-05 AUTH-ADMIN-1). Setavel so por admin via RLS. '
  'NUNCA derivar admin de profiles.role.';

insert into public.schema_migration_log (version, filename, description, session)
values ('20260711093000','20260711093000_wp05b_fam1_coadmin.sql',
  'WP-05B Fam1: coluna aditiva professionals.clinic_role {member|admin} p/ co-admin (AUTH-ADMIN-1).',
  'WP-05B-FAM1')
on conflict (version) do nothing;
