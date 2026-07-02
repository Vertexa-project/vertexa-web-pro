-- =====================================================================================
-- VERTEXA — notifications: notificações do paciente (S6/app). ADITIVA e reversível.
-- NÃO altera tabelas existentes. NÃO renomeia colunas.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md): a tela /notifications do app era 100% mock
-- (mockData.notifications) e o "marcar como lida" não persistia. Esta tabela é a fonte real.
-- Por ora as notificações NASCEM DE SEED (dívida: "emissor de notificações no web" — a web/Edge
-- ainda não gera notificações a partir de eventos; anotada no #14 e no contrato).
--
-- read_at IS NULL = não lida (alimenta o badge de não-lidas). markAsRead seta read_at=now().
--
-- RLS: policies PERMISSIVAS de sprint (seed fictício).
--   SELECT (anon/auth) — a tela lê.
--   UPDATE (anon/auth) — só para marcar como lida (o app atualiza read_at). SEM INSERT/DELETE
--   para anon: notificações só entram por seed/migration (ou futuro emissor web via service_role),
--   nunca pelo client. #11–#14 fecham por auth.uid()->patient_id + restringem o UPDATE à coluna
--   read_at das PRÓPRIAS notificações. Anotada no checklist #14.
--
-- Aplicada via apply_migration (ledger 20260702220402). Idempotente (create table if not exists +
-- drop policy if exists). O seed re-insere se rodar 2x — ok em dev/seed fictício.
--
-- Rollback:
--   drop policy if exists sprint_notification_read   on public.notifications;
--   drop policy if exists sprint_notification_update on public.notifications;
--   drop table  if exists public.notifications cascade;
-- =====================================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  type text not null check (type in ('reminder', 'motivation', 'achievement', 'professional', 'retention', 'system')),
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_patient_created_idx
  on public.notifications (patient_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists sprint_notification_read on public.notifications;
create policy sprint_notification_read on public.notifications
  for select to anon, authenticated using (true);

-- UPDATE permissivo de sprint p/ marcar como lida (o app só altera read_at). Sob RLS real:
-- restringir às notificações do próprio paciente (auth.uid()->patient_id) e à coluna read_at.
drop policy if exists sprint_notification_update on public.notifications;
create policy sprint_notification_update on public.notifications
  for update to anon, authenticated using (true) with check (true);

-- ── Seed: 3 notificações da Mariana, COERENTES com a linha do tempo aprovada ──────────────
-- (achievement 28/06 já lida; plano 01/07 e lembrete 02/07 não lidas -> badge = 2)
insert into public.notifications (patient_id, type, title, body, read_at, created_at) values
  ('10000000-0000-0000-0000-0000000000b1', 'achievement',  'Nova conquista desbloqueada 🏆',
     'Você atingiu 14 dias de constância. Continue assim!', '2026-06-28 20:00:00+00', '2026-06-28 15:05:00+00'),
  ('10000000-0000-0000-0000-0000000000b1', 'professional', 'Mensagem da Dra. Camila',
     'Seu plano alimentar foi atualizado para esta semana.', null, '2026-07-01 13:00:00+00'),
  ('10000000-0000-0000-0000-0000000000b1', 'reminder',     'Registro de peso semanal',
     'É dia de registrar seu peso. Não esqueça de acompanhar sua evolução!', null, '2026-07-02 09:00:00+00');
