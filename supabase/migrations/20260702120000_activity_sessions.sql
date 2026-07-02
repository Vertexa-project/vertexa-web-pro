-- =====================================================================================
-- VERTEXA — activity_sessions: atividade complementar registrada pelo paciente (app)
-- ADITIVA e reversível. NÃO altera tabelas existentes. NÃO renomeia colunas.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md): a tela /log-activity (LogActivity.tsx) do app era
-- 100% visual — o "Salvar atividade" só trocava de step, sem gravar nada. Esta tabela é o ponto
-- CANÔNICO do VALOR "atividade complementar do dia" (modalidade, duração, calorias, origem). Mesmo
-- padrão de weight_logs/meal_logs: o VALOR vive AQUI; o MARCADOR de timeline continua em
-- activity_events(type='activity_logged', payload={modality,duration_min,calories,source}) — disparado
-- pelo tracker/eventSync, NÃO por esta tabela. patient_id é sempre patients.id.
--
-- source = 'manual' | 'device' (o toggle "Dispositivo" é cosmético por ora — "Em breve" — mas o
-- VALOR escolhido é persistido fielmente). performed_at = momento da atividade (default now()).
--
-- RLS: policies PERMISSIVAS de sprint (seed fictício), espelhando weight_logs
-- (migrations/20260625120000): SELECT + INSERT para anon/authenticated. Sem UPDATE/DELETE de
-- propósito (registro é append-only nesta fase). #11–#14 vão FECHAR por clínica/vínculo/papel.
--
-- Rollback:
--   drop policy if exists sprint_activity_session_read  on public.activity_sessions;
--   drop policy if exists sprint_activity_session_write on public.activity_sessions;
--   drop table  if exists public.activity_sessions cascade;
-- =====================================================================================

create table if not exists public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  modality text not null,                     -- corrida|caminhada|ciclismo|natacao|jiujitsu|tenis|cardio|outra
  duration_min int not null,
  calories int,
  source text not null default 'manual',      -- 'manual' | 'device' (device cosmético por ora, mas persistido)
  performed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists activity_sessions_patient_performed_idx
  on public.activity_sessions (patient_id, performed_at desc);

alter table public.activity_sessions enable row level security;

-- Policies PERMISSIVAS de sprint (seed fictício). Substituir por RLS por clínica/vínculo (#11–#14).
drop policy if exists sprint_activity_session_read on public.activity_sessions;
create policy sprint_activity_session_read on public.activity_sessions
  for select to anon, authenticated using (true);

drop policy if exists sprint_activity_session_write on public.activity_sessions;
create policy sprint_activity_session_write on public.activity_sessions
  for insert to anon, authenticated with check (true);
