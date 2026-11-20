-- Cartão 1087 · Tutorial em vídeo no primeiro acesso (clínica e paciente).
-- O admin da plataforma envia um vídeo por público (clinic = web profissional,
-- patient = app do paciente) e liga "mostrar no primeiro acesso". Cada usuário vê
-- o vídeo uma vez; depois pode rever pelo menu.
-- Só cria objetos novos.

create table if not exists public.onboarding_tutorials (
  audience text primary key check (audience in ('clinic', 'patient')),
  title text not null default '',
  video_path text,
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null
);

alter table public.onboarding_tutorials enable row level security;
revoke all on public.onboarding_tutorials from anon, authenticated;
-- Leitura e escrita só pelas funções abaixo.

create table if not exists public.onboarding_tutorial_views (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  audience text not null check (audience in ('clinic', 'patient')),
  seen_at timestamptz not null default now(),
  primary key (auth_user_id, audience)
);

alter table public.onboarding_tutorial_views enable row level security;
revoke all on public.onboarding_tutorial_views from anon, authenticated;

-- Quem já entrou no sistema antes desta versão não está no primeiro acesso:
-- marca como visto. Quem foi convidado e nunca entrou verá o vídeo ao entrar.
insert into public.onboarding_tutorial_views (auth_user_id, audience, seen_at)
select u.id, a.audience, now()
  from auth.users u
 cross join (values ('clinic'), ('patient')) as a(audience)
 where u.last_sign_in_at is not null
on conflict do nothing;

insert into public.onboarding_tutorials (audience) values ('clinic'), ('patient')
on conflict do nothing;

-- Bucket público (vídeo de apresentação, sem dado de paciente). Até 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('onboarding-tutorials', 'onboarding-tutorials', true, 52428800,
        array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;

-- Políticas usam a função pública (authenticated não executa private.is_platform_admin).
drop policy if exists storage_onboarding_tutorials_insert on storage.objects;
drop policy if exists storage_onboarding_tutorials_update on storage.objects;
drop policy if exists storage_onboarding_tutorials_delete on storage.objects;
create policy storage_onboarding_tutorials_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'onboarding-tutorials' and public.am_i_platform_admin());
create policy storage_onboarding_tutorials_update on storage.objects for update to authenticated
  using (bucket_id = 'onboarding-tutorials' and public.am_i_platform_admin())
  with check (bucket_id = 'onboarding-tutorials' and public.am_i_platform_admin());
create policy storage_onboarding_tutorials_delete on storage.objects for delete to authenticated
  using (bucket_id = 'onboarding-tutorials' and public.am_i_platform_admin());

-- Usuário: o tutorial do público e se ainda falta ver (pending).
create or replace function public.get_my_onboarding_tutorial(p_audience text)
returns table (audience text, title text, video_path text, updated_at timestamptz, pending boolean)
language sql stable security definer set search_path = '' as $$
  select t.audience, t.title, t.video_path, t.updated_at,
         not exists (
           select 1 from public.onboarding_tutorial_views v
            where v.auth_user_id = (select auth.uid()) and v.audience = t.audience
         ) as pending
    from public.onboarding_tutorials t
   where (select auth.uid()) is not null
     and t.audience = p_audience
     and t.is_active
     and t.video_path is not null
$$;

create or replace function public.mark_onboarding_tutorial_seen(p_audience text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_audience not in ('clinic', 'patient') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;
  insert into public.onboarding_tutorial_views (auth_user_id, audience)
  values ((select auth.uid()), p_audience)
  on conflict (auth_user_id, audience) do nothing;
end $$;

-- Admin da plataforma: lista e grava.
create or replace function public.platform_list_onboarding_tutorials()
returns table (audience text, title text, video_path text, is_active boolean,
               updated_at timestamptz, updated_by_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  return query
    select t.audience, t.title, t.video_path, t.is_active, t.updated_at, p.full_name
      from public.onboarding_tutorials t
      left join public.profiles p on p.id = t.updated_by_profile_id
     order by case t.audience when 'clinic' then 0 else 1 end;
end $$;

create or replace function public.platform_set_onboarding_tutorial(
  p_audience text, p_title text, p_video_path text, p_is_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if p_audience not in ('clinic', 'patient') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;
  if coalesce(p_is_active, false) and nullif(p_video_path, '') is null then
    raise exception 'video_required' using errcode = '22023';
  end if;
  insert into public.onboarding_tutorials (audience, title, video_path, is_active, updated_at, updated_by_profile_id)
  values (p_audience, coalesce(trim(p_title), ''), nullif(p_video_path, ''), coalesce(p_is_active, false), now(),
          private.current_profile_id())
  on conflict (audience) do update
     set title = excluded.title,
         video_path = excluded.video_path,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at,
         updated_by_profile_id = excluded.updated_by_profile_id;
end $$;

revoke all on function public.get_my_onboarding_tutorial(text) from public, anon;
revoke all on function public.mark_onboarding_tutorial_seen(text) from public, anon;
revoke all on function public.platform_list_onboarding_tutorials() from public, anon;
revoke all on function public.platform_set_onboarding_tutorial(text, text, text, boolean) from public, anon;
grant execute on function public.get_my_onboarding_tutorial(text) to authenticated;
grant execute on function public.mark_onboarding_tutorial_seen(text) to authenticated;
grant execute on function public.platform_list_onboarding_tutorials() to authenticated;
grant execute on function public.platform_set_onboarding_tutorial(text, text, text, boolean) to authenticated;
