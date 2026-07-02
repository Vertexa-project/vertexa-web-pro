-- =====================================================================================
-- VERTEXA — meal_logs: refeição do plano marcada como "feita" pelo paciente (app)
-- ADITIVA e reversível. NÃO altera tabelas existentes. NÃO renomeia colunas.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md): a web AUTORA nutrition_plans -> meals; o app só LIA
-- os planos e o check verde de cada refeição era sempre falso (não havia coluna/estado onde
-- gravar). Esta tabela é o ponto CANÔNICO do VALOR/ESTADO "refeição consumida hoje". O marcador
-- de timeline continua em activity_events(type='meal_logged', payload={meal_id}); o VALOR vive AQUI.
--
-- Idempotência: unique (patient_id, meal_id, consumed_on) => marcar 2x no mesmo dia é no-op;
-- o toggle "desmarcar" é um DELETE da linha do dia. consumed_on é a data LOCAL do registro
-- (o app resolve o fuso e envia a data; default current_date é apenas fallback do servidor).
--
-- RLS: policies PERMISSIVAS de sprint (seed fictício), espelhando weight_logs
-- (migrations/20260625120000). Split INSERT/DELETE segue o precedente de muscle_recovery_states
-- (sprint_muscle_write_insert/_update). #11–#14 vão FECHAR por clínica/vínculo/papel (dado real).
--
-- Rollback:
--   drop policy if exists sprint_meal_read         on public.meal_logs;
--   drop policy if exists sprint_meal_write_insert  on public.meal_logs;
--   drop policy if exists sprint_meal_write_delete  on public.meal_logs;
--   drop table  if exists public.meal_logs cascade;
-- =====================================================================================

create table if not exists public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  meal_id uuid not null references public.meals(id) on delete cascade,
  consumed_on date not null default current_date,
  consumed_at timestamptz not null default now(),
  source text not null default 'app',            -- 'app' (paciente) | outros
  unique (patient_id, meal_id, consumed_on)       -- toggle idempotente por dia
);

create index if not exists meal_logs_patient_consumed_idx
  on public.meal_logs (patient_id, consumed_on);

alter table public.meal_logs enable row level security;

-- Policies PERMISSIVAS de sprint (seed fictício). Substituir por RLS por clínica/vínculo (#11–#14).
drop policy if exists sprint_meal_read on public.meal_logs;
create policy sprint_meal_read on public.meal_logs
  for select to anon, authenticated using (true);

-- "sprint_meal_write" = INSERT + DELETE (toggle). Split em duas policies porque uma policy do
-- Postgres cobre um único comando; UPDATE fica de fora de propósito (o toggle não atualiza linhas).
drop policy if exists sprint_meal_write_insert on public.meal_logs;
create policy sprint_meal_write_insert on public.meal_logs
  for insert to anon, authenticated with check (true);

drop policy if exists sprint_meal_write_delete on public.meal_logs;
create policy sprint_meal_write_delete on public.meal_logs
  for delete to anon, authenticated using (true);
