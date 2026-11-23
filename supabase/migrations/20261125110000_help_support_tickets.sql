-- Cartão 1317 · Central de Ajuda (entrega 2): suporte por chamados.
-- A clínica assinante abre um chamado (assunto, tipo, mensagem e print opcional), acompanha e
-- conversa; a equipe da plataforma responde em Plataforma > Suporte.
-- Quem vê o chamado na clínica: quem abriu e os administradores da clínica.
-- Só cria objetos novos.

-- A clínica está liberada para a Central (operacional + produto liberado pela regra comercial)
-- e o usuário atual é membro ativo dela (dono ou profissional ativo).
create or replace function private.help_clinic_member_allowed(p_clinic_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_clinic_id is not null
     and private.current_profile_id() is not null
     and private.clinic_is_operational(p_clinic_id)
     and exists (
       select 1 from public.clinics c
        where c.id = p_clinic_id
          and (
            c.owner_profile_id = private.current_profile_id()
            or exists (
              select 1 from public.professionals pr
               where pr.clinic_id = c.id
                 and pr.profile_id = private.current_profile_id()
                 and coalesce(pr.status, 'active') = 'active'
            )
          )
     )
     and coalesce((private.billing_resolve_commercial_access(p_clinic_id) ->> 'product_allowed')::boolean, false)
$$;
revoke all on function private.help_clinic_member_allowed(uuid) from public, anon, authenticated;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  opened_by_profile_id uuid references public.profiles(id) on delete set null,
  subject text not null check (length(trim(subject)) between 3 and 140),
  category text not null check (category in ('duvida', 'problema', 'sugestao', 'financeiro')),
  status text not null default 'aberto' check (status in ('aberto', 'respondido', 'resolvido')),
  clinic_unread boolean not null default false,
  vertexa_unread boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists support_tickets_clinic_idx on public.support_tickets (clinic_id, last_message_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, last_message_at desc);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_profile_id uuid references public.profiles(id) on delete set null,
  author_side text not null check (author_side in ('clinica', 'vertexa')),
  body text not null check (length(trim(body)) between 1 and 5000),
  attachment_path text,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_ticket_messages from anon, authenticated;
-- Leitura e escrita só pelas funções abaixo.

-- Quem pode ver/responder o chamado pelo lado da clínica.
create or replace function private.support_clinic_can_see(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.support_tickets t
     where t.id = p_ticket_id
       and private.help_clinic_member_allowed(t.clinic_id)
       and (t.opened_by_profile_id = private.current_profile_id() or private.is_clinic_admin(t.clinic_id))
  )
$$;
revoke all on function private.support_clinic_can_see(uuid) from public, anon, authenticated;

-- Para as políticas do Storage (authenticated não executa funções de private).
create or replace function public.support_can_access_object(p_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ticket uuid;
begin
  begin
    v_ticket := split_part(coalesce(p_name, ''), '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return private.is_platform_admin() or private.support_clinic_can_see(v_ticket);
end $$;
revoke all on function public.support_can_access_object(text) from public, anon;
grant execute on function public.support_can_access_object(text) to authenticated;

-- Prints do chamado: bucket privado, só imagem, até 5 MB. Caminho: <id do chamado>/<arquivo>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists storage_support_attachments_select on storage.objects;
drop policy if exists storage_support_attachments_insert on storage.objects;
create policy storage_support_attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'support-attachments' and public.support_can_access_object(name));
create policy storage_support_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'support-attachments' and public.support_can_access_object(name));

-- Clínicas em que o usuário pode abrir chamado.
create or replace function public.support_my_clinics()
returns table (clinic_id uuid, clinic_name text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name
    from public.clinics c
   where private.help_clinic_member_allowed(c.id)
   order by c.name
$$;

create or replace function public.support_open_ticket(
  p_clinic_id uuid, p_subject text, p_category text, p_body text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.current_profile_id();
  v_ticket public.support_tickets;
  v_msg uuid;
begin
  if not private.help_clinic_member_allowed(p_clinic_id) then
    raise exception 'help_center_not_allowed' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_subject, ''))) < 3 then
    raise exception 'subject_required' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_body, ''))) < 1 then
    raise exception 'body_required' using errcode = '22023';
  end if;
  insert into public.support_tickets (clinic_id, opened_by_profile_id, subject, category)
  values (p_clinic_id, v_me, left(trim(p_subject), 140), coalesce(p_category, 'duvida'))
  returning * into v_ticket;
  insert into public.support_ticket_messages (ticket_id, author_profile_id, author_side, body)
  values (v_ticket.id, v_me, 'clinica', left(trim(p_body), 5000))
  returning id into v_msg;
  return jsonb_build_object('ticket_id', v_ticket.id, 'number', v_ticket.number, 'message_id', v_msg);
