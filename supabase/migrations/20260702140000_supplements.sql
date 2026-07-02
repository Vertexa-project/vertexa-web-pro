-- =====================================================================================
-- VERTEXA — supplements + supplement_intakes: suplementação do paciente (S3/app)
-- ADITIVA e reversível. NÃO altera tabelas existentes. NÃO renomeia colunas.
--
-- Contexto (docs/CONTRATO_INTEGRACAO.md): a aba Plano › Suplem. do app era 100% mock
-- (mockData.supplements) e "marcar tomado" não existia/persistia. Autoria da LISTA é do
-- profissional (web), como nutrition_plans -> meals; o app grava o VALOR/ESTADO "tomado hoje".
-- Padrão canônico: VALOR em tabela própria (supplement_intakes) + MARCADOR de timeline em
-- activity_events(type='supplement_checked', payload={supplement_id}) via tracker/eventSync.
--
-- Idempotência do toggle: unique (patient_id, supplement_id, taken_on) => marcar 2x no mesmo
-- dia é no-op; desmarcar é DELETE da linha do dia. taken_on é a data LOCAL do paciente (o app
-- resolve o fuso e envia; default current_date é fallback do servidor). Espelha meal_logs.
--
-- SEED: o editor de suplementos NO WEB ainda NÃO existe (dívida "editor de suplementos no web",
-- anotada no contrato) — sem seed a lista ficaria vazia. Plantamos os 5 suplementos da Mariana
-- (ids FIXOS p/ determinismo; on conflict do nothing = idempotente).
--
-- RLS: policies PERMISSIVAS de sprint (seed fictício).
--   supplements: leitura anon/auth + escrita ALL espelhando as tabelas de plano (sprint_plan_write).
--   supplement_intakes: SELECT + INSERT + DELETE espelhando meal_logs (sem UPDATE de propósito).
-- #11–#14 fecham por clínica/vínculo/papel (dado real) — AMBAS anotadas no checklist #14.
--
-- Rollback:
--   drop policy if exists sprint_supplement_read            on public.supplements;
--   drop policy if exists sprint_supplement_write           on public.supplements;
--   drop policy if exists sprint_supplement_intake_read     on public.supplement_intakes;
--   drop policy if exists sprint_supplement_intake_insert   on public.supplement_intakes;
--   drop policy if exists sprint_supplement_intake_delete   on public.supplement_intakes;
--   drop table  if exists public.supplement_intakes cascade;
--   drop table  if exists public.supplements cascade;
-- =====================================================================================

-- Lista de suplementos (autoria do web; o app só LÊ)
create table if not exists public.supplements (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  dose text,
  time_label text,                              -- rótulo livre: "Manhã", "Pós-treino", ...
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists supplements_patient_order_idx
  on public.supplements (patient_id, order_index);

-- "Tomado hoje" (o app ESCREVE; VALOR do estado — o marcador de timeline vive em activity_events)
create table if not exists public.supplement_intakes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  supplement_id uuid not null references public.supplements(id) on delete cascade,
  taken_on date not null default current_date,
  taken_at timestamptz not null default now(),
  source text not null default 'app',
  unique (patient_id, supplement_id, taken_on)  -- toggle idempotente por dia
);

create index if not exists supplement_intakes_patient_taken_idx
  on public.supplement_intakes (patient_id, taken_on);

alter table public.supplements enable row level security;
alter table public.supplement_intakes enable row level security;

-- Policies PERMISSIVAS de sprint (seed fictício). Substituir por RLS por clínica/vínculo (#11–#14).
drop policy if exists sprint_supplement_read on public.supplements;
create policy sprint_supplement_read on public.supplements
  for select to anon, authenticated using (true);

-- Escrita da LISTA espelha as tabelas de plano (sprint_plan_write, ALL) — futura autoria do web.
drop policy if exists sprint_supplement_write on public.supplements;
create policy sprint_supplement_write on public.supplements
  for all to anon, authenticated using (true) with check (true);

drop policy if exists sprint_supplement_intake_read on public.supplement_intakes;
create policy sprint_supplement_intake_read on public.supplement_intakes
  for select to anon, authenticated using (true);

drop policy if exists sprint_supplement_intake_insert on public.supplement_intakes;
create policy sprint_supplement_intake_insert on public.supplement_intakes
  for insert to anon, authenticated with check (true);

drop policy if exists sprint_supplement_intake_delete on public.supplement_intakes;
create policy sprint_supplement_intake_delete on public.supplement_intakes
  for delete to anon, authenticated using (true);

-- ── Seed: suplementos da Mariana (ids fixos; espelha o mock que a UI exibia) ────────────
insert into public.supplements (id, patient_id, name, dose, time_label, order_index) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b1', 'Whey Protein', '30g',       'Pós-treino', 0),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000b1', 'Creatina',     '5g',        'Manhã',      1),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000b1', 'Ômega 3',      '1 cápsula', 'Almoço',     2),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-0000000000b1', 'Vitamina D',   '2000 UI',   'Manhã',      3),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-0000000000b1', 'Magnésio',     '400mg',     'Noite',      4)
on conflict (id) do nothing;
