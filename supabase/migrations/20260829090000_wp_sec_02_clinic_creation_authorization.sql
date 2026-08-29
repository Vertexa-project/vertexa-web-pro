-- =====================================================================================
-- WP-SEC-02 — autorização explícita one-time para criar clínica (Modelo B).
--
-- Auth != authority. authenticated + profile NÃO basta para mintar tenant.
--
-- Superfície:
--   private.clinic_creation_authorizations   (schema NÃO exposto ao PostgREST)
--   public.authorize_clinic_creation(uuid)   (só Platform Admin; NÃO cria clínica)
--   public.create_clinic_with_owner(text)    (mesmo contrato WEB; consome grant)
--
-- Fonte V1 do grant: source='platform_admin'.
-- Fonte futura 'asaas' é só valor permitido no CHECK — SEM RPC/webhook Asaas aqui.
--
-- Validade: 7 dias a partir do grant/renew (constante documentada; não é grant eterno).
-- Consumo: UPDATE atômico consumed_at IS NULL + advisory lock por profile.
-- Sem UNIQUE(clinics.owner_profile_id) — cardinalidade multi-clínica fica em aberto.
-- Clínicas existentes NÃO recebem row histórica.
--
-- NÃO edita 20260801090000. NÃO apply remoto nesta WP.
-- =====================================================================================

create table private.clinic_creation_authorizations (
  id uuid primary key default gen_random_uuid(),
  target_profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_by_profile_id uuid references public.profiles(id) on delete set null,
  source text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_clinic_id uuid references public.clinics(id) on delete set null,
  constraint clinic_creation_authorizations_source_check
    check (source in ('platform_admin', 'asaas')),
  constraint clinic_creation_authorizations_expiry_check
    check (expires_at > granted_at),
  constraint clinic_creation_authorizations_consumed_check
    check (
      (consumed_at is null and consumed_clinic_id is null)
      or (consumed_at is not null)
    ),
  constraint clinic_creation_authorizations_pa_grantor_check
    check (source <> 'platform_admin' or granted_by_profile_id is not null)
);

comment on table private.clinic_creation_authorizations is
  'WP-SEC-02: autorização one-time para create_clinic_with_owner. Sem email/senha. '
  'Schema private — sem PostgREST. Sem bootstrap de clínicas existentes.';

comment on column private.clinic_creation_authorizations.target_profile_id is
  'Profile que poderá criar UMA clínica ao consumir este grant. NÃO email.';

comment on column private.clinic_creation_authorizations.granted_by_profile_id is
  'Grantor real. source=platform_admin EXIGE NOT NULL (PA que chamou a RPC). '
  'NULL só é permitido para source futura asaas.';

comment on column private.clinic_creation_authorizations.source is
  'platform_admin (V1) | asaas (reservado; sem integração nesta WP).';

comment on column private.clinic_creation_authorizations.expires_at is
  'V1: granted_at + 7 days no grant RPC. Grant expirado não é consumível.';

create unique index clinic_creation_authorizations_one_open_idx
  on private.clinic_creation_authorizations (target_profile_id)
  where consumed_at is null;

create index clinic_creation_authorizations_target_idx
  on private.clinic_creation_authorizations (target_profile_id);

alter table private.clinic_creation_authorizations enable row level security;

revoke all on table private.clinic_creation_authorizations
  from public, anon, authenticated, service_role;


-- ── Grant RPC (Platform Admin only) ──────────────────────────────────────────

