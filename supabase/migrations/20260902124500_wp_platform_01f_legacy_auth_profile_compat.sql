-- =====================================================================================
-- PLATFORM-01F — identidades Google antigas sem public.profiles.
--
-- Motivo:
--   handle_new_user só corre no trigger on_auth_user_created (INSERT /
--   UPDATE de email_confirmed_at). Login não recria profile. Contas Google
--   anteriores ao trigger ficam sem profile → PROFILE_NOT_FOUND no onboarding.
--   Alterar o trigger em auth.users exige owner de auth.users (CLI linked
--   não tem). A ÂNCORA handle_new_user permanece byte-a-byte.
--
-- Comportamento:
--   - private.ensure_auth_profile(uid): mesma regra do trigger (Google +
--     e-mail confirmado; match órfão por e-mail; senão pending patient).
--     Nunca professional. Nunca platform_admin. Idempotente.
--   - public.ensure_my_profile(): só auth.uid(). EXECUTE authenticated.
--   - Backfill: chama ensure_auth_profile para auth.users sem profile
--     (sem UUID operacional hardcoded).
--
-- Rollback manual:
--   drop function public.ensure_my_profile();
--   drop function private.ensure_auth_profile(uuid);
--   profiles criados pelo backfill não são apagados automaticamente.
-- =====================================================================================

create or replace function private.ensure_auth_profile(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_app jsonb;
  v_user_meta jsonb;
  v_deleted timestamptz;
  v_banned timestamptz;
  v_is_google boolean;
  v_match_count int;
  v_profile_id uuid;
begin
  if p_uid is null then
    return;
  end if;

  if exists (select 1 from public.profiles p where p.auth_user_id = p_uid) then
    return;
  end if;

  select u.email, u.email_confirmed_at, u.raw_app_meta_data, u.raw_user_meta_data,
         u.deleted_at, u.banned_until
    into v_email, v_confirmed, v_app, v_user_meta, v_deleted, v_banned
  from auth.users u
  where u.id = p_uid;

  if not found then
    return;
  end if;

  if v_deleted is not null then
    return;
  end if;

  if v_banned is not null and v_banned > clock_timestamp() then
    return;
  end if;

  v_is_google :=
    coalesce(v_app ->> 'provider' = 'google', false)
    or coalesce(v_app -> 'providers', '[]'::jsonb) ? 'google';

  if v_confirmed is null or not v_is_google then
    return;
  end if;

  select count(*)
    into v_match_count
  from public.profiles
  where auth_user_id is null
    and email is not null
    and v_email is not null
    and lower(btrim(email)) = lower(btrim(v_email));

  if v_match_count = 1 then
    select id
      into v_profile_id
    from public.profiles
    where auth_user_id is null
      and email is not null
      and v_email is not null
      and lower(btrim(email)) = lower(btrim(v_email))
    limit 1;
    update public.profiles set auth_user_id = p_uid where id = v_profile_id;
    return;
  end if;

  insert into public.profiles (auth_user_id, role, full_name, email, status)
  values (
    p_uid,
    'patient',
    coalesce(
      nullif(btrim(v_user_meta ->> 'full_name'), ''),
      nullif(btrim(v_user_meta ->> 'name'), ''),
      v_email,
      'Novo usuário'
    ),
    v_email,
    'pending'
  );
exception
  when unique_violation then
    return;
end;
$$;

comment on function private.ensure_auth_profile(uuid) is
  'PLATFORM-01F: provisiona profile para um auth.users. Fail-closed patient. '
  'Sem PA. EXECUTE só owner.';

revoke all on function private.ensure_auth_profile(uuid)
  from public, anon, authenticated, service_role;


create or replace function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'ensure_my_profile: not authenticated'
      using errcode = '42501', hint = 'NOT_AUTHENTICATED';
  end if;
  perform private.ensure_auth_profile(v_uid);
end;
$$;

comment on function public.ensure_my_profile() is
  'PLATFORM-01F: provisiona o profile do chamador (auth.uid()). '
  'Google confirmado sem profile → pending patient. Sem PA.';

revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;


do $$
declare
  r record;
begin
  for r in
    select u.id
    from auth.users u
    where u.deleted_at is null
      and not exists (select 1 from public.profiles p where p.auth_user_id = u.id)
  loop
    perform private.ensure_auth_profile(r.id);
  end loop;
end $$;


insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260902124500',
  '20260902124500_wp_platform_01f_legacy_auth_profile_compat.sql',
  'PLATFORM-01F: ensure_my_profile para auth Google sem profile + backfill.',
  'PLATFORM-01F'
)
on conflict (version) do nothing;
