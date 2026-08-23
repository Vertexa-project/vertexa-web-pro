-- =====================================================================================
-- WP-07B1 — inbox do profissional (staff_notifications) + fan-out SOS server-side.
--
-- A TESE: o SOS do paciente já é um chat_messages real. Não há alerta visível no WEB
-- se a conversa não estiver aberta. public.notifications é inbox DO PACIENTE (Fam7) e
-- NÃO se reutiliza. chat_mentions continua sendo só @ — este WP NÃO cria menção.
--
-- DELTA ESTRUTURAL:
--   1) public.staff_notifications — referências (sem body/PII da mensagem).
--   2) RLS: SELECT/UPDATE(read_at) só o recipient; INSERT/DELETE client negados.
--   3) private.staff_help_request_body_matches — matcher V1 do prefixo do APP
--      (compatibilidade; dívida: estruturar help-request sem depender do body).
--   4) private.staff_help_request_recipient_profile_ids — roster elegível.
--   5) private.tg_chat_messages_fanout_staff_help_requested — AFTER INSERT,
--      SECURITY DEFINER, search_path='', NÃO é API.
--   6) trigger em public.chat_messages.
--   7) membership em supabase_realtime (H6). Não remove tabelas existentes.
--
-- H5: recipient_profile_id tem FK para profiles; actor_profile_id NÃO tem FK
--   (segunda FK ao mesmo par criaria a 5ª dupla n>1). clinic/patient/channel/message
--   têm no máximo 1 FK cada para o par.
-- ÂNCORAS INTOCADAS: can_see_profile, promote_to_professional, handle_new_user,
--   create_patient, create_clinic_with_owner. public.notifications e chat_mentions
--   NÃO são alterados.
--
-- KILL SWITCH:
--   drop trigger if exists trg_chat_messages_fanout_staff_help_requested
--     on public.chat_messages;
--   revoke all on function private.tg_chat_messages_fanout_staff_help_requested()
--     from public, anon, authenticated;
--
-- NÃO APLICAR no remoto neste WP.
-- =====================================================================================

-- ── 1. Tabela ────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  recipient_profile_id uuid not null references public.profiles(id),
  actor_profile_id uuid,
  patient_id uuid references public.patients(id),
  channel_id uuid references public.chat_channels(id),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  type text not null,
  severity text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint staff_notifications_type_chk
    check (type in ('help_requested')),
  constraint staff_notifications_severity_chk
    check (severity in ('critical')),
  constraint staff_notifications_idemp
    unique (type, message_id, recipient_profile_id)
);

comment on table public.staff_notifications is
  'WP-07B1: inbox do profissional. Só referências; sem body/diagnóstico. '
  'Histórico permanece se o vínculo cair; acesso clínico continua nas RLS de patient/chat.';

comment on column public.staff_notifications.actor_profile_id is
  'Perfil do paciente-autor no momento do SOS. Sem FK para profiles: evita 5ª dupla H5.';

create index if not exists staff_notifications_recipient_created_idx
  on public.staff_notifications (recipient_profile_id, created_at desc);

create index if not exists staff_notifications_recipient_unread_idx
  on public.staff_notifications (recipient_profile_id)
  where read_at is null;

-- ── 2. Grants mínimos ────────────────────────────────────────────────────────────────
revoke all on table public.staff_notifications from public, anon, authenticated;
grant select on table public.staff_notifications to authenticated;
grant update (read_at) on table public.staff_notifications to authenticated;

-- ── 3. RLS ───────────────────────────────────────────────────────────────────────────
alter table public.staff_notifications enable row level security;

drop policy if exists staff_notifications_select on public.staff_notifications;
create policy staff_notifications_select on public.staff_notifications
  for select to authenticated
  using (recipient_profile_id = private.current_profile_id());

drop policy if exists staff_notifications_update_read on public.staff_notifications;
create policy staff_notifications_update_read on public.staff_notifications
  for update to authenticated
  using (recipient_profile_id = private.current_profile_id())
  with check (recipient_profile_id = private.current_profile_id());

