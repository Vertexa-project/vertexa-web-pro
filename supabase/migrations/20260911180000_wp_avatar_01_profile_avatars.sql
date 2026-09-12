-- =====================================================================================
-- AVATAR-01 — Foto de perfil (profissional + paciente) · fundação Storage + DB + RLS.
--
-- DECISÕES:
--   AVATAR_OWNER_ENTITY = PROFILE
--   AVATAR_STORAGE      = PRIVATE bucket profile-avatars
--   Path                = {profile_id}/{hex}.webp|jpg
--   Autoridade          = auth.uid() → private.current_profile_id()
--                         NUNCA body.profile_id / professional_id / patient_id
--   Leitura do objeto   = private.can_see_profile(pasta) — mesmas superfícies já visíveis
--   Mutação             = somente a própria pasta
--   Referência          = public.profiles.avatar_path (canónico)
--                         avatar_url permanece só como fallback legado (não gravamos URL nova)
--   UPDATE direto       = NÃO amplia grant de profiles; avatar_path só via RPC
--   Futuro              = AVATAR_FEATURE_ENTITLEMENT (não implementado; sem paywall/Asaas)
--
-- NÃO TOCA: Calendar, Google, Asaas, Framer, Cloudflare, Custom Domain.
-- NÃO APLICAR no remoto neste WP.
-- =====================================================================================

alter table public.profiles
  add column if not exists avatar_path text;

comment on column public.profiles.avatar_path is
  'AVATAR-01: path do objeto em profile-avatars ({profile_id}/{version}.webp). '
  'Escrita apenas via public.set_my_avatar / remove_my_avatar. avatar_url é legado.';

-- Parser NULL-safe: 1ª pasta = profile_id; exatamente um slash; senão NULL ⇒ deny.
create or replace function private.storage_object_profile(p_name text)
returns uuid
language sql
immutable
set search_path to ''
as $$
  select case
    when p_name like '%/%'
     and p_name not like '%/%/%'
     and split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     and split_part(p_name, '/', 2) ~ '^[0-9a-f]{16,64}\.(webp|jpg)$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;
revoke all on function private.storage_object_profile(text) from public;
grant execute on function private.storage_object_profile(text) to authenticated;

create or replace function private.is_own_avatar_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.storage_object_profile(p_path) is not null
     and private.storage_object_profile(p_path) = private.current_profile_id()
$$;
revoke all on function private.is_own_avatar_path(text) from public;
grant execute on function private.is_own_avatar_path(text) to authenticated;

-- RPC: autoridade = JWT. Valida path + existência do objeto antes de gravar.
create or replace function public.set_my_avatar(p_path text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_profile uuid;
  v_prev text;
begin
  -- AVATAR_FEATURE_ENTITLEMENT: ponto futuro. Hoje qualquer dono autenticado pode definir.
  v_profile := private.current_profile_id();
  if v_profile is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_path is null or private.storage_object_profile(p_path) is distinct from v_profile then
    raise exception 'invalid avatar path' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'profile-avatars'
       and o.name = p_path
  ) then
    raise exception 'avatar object not found' using errcode = 'P0002';
  end if;

  select p.avatar_path into v_prev
    from public.profiles p
   where p.id = v_profile;

  update public.profiles
     set avatar_path = p_path,
         avatar_url = null
   where id = v_profile;

  return v_prev;
end;
$$;

comment on function public.set_my_avatar(text) is
  'AVATAR-01: grava profiles.avatar_path do chamador (JWT). Path deve ser a própria pasta '
  'e o objeto já deve existir em profile-avatars. Sem parâmetros de identidade.';

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

create or replace function public.remove_my_avatar()
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_profile uuid;
  v_prev text;
begin
  v_profile := private.current_profile_id();
  if v_profile is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select p.avatar_path into v_prev
    from public.profiles p
   where p.id = v_profile;

  update public.profiles
     set avatar_path = null,
         avatar_url = null
   where id = v_profile;

  return v_prev;
end;
$$;

comment on function public.remove_my_avatar() is
  'AVATAR-01: limpa avatar_path e avatar_url do chamador (JWT). Devolve o path anterior para delete best-effort.';

revoke all on function public.remove_my_avatar() from public, anon;
grant execute on function public.remove_my_avatar() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists storage_profile_avatars_select on storage.objects;
drop policy if exists storage_profile_avatars_insert on storage.objects;
drop policy if exists storage_profile_avatars_delete on storage.objects;

create policy storage_profile_avatars_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-avatars'
    and private.can_see_profile(private.storage_object_profile(name))
  );

create policy storage_profile_avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and private.storage_object_profile(name) = (select private.current_profile_id())
  );

-- UPDATE intencionalmente SEM policy (arquivo versionado; upsert:false).

create policy storage_profile_avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and private.storage_object_profile(name) = (select private.current_profile_id())
  );

-- Care team: devolve avatar_path para o app assinar. DROP exigido (muda RETURNS TABLE).
drop function if exists public.get_my_care_team();

create function public.get_my_care_team()
returns table (
  professional_id uuid,
  profile_id uuid,
  display_name text,
  avatar_url text,
  avatar_path text,
  type public.professional_type,
  specialty text,
  disciplines text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.id,
    pr.profile_id,
    pf.full_name,
    pf.avatar_url,
    pf.avatar_path,
    pr.type,
    pr.specialty,
    coalesce(
      (
        select array_agg(distinct pd.discipline order by pd.discipline)
          from public.professional_disciplines pd
          join public.disciplines d on d.code = pd.discipline
         where pd.professional_id = pr.id
      ),
      '{}'::text[]
    )
  from public.professional_patient_links l
  join public.professionals pr on pr.id = l.professional_id
  join public.profiles pf on pf.id = pr.profile_id
  where l.patient_id = private.current_patient_id()
    and coalesce(l.status, 'active') = 'active'
    and coalesce(l.is_external, false) = false
    and coalesce(pr.status, 'active') = 'active'
    and private.clinic_is_operational(pr.clinic_id)
  order by pf.full_name nulls last, pr.id;
$$;

comment on function public.get_my_care_team() is
  'WP-09B1 + PLATFORM-02 + AVATAR-01: equipe clínica ATIVA do paciente autenticado. '
  'Inclui avatar_path. Preserva clinic_is_operational. JWT-derived. Sem chat.';

revoke all on function public.get_my_care_team() from public, anon;
grant execute on function public.get_my_care_team() to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260911180000',
  '20260911180000_wp_avatar_01_profile_avatars.sql',
  'AVATAR-01: profiles.avatar_path + bucket privado profile-avatars + RLS path-scoped + '
  'set_my_avatar/remove_my_avatar (JWT) + get_my_care_team.avatar_path. Sem apply remoto.',
  'AVATAR-01'
)
on conflict (version) do nothing;
