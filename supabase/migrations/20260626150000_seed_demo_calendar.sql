-- =====================================================================================
-- VERTEXA — Sessão 10 (web): SEED fictício do Google Calendar p/ a demo (agenda MESCLADA).
-- ADITIVA, idempotente e reversível. Só dado de SEED (não altera schema).
--
-- Cria 1 conexão FAKE (status 'connected') ancorada na clínica c1 + Dra. Camila (e2) e 3 eventos
-- fictícios no cache (hoje/semana), para o Dashboard exibir a agenda interna + Google (com chip de
-- fonte) SEM precisar de conta Google real. NÃO grava token (calendar_connection_tokens fica vazio):
-- a conexão é só de exibição; sincronizar/desconectar reais exigem o OAuth configurado.
-- Títulos são de gestão da clínica (não dados de paciente) — guardrail LGPD.
--
-- Idempotência: conexão via on conflict (id) do nothing; eventos via WHERE NOT EXISTS (marcador
-- google_event_id like 'seed-demo-%').
--
-- Rollback (remove só estes seeds fictícios):
--   delete from public.calendar_event_cache where google_event_id like 'seed-demo-%';
--   delete from public.calendar_connections where id = '00000000-0000-0000-0000-00000000ca10';
-- =====================================================================================

-- Conexão fictícia (sem token) — Clínica Vértice (c1) / Dra. Camila (professional e2).
insert into public.calendar_connections
  (id, clinic_id, professional_id, provider, google_account_email, google_calendar_id, calendar_name, scopes, status, last_synced_at)
values
  (
    '00000000-0000-0000-0000-00000000ca10',
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000e2',
    'google',
    'agenda.demo@clinicavertice.com',
    'agenda.demo@clinicavertice.com',
    'Agenda da Clínica Vértice (demo)',
    'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'connected',
    now()
  )
on conflict (id) do nothing;

-- Eventos fictícios do Google (hoje + dois nos próximos dias). Fuso America/Sao_Paulo (coincide com a
-- janela da agenda interna na demo BR). google_event_id 'seed-demo-*' = marcador idempotente/rollback.
insert into public.calendar_event_cache
  (connection_id, clinic_id, google_event_id, title, starts_at, ends_at, all_day, status, synced_at)
select v.connection_id, v.clinic_id, v.google_event_id, v.title, v.starts_at, v.ends_at, v.all_day, v.status, now()
from (values
  (
    '00000000-0000-0000-0000-00000000ca10'::uuid,
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    'seed-demo-evt-1',
    'Reunião de equipe da clínica',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '14 hours') at time zone 'America/Sao_Paulo',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '14 hours 45 minutes') at time zone 'America/Sao_Paulo',
    false,
    'confirmed'
  ),
  (
    '00000000-0000-0000-0000-00000000ca10'::uuid,
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    'seed-demo-evt-2',
    'Bloqueio: emissão de laudos',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day 10 hours') at time zone 'America/Sao_Paulo',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day 11 hours') at time zone 'America/Sao_Paulo',
    false,
    'confirmed'
  ),
  (
    '00000000-0000-0000-0000-00000000ca10'::uuid,
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    'seed-demo-evt-3',
    'Almoço com fornecedor',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '2 days 12 hours 30 minutes') at time zone 'America/Sao_Paulo',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '2 days 13 hours 30 minutes') at time zone 'America/Sao_Paulo',
    false,
    'confirmed'
  )
) as v(connection_id, clinic_id, google_event_id, title, starts_at, ends_at, all_day, status)
where not exists (
  select 1 from public.calendar_event_cache
  where connection_id = '00000000-0000-0000-0000-00000000ca10'::uuid and google_event_id like 'seed-demo-%'
);

-- Ledger humano (companion PT-BR; deny-all, só alimentado por migration).
insert into public.schema_migration_log (version, filename, description, session) values
  (
    '20260626150000',
    '20260626150000_seed_demo_calendar.sql',
    'Sessao 10 (web): seed ficticio do Google Calendar (1 conexao connected sem token + 3 eventos no cache) na clinica c1 p/ a demo exibir a agenda mesclada (interna + Google). Idempotente; rollback por marcador seed-demo.',
    'S10'
  )
on conflict (version) do update set
  filename = excluded.filename,
  description = excluded.description,
  session = excluded.session;