end $$;

-- Liga o print enviado à mensagem (só o autor, e só arquivo da pasta do chamado).
create or replace function public.support_set_attachment(p_message_id uuid, p_path text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_msg public.support_ticket_messages;
begin
  select * into v_msg from public.support_ticket_messages where id = p_message_id;
  if v_msg.id is null or v_msg.author_profile_id is distinct from private.current_profile_id() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> v_msg.ticket_id::text then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'support-attachments' and o.name = p_path) then
    raise exception 'attachment_not_found' using errcode = 'P0002';
  end if;
  update public.support_ticket_messages set attachment_path = p_path where id = p_message_id;
end $$;

create or replace function public.support_reply(p_ticket_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_side text;
  v_msg uuid;
begin
  if private.is_platform_admin() and not private.support_clinic_can_see(p_ticket_id) then
    v_side := 'vertexa';
  elsif private.support_clinic_can_see(p_ticket_id) then
    v_side := 'clinica';
  else
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_body, ''))) < 1 then
    raise exception 'body_required' using errcode = '22023';
  end if;
  insert into public.support_ticket_messages (ticket_id, author_profile_id, author_side, body)
  values (p_ticket_id, private.current_profile_id(), v_side, left(trim(p_body), 5000))
  returning id into v_msg;
  update public.support_tickets
     set status = case when v_side = 'vertexa' then 'respondido' else 'aberto' end,
         clinic_unread = (v_side = 'vertexa'),
         vertexa_unread = (v_side = 'clinica'),
         last_message_at = now(),
         updated_at = now()
   where id = p_ticket_id;
  return v_msg;
end $$;

