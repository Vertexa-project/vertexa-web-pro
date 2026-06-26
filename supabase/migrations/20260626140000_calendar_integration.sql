-- =====================================================================================
-- VERTEXA — Sessão 10 (web): INTEGRAÇÃO GOOGLE CALENDAR (read-only, multi-tenant) via Edge Functions.
-- ADITIVA e reversível. NÃO altera tabelas/colunas existentes (só cria tabelas/policies/índices).
--
-- Desenho (auditado): a troca OAuth (code→tokens) e o sync rodam em Supabase Edge Functions (Deno)
-- com service_role — o client Vite NUNCA vê client_secret nem refresh_token.
--   • calendar_connections        — METADADO da conexão (sem token). Leitura sprint (anon/auth).
--   • calendar_connection_tokens  — access/refresh token. DENY-ALL (revoke; sem policy) → só service_role.
--   • calendar_event_cache        — espelho read-only dos eventos do Google. Leitura sprint (anon/auth).
--   • calendar_oauth_state        — state anti-CSRF (TTL curto, single-use). DENY-ALL → só service_role.
--
-- ⚠️ RLS permissiva — SPRINT (connections/cache em using(true); o isolamento por clínica é client-side
--    hoje). Antes de dado real, trocar por `clinic_id = clínica do auth.uid()` (dívida #11–#14 / S9).
--    Tokens/state já nascem DENY-ALL (correto desde já). Cifra do refresh_token em repouso
--    (pgsodium/Vault) = recomendada e registrada como dívida S9/P1 (PENDENCIAS #22). Conectar agenda
--    REAL de clínica só após a S9 (pré-S9: apenas conta Google de TESTE / eventos fictícios).
--
-- Rollback:
--   drop table if exists public.calendar_oauth_state cascade;
--   drop table if exists public.calendar_event_cache cascade;
--   drop table if exists public.calendar_connection_tokens cascade;
--   drop table if exists public.calendar_connections cascade;
-- =====================================================================================

-- 1) Conexão (METADADO — sem token). Uma conexão por (clínica, profissional, conta Google).
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete set null,
  provider text not null default 'google',
  google_account_email text,
  google_calendar_id text,
  calendar_name text,
  scopes text,
  status text not null default 'connected', -- connected | revoked | error | stale
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Leitura da agenda = por clínica; idempotência do connect = uma conexão por (clínica, prof, conta).
create index if not exists calendar_connections_clinic_idx
  on public.calendar_connections (clinic_id);
create unique index if not exists calendar_connections_unique_idx
  on public.calendar_connections (clinic_id, professional_id, provider, google_account_email);

alter table public.calendar_connections enable row level security;

-- Leitura (sprint): status/e-mail/agenda visíveis ao portal (SEM token). Escopo por clínica é client-side.
drop policy if exists sprint_calendar_connection_read on public.calendar_connections;
create policy sprint_calendar_connection_read on public.calendar_connections
  for select to anon, authenticated using (true);
-- SEM policy de escrita: connections só são criadas/alteradas pela Edge Function (service_role).

-- 2) Tokens OAuth — SENSÍVEL. DENY-ALL para anon/authenticated; só service_role (Edge Function) lê/escreve.
create table if not exists public.calendar_connection_tokens (
  connection_id uuid primary key references public.calendar_connections(id) on delete cascade,
  access_token text,
  refresh_token text not null,
  token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.calendar_connection_tokens enable row level security;
-- Sem policy + revoke = ninguém com anon/authenticated lê (igual ao endurecimento do ledger, S7/S8).
revoke all on table public.calendar_connection_tokens from anon, authenticated;

-- 3) Cache de eventos (espelho read-only do Google). Leitura sprint por clínica (client-side).
create table if not exists public.calendar_event_cache (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.calendar_connections(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  google_event_id text not null,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  status text,
  synced_at timestamptz not null default now(),
  unique (connection_id, google_event_id)
);

create index if not exists calendar_event_cache_clinic_starts_idx
  on public.calendar_event_cache (clinic_id, starts_at);

alter table public.calendar_event_cache enable row level security;

drop policy if exists sprint_calendar_event_read on public.calendar_event_cache;
create policy sprint_calendar_event_read on public.calendar_event_cache
  for select to anon, authenticated using (true);
-- SEM policy de escrita: só a Edge Function (service_role) faz upsert/delete do cache.

-- 4) State anti-CSRF do OAuth (TTL curto, single-use). DENY-ALL; só service_role (Edge Functions).
create table if not exists public.calendar_oauth_state (
  state text primary key,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete set null,
  redirect_to text, -- origem do SPA (dev/prod) p/ voltar após o callback
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.calendar_oauth_state enable row level security;
revoke all on table public.calendar_oauth_state from anon, authenticated;

-- Registro humano no ledger (companion PT-BR; o ledger é deny-all e só é alimentado por migration).
insert into public.schema_migration_log (version, filename, description, session) values
  (
    '20260626140000',
    '20260626140000_calendar_integration.sql',
    'Sessao 10 (web): integracao Google Calendar read-only, multi-tenant, via Edge Functions. Cria calendar_connections (metadado, leitura sprint), calendar_connection_tokens (DENY-ALL), calendar_event_cache (leitura sprint) e calendar_oauth_state (DENY-ALL). Tokens/state sem acesso anon/authenticated; so service_role via Edge Functions.',
    'S10'
  )
on conflict (version) do update set
  filename = excluded.filename,
  description = excluded.description,
  session = excluded.session;
