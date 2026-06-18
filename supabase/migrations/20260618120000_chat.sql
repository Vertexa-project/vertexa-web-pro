-- Etapa 2 do Chat — schema + backfill + realtime.
-- Idempotente (create if not exists / drop policy if exists / port só se vazia), EXCETO os
-- `alter publication ... add table` do realtime, que NÃO são idempotentes — rodar a migration 1x.
-- Policies de DEMO permissivas (espelham messages/sprint_plan_write) — TEMPORÁRIAS, ver RLS real.
-- NÃO dropar/renomear `messages` (a web vai repontar antes de aposentá-la). Nunca service_role.

-- ========== 4 TABELAS ==========
create table if not exists chat_channels (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade unique,
  created_at timestamptz default now()
);
create table if not exists chat_participants (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references chat_channels(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  role user_role not null,
  unique (channel_id, profile_id)
);
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references chat_channels(id) on delete cascade,
  sender_profile_id uuid references profiles(id),
  sender_role user_role not null,
  body text not null,
  created_at timestamptz default now()
);
create table if not exists chat_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references chat_messages(id) on delete cascade,
  mentioned_profile_id uuid references profiles(id) on delete cascade,
  read_at timestamptz
);
create index if not exists idx_chat_messages_channel_created on chat_messages(channel_id, created_at);
create index if not exists idx_chat_mentions_unread on chat_mentions(mentioned_profile_id) where read_at is null;

-- ========== BACKFILL: 1 canal por paciente ==========
insert into chat_channels (patient_id)
select id from patients on conflict (patient_id) do nothing;

-- participante paciente
insert into chat_participants (channel_id, profile_id, role)
select c.id, pat.profile_id, 'patient'
from chat_channels c join patients pat on pat.id = c.patient_id
where pat.profile_id is not null
on conflict (channel_id, profile_id) do nothing;

-- participantes profissionais vinculados (ativos)
insert into chat_participants (channel_id, profile_id, role)
select c.id, pr.profile_id, 'professional'
from chat_channels c
join professional_patient_links l on l.patient_id = c.patient_id and l.status = 'active'
join professionals pr on pr.id = l.professional_id
where pr.profile_id is not null
on conflict (channel_id, profile_id) do nothing;

-- PORTAR messages -> chat_messages (idempotente: só roda se chat_messages estiver vazia)
insert into chat_messages (channel_id, sender_profile_id, sender_role, body, created_at)
select c.id,
       case when m.sender_role = 'professional' then pr.profile_id else pat.profile_id end,
       m.sender_role, m.body, m.created_at
from messages m
join chat_channels c on c.patient_id = m.patient_id
left join professionals pr on pr.id = m.sender_professional_id
left join patients pat on pat.id = m.patient_id
where not exists (select 1 from chat_messages);

-- ========== POLICIES DE DEMO (permissivas, idempotentes) ==========
-- SELECT = sprint_read_all (espelha messages); ALL = sprint_chat_write (espelha sprint_plan_write).
do $$
declare t text;
begin
  foreach t in array array['chat_channels','chat_participants','chat_messages','chat_mentions']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists sprint_read_all on public.%I;', t);
    execute format('create policy sprint_read_all on public.%I for select to anon, authenticated using (true);', t);
    execute format('drop policy if exists sprint_chat_write on public.%I;', t);
    execute format('create policy sprint_chat_write on public.%I for all to anon, authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- ========== REALTIME (rodar 1x; `add table` não é idempotente) ==========
alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table chat_mentions;
