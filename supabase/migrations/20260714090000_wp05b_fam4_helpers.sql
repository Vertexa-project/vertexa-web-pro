-- =====================================================================================
-- WP-05B · FAMÍLIA 4 (Chat) · parte 1/2 — HELPERS (autorização por PARTICIPAÇÃO)
-- Idempotente. SECURITY DEFINER, search_path='', execute só authenticated.
--
--  · is_channel_participant(channel): current_profile_id() está em chat_participants do canal.
--  · channel_patient(channel): resolve o paciente do canal (chat_channels.patient_id).
--  · can_read_channel(channel): participante OU admin da clínica do paciente do canal (AUTH-ADMIN-1).
--    ISTO é o predicado de SELECT de chat_messages/chat_mentions -> FECHA o REALTIME.
--  · can_manage_channel(channel): quem gere participantes = prof comum vinculado ao paciente OU admin.
--  · message_channel(message): resolve o canal de uma mensagem (p/ policies de chat_mentions).
-- Por serem DEFINER, leem chat_participants/chat_channels/chat_messages sem disparar as policies delas
-- (sem recursão). Rollback: drop das 5 funções.
-- =====================================================================================

create or replace function private.is_channel_participant(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.chat_participants cp
                where cp.channel_id = p_channel and cp.profile_id = private.current_profile_id())
$$;

create or replace function private.channel_patient(p_channel uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select cc.patient_id from public.chat_channels cc where cc.id = p_channel
$$;

create or replace function private.can_read_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_channel_participant(p_channel)
      or private.is_clinic_admin(private.patient_clinic(private.channel_patient(p_channel)))
$$;

create or replace function private.can_manage_channel(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_prescribe_for_patient(private.channel_patient(p_channel))
$$;

create or replace function private.message_channel(p_message uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select cm.channel_id from public.chat_messages cm where cm.id = p_message
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260714090000','20260714090000_wp05b_fam4_helpers.sql',
  'WP-05B Fam4: helpers de chat por participacao (is_channel_participant/channel_patient/can_read_channel/'
  'can_manage_channel/message_channel). can_read_channel governa o SELECT = REALTIME.',
  'WP-05B-FAM4')
on conflict (version) do nothing;
