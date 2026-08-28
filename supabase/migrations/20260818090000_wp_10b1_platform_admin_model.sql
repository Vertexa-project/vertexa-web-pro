-- =====================================================================================
-- WP-10B1 — autoridade de Platform Admin (operador da PLATAFORMA) + catálogo read-only.
--
-- NÃO confundir com clinic admin (owner_profile_id OU professionals.clinic_role='admin').
-- Esta autoridade NÃO amplia policies clínicas. Superadmin NÃO lê patients/chat/VRI/storage.
--
-- Superfície V1:
--   private.platform_admins          (autoridade interna, schema NÃO exposto ao PostgREST)
--   private.is_platform_admin()      (JWT → current_profile_id; zero args; fail-closed)
--   public.am_i_platform_admin()     (boolean para o frontend)
--   public.list_platform_clinics()   (projeção administrativa; DEFINER após o check)
--
-- Fail-closed de list_platform_clinics: EXCEPTION 42501 / hint NOT_PLATFORM_ADMIN.
-- (Não devolve zero rows — isso confundiria "sem clínicas" com "sem permissão".)
--
-- Counts: COUNT(*) de professionals e patients por clinic_id. SEM filtro de status
-- (active/inactive não é distinguido nesta V1).
--
-- Sem granted_by (evita 2ª FK para profiles / H5). Sem bootstrap de usuário.
-- Sem UI. Sem apply remoto. Sem mutation de clínica.
-- =====================================================================================

create table private.platform_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint platform_admins_status_check
    check (status in ('active', 'revoked')),
  constraint platform_admins_revoke_consistency_check
    check (
      (status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null)
    )
);

comment on table private.platform_admins is
  'WP-10B1: autoridade de Platform Admin (operador da Vertexa). NÃO é clinic admin. '
  'Schema private — sem PostgREST. Sem bootstrap nesta migration.';

comment on column private.platform_admins.status is
  'active | revoked. is_platform_admin exige status=active AND revoked_at IS NULL.';

comment on column private.platform_admins.profile_id is
  'PK = public.profiles.id. NÃO email, NÃO auth_user_id.';

alter table private.platform_admins enable row level security;

revoke all on table private.platform_admins from public, anon, authenticated, service_role;


create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.platform_admins pa
     where pa.profile_id = private.current_profile_id()
       and pa.status = 'active'
       and pa.revoked_at is null
  )
$$;

comment on function private.is_platform_admin() is
  'WP-10B1: JWT → current_profile_id() → platform_admins active. Zero args. Fail-closed '
  '(sem auth / sem profile / revoked / ausente → false). NÃO aceita profile_id do client.';

revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;


create or replace function public.am_i_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
$$;

comment on function public.am_i_platform_admin() is
  'WP-10B1: boolean para o frontend decidir se mostra o painel. Delega a '
  'private.is_platform_admin(). Sem metadata. EXECUTE só authenticated.';

revoke all on function public.am_i_platform_admin() from public, anon;
grant execute on function public.am_i_platform_admin() to authenticated;


create or replace function public.list_platform_clinics()
returns table (
  clinic_id uuid,
  clinic_name text,
  created_at timestamptz,
  owner_profile_id uuid,
  professional_count bigint,
  patient_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'list_platform_clinics: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  return query
  select
    c.id,
    c.name,
    c.created_at,
    c.owner_profile_id,
    (select count(*) from public.professionals pr where pr.clinic_id = c.id),
    (select count(*) from public.patients pt where pt.clinic_id = c.id)
  from public.clinics c
  order by c.created_at asc nulls last, c.id;
end;
$$;

comment on function public.list_platform_clinics() is
  'WP-10B1: catálogo administrativo de clínicas. Zero args. SECURITY DEFINER após '
  'is_platform_admin(). Projeção mínima (sem join_code, email, nomes/ids de paciente). '
  'Counts = COUNT(*) vinculados à clínica, sem filtro de status. Não-admin → 42501.';

revoke all on function public.list_platform_clinics() from public, anon;
grant execute on function public.list_platform_clinics() to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260818090000',
  '20260818090000_wp_10b1_platform_admin_model.sql',
  'WP-10B1: private.platform_admins + is_platform_admin + am_i_platform_admin + '
  'list_platform_clinics (read-only, 42501 fail-closed, zero bootstrap, zero policy clínica).',
  'WP-10B1'
)
on conflict (version) do nothing;
