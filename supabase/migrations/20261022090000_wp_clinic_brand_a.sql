-- =====================================================================================
-- WP-BRAND · A — identidade da clínica (logo + cor) para app, relatórios e compartilhamentos.
-- · clinics.logo_path / brand_color (opcionais). logo_path só aceita arquivo da PRÓPRIA pasta da clínica.
-- · bucket público 'clinic-logos' (logo não é dado sensível; nome de arquivo = uuid). Só o ADMIN da
--   clínica grava/troca/apaga (pasta = id da clínica). png/jpeg/webp, até 2 MB.
-- · get_my_clinic_brand(): marca da clínica de quem chama (profissional ativo, senão paciente), p/ web e app.
-- =====================================================================================
alter table public.clinics add column if not exists logo_path text;
alter table public.clinics add column if not exists brand_color text;
alter table public.clinics drop constraint if exists clinics_logo_path_own_folder;
alter table public.clinics add constraint clinics_logo_path_own_folder
  check (logo_path is null or logo_path ~ ('^' || id::text || '/[A-Za-z0-9._-]{1,120}$'));
alter table public.clinics drop constraint if exists clinics_brand_color_hex;
alter table public.clinics add constraint clinics_brand_color_hex
  check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');

grant select (logo_path, brand_color) on public.clinics to authenticated;
grant update (logo_path, brand_color) on public.clinics to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-logos', 'clinic-logos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create or replace function private.storage_object_clinic(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then split_part(p_name, '/', 1)::uuid end
$$;
revoke all on function private.storage_object_clinic(text) from public, anon;
grant execute on function private.storage_object_clinic(text) to authenticated;

drop policy if exists storage_clinic_logos_select on storage.objects;
drop policy if exists storage_clinic_logos_insert on storage.objects;
drop policy if exists storage_clinic_logos_update on storage.objects;
drop policy if exists storage_clinic_logos_delete on storage.objects;
create policy storage_clinic_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'clinic-logos' and private.is_clinic_admin(private.storage_object_clinic(name)));
create policy storage_clinic_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinic-logos' and private.is_clinic_admin(private.storage_object_clinic(name)));
create policy storage_clinic_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'clinic-logos' and private.is_clinic_admin(private.storage_object_clinic(name)))
  with check (bucket_id = 'clinic-logos' and private.is_clinic_admin(private.storage_object_clinic(name)));
create policy storage_clinic_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'clinic-logos' and private.is_clinic_admin(private.storage_object_clinic(name)));

create or replace function public.get_my_clinic_brand()
returns table (clinic_id uuid, clinic_name text, logo_path text, brand_color text)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.current_profile_id();
begin
  if v_me is null then return; end if;
  return query
    select c.id, c.name, c.logo_path, c.brand_color
      from public.professionals pr join public.clinics c on c.id = pr.clinic_id
     where pr.profile_id = v_me and coalesce(pr.status,'active') = 'active' and c.status = 'active'
     order by c.name nulls last limit 1;
  if found then return; end if;
  return query
    select c.id, c.name, c.logo_path, c.brand_color
      from public.patients pt join public.clinics c on c.id = pt.clinic_id
     where pt.profile_id = v_me and c.status = 'active' limit 1;
end $$;
revoke all on function public.get_my_clinic_brand() from public, anon;
grant execute on function public.get_my_clinic_brand() to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20261022090000','20261022090000_wp_clinic_brand_a.sql',
  'BRAND-A: clinics.logo_path/brand_color, bucket público clinic-logos (só admin grava) e get_my_clinic_brand().','BRAND-A');
