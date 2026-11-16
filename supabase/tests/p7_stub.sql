-- Complementos do local_stub para a prova da parte 7 (avatar). Só local.
alter table public.profiles add column avatar_path text, add column avatar_url text;
create function private.storage_object_profile(p_name text) returns uuid language sql immutable set search_path = '' as $$
  select case when p_name like '%/%' and p_name not like '%/%/%'
   and split_part(p_name,'/',1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   and split_part(p_name,'/',2) ~ '^[0-9a-f]{16,64}\.(webp|jpg)$' then split_part(p_name,'/',1)::uuid end $$;
grant execute on function private.storage_object_profile(text) to authenticated;
insert into storage.buckets (id, name) values ('profile-avatars','profile-avatars');
-- como no Supabase: authenticated NÃO tem update direto em profiles
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
create unique index on public.schema_migration_log (version);
