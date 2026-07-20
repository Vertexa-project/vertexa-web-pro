-- =====================================================================================
-- WP-CHAT-ATTACH · A — Anexos na mensageria: modelo de dados + bucket + policies.
--
-- DECISÕES DO DONO (lei):
--  (i)   1 anexo por mensagem via COLUNAS anuláveis em chat_messages (attachment_path/name/mime/size).
--        `body` vira ANULÁVEL + CHECK (body IS NOT NULL OR attachment_path IS NOT NULL) — proíbe row
--        vazio; mensagem só-anexo permitida. Dívida: se N anexos virar requisito → tabela filha.
--  (ii)  Caminho {channel_id}/{uuid}.{ext}; helper private.storage_object_channel espelha
--        storage_object_patient (IMMUTABLE, search_path='', 1a pasta só se casar UUID, senão NULL⇒deny).
--  (iii) Bucket chat-attachments PRIVADO com allowed_mime_types (pdf/jpeg/png/webp) + file_size_limit 10MB.
--  (iv)  DELETE do objeto: SÓ órfão do próprio uploader (owner = auth.uid() AND nenhuma mensagem
--        referencia o path). Helper SECDEF private.chat_attachment_is_orphan evita recursão de RLS.
--        Dívida: órfão cujo uploader nunca volta → janitor agendado (service_role) em WP futuro.
--  (v)   INSERT de chat_messages GANHA (só ACRESCENTA) a integridade de canal do anexo:
--        attachment_path IS NULL OR storage_object_channel(attachment_path) = channel_id.
--
-- AUTORIZAÇÃO (herda a do canal — Família 4; NENHUMA policy de chat existente é AFROUXADA):
--   · metadado do anexo = colunas de chat_messages ⇒ SELECT can_read_channel (inclui admin, oversight),
--     INSERT is_channel_participant AND sender=self (+ item v). append-only mantido (sem UPDATE/DELETE).
--   · objeto (storage.objects, bucket chat-attachments, pasta = channel_id):
--       SELECT  private.can_read_channel(storage_object_channel(name))       (admin LÊ)
--       INSERT  private.is_channel_participant(storage_object_channel(name)) (admin NÃO envia)
--       UPDATE  negado (sem policy)
--       DELETE  owner=auth.uid() AND chat_attachment_is_orphan(name)          (só órfão próprio)
--     anon: sem acesso; service_role: bypass mantido.
--
-- ROLLBACK (kill switch, fail-closed — NUNCA public=true, NUNCA reabrir anon):
--   drop policy if exists storage_chat_attachments_select on storage.objects;
--   drop policy if exists storage_chat_attachments_insert on storage.objects;
--   drop policy if exists storage_chat_attachments_delete on storage.objects;
--   delete from storage.buckets where id='chat-attachments';  -- só se vazio
--   -- restaura o INSERT de chat_messages à versão anterior (remove APENAS o item v):
--   alter policy chat_messages_insert on public.chat_messages with check (
--     private.is_channel_participant(channel_id) and (sender_profile_id = private.current_profile_id()));
--   alter table public.chat_messages drop constraint if exists chat_messages_body_or_attachment_chk;
--   -- body volta a NOT NULL só se não houver linha só-anexo (senão preencher antes):
--   -- update public.chat_messages set body='' where body is null; alter table ... alter column body set not null;
--   alter table public.chat_messages
--     drop column if exists attachment_size, drop column if exists attachment_mime,
--     drop column if exists attachment_name, drop column if exists attachment_path;
--   drop function if exists private.chat_attachment_is_orphan(text);
--   drop function if exists private.storage_object_channel(text);
-- =====================================================================================

-- (ii) extrai channel_id da 1a pasta do path — ESPELHA private.storage_object_patient.
create or replace function private.storage_object_channel(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name like '%/%'
     and split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;
revoke all     on function private.storage_object_channel(text) from public, anon;
grant  execute on function private.storage_object_channel(text) to authenticated;

-- (i) modelo: 1 anexo/mensagem em colunas anuláveis; body anulável + CHECK.
-- (ORDEM: as colunas nascem ANTES do helper de órfão, que referencia attachment_path.)
alter table public.chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;

alter table public.chat_messages alter column body drop not null;

alter table public.chat_messages
  add constraint chat_messages_body_or_attachment_chk
  check (body is not null or attachment_path is not null);

-- (iv) o path é órfão? (nenhuma mensagem o referencia). SECURITY DEFINER: consulta chat_messages
-- sem disparar a RLS de chat_messages de dentro da policy de storage.objects (evita recursão).
create or replace function private.chat_attachment_is_orphan(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.chat_messages cm where cm.attachment_path = p_name
  )
$$;
revoke all     on function private.chat_attachment_is_orphan(text) from public, anon;
grant  execute on function private.chat_attachment_is_orphan(text) to authenticated;

-- (v) INSERT de chat_messages: PRESERVA as condições atuais (participante + anti-forja) e SÓ ACRESCENTA
-- a integridade de canal do anexo (referência cruzada entre canais negada).
alter policy chat_messages_insert on public.chat_messages
with check (
  private.is_channel_participant(channel_id)
  and (sender_profile_id = private.current_profile_id())
  and (attachment_path is null or private.storage_object_channel(attachment_path) = channel_id)
);

-- (iii) bucket privado com allowlist de MIME + teto de 10 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- policies do objeto, escopadas por pasta = channel_id.
create policy storage_chat_attachments_select on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments'
         and private.can_read_channel(private.storage_object_channel(name)));

create policy storage_chat_attachments_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments'
              and private.is_channel_participant(private.storage_object_channel(name)));

-- UPDATE: intencionalmente SEM policy ⇒ negado (append-only; anexo é imutável).

create policy storage_chat_attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-attachments'
         and owner = (select auth.uid())
         and private.chat_attachment_is_orphan(name));

-- Ledger humano (companion PT-BR; deny-all, só alimentado por migration).
insert into public.schema_migration_log (version, filename, description, session)
values ('20260727090000','20260727090000_wp_chat_attach_a.sql',
  'WP-CHAT-ATTACH A: anexos na mensageria. chat_messages ganha attachment_path/name/mime/size (1/msg), '
  'body vira anulavel + CHECK(body OR attachment). Helpers private.storage_object_channel (espelha '
  'storage_object_patient) e private.chat_attachment_is_orphan (SECDEF). Bucket privado chat-attachments '
  '(mime pdf/jpeg/png/webp, 10MB). Policies storage.objects por pasta=channel_id: SELECT can_read_channel '
  '(admin le), INSERT is_channel_participant (admin nao envia), UPDATE negado, DELETE so orfao do proprio '
  'uploader. INSERT de chat_messages SO ACRESCENTA a integridade de canal do anexo (item v); nenhuma policy '
  'existente afrouxada. app/patient-native nao tocados.',
  'WP-CHAT-ATTACH')
on conflict (version) do nothing;