-- ── 4. Matcher SOS (compat V1 com o APP; um lugar só) ────────────────────────────────
-- Contrato atual (vertexa-app-paciente/src/lib/sosMessage.ts, NÃO alterado):
--   SOS_PREFIX = 'Preciso de ajuda'
--   header     = SOS_PREFIX || ' — ' || categoria
--   opcional   = header || '\n\n' || texto
-- Dívida: estruturar help-request sem depender do body.
create or replace function private.staff_help_request_body_matches(p_body text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Separador do APP: espaço + EM DASH U+2014 (e opcionalmente espaço + categoria).
  -- chr() evita ambiguidade de encoding do literal. Dívida: kind estruturado.
  select p_body is not null
     and left(p_body, 16) = 'Preciso de ajuda'
     and (
       char_length(p_body) = 16
       or substr(p_body, 17, 2) = chr(32) || chr(8212)
       or substr(p_body, 17, 1) = E'\n'
     );
$$;

comment on function private.staff_help_request_body_matches(text) is
  'WP-07B1 V1: prefixo SOS do APP. Dívida: kind estruturado, sem parse de body.';

revoke all on function private.staff_help_request_body_matches(text)
  from public, anon, authenticated;

-- ── 5. Recipients = roster ativo interno (não admin-sem-vínculo, não externo) ────────
create or replace function private.staff_help_request_recipient_profile_ids(p_patient uuid)
returns table(profile_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.profile_id
    from public.professional_patient_links l
    join public.professionals pr on pr.id = l.professional_id
   where l.patient_id = p_patient
     and coalesce(l.status, 'active') = 'active'
     and coalesce(l.is_external, false) = false
     and coalesce(pr.status, 'active') = 'active'
     and pr.profile_id is not null;
$$;

comment on function private.staff_help_request_recipient_profile_ids(uuid) is
  'WP-07B1: profissionais com vínculo ativo, não-externo e status active. Sem admin-só.';

revoke all on function private.staff_help_request_recipient_profile_ids(uuid)
  from public, anon, authenticated;

-- ── 6. Trigger: prova canal+paciente+role ANTES do prefixo ───────────────────────────
create or replace function private.tg_chat_messages_fanout_staff_help_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid;
  v_clinic uuid;
  v_patient_profile uuid;
begin
  if tg_op is distinct from 'INSERT' then
    return new;
  end if;

  -- 1–3: canal válido, sender = paciente DAQUELE canal, role patient.
  if new.sender_role is distinct from 'patient'::public.user_role then
    return new;
  end if;
  if new.channel_id is null or new.sender_profile_id is null then
    return new;
  end if;

  select cc.patient_id
    into v_patient
    from public.chat_channels cc
   where cc.id = new.channel_id;
  if v_patient is null then
    return new;
  end if;

  select pt.profile_id, pt.clinic_id
    into v_patient_profile, v_clinic
    from public.patients pt
   where pt.id = v_patient;
  if v_patient_profile is null
     or v_patient_profile is distinct from new.sender_profile_id then
    return new;
  end if;
  if v_clinic is null then
    return new;
  end if;

  -- 4: contrato SOS V1 (depois da prova de identidade).
  if not private.staff_help_request_body_matches(new.body) then
    return new;
  end if;

  insert into public.staff_notifications (
    clinic_id,
    recipient_profile_id,
    actor_profile_id,
    patient_id,
    channel_id,
    message_id,
    type,
    severity
  )
  select
    v_clinic,
    r.profile_id,
    new.sender_profile_id,
    v_patient,
    new.channel_id,
    new.id,
    'help_requested',
    'critical'
  from private.staff_help_request_recipient_profile_ids(v_patient) r
  on conflict (type, message_id, recipient_profile_id) do nothing;

  return new;
end;
$$;

comment on function private.tg_chat_messages_fanout_staff_help_requested() is
  'WP-07B1: AFTER INSERT chat_messages. Fan-out na mesma transação. Não é API.';

revoke all on function private.tg_chat_messages_fanout_staff_help_requested()
  from public, anon, authenticated;

drop trigger if exists trg_chat_messages_fanout_staff_help_requested
  on public.chat_messages;
create trigger trg_chat_messages_fanout_staff_help_requested
  after insert on public.chat_messages
  for each row
  execute function private.tg_chat_messages_fanout_staff_help_requested();

-- ── 7. Realtime (H6) ─────────────────────────────────────────────────────────────────
do $pub$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'staff_notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.staff_notifications';
  end if;
end;
$pub$;

insert into public.schema_migration_log (version, filename, description, session)
values (
  '20260814090000',
  '20260814090000_wp_07b1_staff_notifications.sql',
  'WP-07B1: staff_notifications (inbox profissional) + fan-out SOS em chat_messages. '
  'RLS só recipient; UPDATE só read_at; sem tocar notifications/chat_mentions. '
  'Realtime: add staff_notifications. Matcher V1 do prefixo Preciso de ajuda.',
  'WP-07B1'
)
on conflict (version) do nothing;
