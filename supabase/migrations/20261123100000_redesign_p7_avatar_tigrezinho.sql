-- =====================================================================================
-- REDESIGN P7 — App do paciente: foto OU avatar (bichinho + cor de fundo) no Perfil.
--
-- SÓ COLUNAS NOVAS NULLABLE + RPCs. Nada existente é apagado:
--   · profiles.avatar_kind  ('photo' | 'avatar' | null)  — qual das duas escolhas vale. null = comportamento antigo
--                                                           (foto se houver avatar_path/avatar_url; senão iniciais).
--   · profiles.avatar_key   (raposa|tigre|panda|coruja|coala|leao|pinguim|sapo)
--   · profiles.avatar_bg    (#E6F6EE|#FFEDE8|#EAF0FD|#FEF5DC|#F2F2F0)
--   · set_my_avatar_pick(key, bg)  — o paciente (JWT) escolhe o bichinho e a cor; valida os valores.
--   · set_my_avatar_kind(kind)     — volta para a foto ('photo') ou para o avatar ('avatar'); só se existir.
--   · set_my_avatar / remove_my_avatar (mesma assinatura da AVATAR-01) agora também acertam avatar_kind:
--     subir foto => 'photo'; remover foto => limpa 'photo' (um avatar escolhido continua valendo).
--
-- Foto continua no bucket PRIVADO profile-avatars (RLS por pasta do próprio perfil, AVATAR-01): nenhum bucket novo.
-- Sem GRANT de UPDATE em profiles: a escrita é só por RPC security definer, autoridade = JWT (private.current_profile_id()).
-- Idempotente (add column if not exists / create or replace / constraints condicionais).
--
-- Reversão: drop function set_my_avatar_pick(text,text), set_my_avatar_kind(text); recriar set_my_avatar/remove_my_avatar
-- da 20260911180000; alter table profiles drop column avatar_kind, avatar_key, avatar_bg.
-- NÃO APLICAR sem ordem (parte 7 do redesign).
-- =====================================================================================

alter table public.profiles
  add column if not exists avatar_kind text,
  add column if not exists avatar_key text,
  add column if not exists avatar_bg text;

comment on column public.profiles.avatar_kind is 'P7: photo | avatar | null (null = foto se houver, senão iniciais). Escrita só por RPC.';
comment on column public.profiles.avatar_key  is 'P7: bichinho escolhido (marcador; o desenho final é do design).';
comment on column public.profiles.avatar_bg   is 'P7: cor de fundo do avatar (uma das 5 da paleta).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_kind_chk') then
    alter table public.profiles add constraint profiles_avatar_kind_chk check (avatar_kind is null or avatar_kind in ('photo', 'avatar'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_key_chk') then
    alter table public.profiles add constraint profiles_avatar_key_chk
      check (avatar_key is null or avatar_key in ('raposa', 'tigre', 'panda', 'coruja', 'coala', 'leao', 'pinguim', 'sapo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_bg_chk') then
    alter table public.profiles add constraint profiles_avatar_bg_chk
      check (avatar_bg is null or avatar_bg in ('#E6F6EE', '#FFEDE8', '#EAF0FD', '#FEF5DC', '#F2F2F0'));
  end if;
end $$;

-- Escolha do avatar: bichinho + cor, os dois obrigatórios e dentro da lista.
create or replace function public.set_my_avatar_pick(p_key text, p_bg text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_profile uuid := private.current_profile_id();
begin
  if v_profile is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('raposa', 'tigre', 'panda', 'coruja', 'coala', 'leao', 'pinguim', 'sapo') then
    raise exception 'invalid avatar key' using errcode = '22023';
  end if;
  if p_bg is null or upper(p_bg) not in ('#E6F6EE', '#FFEDE8', '#EAF0FD', '#FEF5DC', '#F2F2F0') then
    raise exception 'invalid avatar background' using errcode = '22023';
  end if;
  update public.profiles
     set avatar_kind = 'avatar', avatar_key = p_key, avatar_bg = upper(p_bg)
   where id = v_profile;
end;
$$;
comment on function public.set_my_avatar_pick(text, text) is 'P7: grava o avatar (bichinho + cor) do chamador (JWT). Valores fora da lista = 22023.';
revoke all on function public.set_my_avatar_pick(text, text) from public, anon;
grant execute on function public.set_my_avatar_pick(text, text) to authenticated;

-- Alterna entre as duas escolhas já feitas (a foto só vale se existir).
create or replace function public.set_my_avatar_kind(p_kind text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_profile uuid := private.current_profile_id();
  v_row public.profiles%rowtype;
begin
  if v_profile is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('photo', 'avatar') then
    raise exception 'invalid avatar kind' using errcode = '22023';
  end if;
  select * into v_row from public.profiles where id = v_profile;
  if p_kind = 'photo' and v_row.avatar_path is null and v_row.avatar_url is null then
    raise exception 'no photo' using errcode = 'P0002';
  end if;
  if p_kind = 'avatar' and (v_row.avatar_key is null or v_row.avatar_bg is null) then
    raise exception 'no avatar' using errcode = 'P0002';
  end if;
  update public.profiles set avatar_kind = p_kind where id = v_profile;
end;
$$;
comment on function public.set_my_avatar_kind(text) is 'P7: escolhe qual vale (photo|avatar) entre as que o chamador já tem.';
revoke all on function public.set_my_avatar_kind(text) from public, anon;
grant execute on function public.set_my_avatar_kind(text) to authenticated;

-- AVATAR-01 (mesma assinatura e mesmas validações) + avatar_kind = 'photo' ao subir foto.
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
  v_profile := private.current_profile_id();
  if v_profile is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_path is null or private.storage_object_profile(p_path) is distinct from v_profile then
    raise exception 'invalid avatar path' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'profile-avatars' and o.name = p_path
  ) then
    raise exception 'avatar object not found' using errcode = 'P0002';
  end if;

  select p.avatar_path into v_prev from public.profiles p where p.id = v_profile;

  update public.profiles
     set avatar_path = p_path,
         avatar_url = null,
         avatar_kind = 'photo'
   where id = v_profile;

  return v_prev;
end;
$$;
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

  select p.avatar_path into v_prev from public.profiles p where p.id = v_profile;

  update public.profiles
     set avatar_path = null,
         avatar_url = null,
         avatar_kind = case when avatar_kind = 'photo' then null else avatar_kind end
   where id = v_profile;

  return v_prev;
end;
$$;
revoke all on function public.remove_my_avatar() from public, anon;
grant execute on function public.remove_my_avatar() to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20261123100000',
  '20261123100000_redesign_p7_avatar_tigrezinho.sql',
  'Redesign P7: profiles.avatar_kind/avatar_key/avatar_bg + set_my_avatar_pick/set_my_avatar_kind; set_my_avatar/remove_my_avatar acertam avatar_kind. Sem apply remoto.',
  'REDESIGN-P7'
)
on conflict (version) do nothing;