-- Resolver (clínica ou Vertexa) ou reabrir (Vertexa). Responder também reabre.
create or replace function public.support_set_status(p_ticket_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_vertexa boolean := private.is_platform_admin();
begin
  if not (v_vertexa or private.support_clinic_can_see(p_ticket_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_status not in ('aberto', 'respondido', 'resolvido') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if not v_vertexa and p_status <> 'resolvido' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.support_tickets
     set status = p_status,
         updated_at = now(),
         vertexa_unread = case when p_status = 'resolvido' then false else vertexa_unread end
   where id = p_ticket_id;
end $$;

-- Lista do lado da clínica (quem abriu + admins da clínica).
create or replace function public.support_list_my_tickets()
returns table (id uuid, number bigint, clinic_name text, subject text, category text, status text,
               unread boolean, opened_by_name text, created_at timestamptz, last_message_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.help_center_allowed() then
    raise exception 'help_center_not_allowed' using errcode = '42501';
  end if;
  return query
    select t.id, t.number, c.name, t.subject, t.category, t.status, t.clinic_unread, p.full_name,
           t.created_at, t.last_message_at
      from public.support_tickets t
      join public.clinics c on c.id = t.clinic_id
      left join public.profiles p on p.id = t.opened_by_profile_id
     where private.help_clinic_member_allowed(t.clinic_id)
       and (t.opened_by_profile_id = private.current_profile_id() or private.is_clinic_admin(t.clinic_id))
     order by t.last_message_at desc
     limit 200;
end $$;

create or replace function public.support_my_unread_count()
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from public.support_tickets t
   where t.clinic_unread
     and private.help_clinic_member_allowed(t.clinic_id)
     and (t.opened_by_profile_id = private.current_profile_id() or private.is_clinic_admin(t.clinic_id))
$$;

-- Lista da plataforma (equipe Vertexa).
create or replace function public.support_platform_list(p_status text default null)
returns table (id uuid, number bigint, clinic_name text, subject text, category text, status text,
               unread boolean, opened_by_name text, created_at timestamptz, last_message_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  return query
    select t.id, t.number, c.name, t.subject, t.category, t.status, t.vertexa_unread, p.full_name,
           t.created_at, t.last_message_at
      from public.support_tickets t
      join public.clinics c on c.id = t.clinic_id
      left join public.profiles p on p.id = t.opened_by_profile_id
     where p_status is null or t.status = p_status
     order by (t.status = 'aberto') desc, t.last_message_at desc
     limit 300;
end $$;

create or replace function public.support_platform_counts()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'aberto', (select count(*) from public.support_tickets where status = 'aberto'),
    'respondido', (select count(*) from public.support_tickets where status = 'respondido'),
    'resolvido', (select count(*) from public.support_tickets where status = 'resolvido'),
    'unread', (select count(*) from public.support_tickets where vertexa_unread)
  );
end $$;

-- Detalhe com a conversa; marca como lido para quem abriu.
create or replace function public.support_get_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic_side boolean := private.support_clinic_can_see(p_ticket_id);
  v_vertexa boolean := private.is_platform_admin();
  v_out jsonb;
begin
  if not (v_clinic_side or v_vertexa) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_clinic_side then
    update public.support_tickets set clinic_unread = false where id = p_ticket_id and clinic_unread;
  else
    update public.support_tickets set vertexa_unread = false where id = p_ticket_id and vertexa_unread;
  end if;
  select jsonb_build_object(
           'id', t.id, 'number', t.number, 'clinic_name', c.name, 'subject', t.subject,
           'category', t.category, 'status', t.status, 'created_at', t.created_at,
           'opened_by_name', op.full_name,
           'viewer_side', case when v_clinic_side then 'clinica' else 'vertexa' end,
           'messages', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', m.id, 'author_side', m.author_side, 'author_name', ap.full_name,
                      'body', m.body, 'attachment_path', m.attachment_path, 'created_at', m.created_at)
                    order by m.created_at, m.id)
               from public.support_ticket_messages m
               left join public.profiles ap on ap.id = m.author_profile_id
              where m.ticket_id = t.id), '[]'::jsonb))
    into v_out
    from public.support_tickets t
    join public.clinics c on c.id = t.clinic_id
    left join public.profiles op on op.id = t.opened_by_profile_id
   where t.id = p_ticket_id;
  return v_out;
end $$;

revoke all on function public.support_my_clinics() from public, anon;
revoke all on function public.support_open_ticket(uuid, text, text, text) from public, anon;
revoke all on function public.support_set_attachment(uuid, text) from public, anon;
revoke all on function public.support_reply(uuid, text) from public, anon;
revoke all on function public.support_set_status(uuid, text) from public, anon;
revoke all on function public.support_list_my_tickets() from public, anon;
revoke all on function public.support_my_unread_count() from public, anon;
revoke all on function public.support_platform_list(text) from public, anon;
revoke all on function public.support_platform_counts() from public, anon;
revoke all on function public.support_get_ticket(uuid) from public, anon;
grant execute on function public.support_my_clinics() to authenticated;
grant execute on function public.support_open_ticket(uuid, text, text, text) to authenticated;
grant execute on function public.support_set_attachment(uuid, text) to authenticated;
grant execute on function public.support_reply(uuid, text) to authenticated;
grant execute on function public.support_set_status(uuid, text) to authenticated;
grant execute on function public.support_list_my_tickets() to authenticated;
grant execute on function public.support_my_unread_count() to authenticated;
grant execute on function public.support_platform_list(text) to authenticated;
grant execute on function public.support_platform_counts() to authenticated;
grant execute on function public.support_get_ticket(uuid) to authenticated;
