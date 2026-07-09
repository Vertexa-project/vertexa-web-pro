-- =====================================================================================
-- WP-05B · FAMÍLIA 4 (Chat) · parte 2/2 — RLS REAL de 4 tabelas (por PARTICIPAÇÃO; realtime coberto)
-- Substitui as sprint_*. Determinística/idempotente.
--
-- REALTIME: chat_messages e chat_mentions estão na publicação supabase_realtime; o Realtime aplica a
--   RLS de SELECT da tabela assinada. Logo, SELECT = can_read_channel FECHA o canal de tempo real:
--   um NÃO-PARTICIPANTE que assine NÃO recebe eventos (SELECT negado ⇒ push negado). Nada afrouxado.
--
--  · chat_channels: SELECT can_read_channel (participante OU admin da clínica). INSERT = quem alcança o
--    paciente (can_access_patient_internal — paciente cria o próprio canal, prof vinculado/admin também;
--    externo NÃO). DELETE = can_manage_channel (prof vinculado/admin). Sem UPDATE.
--  · chat_participants: SELECT can_read_channel. INSERT/DELETE = can_manage_channel (prof vinculado/admin)
--    — o PACIENTE NÃO gere participantes (app não escreve chat_participants). ANTI-JOIN: ninguém se
--    auto-insere em canal alheio. Sem UPDATE.
--  · chat_messages: SELECT can_read_channel (== realtime). INSERT = participante do canal E
--    sender_profile_id = current_profile_id() (ANTI-FORJA de remetente). APPEND-ONLY (sem UPDATE/DELETE)
--    -> channel_id/sender imutáveis (não move mensagem, não reescreve remetente).
--  · chat_mentions: SELECT = o mencionado OU quem lê o canal da mensagem. INSERT = participante do canal
--    da mensagem. UPDATE só de read_at e só pelo PRÓPRIO mencionado (col-priv read_at). Sem DELETE.
-- anon: sem policy. service_role/postgres: bypassrls (Edge/observability).
--
-- KILL SWITCH (fail-closed): reverter as 4 a DENY-ALL (RLS ON, zero policy); NUNCA reabrir anon:
--   do $$ declare r record; begin
--     for r in select policyname, tablename from pg_policies where schemaname='public'
--       and tablename in ('chat_channels','chat_participants','chat_messages','chat_mentions')
--     loop execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename); end loop;
--   end $$;
-- ATENÇÃO: deny-all em chat_messages TAMBÉM DESLIGA o REALTIME para todos (fail-closed correto: melhor
--   ninguém receber do que vazar). Sintoma: usuário legítimo parou de ver/enviar no seu canal ->
--   corrigir a policy p/ FRENTE; jamais recriar sprint_*.
-- =====================================================================================

-- chat_channels
drop policy if exists sprint_read_all  on public.chat_channels;
drop policy if exists sprint_chat_write on public.chat_channels;
drop policy if exists chat_channels_select on public.chat_channels;
drop policy if exists chat_channels_insert on public.chat_channels;
drop policy if exists chat_channels_delete on public.chat_channels;
create policy chat_channels_select on public.chat_channels for select to authenticated using ( private.can_read_channel(id) );
create policy chat_channels_insert on public.chat_channels for insert to authenticated with check ( private.can_access_patient_internal(patient_id) );
create policy chat_channels_delete on public.chat_channels for delete to authenticated using ( private.can_manage_channel(id) );
revoke update on public.chat_channels from authenticated, anon;

-- chat_participants
drop policy if exists sprint_read_all  on public.chat_participants;
drop policy if exists sprint_chat_write on public.chat_participants;
drop policy if exists chat_participants_select on public.chat_participants;
drop policy if exists chat_participants_insert on public.chat_participants;
drop policy if exists chat_participants_delete on public.chat_participants;
create policy chat_participants_select on public.chat_participants for select to authenticated using ( private.can_read_channel(channel_id) );
create policy chat_participants_insert on public.chat_participants for insert to authenticated with check ( private.can_manage_channel(channel_id) );
create policy chat_participants_delete on public.chat_participants for delete to authenticated using ( private.can_manage_channel(channel_id) );
revoke update on public.chat_participants from authenticated, anon;

-- chat_messages (append-only; SELECT = realtime; anti-forja de remetente)
drop policy if exists sprint_read_all  on public.chat_messages;
drop policy if exists sprint_chat_write on public.chat_messages;
drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated using ( private.can_read_channel(channel_id) );
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check ( private.is_channel_participant(channel_id) and sender_profile_id = private.current_profile_id() );
revoke update on public.chat_messages from authenticated, anon;

-- chat_mentions
drop policy if exists sprint_read_all  on public.chat_mentions;
drop policy if exists sprint_chat_write on public.chat_mentions;
drop policy if exists chat_mentions_select on public.chat_mentions;
drop policy if exists chat_mentions_insert on public.chat_mentions;
drop policy if exists chat_mentions_update_read on public.chat_mentions;
create policy chat_mentions_select on public.chat_mentions for select to authenticated
  using ( mentioned_profile_id = private.current_profile_id() or private.can_read_channel(private.message_channel(message_id)) );
create policy chat_mentions_insert on public.chat_mentions for insert to authenticated
  with check ( private.is_channel_participant(private.message_channel(message_id)) );
create policy chat_mentions_update_read on public.chat_mentions for update to authenticated
  using ( mentioned_profile_id = private.current_profile_id() ) with check ( mentioned_profile_id = private.current_profile_id() );
revoke update on public.chat_mentions from authenticated, anon;
grant  update (read_at) on public.chat_mentions to authenticated;

insert into public.schema_migration_log (version, filename, description, session)
values ('20260714091000','20260714091000_wp05b_fam4_chat_rls.sql',
  'WP-05B Fam4: RLS real 4 tabelas de chat por participacao. SELECT can_read_channel (== realtime); '
  'chat_messages append-only + anti-forja sender (sender=current_profile_id); participantes geridos por '
  'prof vinculado/admin (anti-join); mencao read_at so pelo mencionado. anon negado.',
  'WP-05B-FAM4')
on conflict (version) do nothing;
