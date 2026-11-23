-- Cartão 1317 · Central de Ajuda (entrega 1): tutoriais só para quem assina o Vertexa.
-- Acesso = admin da plataforma OU membro ativo (dono ou profissional ativo) de uma clínica
-- operacional com o produto liberado pela mesma regra comercial que libera o sistema
-- (private.billing_resolve_commercial_access → product_allowed).
-- Só cria objetos novos.

create table if not exists public.help_categories (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  title text not null,
  description text not null default '',
  position integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  category_id text not null references public.help_categories(id) on update cascade,
  title text not null check (length(trim(title)) between 2 and 120),
  summary text not null default '',
  body text not null default '',
  video_path text,
  position integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null
);

create index if not exists help_articles_category_position_idx
  on public.help_articles (category_id, position);

alter table public.help_categories enable row level security;
alter table public.help_articles enable row level security;
revoke all on public.help_categories from anon, authenticated;
revoke all on public.help_articles from anon, authenticated;
-- Leitura e escrita só pelas funções abaixo.

create or replace function private.help_center_allowed()
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_profile_id() is not null
     and (
       private.is_platform_admin()
       or exists (
         select 1
           from public.clinics c
          where private.clinic_is_operational(c.id)
            and (
              c.owner_profile_id = private.current_profile_id()
              or exists (
                select 1 from public.professionals pr
                 where pr.clinic_id = c.id
                   and pr.profile_id = private.current_profile_id()
                   and coalesce(pr.status, 'active') = 'active'
              )
            )
            and coalesce((private.billing_resolve_commercial_access(c.id) ->> 'product_allowed')::boolean, false)
       )
     )
$$;

-- Para a tela: pode entrar? (não lança erro; quem não pode vê o aviso de assinatura)
create or replace function public.help_center_access()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.current_profile_id();
begin
  if v_me is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  end if;
  if private.help_center_allowed() then
    return jsonb_build_object('allowed', true, 'reason', 'ok',
                              'platform_admin', private.is_platform_admin());
  end if;
  return jsonb_build_object('allowed', false, 'reason', 'not_subscribed');
end $$;

create or replace function public.help_list_articles()
returns table (slug text, category_id text, category_title text, category_description text,
               category_position integer, title text, summary text, has_video boolean,
               article_position integer, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.help_center_allowed() then
    raise exception 'help_center_not_allowed' using errcode = '42501';
  end if;
  return query
    select a.slug, c.id, c.title, c.description, c.position, a.title, a.summary,
           a.video_path is not null, a.position, a.updated_at
      from public.help_articles a
      join public.help_categories c on c.id = a.category_id
     where a.is_published
     order by c.position, c.id, a.position, a.title;
end $$;

create or replace function public.help_get_article(p_slug text)
returns table (slug text, category_id text, category_title text, title text, summary text,
               body text, video_path text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.help_center_allowed() then
    raise exception 'help_center_not_allowed' using errcode = '42501';
  end if;
  return query
    select a.slug, c.id, c.title, a.title, a.summary, a.body, a.video_path, a.updated_at
      from public.help_articles a
      join public.help_categories c on c.id = a.category_id
     where a.slug = p_slug
       and a.is_published;
end $$;

-- Texto para busca: minúsculo e sem acento (sem depender da extensão unaccent).
create or replace function private.help_fold(p text)
returns text
language sql immutable set search_path = '' as $$
  select translate(lower(coalesce(p, '')),
                   'áàâãäéèêëíìîïóòôõöúùûüçñ',
                   'aaaaaeeeeiiiiooooouuuucn')
$$;

-- Busca no título, resumo e texto (sem acento, sem diferenciar maiúsculas).
create or replace function public.help_search_articles(p_query text)
returns table (slug text, category_title text, title text, summary text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_terms text[];
begin
  if not private.help_center_allowed() then
    raise exception 'help_center_not_allowed' using errcode = '42501';
  end if;
  v_terms := array(
    select t from unnest(regexp_split_to_array(private.help_fold((coalesce(p_query, ''))), '\s+')) t
     where length(t) >= 2
  );
  if coalesce(array_length(v_terms, 1), 0) = 0 then
    return;
  end if;
  return query
    select a.slug, c.title, a.title, a.summary
      from public.help_articles a
      join public.help_categories c on c.id = a.category_id
     where a.is_published
       and not exists (
         select 1 from unnest(v_terms) term
          where position(term in private.help_fold((a.title || ' ' || a.summary || ' ' || a.body || ' ' || c.title))) = 0
       )
     order by (position(v_terms[1] in private.help_fold((a.title))) > 0) desc, c.position, a.position
     limit 30;
end $$;

revoke all on function private.help_center_allowed() from public, anon, authenticated;
revoke all on function private.help_fold(text) from public, anon, authenticated;
revoke all on function public.help_center_access() from public, anon;
revoke all on function public.help_list_articles() from public, anon;
revoke all on function public.help_get_article(text) from public, anon;
revoke all on function public.help_search_articles(text) from public, anon;
grant execute on function public.help_center_access() to authenticated;
grant execute on function public.help_list_articles() to authenticated;
grant execute on function public.help_get_article(text) to authenticated;
grant execute on function public.help_search_articles(text) to authenticated;
