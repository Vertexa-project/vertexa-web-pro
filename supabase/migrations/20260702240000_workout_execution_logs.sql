-- =====================================================================================
-- VERTEXA — workout_session_logs + workout_set_logs: EXECUÇÃO de treino (o que foi FEITO)
-- ADITIVA e reversível. NÃO altera tabelas existentes. NÃO renomeia colunas.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md, dívida #S-EXEC): o app guia o treino PRESCRITO
-- (workout_plans->workouts->workout_exercises: sets/reps/load_kg) mas DESCARTAVA o que foi feito —
-- o WorkoutGuide só emitia workout_checked (MARCADOR). Estas 2 tabelas são o ponto CANÔNICO do
-- VALOR "execução do treino": a sessão (workout_session_logs) e cada série feita (workout_set_logs:
-- peso + reps FEITAS + RPE opcional). O plano é o "prescrito"; isto é o "feito". O MARCADOR de
-- timeline/VRI continua em activity_events(type='workout_checked') via tracker/eventSync — NÃO muda:
-- o adherenceEngine lê só type/created_at (dias distintos), NUNCA estas tabelas. patient_id = patients.id.
--
-- Padrão de mercado (Strong/Hevy/StrengthLog): núcleo por SÉRIE (peso+reps+RPE); tempo total e
-- descanso NULLABLE (a UI não obriga a coletar agora); volume (peso×reps) e 1RM = DERIVADOS em
-- leitura, NUNCA coluna.
--
-- DURABILIDADE (decisão aprovada): workout_id / workout_exercise_id são ON DELETE SET NULL (nullable) —
-- a execução do PACIENTE sobrevive à edição/regeneração do plano pelo profissional. Snapshots
-- workout_name / exercise_name preservam a leitura mesmo se o plano sumir.
--
-- GAP CONHECIDO (dívida #S-EXEC-2): exercício por TEMPO (prancha/isometria em segundos) NÃO é
-- modelado — reps_done não vira segundos. Solução futura ADITIVA: workout_set_logs.duration_seconds
-- nullable. Não implementado agora (só registrado).
--
-- RLS: policies PERMISSIVAS de sprint (seed fictício), espelhando activity_sessions
-- (migrations/20260702120000): SELECT + INSERT para anon/authenticated. Sem UPDATE/DELETE de
-- propósito (execução é append-only nesta fase). #11–#14 vão FECHAR por clínica/vínculo/papel.
-- Intenção da RLS real (S9): SELECT do paciente dono + profissionais vinculados; INSERT só o paciente
-- dono (auth.uid()->patients) ou o profissional vinculado. AMBAS as tabelas entram no checklist #14.
--
-- Rollback:
--   drop policy if exists sprint_workout_set_read      on public.workout_set_logs;
--   drop policy if exists sprint_workout_set_write     on public.workout_set_logs;
--   drop policy if exists sprint_workout_session_read  on public.workout_session_logs;
--   drop policy if exists sprint_workout_session_write on public.workout_session_logs;
--   drop table  if exists public.workout_set_logs cascade;
--   drop table  if exists public.workout_session_logs cascade;
-- =====================================================================================

create table if not exists public.workout_session_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  workout_id uuid references public.workouts(id) on delete set null,  -- LINK que faltava; SET NULL sobrevive à edição do plano
  workout_name text,                                                  -- snapshot p/ leitura após o plano sumir
  performed_on date not null default (now() at time zone 'America/Sao_Paulo')::date, -- data LOCAL (o app envia; default é fallback LOCAL, não UTC)
  started_at timestamptz,                                             -- nullable; populado do início da sessão
  completed_at timestamptz,                                           -- nullable
  total_duration_min int,                                             -- nullable; derivado dos timestamps (UI não obriga)
  notes text,                                                         -- nullable
  source text not null default 'app',
  created_at timestamptz not null default now()
);

create index if not exists workout_session_logs_patient_performed_idx
  on public.workout_session_logs (patient_id, performed_on desc);

-- Hardening: garante o default LOCAL mesmo em bancos onde a tabela já existia (create table if not exists = no-op).
alter table public.workout_session_logs
  alter column performed_on set default (now() at time zone 'America/Sao_Paulo')::date;

create table if not exists public.workout_set_logs (
  id uuid primary key default gen_random_uuid(),
  session_log_id uuid not null references public.workout_session_logs(id) on delete cascade,
  workout_exercise_id uuid references public.workout_exercises(id) on delete set null, -- qual exercício do plano
  exercise_name text not null,                                       -- snapshot: leitura sobrevive à edição do plano
  set_index int not null,                                            -- ordem da série (1-based)
  weight_kg numeric(6,2) not null check (weight_kg >= 0),            -- 0 é válido (peso corporal: flexão/prancha)
  reps_done int not null check (reps_done >= 0),
  rpe numeric(3,1) check (rpe is null or (rpe >= 6 and rpe <= 10)),  -- opcional (6-10, permite meio-ponto)
  rest_seconds int,                                                  -- nullable (UI não obriga)
  created_at timestamptz not null default now()
);

create index if not exists workout_set_logs_session_idx
  on public.workout_set_logs (session_log_id);

alter table public.workout_session_logs enable row level security;
alter table public.workout_set_logs enable row level security;

-- Policies PERMISSIVAS de sprint (seed fictício). Substituir por RLS por clínica/vínculo (#11–#14).
drop policy if exists sprint_workout_session_read on public.workout_session_logs;
create policy sprint_workout_session_read on public.workout_session_logs
  for select to anon, authenticated using (true);

drop policy if exists sprint_workout_session_write on public.workout_session_logs;
create policy sprint_workout_session_write on public.workout_session_logs
  for insert to anon, authenticated with check (true);

drop policy if exists sprint_workout_set_read on public.workout_set_logs;
create policy sprint_workout_set_read on public.workout_set_logs
  for select to anon, authenticated using (true);

drop policy if exists sprint_workout_set_write on public.workout_set_logs;
create policy sprint_workout_set_write on public.workout_set_logs
  for insert to anon, authenticated with check (true);