create or replace function public.authorize_clinic_creation(p_target_profile_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_profile_id();
  v_expires timestamptz := clock_timestamp() + interval '7 days';
  v_id uuid;
  v_auth_uid uuid;
  v_status text;
begin
  if not private.is_platform_admin() then
    raise exception 'authorize_clinic_creation: not a platform admin'
      using errcode = '42501', hint = 'NOT_PLATFORM_ADMIN';
  end if;

  if v_me is null then
    raise exception 'authorize_clinic_creation: grantor profile missing'
      using errcode = '42501', hint = 'GRANTOR_REQUIRED';
  end if;

  if p_target_profile_id is null then
    raise exception 'authorize_clinic_creation: target required'
      using errcode = '22023', hint = 'TARGET_REQUIRED';
  end if;

  select p.auth_user_id, p.status
    into v_auth_uid, v_status
    from public.profiles p
   where p.id = p_target_profile_id;

  if not found then
    raise exception 'authorize_clinic_creation: target profile not found'
      using errcode = '22023', hint = 'TARGET_NOT_FOUND';
  end if;

  -- Grant inútil se o profile não puder autenticar para consumir.
  -- NÃO usa profiles.role como autoridade.
  if v_auth_uid is null then
    raise exception 'authorize_clinic_creation: target has no auth user'
      using errcode = '22023', hint = 'TARGET_NOT_USABLE';
  end if;

  -- Contrato real de profiles.status (AUTH-01): text NOT NULL, default active;
  -- valores documentados = active | pending. Qualquer outro = incompatível (fail-closed).
  if v_status is distinct from 'active' and v_status is distinct from 'pending' then
    raise exception 'authorize_clinic_creation: target status incompatible'
      using errcode = '42501', hint = 'TARGET_STATUS_INCOMPATIBLE';
  end if;

  if exists (
    select 1
      from public.clinics c
     where c.owner_profile_id = p_target_profile_id
  ) then
    raise exception 'authorize_clinic_creation: target already owns a clinic'
      using errcode = '42501', hint = 'TARGET_ALREADY_OWNS_CLINIC';
  end if;

  insert into private.clinic_creation_authorizations (
    target_profile_id,
    granted_by_profile_id,
    source,
    granted_at,
    expires_at
  ) values (
    p_target_profile_id,
    v_me,
    'platform_admin',
    clock_timestamp(),
    v_expires
  )
  on conflict (target_profile_id) where consumed_at is null
  do update set
    granted_by_profile_id = excluded.granted_by_profile_id,
    source = 'platform_admin',
    granted_at = excluded.granted_at,
    expires_at = excluded.expires_at
  returning id, expires_at into v_id, v_expires;

  return jsonb_build_object(
    'authorization_id', v_id,
    'target_profile_id', p_target_profile_id,
    'expires_at', v_expires,
    'source', 'platform_admin'
  );
end;
$$;

comment on function public.authorize_clinic_creation(uuid) is
  'WP-SEC-02: Platform Admin concede/renova autorização one-time (7 dias). '
  'NÃO cria clínica/professional. NÃO muda profiles.role. Fail-closed 42501 '
  'NOT_PLATFORM_ADMIN. Target: profile existente com auth_user_id e SEM clínica própria. '
  'Aceita profiles.status active|pending. Outro status → TARGET_STATUS_INCOMPATIBLE. '
  'role NÃO é autoridade. granted_by = current_profile_id() do PA.';

revoke all on function public.authorize_clinic_creation(uuid) from public, anon;
grant execute on function public.authorize_clinic_creation(uuid) to authenticated;


-- ── create_clinic_with_owner: mesmo contrato WEB + gate fail-closed ─────────

create or replace function public.create_clinic_with_owner(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_profile_id();
  v_name   text := btrim(coalesce(p_name, ''));
  v_clinic uuid;
  v_prof   uuid;
  v_auth   uuid;
  v_status text;
begin
  if v_me is null then
    raise exception 'create_clinic_with_owner: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;

  -- Serializa criações do MESMO profile nesta transação (sem UNIQUE owner no schema).
  -- hashtext é int4: colisão só serializa extra; o claim continua por target_profile_id.
  perform pg_catalog.pg_advisory_xact_lock(90202, pg_catalog.hashtext(v_me::text));

  if exists (select 1 from public.clinics c where c.owner_profile_id = v_me) then
    raise exception 'create_clinic_with_owner: profile already owns a clinic'
      using errcode = '42501', hint = 'ALREADY_OWNS_CLINIC';
  end if;

  -- Nome ANTES do consumo: nome inválido não queima o grant.
  if v_name = '' then
    raise exception 'create_clinic_with_owner: clinic name is required'
      using errcode = '22023', hint = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'create_clinic_with_owner: clinic name too short (min 2)'
      using errcode = '22023', hint = 'NAME_TOO_SHORT';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'create_clinic_with_owner: clinic name too long (max 120)'
      using errcode = '22023', hint = 'NAME_TOO_LONG';
  end if;

  -- TOCTOU: elegibilidade no consumo. role NÃO é autoridade.
  select p.status
    into v_status
    from public.profiles p
   where p.id = v_me;

  if v_status is distinct from 'active' and v_status is distinct from 'pending' then
    raise exception 'create_clinic_with_owner: target status incompatible'
      using errcode = '42501', hint = 'TARGET_STATUS_INCOMPATIBLE';
  end if;

  -- Claim atômico: no máximo uma sessão obtém o grant aberto e vigente.
  update private.clinic_creation_authorizations a
     set consumed_at = clock_timestamp()
   where a.id = (
     select x.id
       from private.clinic_creation_authorizations x
      where x.target_profile_id = v_me
        and x.consumed_at is null
        and x.expires_at > clock_timestamp()
      order by x.granted_at asc, x.id
      limit 1
      for update
   )
  returning a.id into v_auth;

  if v_auth is null then
    raise exception 'create_clinic_with_owner: onboarding not permitted'
      using errcode = '42501', hint = 'ONBOARDING_NOT_ALLOWED';
  end if;

  insert into public.clinics (name, owner_profile_id)
  values (v_name, v_me)
  returning id into v_clinic;

  insert into public.professionals (profile_id, clinic_id, type, clinic_role)
  values (v_me, v_clinic, 'other', 'admin')
  returning id into v_prof;

  update public.profiles
     set role = 'professional', status = 'active'
   where id = v_me;

  update private.clinic_creation_authorizations
     set consumed_clinic_id = v_clinic
   where id = v_auth;

  return jsonb_build_object('clinic_id', v_clinic, 'professional_id', v_prof);
end
$$;

comment on function public.create_clinic_with_owner(text) is
  'WP-SEC-02: cria a PRÓPRIA clínica só com autorização one-time vigente. '
  'Assinatura inalterada (p_name text → jsonb). Dono = current_profile_id(). '
  'Sem grant/expirado → 42501 ONBOARDING_NOT_ALLOWED. Nome inválido não consome. '
  'Consumo + inserts na mesma transação. Advisory lock por profile. '
  'Status active|pending revalidado ANTES do claim (TOCTOU). '
  'Happy path preenche consumed_at e consumed_clinic_id = clinic_id retornado.';

revoke all on function public.create_clinic_with_owner(text) from public, anon;
grant execute on function public.create_clinic_with_owner(text) to authenticated;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260829090000',
  '20260829090000_wp_sec_02_clinic_creation_authorization.sql',
  'WP-SEC-02: private.clinic_creation_authorizations (RLS ON, zero policies, revoke '
  'authenticated) + authorize_clinic_creation (PA only, 7d, renew) + '
  'create_clinic_with_owner consome grant fail-closed (ONBOARDING_NOT_ALLOWED). '
  'Sem UNIQUE owner. Sem Asaas. Sem UI. Sem apply remoto.',
  'WP-SEC-02'
)
on conflict (version) do nothing;
