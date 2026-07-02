-- =====================================================================================
-- VERTEXA — achievements + patient_achievements: catálogo de conquistas + unlocks (S5/app)
-- ADITIVA e reversível. NÃO altera tabelas existentes. NÃO renomeia colunas. NÃO toca o VRI.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md): a aba /achievements do app era 100% mock
-- (mockData.achievements) e a S18 deixou "Conquistas → estado vazio (motor é a S5)". Este é o
-- motor. Padrão: DEFINIÇÕES em catálogo GLOBAL (achievements, product-level, não por-paciente)
-- + UNLOCKS por paciente (patient_achievements), escritos PELO MOTOR (achievementsEngine.ts),
-- NUNCA por INSERT manual.
--
-- ISOLAMENTO DO VRI (invariante da sprint): conquistas NÃO alimentam o adherenceEngine nem o
-- denominador do soft-cap. Escrevem SÓ em patient_achievements; o motor lê os mesmos dados reais
-- (activity_events / weight_logs / patients / meal_logs / activity_sessions / supplement_intakes)
-- mas em caminho separado. A prova é o snapshot da Mariana seguir 96/alta (a232d1a4) intocado.
--
-- Unlock é MONOTÔNICO: uma conquista destravada nunca é "re-travada". Por isso o toggle é UPSERT
-- ON CONFLICT DO NOTHING (preserva a 1ª data) — sem UPDATE nem DELETE para anon.
--
-- RLS: policies PERMISSIVAS de sprint (seed fictício), espelhando weight_logs/meal_logs.
--   achievements:         SELECT anon/auth (catálogo read-only; autoria futura via web/migration).
--   patient_achievements: SELECT + INSERT anon/auth (sem UPDATE/DELETE — unlock monotônico).
-- #11–#14 fecham por clínica/vínculo/papel (dado real) — AMBAS anotadas no checklist #14.
--
-- Aplicada no remoto via apply_migration (ledger do CLI: version 20260702210746). Idempotente
-- (create table if not exists + drop policy if exists + seed on conflict do nothing).
--
-- Rollback:
--   drop policy if exists sprint_achievement_read          on public.achievements;
--   drop policy if exists sprint_patient_achievement_read   on public.patient_achievements;
--   drop policy if exists sprint_patient_achievement_insert on public.patient_achievements;
--   drop table  if exists public.patient_achievements cascade;
--   drop table  if exists public.achievements cascade;
-- =====================================================================================

-- Catálogo GLOBAL de conquistas (product-level). code = chave estável (sem id gerado em migration
-- de dados). Categorias: first_step | streak | weight.
create table if not exists public.achievements (
  code text primary key,
  title text not null,
  description text not null,
  icon text not null,
  category text not null check (category in ('first_step', 'streak', 'weight')),
  sort_order int not null default 0
);

-- Unlocks por paciente (ESCRITOS PELO MOTOR). unique => idempotente; source documenta a origem.
create table if not exists public.patient_achievements (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  achievement_code text not null references public.achievements(code) on delete cascade,
  unlocked_at timestamptz not null default now(),
  source text not null default 'engine',
  unique (patient_id, achievement_code)
);

create index if not exists patient_achievements_patient_idx
  on public.patient_achievements (patient_id, unlocked_at);

alter table public.achievements enable row level security;
alter table public.patient_achievements enable row level security;

-- Catálogo: SELECT permissivo de sprint (leitura pública do seed fictício).
drop policy if exists sprint_achievement_read on public.achievements;
create policy sprint_achievement_read on public.achievements
  for select to anon, authenticated using (true);

-- Unlocks: SELECT + INSERT (o motor grava). UPDATE/DELETE ficam de fora de propósito
-- (unlock monotônico; UPSERT usa ON CONFLICT DO NOTHING, que só precisa de INSERT).
drop policy if exists sprint_patient_achievement_read on public.patient_achievements;
create policy sprint_patient_achievement_read on public.patient_achievements
  for select to anon, authenticated using (true);

drop policy if exists sprint_patient_achievement_insert on public.patient_achievements;
create policy sprint_patient_achievement_insert on public.patient_achievements
  for insert to anon, authenticated with check (true);

-- ── Seed: catálogo aprovado (12 conquistas) — fonte única do catálogo ────────────────────
-- Rótulos de PESO carregam "desde o início do acompanhamento" DE PROPÓSITO (recorte diferente
-- da tela Progresso "no período registrado" — evita a impressão de dois números conflitantes).
insert into public.achievements (code, title, description, icon, category, sort_order) values
  ('first_workout',    'Primeiro treino',                 'Você registrou seu primeiro treino',                              '🏋️', 'first_step', 0),
  ('first_weight',     'Primeiro peso registrado',        'Você registrou seu peso pela primeira vez',                       '⚖️', 'first_step', 1),
  ('first_photo',      'Primeira foto de progresso',      'Você enviou sua primeira foto de acompanhamento',                 '📸', 'first_step', 2),
  ('first_meal_day',   'Primeira refeição marcada',       'Você marcou sua primeira refeição do plano',                      '🥗', 'first_step', 3),
  ('first_activity',   'Primeira atividade complementar', 'Você registrou sua primeira atividade complementar',              '🏃', 'first_step', 4),
  ('first_supplement', 'Primeiro suplemento tomado',      'Você marcou seu primeiro suplemento',                             '💊', 'first_step', 5),
  ('streak_7',         '7 dias de constância',            'Uma semana seguida de registros',                                 '🔥', 'streak',     6),
  ('streak_14',        '14 dias de constância',           'Duas semanas seguidas de registros',                              '🔥', 'streak',     7),
  ('streak_30',        '30 dias de constância',           'Um mês completo de constância',                                   '🏆', 'streak',     8),
  ('weight_3kg',       '3 kg eliminados',                 '3 kg eliminados desde o início do acompanhamento',                '⚖️', 'weight',     9),
  ('weight_5kg',       '5 kg eliminados',                 '5 kg eliminados desde o início do acompanhamento',                '🎯', 'weight',    10),
  ('weight_target',    'Peso-alvo atingido',              'Você alcançou seu peso-alvo',                                     '🌟', 'weight',    11)
on conflict (code) do nothing;
