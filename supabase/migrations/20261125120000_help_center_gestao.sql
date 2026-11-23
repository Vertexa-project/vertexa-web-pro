-- Cartão 1317 · Central de Ajuda (entrega 3): a equipe Vertexa cuida do conteúdo.
-- Criar, editar, ocultar e ordenar tutoriais e assuntos; vídeo e imagens em cada tutorial;
-- WhatsApp, e-mail e horário do suporte mostrados na página Suporte.
-- Só cria objetos novos (e funções novas).

-- Mídia dos tutoriais: bucket público (conteúdo de ajuda, sem dado de paciente).
-- Vídeo até 50 MB (limite global do Storage) e imagens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('help-media', 'help-media', true, 52428800,
        array['video/mp4', 'video/webm', 'video/quicktime', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists storage_help_media_select on storage.objects;
drop policy if exists storage_help_media_insert on storage.objects;
drop policy if exists storage_help_media_update on storage.objects;
drop policy if exists storage_help_media_delete on storage.objects;
-- select: o Storage exige leitura pela política para apagar/listar (o download público não usa).
create policy storage_help_media_select on storage.objects for select to authenticated
  using (bucket_id = 'help-media' and public.am_i_platform_admin());
create policy storage_help_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'help-media' and public.am_i_platform_admin());
create policy storage_help_media_update on storage.objects for update to authenticated
  using (bucket_id = 'help-media' and public.am_i_platform_admin())
  with check (bucket_id = 'help-media' and public.am_i_platform_admin());
create policy storage_help_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'help-media' and public.am_i_platform_admin());

-- Contato do suporte (uma linha só).
create table if not exists public.help_settings (
  id boolean primary key default true check (id),
  support_whatsapp text not null default '',
  support_email text not null default '',
  support_hours text not null default '',
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null
);
alter table public.help_settings enable row level security;
revoke all on public.help_settings from anon, authenticated;
insert into public.help_settings (id) values (true) on conflict do nothing;

create or replace function public.help_get_settings()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.help_center_allowed() then
    raise exception 'help_center_not_allowed' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('support_whatsapp', s.support_whatsapp, 'support_email', s.support_email,
                              'support_hours', s.support_hours)
      from public.help_settings s where s.id
  );
end $$;

create or replace function public.platform_help_save_settings(p_whatsapp text, p_email text, p_hours text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if v_phone <> '' and length(v_phone) not between 10 and 13 then
    raise exception 'invalid_whatsapp' using errcode = '22023';
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  update public.help_settings
     set support_whatsapp = v_phone,
         support_email = v_email,
         support_hours = left(trim(coalesce(p_hours, '')), 120),
         updated_at = now(),
         updated_by_profile_id = private.current_profile_id()
   where id;
end $$;

-- Lista completa para a plataforma (inclui ocultos).
create or replace function public.platform_help_list()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description,
                                          'position', c.position) order by c.position, c.id)
        from public.help_categories c), '[]'::jsonb),
    'articles', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'slug', a.slug, 'category_id', a.category_id,
                                          'title', a.title, 'summary', a.summary, 'body', a.body,
                                          'video_path', a.video_path, 'position', a.position,
                                          'is_published', a.is_published, 'updated_at', a.updated_at,
                                          'updated_by_name', p.full_name)
                       order by a.category_id, a.position, a.title)
        from public.help_articles a
        left join public.profiles p on p.id = a.updated_by_profile_id), '[]'::jsonb)
  );
end $$;

-- Endereço do tutorial a partir do título (sem acento, só letras, números e hífen).
create or replace function private.help_slugify(p text)
returns text
language sql immutable set search_path = '' as $$
  select left(trim(both '-' from regexp_replace(private.help_fold(p), '[^a-z0-9]+', '-', 'g')), 70)
$$;
revoke all on function private.help_slugify(text) from public, anon, authenticated;

create or replace function public.platform_help_save_article(
  p_id uuid, p_category_id text, p_title text, p_summary text, p_body text,
  p_video_path text, p_position integer, p_is_published boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text;
  v_base text;
  v_n integer := 1;
  v_row public.help_articles;
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) < 2 then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.help_categories where id = p_category_id) then
    raise exception 'category_not_found' using errcode = '22023';
  end if;
  if nullif(p_video_path, '') is not null and p_video_path !~ '^videos/[A-Za-z0-9._/-]+$' then
    raise exception 'invalid_video_path' using errcode = '22023';
  end if;
  if p_id is null then
    v_base := coalesce(nullif(private.help_slugify(p_title), ''), 'tutorial');
    if length(v_base) < 2 then v_base := 'tutorial-' || v_base; end if;
    v_slug := v_base;
    while exists (select 1 from public.help_articles where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;
    insert into public.help_articles (slug, category_id, title, summary, body, video_path, position,
                                      is_published, updated_by_profile_id)
    values (v_slug, p_category_id, trim(p_title), trim(coalesce(p_summary, '')), coalesce(p_body, ''),
            nullif(p_video_path, ''), coalesce(p_position, 0), coalesce(p_is_published, true),
            private.current_profile_id())
    returning * into v_row;
  else
    update public.help_articles
       set category_id = p_category_id,
           title = trim(p_title),
           summary = trim(coalesce(p_summary, '')),
           body = coalesce(p_body, ''),
           video_path = nullif(p_video_path, ''),
           position = coalesce(p_position, position),
           is_published = coalesce(p_is_published, is_published),
           updated_at = now(),
           updated_by_profile_id = private.current_profile_id()
     where id = p_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'article_not_found' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'slug', v_row.slug);
end $$;

create or replace function public.platform_help_save_category(
  p_id text, p_title text, p_description text, p_position integer)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id text := nullif(trim(coalesce(p_id, '')), '');
  v_base text;
  v_n integer := 1;
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) < 2 then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if v_id is null then
    v_base := coalesce(nullif(private.help_slugify(p_title), ''), 'assunto');
    if length(v_base) < 2 then v_base := 'assunto-' || v_base; end if;
    v_id := left(v_base, 55);
    while exists (select 1 from public.help_categories where id = v_id) loop
      v_n := v_n + 1;
      v_id := left(v_base, 55) || '-' || v_n;
    end loop;
    insert into public.help_categories (id, title, description, position)
    values (v_id, trim(p_title), trim(coalesce(p_description, '')), coalesce(p_position, 0));
  else
    update public.help_categories
       set title = trim(p_title),
           description = trim(coalesce(p_description, '')),
           position = coalesce(p_position, position),
           updated_at = now()
     where id = v_id;
    if not found then
      raise exception 'category_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

revoke all on function public.help_get_settings() from public, anon;
revoke all on function public.platform_help_save_settings(text, text, text) from public, anon;
revoke all on function public.platform_help_list() from public, anon;
revoke all on function public.platform_help_save_article(uuid, text, text, text, text, text, integer, boolean) from public, anon;
revoke all on function public.platform_help_save_category(text, text, text, integer) from public, anon;
grant execute on function public.help_get_settings() to authenticated;
grant execute on function public.platform_help_save_settings(text, text, text) to authenticated;
grant execute on function public.platform_help_list() to authenticated;
grant execute on function public.platform_help_save_article(uuid, text, text, text, text, text, integer, boolean) to authenticated;
grant execute on function public.platform_help_save_category(text, text, text, integer) to authenticated;
